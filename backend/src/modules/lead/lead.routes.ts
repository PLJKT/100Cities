import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

const LEAD_STATUSES = ['new', 'under_review', 'approved', 'rejected', 'converted'];
const STAGES = ['intake', 'matching', 'site_visit', 'proposal', 'decision'];

function enrich(row: any) {
  const u = getDb()
    .prepare(`SELECT id, username, partner_name FROM sys_user WHERE id=?`)
    .get(row.channel_user_id);
  return { ...row, channel: u || null };
}

/** 潜在客户列表（管理员/审核） */
r.get('/', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb().prepare(`SELECT * FROM lead ORDER BY id DESC`).all();
  res.json(rows.map(enrich));
});

/** 我的录入（渠道方只看自己） */
r.get('/my', authRequired, (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(`SELECT * FROM lead WHERE channel_user_id=? ORDER BY id DESC`)
    .all(req.user!.uid)
    .map(enrich);
  res.json(rows);
});

/** 渠道方录入潜在客户（功能 3：行业/规模/诉求等） */
r.post('/', authRequired, requirePerm('partner.form'), (req: AuthedRequest, res) => {
  const { company_name, industry, company_size, need_description, contact_name, contact_phone, contact_email, source_channel } = req.body || {};
  if (!company_name) return res.status(400).json({ error: { message: 'company_name required' } });
  const info = getDb()
    .prepare(
      `INSERT INTO lead (channel_user_id, company_name, industry, company_size, need_description, contact_name, contact_phone, contact_email, source_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user!.uid,
      company_name,
      industry || null,
      ['SME', 'Mid', 'Large', 'Enterprise'].includes(company_size) ? company_size : 'SME',
      need_description || null,
      contact_name || null,
      contact_phone || null,
      contact_email || null,
      source_channel || 'direct',
    );
  writeLog(req.user!.uid, 'lead.create', 'lead', Number(info.lastInsertRowid), { company_name });
  res.json({ id: info.lastInsertRowid, status: 'new' });
});

/** 审核更新状态（管理员/审核） */
r.put('/:id/status', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const { status } = req.body || {};
  if (!LEAD_STATUSES.includes(status)) {
    return res.status(400).json({ error: { message: `status must be one of ${LEAD_STATUSES.join('/')}` } });
  }
  const info = getDb()
    .prepare(`UPDATE lead SET status=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, req.params.id);
  if (!info.changes) return res.status(404).json({ error: { message: 'lead not found' } });
  writeLog(req.user!.uid, 'lead.status', 'lead', Number(req.params.id), { status });
  res.json({ ok: true, status });
});

// ---------- Pipeline（审核五步流转，关联 lead） ----------

/** 查看审核流程（管理员/审核/录入渠道方） */
r.get('/:id/pipeline', authRequired, (req: AuthedRequest, res) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const canView =
    req.user!.role_id === 1 || req.user!.role_id === 3 || lead.channel_user_id === req.user!.uid;
  if (!canView) return res.status(403).json({ error: { message: 'forbidden' } });

  let pipe = db.prepare(`SELECT * FROM pipeline WHERE lead_id=?`).get(lead.id) as any;
  if (!pipe) {
    const info = db.prepare(`INSERT INTO pipeline (lead_id, stage) VALUES (?, 'intake')`).run(lead.id);
    pipe = db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(info.lastInsertRowid);
  }
  const events = db.prepare(`SELECT * FROM pipeline_event WHERE pipeline_id=? ORDER BY id`).all(pipe.id);
  res.json({ lead: enrich(lead), pipeline: pipe, events });
});

/** 推进审核阶段（管理员/审核） */
r.put('/:id/pipeline', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const db = getDb();
  const lead = db.prepare(`SELECT * FROM lead WHERE id=?`).get(req.params.id) as any;
  if (!lead) return res.status(404).json({ error: { message: 'lead not found' } });
  const { stage, note } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: { message: `stage must be one of ${STAGES.join('/')}` } });

  let pipe = db.prepare(`SELECT * FROM pipeline WHERE lead_id=?`).get(lead.id) as any;
  if (!pipe) {
    const info = db.prepare(`INSERT INTO pipeline (lead_id, stage) VALUES (?, 'intake')`).run(lead.id);
    pipe = db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(info.lastInsertRowid);
  }
  const from = pipe.stage;
  db.transaction(() => {
    db.prepare(`UPDATE pipeline SET stage=?, stage_note=?, updated_by=?, updated_at=datetime('now') WHERE id=?`)
      .run(stage, note || null, req.user!.uid, pipe.id);
    db.prepare(`INSERT INTO pipeline_event (pipeline_id, from_stage, to_stage, note, user_id) VALUES (?, ?, ?, ?, ?)`)
      .run(pipe.id, from, stage, note || null, req.user!.uid);
    // 同步 lead 状态：进入审核即 under_review；到 decision 且 note 通过时转 approved
    if (lead.status === 'new') {
      db.prepare(`UPDATE lead SET status='under_review', updated_at=datetime('now') WHERE id=?`).run(lead.id);
    }
  })();
  writeLog(req.user!.uid, 'lead.pipeline.advance', 'pipeline', pipe.id, { from, to: stage });
  res.json({ ok: true, from, to: stage, pipeline_id: pipe.id });
});

export default r;
