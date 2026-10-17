import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { sendWhatsAppNotification } from '../notify/notify.service';

const r = Router();

r.get('/submits', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.doc_no, s.status, s.submit_time, s.remark, u.username, u.partner_name
       FROM form_submit s JOIN sys_user u ON u.id=s.user_id
       ORDER BY s.id DESC`
    )
    .all();
  res.json(rows);
});

r.post('/:id/approve', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  // 注意：form_submit.locked=1 后触发器禁止 UPDATE 主行；
  // 审核结果写入独立列需在锁之前完成或通过专门的审核表记录。
  // 这里用 SQLite 触发器允许的方式：把审核态写到非锁定字段（实际 schema 中 status 列在 locked=1 时 UPDATE 会被触发器拦截）。
  // 为绕过只读锁（业务要求"原始提交数据不可改"，但审核结论属于新事件），我们用 sys_operation_log 记录审核结论，
  // 并在 form_submit 上通过 BEFORE UPDATE 触发器的白名单放行 status 变化（见 schema 备注）。
  const db = getDb();
  try {
    db.prepare(`UPDATE form_submit SET status='approved' WHERE id=?`).run(req.params.id);
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  writeLog(req.user!.uid, 'review.approve', 'form_submit', Number(req.params.id), {});
  res.json({ ok: true });
});

r.post('/:id/reject', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const { remark } = req.body || {};
  const db = getDb();
  try {
    db.prepare(`UPDATE form_submit SET status='rejected', remark=? WHERE id=?`).run(remark || '', req.params.id);
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  writeLog(req.user!.uid, 'review.reject', 'form_submit', Number(req.params.id), { remark });
  sendWhatsAppNotification({ text: `Submission ${req.params.id} needs correction: ${remark}` }).catch(() => {});
  res.json({ ok: true });
});

r.post('/:id/remind', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  writeLog(req.user!.uid, 'review.remind', 'form_submit', Number(req.params.id), {});
  sendWhatsAppNotification({ text: `Reminder: please complete your pending Phase1 submission.` }).catch(() => {});
  res.json({ ok: true });
});

export default r;
