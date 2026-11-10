import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { emit, drain } from '../automation/bus';
import { advanceStage, ensureCaseForLead, STAGES } from '../automation/case.service';

const r = Router();

const LEAD_STATUSES = ['new', 'under_review', 'approved', 'rejected', 'converted'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const FOLLOWUP_ACTIONS = ['call', 'email', 'meeting', 'site_visit', 'note'];

function enrich(row: any) {
  const u = getDb()
    .prepare(`SELECT id, username, partner_name FROM sys_user WHERE id=?`)
    .get(row.channel_user_id);
  const a = row.assigned_to
    ? getDb().prepare(`SELECT id, username, partner_name FROM sys_user WHERE id=?`).get(row.assigned_to)
    : null;
  return { ...row, channel: u || null, assignee: a || null };
}

/** 潜客列表（管理员/审核；支持筛选） */
r.get('/', authRequired, requirePerm('review'), (req, res) => {
  const { status, industry, source, priority, q } = req.query as any;
  const cond: string[] = [];
  const args: any[] = [];
  if (status) { cond.push(`status=?`); args.push(status); }
  if (industry) { cond.push(`industry=?`); args.push(industry); }
  if (source) { cond.push(`source_channel=?`); args.push(source); }
  if (priority) { cond.push(`priority=?`); args.push(priority); }
  if (q) { cond.push(`(company_name LIKE ? OR contact_name LIKE ? OR contact_email LIKE ?)`); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM lead ${where} ORDER BY id DESC`).all(...args);
  res.json(rows.map(enrich));
});

/** 我的录入（渠道方只看自己） */
r.get('/my', authRequired, (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM lead WHERE channel_user_id=? ORDER BY id DESC`)
    .all(req.user!.uid)
    .map(enrich);
  res.json(rows);
});

/** 潜客统计（v4：来源/行业/规模/优先级/漏斗/趋势） */
r.get('/stats', authRequired, requirePerm('review'), (_req, res) => {
  const db = getDb();
  const rows = (sql: string) => db.prepare(sql).all() as any[];
  const kv = (arr: any[]) => Object.fromEntries(arr.map((x) => [x.k, x.c]));
  const total = (db.prepare(`SELECT COUNT(*) c FROM lead`).get() as any).c;
  const converted = (db.prepare(`SELECT COUNT(*) c FROM lead WHERE status='converted' OR status='approved'`).get() as any).c;
  const byStatus = rows(`SELECT status AS k, COUNT(*) c FROM lead GROUP BY status`);
  const bySource = rows(`SELECT source_channel AS k, COUNT(*) c FROM lead GROUP BY source_channel`);
  const byIndustry = rows(`SELECT industry AS k, COUNT(*) c FROM lead WHERE industry IS NOT NULL GROUP BY industry ORDER BY c DESC LIMIT 10`);
  const bySize = rows(`SELECT company_size AS k, COUNT(*) c FROM lead GROUP BY company_size`);
  const byPriority = rows(`SELECT priority AS k, COUNT(*) c FROM lead GROUP BY priority`);
  const weekly = rows(`
    SELECT strftime('%Y-W%W', created_at) AS k, COUNT(*) c FROM lead
    WHERE created_at >= datetime('now','-8 weeks') GROUP BY k ORDER BY k`);
  // 五步漏斗（pipeline 当前所在阶段）
  const funnel = rows(`SELECT stage AS k, COUNT(*) c FROM pipeline WHERE lead_id IS NOT NULL GROUP BY stage`);
  res.json({
    total,
    conversionRate: total ? Math.round((converted / total) * 100) : 0,
    byStatus: kv(byStatus),
    bySource: kv(bySource),
    byIndustry: kv(byIndustry),
    bySize: kv(bySize),
    byPriority: kv(byPriority),
    weeklyTrend: weekly,
    funnel: kv(funnel),
  });
});

/** 渠道方录入潜在客户（功能 3：行业/规模/诉求等；v4：预计投资额/优先级/下一步） */
r.post('/', authRequired, requirePerm('partner.form'), (req: AuthedRequest, res) => {
  const b = req.body || {};
  const { company_name, industry, company_size, need_description, contact_name, contact_phone, contact_email, source_channel, estimated_value, priority, next_action, next_follow_at } = b;
  if (!company_name) return res.status(400).json({ error: { message: 'company_name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO lead (channel_user_id, company_name, industry, company_size, need_description, contact_name, contact_phone, contact_email, source_channel, estimated_value, priority, next_action, next_follow_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.uid,
      company_name,
      industry || null,
      ['SME', 'Mid', 'Large', 'Enterprise'].includes(company_size) ? company_size : 'SME',
      need_description || null,
      contact_name || null,
      contact_phone || null,
      contact_email || null,
      source_channel || 'direct',
      estimated_value || null,
      PRIORITIES.includes(priority) ? priority : 'normal',
      next_action || null,
      next_follow_at || null,
    );
  writeLog(req.user!.uid, 'lead.create', 'lead', Number(info.lastInsertRowid), { company_name });
  // 线索录入即触发联动：R03 会建案 + 生成资格判定任务
  const eventId = emit({
    type: 'lead.created',
    entityType: 'lead',
    entityId: Number(info.lastInsertRowid),
    actor: { type: 'user', userId: req.user!.uid },
    payload: { lead_id: Number(info.lastInsertRowid), company_name },
  });
  const drained = drain();
  const c = getDb().prepare(`SELECT id, case_no FROM biz_case WHERE lead_id=?`).get(info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid, status: 'new', event_id: eventId, case: c || null, automation: drained });
});

/** 潜客详情（v4：含 pipeline 全历史 + 跟进台账 + 关联项目） */
r.get('/:id', authRequired, (req: AuthedRequest, res) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const canView = req.user!.role_id === 1 || req.user!.role_id === 3 || lead.channel_user_id === req.user!.uid;
  if (!canView) return res.status(403).json({ error: { message: 'forbidden' } });
  const followups = db.prepare(`SELECT * FROM lead_followup WHERE lead_id=? ORDER BY id DESC`).all(lead.id);
  const projects = db.prepare(`SELECT * FROM project WHERE lead_id=? ORDER BY id DESC`).all(lead.id);
  res.json({ ...enrich(lead), followups, projects });
});

/** 新增跟进记录（v4：台账——动作/备注/时间） */
r.post('/:id/followups', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const { action, note, follow_at } = req.body || {};
  if (!FOLLOWUP_ACTIONS.includes(action)) {
    return res.status(400).json({ error: { message: `action must be one of ${FOLLOWUP_ACTIONS.join('/')}` } });
  }
  const ts = follow_at || new Date().toISOString().slice(0, 19).replace('T', ' ');
  const info = db
    .prepare(`INSERT INTO lead_followup (lead_id, action, note, follow_at, user_id) VALUES (?, ?, ?, ?, ?)`)
    .run(lead.id, action, note || null, ts, req.user!.uid);
  writeLog(req.user!.uid, 'lead.followup', 'lead', lead.id, { action });
  res.json({ id: info.lastInsertRowid });
});

/** 审核更新状态（管理员/审核） */
r.put('/:id/status', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const { status } = req.body || {};
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: { message: `status must be one of ${LEAD_STATUSES.join('/')}` } });
  }
  const info = getDb()
    .prepare(`UPDATE lead SET status=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: { message: 'lead not found' } });
  writeLog(req.user!.uid, 'lead.status', 'lead', Number(req.params.id), { status });
  res.json({ ok: true, status });
});

/** 更新台账字段（负责人/下一步/跟进时间/优先级） */
r.put('/:id', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'lead not found' } });
  const b = req.body || {};
  getDb()
    .prepare(
      `UPDATE lead SET priority=?, assigned_to=?, next_action=?, next_follow_at=?, estimated_value=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      PRIORITIES.includes(b.priority) ? b.priority : row.priority,
      b.assigned_to ?? row.assigned_to,
      b.next_action ?? row.next_action,
      b.next_follow_at ?? row.next_follow_at,
      b.estimated_value ?? row.estimated_value,
      row.id,
    );
  writeLog(req.user!.uid, 'lead.update', 'lead', row.id, {});
  res.json({ ok: true });
});

// ---------- Pipeline（审核五步流转，关联 lead） ----------

/** 查看审核流程（管理员/审核/录入渠道方）——阶段真相来自案件 pipeline */
r.get('/:id/pipeline', authRequired, (req: AuthedRequest, res) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const canView =
    req.user!.role_id === 1 || req.user!.role_id === 3 || lead.channel_user_id === req.user!.uid;
  if (!canView) return res.status(403).json({ error: { message: 'forbidden' } });

  const c = ensureCaseForLead(lead.id, { type: 'user', userId: req.user!.uid });
  const pipe = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(c.id) as any;
  const events = pipe ? db.prepare(`SELECT * FROM pipeline_event WHERE pipeline_id=? ORDER BY id`).all(pipe.id) : [];
  res.json({ lead: enrich(lead), case: c, pipeline: pipe, events });
});

/**
 * 推进审核阶段 —— 不再自己写 pipeline。
 * 统一走 advanceStage：写阶段 + 写历史 + 发 case.stage_changed，
 * 下游（任务、项目、资产预留、里程碑）由规则自动跟上。
 */
r.put('/:id/pipeline', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const { stage, note, force } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: { message: `stage must be one of ${STAGES.join('/')}` } });

  try {
    const c = ensureCaseForLead(lead.id, { type: 'user', userId: req.user!.uid });
    const out = advanceStage(c.id, stage, note || null, { type: 'user', userId: req.user!.uid }, { force: !!force });
    writeLog(req.user!.uid, 'lead.pipeline.advance', 'biz_case', c.id, { from: out.from, to: stage });
    res.json({ ok: true, case_id: c.id, case_no: c.case_no, from: out.from, to: stage, pipeline_id: out.pipelineId, automation: out.drained });
  } catch (e) {
    next(e);
  }
});

export default r;
