import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { getEmailSettings } from '../notify/notify.service';

const r = Router();

/** 读取当前 SMTP 配置（脱敏显示密码有无） */
r.get('/email', authRequired, requirePerm('admin.templates'), (_req, res) => {
  const s = getEmailSettings();
  res.json({ ...s, pass: s.pass ? '***' : '' });
});

/** 保存 SMTP 配置（后台可随时切换邮箱，如 Gmail → 企业邮箱） */
r.put('/email', authRequired, requirePerm('admin.templates'), (req: AuthedRequest, res) => {
  const db = getDb();
  const b = req.body || {};
  db.prepare(
    `INSERT INTO email_settings (id, host, port, secure, user, pass, from_name, from_addr, to_addr, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       host=excluded.host, port=excluded.port, secure=excluded.secure, user=excluded.user,
       pass=excluded.pass, from_name=excluded.from_name, from_addr=excluded.from_addr,
       to_addr=excluded.to_addr, updated_at=datetime('now')`
  ).run(
    b.host || null,
    b.port || 587,
    b.secure ? 1 : 0,
    b.user || null,
    b.pass || null,
    b.from_name || '100 Cities Club',
    b.from_addr || null,
    b.to_addr || null,
  );
  writeLog(req.user!.uid, 'settings.email.update', 'email_settings', 1, { host: b.host });
  res.json({ ok: true });
});

export default r;
