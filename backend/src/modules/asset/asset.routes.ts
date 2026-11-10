import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const CATEGORIES = ['industrial', 'residential', 'commercial', 'power', 'water', 'dryport', 'sez', 'infra', 'education'];
// v5：新增 held（软预留期间），与 reserved（硬预留）区分，避免"预留中"和"意向锁定"混用一态
const STATUSES = ['available', 'held', 'reserved', 'leased', 'planning'];

/** 资产列表（登录即可，供业务信息页/资产页面展示）
 *  v5：附带当前有效预留信息，前端可直接显示"被哪个案件锁到什么时候" */
r.get('/', authRequired, (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM asset WHERE enabled=1 ORDER BY sort, id`).all() as any[];
  const holds = db
    .prepare(
      `SELECT h.*, c.case_no, c.org_name FROM asset_hold h JOIN biz_case c ON c.id=h.case_id
       WHERE h.status IN ('active','confirmed')`
    )
    .all() as any[];
  res.json(
    rows.map((a) => ({
      ...a,
      active_holds: holds.filter((h) => h.asset_id === a.id),
    }))
  );
});

/** 资产详情（含完整建档信息：价格/面积/参数/联系人） */
r.get('/:id', authRequired, (req, res) => {
  const row = getDb().prepare(`SELECT * FROM asset WHERE id=? AND enabled=1`).get(req.params.id);
  if (!row) return res.status(404).json({ error: { message: 'asset not found' } });
  res.json(row);
});

/** 资产的预留台账（谁锁的、锁到什么时候、软锁还是硬锁） */
r.get('/:id/holds', authRequired, (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT h.*, c.case_no, c.org_name, c.lifecycle
       FROM asset_hold h JOIN biz_case c ON c.id=h.case_id
       WHERE h.asset_id=? ORDER BY h.id DESC`
    )
    .all(req.params.id);
  res.json(rows);
});

/** 人工释放预留（管理员；到期释放由调度器自动做） */
r.post('/holds/:holdId/release', authRequired, requirePerm('admin.assets'), (req: AuthedRequest, res) => {
  const db = getDb();
  const h = db.prepare(`SELECT * FROM asset_hold WHERE id=?`).get(req.params.holdId) as any;
  if (!h) return res.status(404).json({ error: { message: 'hold not found' } });
  db.prepare(`UPDATE asset_hold SET status='released', released_at=datetime('now') WHERE id=?`).run(h.id);
  const others = db
    .prepare(`SELECT COUNT(*) n FROM asset_hold WHERE asset_id=? AND status IN ('active','confirmed')`)
    .get(h.asset_id) as any;
  if (!others.n) {
    const a = db.prepare(`SELECT status FROM asset WHERE id=?`).get(h.asset_id) as any;
    if (a && a.status !== 'planning' && a.status !== 'leased') {
      db.prepare(`UPDATE asset SET status='available', updated_at=datetime('now') WHERE id=?`).run(h.asset_id);
    }
  }
  writeLog(req.user!.uid, 'asset.hold.release', 'asset_hold', h.id, { asset_id: h.asset_id });
  res.json({ ok: true });
});

/** 按板块筛选 */
r.get('/category/:cat', authRequired, (req, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM asset WHERE enabled=1 AND category=? ORDER BY sort, id`)
    .all(req.params.cat);
  res.json(rows);
});

/** 考察匹配（v4：按行业/规模/面积需求推荐资产） */
r.post('/match', authRequired, (req, res) => {
  const { industry, company_size, need_area, category } = req.body || {};
  const db = getDb();
  let rows = db.prepare(`SELECT * FROM asset WHERE enabled=1`).all() as any[];
  // 优先匹配指定板块或工业/干港/电力（制造类诉求）；再按面积文本匹配
  const preferCat = category || (industry ? 'industrial' : null);
  if (preferCat) rows.sort((a, b) => (b.category === preferCat ? 1 : 0) - (a.category === preferCat ? 1 : 0));
  if (need_area) {
    rows.sort((a, b) => scoreArea(b, need_area) - scoreArea(a, need_area));
  }
  const matched = rows.slice(0, 8).map((row: any) => ({
    ...row,
    match_score: matchScore(row, { industry, company_size, need_area, category }),
  }));
  res.json({ query: { industry, company_size, need_area, category }, results: matched });
});

function scoreArea(row: any, need: string) {
  const want = parseArea(need);
  if (!want) return 0;
  const min = parseArea(row.min_area) || 0;
  const max = parseArea(row.max_area) || 0;
  if (max && want <= max) return 1;
  if (min && want >= min) return 0.8;
  return 0.2;
}

function parseArea(s: any): number | null {
  if (!s) return null;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*(m²|m2|sqm|ha)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return null;
  return /ha/i.test(m[2] || '') ? n * 10000 : n;
}

function matchScore(row: any, q: any): number {
  let score = 0;
  if (q.industry && (row.category === 'industrial' || row.category === 'sez')) score += 3;
  if (q.category && row.category === q.category) score += 4;
  if (row.status === 'available') score += 2;
  if (q.need_area && scoreArea(row, q.need_area) > 0.7) score += 3;
  if (q.company_size === 'Large' || q.company_size === 'Enterprise') {
    if (parseArea(row.max_area) || 0 >= 50000) score += 1;
  }
  return score;
}

/** 新增资产（Super Admin） */
r.post('/', authRequired, requirePerm('admin.assets'), (req: AuthedRequest, res) => {
  const b = req.body || {};
  const { name } = b;
  if (!name) return res.status(400).json({ error: { message: 'name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO asset (name, category, location, size_desc, description, status, price_desc, min_area, max_area, key_specs, owner_contact, image_url, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name,
      CATEGORIES.includes(b.category) ? b.category : 'industrial',
      b.location || null,
      b.size_desc || null,
      b.description || null,
      STATUSES.includes(b.status) ? b.status : 'available',
      b.price_desc || null,
      b.min_area || null,
      b.max_area || null,
      b.key_specs || null,
      b.owner_contact || null,
      b.image_url || null,
      b.sort || 0,
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
      `UPDATE asset SET name=?, category=?, location=?, size_desc=?, description=?, status=?, price_desc=?, min_area=?, max_area=?, key_specs=?, owner_contact=?, image_url=?, sort=?, enabled=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      b.name ?? row.name,
      CATEGORIES.includes(b.category) ? b.category : row.category,
      b.location ?? row.location,
      b.size_desc ?? row.size_desc,
      b.description ?? row.description,
      STATUSES.includes(b.status) ? b.status : row.status,
      b.price_desc ?? row.price_desc,
      b.min_area ?? row.min_area,
      b.max_area ?? row.max_area,
      b.key_specs ?? row.key_specs,
      b.owner_contact ?? row.owner_contact,
      b.image_url ?? row.image_url,
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
