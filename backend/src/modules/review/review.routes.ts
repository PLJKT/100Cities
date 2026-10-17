import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { sendRejectNotification, sendWhatsAppNotification } from '../notify/notify.service';
import type { Lang } from '../notify/templates';

const r = Router();

function pickLang(req: AuthedRequest): Lang {
  const h = (req.headers['x-lang'] as string) || 'en';
  return (h === 'id' || h === 'zh' ? h : 'en') as Lang;
}

r.get('/submits', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.doc_no, s.status, s.submit_time, s.remark, u.username, u.partner_name, u.email
       FROM form_submit s JOIN sys_user u ON u.id=s.user_id
       ORDER BY s.id DESC`
    )
    .all();
  res.json(rows);
});

r.post('/:id/approve', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  try {
    getDb().prepare(`UPDATE form_submit SET status='approved' WHERE id=?`).run(req.params.id);
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  writeLog(req.user!.uid, 'review.approve', 'form_submit', Number(req.params.id), {});
  res.json({ ok: true });
});

r.post('/:id/reject', authRequired, requirePerm('review'), async (req: AuthedRequest, res) => {
  const { remark } = req.body || {};
  const db = getDb();
  let row: any;
  try {
    db.prepare(`UPDATE form_submit SET status='rejected', remark=? WHERE id=?`).run(remark || '', req.params.id);
    row = db.prepare(`SELECT doc_no, email FROM form_submit s JOIN sys_user u ON u.id=s.user_id WHERE s.id=?`).get(req.params.id);
  } catch (e: any) {
    return res.status(423).json({ error: { code: 'LOCKED', message: e.message } });
  }
  writeLog(req.user!.uid, 'review.reject', 'form_submit', Number(req.params.id), { remark });
  if (row?.email) {
    sendRejectNotification({ lang: pickLang(req), to: row.email, docNo: row.doc_no, remark: remark || '' }).catch(() => {});
  }
  sendWhatsAppNotification({ text: `Submission ${req.params.id} needs correction: ${remark}` }).catch(() => {});
  res.json({ ok: true });
});

r.post('/:id/remind', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  writeLog(req.user!.uid, 'review.remind', 'form_submit', Number(req.params.id), {});
  sendWhatsAppNotification({ text: `Reminder: please complete your pending Phase1 submission.` }).catch(() => {});
  res.json({ ok: true });
});

export default r;
