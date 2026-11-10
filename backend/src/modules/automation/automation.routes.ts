import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { drain } from '../automation/bus';
import { sweepExpiredHolds, sweepOverdueTasks, sweepStageOverdue } from '../automation/task.service';

/** 自动化台：规则目录 / 事件流 / 执行台账 / 重放 / 手工扫描 */
const r = Router();

const adminOnly = (req: AuthedRequest, res: any, next: any) => {
  if (req.user?.role_name === 'Super Admin') return next();
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Super Admin only' } });
};

/** 规则目录 */
r.get('/rules', authRequired, requirePerm('review'), (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM automation_rule ORDER BY priority, id`).all() as any[];
  res.json(
    rows.map((x) => ({
      ...x,
      condition: JSON.parse(x.condition_json || '{}'),
      actions: JSON.parse(x.actions_json || '[]'),
      stats: db
        .prepare(`SELECT outcome, COUNT(*) n FROM automation_run WHERE rule_key=? GROUP BY outcome`)
        .all(x.rule_key)
        .reduce((acc: any, cur: any) => ({ ...acc, [cur.outcome]: cur.n }), {}),
    }))
  );
});

r.put('/rules/:key', authRequired, adminOnly, (req, res) => {
  const db = getDb();
  const { enabled } = req.body || {};
  const info = db.prepare(`UPDATE automation_rule SET enabled=? WHERE rule_key=?`).run(enabled ? 1 : 0, req.params.key);
  if (!info.changes) return res.status(404).json({ error: { message: 'rule not found' } });
  res.json({ ok: true });
});

/** 事件流（业务事实） */
r.get('/events', authRequired, requirePerm('review'), (req, res) => {
  const { case_id, event_type, status, limit, offset } = req.query as any;
  const cond: string[] = [];
  const args: any[] = [];
  if (case_id) { cond.push(`case_id=?`); args.push(Number(case_id)); }
  if (event_type) { cond.push(`event_type=?`); args.push(event_type); }
  if (status) { cond.push(`status=?`); args.push(status); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const lim = Math.min(Number(limit || 80), 300);
  const rows = getDb()
    .prepare(`SELECT * FROM biz_event ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, lim, Number(offset || 0));
  res.json(rows.map((x: any) => ({ ...x, payload: JSON.parse(x.payload || '{}') })));
});

/** 执行台账（规则为什么跑/为什么没跑） */
r.get('/runs', authRequired, requirePerm('review'), (req, res) => {
  const { case_id, outcome, limit } = req.query as any;
  const cond: string[] = [];
  const args: any[] = [];
  if (case_id) { cond.push(`r.case_id=?`); args.push(Number(case_id)); }
  if (outcome) { cond.push(`r.outcome=?`); args.push(outcome); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(
      `SELECT r.*, ru.name AS rule_name FROM automation_run r
       LEFT JOIN automation_rule ru ON ru.rule_key=r.rule_key
       ${where} ORDER BY r.id DESC LIMIT ?`
    )
    .all(...args, Math.min(Number(limit || 100), 300));
  res.json(rows);
});

/** 重放某条事件（幂等键会阻止重复产物，这里同时清掉该事件的执行台账） */
r.post('/replay/:eventId', authRequired, adminOnly, (req, res) => {
  const db = getDb();
  const id = Number(req.params.eventId);
  const ev = db.prepare(`SELECT * FROM biz_event WHERE id=?`).get(id) as any;
  if (!ev) return res.status(404).json({ error: { message: 'event not found' } });
  db.transaction(() => {
    db.prepare(`DELETE FROM automation_run WHERE event_id=?`).run(id);
    db.prepare(`UPDATE biz_event SET status='pending', error=NULL, processed_at=NULL WHERE id=?`).run(id);
  })();
  const out = drain();
  res.json({ ok: true, ...out });
});

/** 手工触发扫描（定时任务之外的兜底） */
r.post('/sweep', authRequired, requirePerm('review'), (_req, res) => {
  res.json({
    tasks: sweepOverdueTasks(),
    stages: sweepStageOverdue(),
    holds: sweepExpiredHolds(),
    drained: drain(),
  });
});

export default r;
