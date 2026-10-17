import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';

const r = Router();

r.get('/', authRequired, requirePerm('admin.roles'), (_req, res) => {
  res.json(getDb().prepare(`SELECT * FROM sys_role ORDER BY id`).all());
});

r.post('/', authRequired, requirePerm('admin.roles'), (req: AuthedRequest, res) => {
  const { role_name, menu_permissions, data_scope } = req.body || {};
  const info = getDb()
    .prepare(`INSERT INTO sys_role (role_name, menu_permissions, data_scope) VALUES (?, ?, ?)`)
    .run(role_name, JSON.stringify(menu_permissions || []), data_scope || 'self');
  res.json({ id: info.lastInsertRowid });
});

r.put('/:id', authRequired, requirePerm('admin.roles'), (req, res) => {
  const { role_name, menu_permissions, data_scope } = req.body || {};
  getDb()
    .prepare(`UPDATE sys_role SET role_name=?, menu_permissions=?, data_scope=? WHERE id=?`)
    .run(role_name, JSON.stringify(menu_permissions || []), data_scope, req.params.id);
  res.json({ ok: true });
});

export default r;
