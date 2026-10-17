import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

r.get('/', authRequired, requirePerm('admin.users'), (_req, res) => {
  const rows = getDb()
    .prepare(`SELECT u.id, u.username, u.partner_name, u.role_id, r.role_name, u.enabled, u.created_at
              FROM sys_user u JOIN sys_role r ON r.id=u.role_id ORDER BY u.id`)
    .all();
  res.json(rows);
});

r.post('/', authRequired, requirePerm('admin.users'), (req: AuthedRequest, res) => {
  const { username, password, role_id, partner_name } = req.body || {};
  if (!username || !password || !role_id) return res.status(400).json({ error: { message: 'missing fields' } });
  const hash = bcrypt.hashSync(password, 10);
  const info = getDb()
    .prepare(`INSERT INTO sys_user (username, password_hash, role_id, partner_name, enabled, created_by)
              VALUES (?, ?, ?, ?, 1, ?)`)
    .run(username, hash, role_id, partner_name || null, req.user!.uid);
  writeLog(req.user!.uid, 'user.create', 'sys_user', info.lastInsertRowid as number, { username });
  res.json({ id: info.lastInsertRowid });
});

r.put('/:id', authRequired, requirePerm('admin.users'), (req: AuthedRequest, res) => {
  const { enabled, password, role_id } = req.body || {};
  const db = getDb();
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(`UPDATE sys_user SET password_hash=? WHERE id=?`).run(hash, req.params.id);
  }
  if (enabled !== undefined) db.prepare(`UPDATE sys_user SET enabled=? WHERE id=?`).run(enabled ? 1 : 0, req.params.id);
  if (role_id) db.prepare(`UPDATE sys_user SET role_id=? WHERE id=?`).run(role_id, req.params.id);
  writeLog(req.user!.uid, 'user.update', 'sys_user', Number(req.params.id), req.body);
  res.json({ ok: true });
});

export default r;
