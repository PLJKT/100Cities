import { getDb } from '../../config/db';
import { emit, drain } from './bus';
import { STAGE_SLA_DAYS } from './case.service';

/**
 * 任务服务：待办是持久化实体——可分配、可计时、可升级。
 * Dashboard 直接读这里，不再用 COUNT(*) 实时拼"待办"，所以数字和列表永远一致。
 */

export function listTasks(q: {
  status?: string;
  assignee?: number;
  caseId?: number;
  taskType?: string;
  overdue?: boolean;
  limit?: number;
  offset?: number;
}): { items: any[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const args: any[] = [];

  if (q.status) {
    where.push(`t.status = ?`);
    args.push(q.status);
  }
  if (q.assignee) {
    where.push(`t.assignee_user_id = ?`);
    args.push(q.assignee);
  }
  if (q.caseId) {
    where.push(`t.case_id = ?`);
    args.push(q.caseId);
  }
  if (q.taskType) {
    where.push(`t.task_type = ?`);
    args.push(q.taskType);
  }
  if (q.overdue) {
    where.push(`t.status='open' AND t.due_at IS NOT NULL AND t.due_at < datetime('now')`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) n FROM task t ${w}`).get(...args) as any).n;
  const limit = Math.min(Number(q.limit || 50), 200);
  const offset = Number(q.offset || 0);

  const items = db
    .prepare(
      `SELECT t.*, c.case_no, c.org_name, u.username AS assignee_name,
              CASE WHEN t.status='open' AND t.due_at IS NOT NULL AND t.due_at < datetime('now')
                   THEN 1 ELSE 0 END AS is_overdue
       FROM task t
       LEFT JOIN biz_case c ON c.id=t.case_id
       LEFT JOIN sys_user u ON u.id=t.assignee_user_id
       ${w}
       ORDER BY (t.status='open' AND t.due_at IS NOT NULL AND t.due_at < datetime('now')) DESC,
                t.due_at IS NULL, t.due_at, t.id
       LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset);

  return { items, total };
}

export function getTask(id: number): any {
  const db = getDb();
  const t = db.prepare(`SELECT * FROM task WHERE id=?`).get(id) as any;
  if (!t) return null;
  const runs = t.created_by_event_id
    ? db.prepare(`SELECT * FROM automation_run WHERE event_id=?`).all(t.created_by_event_id)
    : [];
  const event = t.created_by_event_id ? db.prepare(`SELECT * FROM biz_event WHERE id=?`).get(t.created_by_event_id) : null;
  return { ...t, automation: runs, source_event: event };
}

export function updateTaskStatus(
  id: number,
  status: string,
  actor: { userId?: number | null; type: 'user' | 'system' },
  note?: string
) {
  const db = getDb();
  const t = db.prepare(`SELECT * FROM task WHERE id=?`).get(id) as any;
  if (!t) throw new Error('Task not found');
  if (!['open', 'done', 'cancelled'].includes(status)) throw new Error(`Invalid status '${status}'`);

  db.prepare(
    `UPDATE task SET status=?, closed_at=CASE WHEN ?='open' THEN NULL ELSE datetime('now') END,
     updated_at=datetime('now'), detail=COALESCE(?, detail) WHERE id=?`
  ).run(status, status, note || null, id);

  emit({
    type: 'task.status_changed',
    entityType: 'task',
    entityId: id,
    caseId: t.case_id,
    actor,
    payload: { task_id: id, task_type: t.task_type, from: t.status, to: status, title: t.title },
  });
  drain();
  return db.prepare(`SELECT * FROM task WHERE id=?`).get(id);
}

export function assignTask(id: number, userId: number | null, actor: { userId?: number | null; type: 'user' | 'system' }) {
  const db = getDb();
  const t = db.prepare(`SELECT * FROM task WHERE id=?`).get(id) as any;
  if (!t) throw new Error('Task not found');
  db.prepare(`UPDATE task SET assignee_user_id=?, updated_at=datetime('now') WHERE id=?`).run(userId, id);
  emit({
    type: 'task.assigned',
    entityType: 'task',
    entityId: id,
    caseId: t.case_id,
    actor,
    payload: { task_id: id, assignee_user_id: userId, title: t.title },
  });
  drain();
  return db.prepare(`SELECT * FROM task WHERE id=?`).get(id);
}

/**
 * 逾期扫描：把"人盯表格"换成系统盯。
 * 单条任务 24 小时内只升级一次（靠 last_escalated_at 节流）。
 */
export function sweepOverdueTasks(): { scanned: number; escalated: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM task
       WHERE status='open' AND due_at IS NOT NULL AND due_at < datetime('now')
         AND (last_escalated_at IS NULL OR last_escalated_at < datetime('now','-1 day'))
       LIMIT 200`
    )
    .all() as any[];

  let escalated = 0;
  for (const t of rows) {
    const c = t.case_id ? (db.prepare(`SELECT case_no FROM biz_case WHERE id=?`).get(t.case_id) as any) : null;
    emit({
      type: 'task.overdue',
      entityType: 'task',
      entityId: t.id,
      caseId: t.case_id,
      actor: { type: 'system' },
      payload: { task_id: t.id, title: t.title, case_no: c?.case_no || null, due_at: t.due_at },
    });
    escalated++;
  }
  if (escalated) drain();
  return { scanned: rows.length, escalated };
}

/**
 * 阶段 SLA 扫描：同一案件的同一阶段只告警一次（以 stage_entered_at 为界查重）。
 */
export function sweepStageOverdue(): { breached: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT c.id, c.case_no, c.org_name, p.stage, p.entered_at
       FROM biz_case c
       JOIN pipeline p ON p.case_id=c.id
       WHERE c.lifecycle NOT IN ('won','lost','dropped')
         AND p.stage IN ('intake','matching','site_visit','proposal','decision')`
    )
    .all() as any[];

  let breached = 0;
  for (const r of rows) {
    const sla = STAGE_SLA_DAYS[r.stage] ?? 14;
    const ageDays = Math.floor((Date.now() - new Date(String(r.entered_at).replace(' ', 'T') + 'Z').getTime()) / 86400000);
    if (ageDays < sla) continue;

    const already = db
      .prepare(
        `SELECT id FROM biz_event WHERE case_id=? AND event_type='case.stage_overdue' AND occurred_at >= ? LIMIT 1`
      )
      .get(r.id, r.entered_at);
    if (already) continue;

    emit({
      type: 'case.stage_overdue',
      entityType: 'biz_case',
      entityId: r.id,
      caseId: r.id,
      actor: { type: 'system' },
      payload: {
        case_no: r.case_no,
        org_name: r.org_name,
        stage: r.stage,
        age_days: ageDays,
        sla_days: sla,
      },
    });
    breached++;
  }
  if (breached) drain();
  return { breached };
}

/** 预留到期释放（软预留 72h、硬预留 30 天，到期自动回池） */
export function sweepExpiredHolds(): { released: number } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM asset_hold WHERE status='active' AND expires_at IS NOT NULL AND expires_at < datetime('now')`
    )
    .all() as any[];

  for (const h of rows) {
    db.prepare(`UPDATE asset_hold SET status='expired', released_at=datetime('now') WHERE id=?`).run(h.id);
    const others = db
      .prepare(`SELECT COUNT(*) n FROM asset_hold WHERE asset_id=? AND status IN ('active','confirmed')`)
      .get(h.asset_id) as any;
    if (!others.n) {
      const a = db.prepare(`SELECT status FROM asset WHERE id=?`).get(h.asset_id) as any;
      if (a && a.status !== 'planning' && a.status !== 'leased') {
        db.prepare(`UPDATE asset SET status='available', updated_at=datetime('now') WHERE id=?`).run(h.asset_id);
      }
    }
  }
  return { released: rows.length };
}
