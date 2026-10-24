import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const TIERS = ['explorer', 'manufacturer', 'tech', 'existing', 'investor'];
const STAGES = ['intake', 'matching', 'site_visit', 'proposal', 'decision'];

/** 档案 + 关联账号信息 + 关键指标（清单展示用） */
function enrich(row: any) {
  const db = getDb();
  const u = db.prepare(`SELECT id, username, email, phone, enabled FROM sys_user WHERE id=?`).get(row.user_id);
  const submits = (db.prepare(`SELECT COUNT(*) c FROM form_submit WHERE user_id=?`).get(row.user_id) as any).c;
  const leads = (db.prepare(`SELECT COUNT(*) c FROM lead WHERE channel_user_id=?`).get(row.user_id) as any).c;
  const projects = (db.prepare(`SELECT COUNT(*) c FROM project WHERE member_id=?`).get(row.id) as any).c;
  const pipe = db.prepare(`SELECT stage FROM pipeline WHERE partner_id=?`).get(row.id) as any;
  const lastActive = (db
    .prepare(
      `SELECT MAX(m) AS m FROM (
         SELECT updated_at AS m FROM partner_profile WHERE id=?
         UNION ALL SELECT submit_time AS m FROM form_submit WHERE user_id=?
         UNION ALL SELECT updated_at AS m FROM lead WHERE channel_user_id=?
         UNION ALL SELECT updated_at AS m FROM project WHERE member_id=?)`
    )
    .get(row.id, row.user_id, row.user_id, row.id) as any).m;
  return {
    ...row,
    account: u || null,
    submits,
    leads,
    projects,
    pipeline_stage: pipe?.stage || null,
    last_active: lastActive || null,
  };
}

// ---------- 档案 ----------

r.get('/', authRequired, requirePerm('admin.users'), (_req, res) => {
  const rows = getDb().prepare(`SELECT * FROM partner_profile ORDER BY id DESC`).all();
  res.json(rows.map(enrich));
});

/** 我的档案（合作方） */
r.get('/my', authRequired, (req: AuthedRequest, res) => {
  const row = getDb().prepare(`SELECT * FROM partner_profile WHERE user_id=?`).get(req.user!.uid);
  if (!row) return res.status(404).json({ error: { message: 'profile not found' } });
  res.json(enrich(row as any));
});

/** 创建档案（Admin 建号后补充企业信息） */
r.post('/', authRequired, requirePerm('admin.users'), (req: AuthedRequest, res) => {
  const { user_id, company_name, nationality, industry, tier, status, contact_email, contact_phone } = req.body || {};
  if (!user_id || !company_name) return res.status(400).json({ error: { message: 'user_id and company_name required' } });
  const db = getDb();
  if (db.prepare(`SELECT id FROM sys_user WHERE id=?`).get(user_id) === undefined) {
    return res.status(404).json({ error: { message: 'user not found' } });
  }
  const tierV = TIERS.includes(tier) ? tier : 'explorer';
  const statusV = ['invited', 'active', 'paused'].includes(status) ? status : 'invited';
  const info = db
    .prepare(
      `INSERT INTO partner_profile (user_id, company_name, nationality, industry, tier, status, contact_email, contact_phone)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(user_id, company_name, nationality || 'ID', industry || null, tierV, statusV, contact_email || null, contact_phone || null);
  writeLog(req.user!.uid, 'partner.create', 'partner_profile', Number(info.lastInsertRowid), { user_id });
  res.json({ id: info.lastInsertRowid });
});

/** 更新档案（Admin 全量；合作方仅可改自己） */
r.put('/:id', authRequired, (req: AuthedRequest, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM partner_profile WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'profile not found' } });
  const isSelf = row.user_id === req.user!.uid;
  const isAdmin = req.user!.role_id === 1;
  if (!isAdmin && !isSelf) return res.status(403).json({ error: { message: 'forbidden' } });

  const b = req.body || {};
  const tierV = TIERS.includes(b.tier) ? b.tier : row.tier;
  const statusV = ['invited', 'active', 'paused'].includes(b.status) ? b.status : row.status;
  db.prepare(
    `UPDATE partner_profile
     SET company_name=?, nationality=?, industry=?, tier=?, status=?, contact_email=?, contact_phone=?, updated_at=datetime('now')
     WHERE id=?`
  ).run(
    b.company_name ?? row.company_name,
    b.nationality ?? row.nationality,
    b.industry ?? row.industry,
    tierV,
    statusV,
    b.contact_email ?? row.contact_email,
    b.contact_phone ?? row.contact_phone,
    row.id,
  );
  writeLog(req.user!.uid, 'partner.update', 'partner_profile', row.id, { self: isSelf });
  res.json({ ok: true });
});

// ---------- Pipeline（五步流转） ----------

/** 查看 pipeline 详情 + 事件流 */
r.get('/:id/pipeline', authRequired, (req: AuthedRequest, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM partner_profile WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'profile not found' } });
  if (req.user!.role_id !== 1 && req.user!.role_id !== 3 && row.user_id !== req.user!.uid) {
    return res.status(403).json({ error: { message: 'forbidden' } });
  }
  let pipe = db.prepare(`SELECT * FROM pipeline WHERE partner_id=?`).get(row.id) as any;
  if (!pipe) {
    const info = db.prepare(`INSERT INTO pipeline (partner_id, stage) VALUES (?, 'intake')`).run(row.id);
    pipe = db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(info.lastInsertRowid);
  }
  const events = db.prepare(`SELECT * FROM pipeline_event WHERE pipeline_id=? ORDER BY id`).all(pipe.id);
  res.json({ pipeline: pipe, events });
});

/** 推进 stage（Admin/Reviewer） */
r.put('/:id/pipeline', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM partner_profile WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'profile not found' } });
  const { stage, note } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: { message: `stage must be one of ${STAGES.join('/')}` } });

  let pipe = db.prepare(`SELECT * FROM pipeline WHERE partner_id=?`).get(row.id) as any;
  if (!pipe) {
    const info = db.prepare(`INSERT INTO pipeline (partner_id, stage) VALUES (?, 'intake')`).run(row.id);
    pipe = db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(info.lastInsertRowid);
  }
  const from = pipe.stage;
  db.transaction(() => {
    db.prepare(`UPDATE pipeline SET stage=?, stage_note=?, updated_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(stage, note || null, req.user!.uid, pipe.id);
    db.prepare(`INSERT INTO pipeline_event (pipeline_id, from_stage, to_stage, note, user_id) VALUES (?, ?, ?, ?, ?)`)
      .run(pipe.id, from, stage, note || null, req.user!.uid);
  })();
  writeLog(req.user!.uid, 'pipeline.advance', 'pipeline', pipe.id, { from, to: stage });
  res.json({ ok: true, from, to: stage, pipeline_id: pipe.id });
});

export default r;
