import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';

const r = Router();

/** 汇总：审核 / BOD 只读可见 */
r.get('/summary', authRequired, requirePerm('dashboard'), (_req: AuthedRequest, res) => {
  const total = (getDb().prepare(`SELECT COUNT(*) c FROM form_submit`).get() as any).c;
  const approved = (getDb().prepare(`SELECT COUNT(*) c FROM form_submit WHERE status='approved'`).get() as any).c;
  const overdue = (getDb().prepare(`SELECT COUNT(*) c FROM form_submit WHERE status='pending' AND submit_time < datetime('now','-7 day')`).get() as any).c;
  res.json({
    total,
    approved,
    overdue,
    progress: total ? Math.round((approved / total) * 100) : 0,
    completion: total ? Math.round((approved / total) * 100) : 0,
  });
});

/** 明细：仅审核可见，BOD 不可见 */
r.get('/detail', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb()
    .prepare(`SELECT s.*, u.partner_name FROM form_submit s JOIN sys_user u ON u.id=s.user_id ORDER BY s.id DESC`)
    .all();
  res.json(rows);
});

export default r;
