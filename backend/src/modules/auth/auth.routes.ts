import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../../config/db';
import { signToken, authRequired, AuthedRequest } from '../../middlewares/auth';
import { writeLog } from '../log/log.service';

const r = Router();

r.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: { message: 'username/password required' } });
  const row = getDb()
    .prepare(`SELECT u.*, r.role_name, r.menu_permissions FROM sys_user u JOIN sys_role r ON r.id=u.role_id WHERE u.username=? AND u.enabled=1`)
    .get(username) as any;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: { message: 'invalid credentials' } });
  }
  const token = signToken({ uid: row.id, username: row.username, role_id: row.role_id });
  writeLog(row.id, 'login', 'sys_user', row.id, { ip: req.ip });
  res.json({
    token,
    user: {
      id: row.id,
      username: row.username,
      partner_name: row.partner_name,
      role_name: row.role_name,
      menu_permissions: JSON.parse(row.menu_permissions || '[]'),
    },
  });
});

r.get('/me', authRequired, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

export default r;
