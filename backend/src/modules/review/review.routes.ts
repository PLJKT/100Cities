import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { sendWhatsAppNotification } from '../notify/notify.service';
import { emit, drain } from '../automation/bus';

const r = Router();

r.get('/submits', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.doc_no, s.status, s.submit_time, s.remark, u.username, u.partner_name, u.email,
              c.id AS case_id, c.case_no, COALESCE(p.stage,'intake') AS case_stage, c.lifecycle AS case_lifecycle
       FROM form_submit s
       JOIN sys_user u ON u.id=s.user_id
       LEFT JOIN biz_case c ON c.submit_id=s.id
       LEFT JOIN pipeline p ON p.case_id=c.id
       ORDER BY s.id DESC`
    )
    .all();
  res.json(rows);
});

/**
 * 审核通过 —— 这里不再只有一条 UPDATE。
 * 事务内改状态 + 写 submission.approved 事件，事件派发时由规则 R01 完成：
 * 建会员档案 → 开案 → 建复核任务 → 邮件通知申请人。
 * 路由本身不知道下游是谁，新增联动只需加规则，不用回来改这个文件。
 */
r.post('/:id/approve', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const db = getDb();
  let eventId = 0;
  try {
    db.transaction(() => {
      db.prepare(`UPDATE form_submit SET status='approved' WHERE id=?`).run(req.params.id);
      eventId = emit({
        type: 'submission.approved',
        entityType: 'form_submit',
        entityId: Number(req.params.id),
        actor: { type: 'user', userId: req.user!.uid },
        payload: { submit_id: Number(req.params.id) },
      });
    })();
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  const drained = drain();
  const c = db.prepare(`SELECT * FROM biz_case WHERE submit_id=?`).get(req.params.id);
  writeLog(req.user!.uid, 'review.approve', 'form_submit', Number(req.params.id), { event_id: eventId });
  res.json({ ok: true, event_id: eventId, case: c || null, automation: drained });
});

/**
 * 审核退回 —— 通知也从路由里移除，交给规则 R02（含补正任务）。
 */
r.post('/:id/reject', authRequired, requirePerm('review'), async (req: AuthedRequest, res) => {
  const { remark } = req.body || {};
  const db = getDb();
  let eventId = 0;
  try {
    db.transaction(() => {
      db.prepare(`UPDATE form_submit SET status='rejected', remark=? WHERE id=?`).run(remark || '', req.params.id);
      eventId = emit({
        type: 'submission.rejected',
        entityType: 'form_submit',
        entityId: Number(req.params.id),
        actor: { type: 'user', userId: req.user!.uid },
        payload: { submit_id: Number(req.params.id), remark: remark || '' },
      });
    })();
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  const drained = drain();
  writeLog(req.user!.uid, 'review.reject', 'form_submit', Number(req.params.id), { remark, event_id: eventId });
  res.json({ ok: true, event_id: eventId, automation: drained });
});

r.post('/:id/remind', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  writeLog(req.user!.uid, 'review.remind', 'form_submit', Number(req.params.id), {});
  sendWhatsAppNotification({ text: `Reminder: please complete your pending Phase1 submission.` }).catch(() => {});
  res.json({ ok: true });
});

export default r;
