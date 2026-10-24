import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const STAGES = ['intake', 'matching', 'site_visit', 'proposal', 'decision'];
const STATUSES = ['active', 'paused', 'completed'];

function enrich(row: any) {
  const lead = row.lead_id
    ? getDb().prepare(`SELECT id, company_name, industry FROM lead WHERE id=?`).get(row.lead_id) || null
    : null;
  const member = row.member_id
    ? getDb().prepare(`SELECT id, company_name, nationality, tier FROM partner_profile WHERE id=?`).get(row.member_id) || null
    : null;
  return { ...row, lead, member };
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

/** 新建项目（Super Admin/审核） */
r.post('/', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const { lead_id, member_id, name, description, stage, progress_note, status, started_at } = req.body || {};
  if (!name) return res.status(400).json({ error: { message: 'name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO project (lead_id, member_id, name, description, stage, progress_note, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      lead_id || null,
      member_id || null,
      name,
      description || null,
      STAGES.includes(stage) ? stage : 'intake',
      progress_note || null,
      STATUSES.includes(status) ? status : 'active',
      started_at || null,
    );
  writeLog(req.user!.uid, 'project.create', 'project', Number(info.lastInsertRowid), { name });
  res.json({ id: info.lastInsertRowid });
});

/** 更新项目进度（Super Admin/审核：阶段 + 进度说明） */
r.put('/:id', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM project WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'project not found' } });
  const b = req.body || {};
  getDb()
    .prepare(
      `UPDATE project SET lead_id=?, member_id=?, name=?, description=?, stage=?, progress_note=?, status=?, started_at=?, updated_at=datetime('now') WHERE id=?`
    )
    .run(
      b.lead_id ?? row.lead_id,
      b.member_id ?? row.member_id,
      b.name ?? row.name,
      b.description ?? row.description,
      STAGES.includes(b.stage) ? b.stage : row.stage,
      b.progress_note ?? row.progress_note,
      STATUSES.includes(b.status) ? b.status : row.status,
      b.started_at ?? row.started_at,
      row.id,
    );
  writeLog(req.user!.uid, 'project.update', 'project', row.id, { stage: b.stage });
  res.json({ ok: true });
});

export default r;
