import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const STAGES = ['intake', 'matching', 'site_visit', 'proposal', 'decision'];
const STATUSES = ['active', 'paused', 'completed'];
const MS_STATUSES = ['pending', 'in_progress', 'done'];

function enrich(row: any) {
  const db = getDb();
  const lead = row.lead_id
    ? db.prepare(`SELECT id, company_name, industry, status FROM lead WHERE id=?`).get(row.lead_id) || null
    : null;
  const member = row.member_id
    ? db.prepare(`SELECT id, company_name, nationality, tier FROM partner_profile WHERE id=?`).get(row.member_id) || null
    : null;
  const asset = row.asset_id
    ? db.prepare(`SELECT id, name, category, location FROM asset WHERE id=?`).get(row.asset_id) || null
    : null;
  return { ...row, lead, member, asset };
}

/** 项目列表（功能 6：会员合作项目信息与进度说明；登录可见） */
r.get('/', authRequired, (_req, res) => {
  const rows = getDb().prepare(`SELECT * FROM project ORDER BY id DESC`).all();
  res.json(rows.map(enrich));
});

/** 我的项目（会员/渠道方：按 partner_profile 归属） */
r.get('/my', authRequired, (req: AuthedRequest, res) => {
  const profile = getDb().prepare(`SELECT id FROM partner_profile WHERE user_id=?`).get(req.user!.uid) as any;
  if (!profile) return res.json([]);
  const rows = getDb().prepare(`SELECT * FROM project WHERE member_id=? ORDER BY id DESC`).all(profile.id);
  res.json(rows.map(enrich));
});

/** 项目详情（v4：含里程碑 + 关联 lead/资产/会员） */
r.get('/:id', authRequired, (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM project WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'project not found' } });
  const milestones = db.prepare(`SELECT * FROM project_milestone WHERE project_id=? ORDER BY id`).all(row.id);
  res.json({ ...enrich(row), milestones });
});

/** 新建项目（Super Admin/审核；v4：进度/价值/预计完成/关联资产） */
r.post('/', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const b = req.body || {};
  const { lead_id, member_id, asset_id, name, description, stage, progress_pct, progress_note, estimated_value, expected_close, status, started_at } = b;
  if (!name) return res.status(400).json({ error: { message: 'name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO project (lead_id, member_id, asset_id, name, description, stage, progress_pct, progress_note, estimated_value, expected_close, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      lead_id || null,
      member_id || null,
      asset_id || null,
      name,
      description || null,
      STAGES.includes(stage) ? stage : 'intake',
      Math.max(0, Math.min(100, progress_pct || 0)),
      progress_note || null,
      estimated_value || null,
      expected_close || null,
      STATUSES.includes(status) ? status : 'active',
      started_at || null,
    );
  writeLog(req.user!.uid, 'project.create', 'project', Number(info.lastInsertRowid), { name });
  res.json({ id: info.lastInsertRowid });
});

/** 更新项目进度（Super Admin/审核：阶段 + 进度说明 + 百分比） */
r.put('/:id', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM project WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'project not found' } });
  const b = req.body || {};
  getDb()
    .prepare(
      `UPDATE project SET lead_id=?, member_id=?, asset_id=?, name=?, description=?, stage=?, progress_pct=?, progress_note=?, estimated_value=?, expected_close=?, status=?, started_at=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      b.lead_id ?? row.lead_id,
      b.member_id ?? row.member_id,
      b.asset_id ?? row.asset_id,
      b.name ?? row.name,
      b.description ?? row.description,
      STAGES.includes(b.stage) ? b.stage : row.stage,
      b.progress_pct === undefined ? row.progress_pct : Math.max(0, Math.min(100, b.progress_pct)),
      b.progress_note ?? row.progress_note,
      b.estimated_value ?? row.estimated_value,
      b.expected_close ?? row.expected_close,
      STATUSES.includes(b.status) ? b.status : row.status,
      b.started_at ?? row.started_at,
      row.id,
    );
  writeLog(req.user!.uid, 'project.update', 'project', row.id, { stage: b.stage, pct: b.progress_pct });
  res.json({ ok: true });
});

/** 新增里程碑（v4） */
r.post('/:id/milestones', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM project WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'project not found' } });
  const { name, due_date, status, note } = req.body || {};
  if (!name) return res.status(400).json({ error: { message: 'name required' } });
  const info = getDb()
    .prepare(`INSERT INTO project_milestone (project_id, name, due_date, status, note) VALUES (?, ?, ?, ?, ?)`)
    .run(row.id, name, due_date || null, MS_STATUSES.includes(status) ? status : 'pending', note || null);
  writeLog(req.user!.uid, 'project.milestone.create', 'project', row.id, { name });
  res.json({ id: info.lastInsertRowid });
});

/** 更新里程碑 */
r.put('/milestones/:mid', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM project_milestone WHERE id=?`).get(req.params.mid) as any;
  if (!row) return res.status(404).json({ error: { message: 'milestone not found' } });
  const b = req.body || {};
  getDb()
    .prepare(`UPDATE project_milestone SET name=?, due_date=?, status=?, note=? WHERE id=?`)
    .run(b.name ?? row.name, b.due_date ?? row.due_date, MS_STATUSES.includes(b.status) ? b.status : row.status, b.note ?? row.note, row.id);
  res.json({ ok: true });
});

/** 删除里程碑 */
r.delete('/milestones/:mid', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const info = getDb().prepare(`DELETE FROM project_milestone WHERE id=?`).run(req.params.mid);
  if (!info.changes) return res.status(404).json({ error: { message: 'milestone not found' } });
  res.json({ ok: true });
});

export default r;
