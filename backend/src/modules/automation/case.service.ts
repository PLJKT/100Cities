import { getDb } from '../../config/db';
import { emit, drain } from './bus';

/**
 * 案件（Case）——招商主链的唯一入口。
 *
 * 关键取舍：pipeline.stage 仍然是"阶段"的唯一真相，biz_case 不复制 stage。
 * 所有路由想改阶段，只能调 advanceStage()，由它改 pipeline + 写 pipeline_event + 发事件。
 * 这样"谁改了阶段、为什么改、改完触发了什么"永远是同一条链。
 */

export const STAGES = ['intake', 'matching', 'site_visit', 'proposal', 'decision'] as const;
export type Stage = (typeof STAGES)[number];

/** 各阶段 SLA（天），超时由调度器发 case.stage_overdue */
export const STAGE_SLA_DAYS: Record<string, number> = {
  intake: 14,
  matching: 14,
  site_visit: 21,
  proposal: 21,
  decision: 14,
};

export class CaseError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function getCase(caseId: number): any {
  const c = getDb().prepare(`SELECT * FROM biz_case WHERE id=?`).get(caseId);
  if (!c) throw new CaseError('Case not found', 404);
  return c;
}

export function getOrCreatePipeline(caseId: number): any {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(caseId) as any;
  if (existing) return existing;
  const c = getCase(caseId);
  const info = db
    .prepare(
      `INSERT INTO pipeline (case_id, lead_id, partner_id, submit_id, stage, entered_at, updated_at)
       VALUES (?, ?, ?, ?, 'intake', datetime('now'), datetime('now'))`
    )
    .run(caseId, c.lead_id, c.partner_profile_id, c.submit_id);
  return db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(Number(info.lastInsertRowid));
}

/**
 * 阶段流转：唯一写入口。
 * - 只允许向前推进；回退必须显式 force（会留痕）
 * - 事务内写 pipeline + pipeline_event + 同步 lead 状态 + 发 case.stage_changed
 */
export function advanceStage(
  caseId: number,
  toStage: string,
  note: string | null,
  actor: { userId?: number | null; type: 'user' | 'system' } = { type: 'system' },
  opts: { force?: boolean } = {}
): { from: string; to: string; pipelineId: number; drained: any } {
  const db = getDb();
  const c = getCase(caseId);
  const pipe = getOrCreatePipeline(caseId);
  const from = pipe.stage as string;

  if (!STAGES.includes(toStage as Stage)) throw new CaseError(`Unknown stage '${toStage}'`);
  if (from === toStage) throw new CaseError(`Case ${c.case_no} is already in stage '${toStage}'`);

  const fi = STAGES.indexOf(from as Stage);
  const ti = STAGES.indexOf(toStage as Stage);
  if (ti < fi && !opts.force) {
    throw new CaseError(
      `Backward transition ${from} → ${toStage} requires force=true (it will be recorded as a re-stage)`,
      409
    );
  }

  let eventId = 0;
  db.transaction(() => {
    db.prepare(
      `UPDATE pipeline SET stage=?, stage_note=?, entered_at=datetime('now'), updated_at=datetime('now'), updated_by=? WHERE id=?`
    ).run(toStage, note || null, actor.userId ?? null, pipe.id);

    db.prepare(`INSERT INTO pipeline_event (pipeline_id, from_stage, to_stage, note, user_id) VALUES (?, ?, ?, ?, ?)`).run(
      pipe.id,
      from,
      toStage,
      opts.force && ti < fi ? `[RE-STAGE] ${note || ''}` : note || null,
      actor.userId ?? null
    );

    db.prepare(`UPDATE biz_case SET updated_at=datetime('now') WHERE id=?`).run(caseId);

    // 线索状态跟随（state 同步只在这里做，避免多处手写）
    if (c.lead_id) {
      const lead = db.prepare(`SELECT status FROM lead WHERE id=?`).get(c.lead_id) as any;
      if (lead && lead.status !== 'converted' && lead.status !== 'rejected') {
        const next = toStage === 'decision' ? 'approved' : lead.status === 'new' ? 'under_review' : lead.status;
        if (next !== lead.status) {
          db.prepare(`UPDATE lead SET status=?, updated_at=datetime('now') WHERE id=?`).run(next, c.lead_id);
        }
      }
    }

    eventId = emit({
      type: 'case.stage_changed',
      entityType: 'biz_case',
      entityId: caseId,
      caseId,
      actor,
      payload: {
        case_no: c.case_no,
        org_name: c.org_name,
        from_stage: from,
        to_stage: toStage,
        stage: toStage,
        asset_id: c.asset_id,
        owner_user_id: c.owner_user_id,
        note: note || null,
        forced: !!opts.force,
      },
    });
  })();

  const drained = drain();
  return { from, to: toStage, pipelineId: pipe.id, drained: { ...drained, eventId } };
}

/** 成交：lifecycle=won + 发 case.won（资产转租、项目收口、释放竞争预留都由规则完成） */
export function markWon(caseId: number, note: string | null, actor: { userId?: number | null; type: 'user' | 'system' }) {
  const db = getDb();
  const c = getCase(caseId);
  if (c.lifecycle === 'won') throw new CaseError('Case already won', 409);

  let eventId = 0;
  db.transaction(() => {
    db.prepare(`UPDATE biz_case SET lifecycle='won', updated_at=datetime('now') WHERE id=?`).run(caseId);
    if (c.lead_id) db.prepare(`UPDATE lead SET status='converted', updated_at=datetime('now') WHERE id=?`).run(c.lead_id);
    eventId = emit({
      type: 'case.won',
      entityType: 'biz_case',
      entityId: caseId,
      caseId,
      actor,
      payload: { case_no: c.case_no, org_name: c.org_name, asset_id: c.asset_id, note: note || null },
    });
  })();

  const drained = drain();
  return { eventId, drained };
}

/** 失单：lifecycle=lost + 发 case.lost（释放预留、项目暂停、生成复盘任务） */
export function markLost(caseId: number, reason: string | null, actor: { userId?: number | null; type: 'user' | 'system' }) {
  const db = getDb();
  const c = getCase(caseId);
  if (c.lifecycle === 'lost') throw new CaseError('Case already lost', 409);

  let eventId = 0;
  db.transaction(() => {
    db.prepare(`UPDATE biz_case SET lifecycle='lost', value_desc=COALESCE(value_desc, NULL), updated_at=datetime('now') WHERE id=?`).run(caseId);
    if (c.lead_id) db.prepare(`UPDATE lead SET status='rejected', updated_at=datetime('now') WHERE id=?`).run(c.lead_id);
    eventId = emit({
      type: 'case.lost',
      entityType: 'biz_case',
      entityId: caseId,
      caseId,
      actor,
      payload: { case_no: c.case_no, org_name: c.org_name, reason: reason || null },
    });
  })();

  const drained = drain();
  return { eventId, drained };
}

/** 资产可用性校验：已被别的案件硬预留、或已出租，都不允许再次占用 */
export function assertAssetFree(assetId: number, caseId: number | null) {
  const db = getDb();
  const asset = db.prepare(`SELECT * FROM asset WHERE id=?`).get(assetId) as any;
  if (!asset) throw new CaseError('Asset not found', 404);

  const hard = db
    .prepare(
      `SELECT h.*, bc.case_no FROM asset_hold h JOIN biz_case bc ON bc.id=h.case_id
       WHERE h.asset_id=? AND h.hold_type='hard' AND h.status IN ('active','confirmed')
         AND (? IS NULL OR h.case_id<>?)`
    )
    .get(assetId, caseId, caseId) as any;
  if (hard) throw new CaseError(`Asset is hard-held by case ${hard.case_no}`, 409);
  if (asset.status === 'leased') throw new CaseError('Asset is already leased', 409);
  return asset;
}

/** 关联意向资产（带占用校验；真正的 hold 由规则在阶段推进时创建） */
export function linkAsset(caseId: number, assetId: number | null, actor: { userId?: number | null; type: 'user' | 'system' }) {
  const db = getDb();
  const c = getCase(caseId);
  if (assetId != null) assertAssetFree(assetId, caseId);

  db.prepare(`UPDATE biz_case SET asset_id=?, updated_at=datetime('now') WHERE id=?`).run(assetId, caseId);
  emit({
    type: 'case.asset_linked',
    entityType: 'biz_case',
    entityId: caseId,
    caseId,
    actor,
    payload: { case_no: c.case_no, asset_id: assetId },
  });
  drain();
  return { caseId, assetId };
}

/** 线索 → 案件（幂等）：没有案件时发 lead.created，由规则 R03 建案并生成资格判定任务 */
export function ensureCaseForLead(leadId: number, actor: { userId?: number | null; type: 'user' | 'system' }): any {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM biz_case WHERE lead_id=?`).get(leadId) as any;
  if (existing) return existing;
  emit({
    type: 'lead.created',
    entityType: 'lead',
    entityId: leadId,
    actor,
    payload: { lead_id: leadId },
  });
  drain();
  return db.prepare(`SELECT * FROM biz_case WHERE lead_id=?`).get(leadId);
}

/** 案件 360：一个接口拼出所有相关模块，前端不必再分别拉 6 个表 */
export function caseView(caseId: number): any {
  const db = getDb();
  const c = getCase(caseId);
  const pipe = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(caseId) || null;
  const partner = c.partner_profile_id
    ? db.prepare(`SELECT * FROM partner_profile WHERE id=?`).get(c.partner_profile_id)
    : null;
  const lead = c.lead_id ? db.prepare(`SELECT * FROM lead WHERE id=?`).get(c.lead_id) : null;
  const submit = c.submit_id ? db.prepare(`SELECT * FROM form_submit WHERE id=?`).get(c.submit_id) : null;
  const submitData = c.submit_id
    ? db.prepare(`SELECT field_key, field_value FROM form_submit_data WHERE submit_id=?`).all(c.submit_id)
    : [];
  const project = c.project_id ? db.prepare(`SELECT * FROM project WHERE id=?`).get(c.project_id) : null;
  const milestones = c.project_id
    ? db.prepare(`SELECT * FROM project_milestone WHERE project_id=? ORDER BY due_date, id`).all(c.project_id)
    : [];
  const asset = c.asset_id ? db.prepare(`SELECT * FROM asset WHERE id=?`).get(c.asset_id) : null;
  const holds = db
    .prepare(
      `SELECT h.*, bc.case_no FROM asset_hold h JOIN biz_case bc ON bc.id=h.case_id WHERE h.case_id=? ORDER BY h.id DESC`
    )
    .all(caseId);
  const tasks = db.prepare(`SELECT * FROM task WHERE case_id=? ORDER BY status, due_at`).all(caseId);
  const stageHistory = pipe
    ? db.prepare(`SELECT * FROM pipeline_event WHERE pipeline_id=? ORDER BY id`).all((pipe as any).id)
    : [];
  const events = db.prepare(`SELECT * FROM biz_event WHERE case_id=? ORDER BY id DESC LIMIT 30`).all(caseId);

  const ageDays = pipe
    ? Math.floor(
        (Date.now() - new Date((pipe as any).entered_at.replace(' ', 'T') + 'Z').getTime()) / 86400000
      )
    : null;

  return {
    case: c,
    stage: (pipe as any)?.stage || null,
    stage_entered_at: (pipe as any)?.entered_at || null,
    stage_age_days: ageDays,
    stage_sla_days: (pipe as any)?.stage ? STAGE_SLA_DAYS[(pipe as any).stage] : null,
    partner,
    lead,
    submit,
    submit_data: submitData,
    project,
    milestones,
    asset,
    holds,
    tasks,
    stage_history: stageHistory,
    events,
  };
}

/** 统一时间线：把 6 个模块的痕迹压成一条叙事，这是"内容协调"的可视化出口 */
export function caseTimeline(caseId: number): any[] {
  const db = getDb();
  const c = getCase(caseId);
  const pipe = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(caseId) as any;
  const items: any[] = [];

  for (const e of db.prepare(`SELECT * FROM biz_event WHERE case_id=? ORDER BY id`).all(caseId) as any[]) {
    let payload: any = {};
    try {
      payload = JSON.parse(e.payload || '{}');
    } catch {
      payload = {};
    }
    items.push({
      at: e.occurred_at,
      kind: 'event',
      code: e.event_type,
      title: e.event_type,
      detail: payload.note || payload.message || payload.reason || payload.name || '',
      actor: e.actor,
    });
  }

  if (pipe) {
    for (const pe of db.prepare(`SELECT * FROM pipeline_event WHERE pipeline_id=?`).all(pipe.id) as any[]) {
      items.push({
        at: pe.created_at,
        kind: 'stage',
        code: `${pe.from_stage || '—'} → ${pe.to_stage}`,
        title: `Stage: ${pe.from_stage || '—'} → ${pe.to_stage}`,
        detail: pe.note || '',
        actor: pe.user_id ? 'user' : 'system',
      });
    }
  }

  for (const t of db.prepare(`SELECT * FROM task WHERE case_id=?`).all(caseId) as any[]) {
    items.push({
      at: t.created_at,
      kind: 'task',
      code: t.task_type,
      title: `Task created: ${t.title}`,
      detail: `Due ${t.due_at || '—'} · ${t.priority}`,
      actor: 'system',
    });
    if (t.closed_at) {
      items.push({ at: t.closed_at, kind: 'task', code: t.task_type, title: `Task ${t.status}: ${t.title}`, detail: '', actor: 'user' });
    }
  }

  if (c.lead_id) {
    for (const f of db.prepare(`SELECT * FROM lead_followup WHERE lead_id=?`).all(c.lead_id) as any[]) {
      items.push({ at: f.follow_at || f.created_at, kind: 'followup', code: 'lead.followup', title: `Follow-up: ${f.action}`, detail: f.note || '', actor: 'user' });
    }
  }

  for (const n of db.prepare(`SELECT * FROM notification WHERE ref_type='biz_case' AND ref_id=?`).all(caseId) as any[]) {
    items.push({ at: n.created_at, kind: 'notify', code: n.channel, title: `${n.channel.toUpperCase()} → ${n.to_addr}`, detail: n.subject || n.body_summary || '', actor: 'system' });
  }

  return items.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/** 列出案件（带阶段与任务计数，供列表页一次取全） */
export function listCases(q: {
  lifecycle?: string;
  stage?: string;
  q?: string;
  owner?: number;
  limit?: number;
  offset?: number;
}): { items: any[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];
  if (q.lifecycle) {
    where.push(`c.lifecycle = ?`);
    args.push(q.lifecycle);
  }
  if (q.stage) {
    where.push(`COALESCE(p.stage,'intake') = ?`);
    args.push(q.stage);
  }
  if (q.owner) {
    where.push(`c.owner_user_id = ?`);
    args.push(q.owner);
  }
  if (q.q) {
    where.push(`(c.org_name LIKE ? OR c.case_no LIKE ? OR c.country LIKE ?)`);
    args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) n FROM biz_case c LEFT JOIN pipeline p ON p.case_id=c.id ${w}`).get(...args) as any).n;
  const limit = Math.min(Number(q.limit || 50), 200);
  const offset = Number(q.offset || 0);

  const items = db
    .prepare(
      `SELECT c.*, COALESCE(p.stage,'intake') AS stage, p.entered_at AS stage_entered_at,
              CASE WHEN p.entered_at IS NULL THEN NULL
                   ELSE CAST(julianday('now') - julianday(p.entered_at) AS INTEGER) END AS stage_age_days,
              (SELECT COUNT(*) FROM task t WHERE t.case_id=c.id AND t.status='open') AS open_tasks,
              (SELECT COUNT(*) FROM task t WHERE t.case_id=c.id AND t.status='open' AND t.due_at < datetime('now')) AS overdue_tasks,
              a.name AS asset_name
       FROM biz_case c
       LEFT JOIN pipeline p ON p.case_id=c.id
       LEFT JOIN asset a ON a.id=c.asset_id
       ${w}
       ORDER BY c.updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);

  return { items, total };
}
