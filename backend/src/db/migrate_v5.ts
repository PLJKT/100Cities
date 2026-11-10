import type { Database } from 'better-sqlite3';
import { AUTOMATION_RULES } from '../modules/automation/rules.seed';

function addColIfMissing(db: Database, table: string, col: string, ddl: string) {
  const c = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  if (!c.length) return;
  if (!c.some((x) => x.name === col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    // eslint-disable-next-line no-console
    console.log(`[migrate:v5] ${table}.${col} added`);
  }
}

/** 生成下一个案件编号 C-YYYYMM-0001 */
export function nextCaseNo(db: Database): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `C-${ym}-`;
  const row = db
    .prepare(`SELECT case_no FROM biz_case WHERE case_no LIKE ? ORDER BY case_no DESC LIMIT 1`)
    .get(`${prefix}%`) as any;
  const last = row?.case_no ? parseInt(String(row.case_no).slice(prefix.length), 10) : 0;
  return `${prefix}${String((isNaN(last) ? 0 : last) + 1).padStart(4, '0')}`;
}

/**
 * v5 迁移：补列 → 建索引 → 灌规则种子 → 回填存量数据。
 * 全部幂等，每次启动可重复执行。
 */
export function migrateV5(db: Database) {
  // 1) 关联列（老库需要 ALTER；新库由 CREATE TABLE 建，这里补 case_id 两处）
  addColIfMissing(db, 'pipeline', 'case_id', `INTEGER REFERENCES biz_case(id)`);
  addColIfMissing(db, 'project', 'case_id', `INTEGER REFERENCES biz_case(id)`);

  // 2) 索引（必须在列存在之后创建）
  db.exec(`
    CREATE INDEX IF NOT EXISTS ix_pipeline_case ON pipeline(case_id);
    CREATE INDEX IF NOT EXISTS ix_project_case  ON project(case_id);
  `);

  // 3) 规则种子：INSERT OR IGNORE，后台改过的规则不会被覆盖
  const ins = db.prepare(
    `INSERT OR IGNORE INTO automation_rule (rule_key, name, event_type, condition_json, actions_json, priority, enabled, description)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  );
  for (const r of AUTOMATION_RULES) {
    ins.run(
      r.key,
      r.name,
      r.event,
      JSON.stringify(r.condition || {}),
      JSON.stringify(r.actions),
      r.priority ?? 0,
      r.description || null
    );
  }

  backfillCases(db);
}

/**
 * 存量数据回填：把已有的 lead / partner_profile / project / pipeline 挂到统一个案上。
 * 只做「补链」，不改业务状态值。
 */
function backfillCases(db: Database) {
  const hasCase = (sql: string, ...args: any[]) =>
    db.prepare(sql).get(...args) !== undefined;

  const insertCase = db.prepare(
    `INSERT INTO biz_case (case_no, origin, org_name, country, industry, company_size, source_channel,
                           lifecycle, review_status, value_desc, lead_id, partner_profile_id, asset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const leadLife: Record<string, string> = {
    new: 'inquiry',
    under_review: 'inquiry',
    approved: 'qualified',
    rejected: 'dropped',
    converted: 'won',
  };
  const leadReview: Record<string, string> = { approved: 'approved', rejected: 'rejected' };

  db.transaction(() => {
    // 3.1 每条 lead 一个案件
    const leads = db.prepare(`SELECT * FROM lead`).all() as any[];
    for (const l of leads) {
      if (hasCase(`SELECT id FROM biz_case WHERE lead_id=?`, l.id)) continue;
      insertCase.run(
        nextCaseNo(db),
        'lead',
        l.company_name,
        null,
        l.industry || null,
        l.company_size || null,
        l.source_channel || null,
        leadLife[l.status] || 'inquiry',
        leadReview[l.status] || 'pending',
        l.estimated_value || null,
        l.id,
        null,
        null
      );
    }

    // 3.2 每个会员档案一个案件（已有 lead 案的会员不重复建）
    const partners = db.prepare(`SELECT * FROM partner_profile`).all() as any[];
    for (const p of partners) {
      if (hasCase(`SELECT id FROM biz_case WHERE partner_profile_id=?`, p.id)) continue;
      insertCase.run(
        nextCaseNo(db),
        'partner',
        p.company_name,
        p.nationality || null,
        p.industry || null,
        null,
        null,
        p.status === 'active' ? 'qualified' : 'inquiry',
        'pending',
        null,
        null,
        p.id,
        null
      );
    }

    // 3.3 旧 pipeline 挂到案件（按 lead_id / partner_id 反查）
    const pipes = db.prepare(`SELECT * FROM pipeline WHERE case_id IS NULL`).all() as any[];
    for (const p of pipes) {
      const c = p.lead_id
        ? (db.prepare(`SELECT id FROM biz_case WHERE lead_id=?`).get(p.lead_id) as any)
        : p.partner_id
        ? (db.prepare(`SELECT id FROM biz_case WHERE partner_profile_id=?`).get(p.partner_id) as any)
        : null;
      if (c?.id) db.prepare(`UPDATE pipeline SET case_id=? WHERE id=?`).run(c.id, p.id);
    }

    // 3.4 旧项目回挂案件，并回写 case.project_id
    const projects = db.prepare(`SELECT * FROM project WHERE case_id IS NULL`).all() as any[];
    for (const pr of projects) {
      const c = pr.lead_id
        ? (db.prepare(`SELECT id FROM biz_case WHERE lead_id=?`).get(pr.lead_id) as any)
        : pr.member_id
        ? (db.prepare(`SELECT id FROM biz_case WHERE partner_profile_id=?`).get(pr.member_id) as any)
        : null;
      if (!c?.id) continue;
      db.prepare(`UPDATE project SET case_id=? WHERE id=?`).run(c.id, pr.id);
      db.prepare(`UPDATE biz_case SET project_id=?, asset_id=COALESCE(asset_id,?) WHERE id=?`)
        .run(pr.id, pr.asset_id || null, c.id);
    }
  })();
}
