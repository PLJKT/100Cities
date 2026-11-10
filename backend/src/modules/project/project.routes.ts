import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { emit, drain } from '../automation/bus';
import { advanceStage, assertAssetFree, CaseError, ensureCaseForLead, STAGES } from '../automation/case.service';

const r = Router();

const STATUSES = ['active', 'paused', 'completed'];
const MS_STATUSES = ['pending', 'in_progress', 'done'];

/** 找项目对应的案件（lead 优先，其次会员档案） */
function caseOf(leadId: number | null, memberId: number | null): any {
  const db = getDb();
  if (leadId) {
    const c = db.prepare(`SELECT * FROM biz_case WHERE lead_id=?`).get(leadId);
    if (c) return c;
  }
  if (memberId) {
    const c = db.prepare(`SELECT * FROM biz_case WHERE partner_profile_id=?`).get(memberId);
    if (c) return c;
  }
  return null;
}

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

/** 新建项目（Super Admin/审核；v4：进度/价值/预计完成/关联资产）
 *  v5：建项目 = 在案件上挂项目；带资产时先做占用校验，避免两个案件抢同一块地 */
r.post('/', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  const b = req.body || {};
  const { lead_id, member_id, asset_id, name, description, stage, progress_pct, progress_note, estimated_value, expected_close, status, started_at } = b;
  if (!name) return res.status(400).json({ error: { message: 'name required' } });

  try {
    const c = caseOf(lead_id || null, member_id || null) || (lead_id ? ensureCaseForLead(Number(lead_id), { type: 'user', userId: req.user!.uid }) : null);
    if (asset_id) assertAssetFree(Number(asset_id), c?.id ?? null);

    const db = getDb();
    let eventId = 0;
    let projectId = 0;
    db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO project (case_id, lead_id, member_id, asset_id, name, description, stage, progress_pct, progress_note, estimated_value, expected_close, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          c?.id ?? null,
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
          started_at || null
        );
      projectId = Number(info.lastInsertRowid);

      if (c?.id) {
        db.prepare(`UPDATE biz_case SET project_id=?, asset_id=COALESCE(?, asset_id), updated_at=datetime('now') WHERE id=?`)
          .run(projectId, asset_id || null, c.id);
        eventId = emit({
          type: 'project.created',
          entityType: 'project',
          entityId: projectId,
          caseId: c.id,
          actor: { type: 'user', userId: req.user!.uid },
          payload: { project_id: projectId, name, case_no: c.case_no },
        });
      }
    })();

    if (eventId) drain();
    writeLog(req.user!.uid, 'project.create', 'project', projectId, { name, case_id: c?.id ?? null });
    res.json({ id: projectId, case_id: c?.id ?? null, event_id: eventId || null });
  } catch (e) {
    next(e);
  }
});

/** 更新项目进度（Super Admin/审核：阶段 + 进度说明 + 百分比）
 *  v5：改项目阶段会同步推进案件阶段（阶段唯一写入口），从而触发下游联动 */
r.put('/:id', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM project WHERE id=?`).get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: { message: 'project not found' } });
  const b = req.body || {};

  try {
    if (b.asset_id && b.asset_id !== row.asset_id) assertAssetFree(Number(b.asset_id), row.case_id ?? null);

    const nextStage = STAGES.includes(b.stage) ? b.stage : row.stage;
    if (row.case_id && nextStage !== row.stage) {
      advanceStage(row.case_id, nextStage, b.progress_note || null, { type: 'user', userId: req.user!.uid }, { force: !!b.force });
    }

    db.prepare(
      `UPDATE project SET lead_id=?, member_id=?, asset_id=?, name=?, description=?, stage=?, progress_pct=?, progress_note=?, estimated_value=?, expected_close=?, status=?, started_at=?, updated_at=datetime('now') WHERE id=?`
    ).run(
      b.lead_id ?? row.lead_id,
      b.member_id ?? row.member_id,
      b.asset_id ?? row.asset_id,
      b.name ?? row.name,
      b.description ?? row.description,
      nextStage,
      b.progress_pct === undefined ? row.progress_pct : Math.max(0, Math.min(100, b.progress_pct)),
      b.progress_note ?? row.progress_note,
      b.estimated_value ?? row.estimated_value,
      b.expected_close ?? row.expected_close,
      STATUSES.includes(b.status) ? b.status : row.status,
      b.started_at ?? row.started_at,
      row.id
    );
    writeLog(req.user!.uid, 'project.update', 'project', row.id, { stage: b.stage, pct: b.progress_pct });
    res.json({ ok: true, case_id: row.case_id ?? null });
  } catch (e) {
    next(e);
  }
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
