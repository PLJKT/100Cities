import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';

const r = Router();

r.get('/', authRequired, requirePerm('admin.templates'), (_req, res) => {
  res.json(getDb().prepare(`SELECT * FROM form_template ORDER BY id`).all());
});

r.post('/', authRequired, requirePerm('admin.templates'), (req: AuthedRequest, res) => {
  const { template_key, section_config } = req.body || {};
  const info = getDb()
    .prepare(`INSERT INTO form_template (template_key, section_config, version) VALUES (?, ?, 1)`)
    .run(template_key, JSON.stringify(section_config || {}));
  res.json({ id: info.lastInsertRowid });
});

r.put('/:id', authRequired, requirePerm('admin.templates'), (req, res) => {
  const { section_config } = req.body || {};
  getDb()
    .prepare(`UPDATE form_template SET section_config=?, version=version+1, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(section_config || {}), req.params.id);
  res.json({ ok: true });
});

export default r;
