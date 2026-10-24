import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const CATEGORIES = ['industrial', 'residential', 'commercial', 'power', 'water', 'dryport', 'sez', 'infra', 'education'];
const STATUSES = ['available', 'reserved', 'leased', 'planning'];

/** 资产列表（登录即可，供业务信息页/资产页面展示） */
r.get('/', authRequired, (_req, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM asset WHERE enabled=1 ORDER BY sort, id`)
    .all();
  res.json(rows);
});

/** 按板块筛选 */
r.get('/category/:cat', authRequired, (req, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM asset WHERE enabled=1 AND category=? ORDER BY sort, id`)
    .all(req.params.cat);
  res.json(rows);
});

/** 新增资产（Super Admin） */
r.post('/', authRequired, requirePerm('admin.assets'), (req: AuthedRequest, res) => {
  const { name, category, location, size_desc, description, status, sort } = req.body || {};
  if (!name) return res.status(400).json({ error: { message: 'name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO asset (name, category, location, size_desc, description, status, sort) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      CATEGORIES.includes(category) ? category : 'industrial',
      location || null,
      size_desc || null,
      description || null,
      STATUSES.includes(status) ? status : 'available',
      sort || 0,
    );
  writeLog(req.user!.uid, 'asset.create', 'asset', Number(info.lastInsertRowid), { name });
  res.json({ id: info.lastInsertRowid });
});

/** 更新资产（Super Admin） */
r.put('/:id', authRequired, requirePerm('admin.assets'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM asset WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'asset not found' } });
  const b = req.body || {};
  getDb()
    .prepare(
      `UPDATE asset SET name=?, category=?, location=?, size_desc=?, description=?, status=?, sort=?, enabled=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      b.name ?? row.name,
      CATEGORIES.includes(b.category) ? b.category : row.category,
      b.location ?? row.location,
      b.size_desc ?? row.size_desc,
      b.description ?? row.description,
      STATUSES.includes(b.status) ? b.status : row.status,
      b.sort ?? row.sort,
      b.enabled === undefined ? row.enabled : b.enabled ? 1 : 0,
      row.id,
    );
  writeLog(req.user!.uid, 'asset.update', 'asset', row.id, {});
  res.json({ ok: true });
});

/** 删除/停用资产（Super Admin） */
r.delete('/:id', authRequired, requirePerm('admin.assets'), (req: AuthedRequest, res) => {
  const info = getDb().prepare(`UPDATE asset SET enabled=0 WHERE id=?`).run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: { message: 'asset not found' } });
  writeLog(req.user!.uid, 'asset.disable', 'asset', Number(req.params.id), {});
  res.json({ ok: true });
});

export default r;
