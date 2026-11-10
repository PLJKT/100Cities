import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';
import { advanceStage, caseView, caseTimeline, listCases, markLost, markWon, linkAsset, CaseError, STAGES } from '../automation/case.service';

/**
 * 案件 API —— 招商主链的唯一入口。
 * 任何模块想让案件往前走，都必须走这里（或等价的 service 调用），
 * 从而保证"阶段变更 → 事件 → 联动产物"是一条链，而不是各页面前端各拼一次。
 */
const r = Router();

/** 案件列表（带阶段、开单任务数、逾期数、资产名） */
r.get('/', authRequired, requirePerm('review'), (req, res) => {
  const { lifecycle, stage, q, owner, limit, offset } = req.query as any;
  res.json(listCases({ lifecycle, stage, q, owner: owner ? Number(owner) : undefined, limit, offset }));
});

/** 案件 360：一条记录串起会员/线索/提交/阶段/项目/资产/预留/任务/事件 */
r.get('/:id', authRequired, requirePerm('review'), (req, res) => {
  res.json(caseView(Number(req.params.id)));
});

/** 统一时间线（事件 / 阶段 / 任务 / 跟进 / 通知 合成一条叙事） */
r.get('/:id/timeline', authRequired, requirePerm('review'), (req, res) => {
  res.json(caseTimeline(Number(req.params.id)));
});

/** 联动解释：这个案件上的每条任务是被哪条规则、哪个事件产生的 */
r.get('/:id/explain', authRequired, requirePerm('review'), (req, res) => {
  const db = getDb();
  const caseId = Number(req.params.id);
  const runs = db
    .prepare(
      `SELECT r.*, ru.name AS rule_name, ru.description AS rule_desc, e.actor, e.occurred_at
       FROM automation_run r
       LEFT JOIN automation_rule ru ON ru.rule_key=r.rule_key
       LEFT JOIN biz_event e ON e.id=r.event_id
       WHERE r.case_id=? ORDER BY r.id DESC`
    )
    .all(caseId) as any[];
  const tasks = db.prepare(`SELECT * FROM task WHERE case_id=? ORDER BY id`).all(caseId) as any[];
  res.json({
    runs,
    tasks: tasks.map((t) => ({
      id: t.id,
      task_type: t.task_type,
      title: t.title,
      status: t.status,
      due_at: t.due_at,
      escalation_level: t.escalation_level,
      created_by_event_id: t.created_by_event_id,
      reason: runs.find((x) => x.event_id === t.created_by_event_id)?.rule_key || null,
      event: runs.find((x) => x.event_id === t.created_by_event_id)?.event_type || null,
    })),
  });
});

/** 推进阶段：唯一写入口（写 pipeline + pipeline_event + 发事件 + 触发联动） */
r.post('/:id/stage', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  const { stage, note, force } = req.body || {};
  if (!STAGES.includes(stage)) {
    return res.status(400).json({ error: { message: `stage must be one of ${STAGES.join('/')}` } });
  }
  try {
    const out = advanceStage(Number(req.params.id), stage, note || null, { type: 'user', userId: req.user!.uid }, { force: !!force });
    writeLog(req.user!.uid, 'case.stage.advance', 'biz_case', Number(req.params.id), { from: out.from, to: out.to });
    res.json({ ok: true, ...out });
  } catch (e) {
    next(e);
  }
});

/** 成交 */
r.post('/:id/won', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  try {
    const out = markWon(Number(req.params.id), (req.body || {}).note || null, { type: 'user', userId: req.user!.uid });
    writeLog(req.user!.uid, 'case.won', 'biz_case', Number(req.params.id), {});
    res.json({ ok: true, ...out });
  } catch (e) {
    next(e);
  }
});

/** 失单 */
r.post('/:id/lost', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  try {
    const out = markLost(Number(req.params.id), (req.body || {}).reason || null, { type: 'user', userId: req.user!.uid });
    writeLog(req.user!.uid, 'case.lost', 'biz_case', Number(req.params.id), {});
    res.json({ ok: true, ...out });
  } catch (e) {
    next(e);
  }
});

/** 关联意向资产（带硬占用冲突校验） */
r.put('/:id/asset', authRequired, requirePerm('review'), (req: AuthedRequest, res, next) => {
  try {
    const assetId = (req.body || {}).asset_id;
    const out = linkAsset(Number(req.params.id), assetId == null ? null : Number(assetId), {
      type: 'user',
      userId: req.user!.uid,
    });
    res.json({ ok: true, ...out });
  } catch (e) {
    next(e);
  }
});

/** 手工指派案件负责人 */
r.put('/:id/owner', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const owner = (req.body || {}).owner_user_id ?? null;
  getDb().prepare(`UPDATE biz_case SET owner_user_id=?, updated_at=datetime('now') WHERE id=?`).run(owner, Number(req.params.id));
  res.json({ ok: true });
});

export default r;
export { CaseError };
