import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';

const r = Router();

/** 汇总：审核 / BOD 只读可见（v3：含资产/潜客/项目/pipeline/会员关键指标） */
r.get('/summary', authRequired, requirePerm('dashboard'), (_req: AuthedRequest, res) => {
  const db = getDb();
  const q = (sql: string, ...args: any[]) => (db.prepare(sql).get(...args) as any)?.c ?? 0;
  const rows = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];

  // 提交（旧指标保留）
  const total = q(`SELECT COUNT(*) c FROM form_submit`);
  const approved = q(`SELECT COUNT(*) c FROM form_submit WHERE status='approved'`);
  const overdue = q(`SELECT COUNT(*) c FROM form_submit WHERE status='pending' AND submit_time < datetime('now','-7 day')`);
  const progress = total ? Math.round((approved / total) * 100) : 0;

  // 资产
  const assetTotal = q(`SELECT COUNT(*) c FROM asset WHERE enabled=1`);
  const assetsByCategory = rows(`SELECT category AS k, COUNT(*) c FROM asset WHERE enabled=1 GROUP BY category`);
  const assetsByStatus = rows(`SELECT status AS k, COUNT(*) c FROM asset WHERE enabled=1 GROUP BY status`);

  // 潜客
  const leadTotal = q(`SELECT COUNT(*) c FROM lead`);
  const leadsByStatus = rows(`SELECT status AS k, COUNT(*) c FROM lead GROUP BY status`);

  // 项目
  const projectTotal = q(`SELECT COUNT(*) c FROM project`);
  const projectsByStage = rows(`SELECT stage AS k, COUNT(*) c FROM project GROUP BY stage`);
  const projectsByStatus = rows(`SELECT status AS k, COUNT(*) c FROM project GROUP BY status`);

  // 会员
  const partnerTotal = q(`SELECT COUNT(*) c FROM partner_profile WHERE status <> 'paused'`);
  const partnersByTier = rows(`SELECT tier AS k, COUNT(*) c FROM partner_profile GROUP BY tier`);

  // Pipeline
  const pipelinesByStage = rows(`SELECT stage AS k, COUNT(*) c FROM pipeline GROUP BY stage`);
  const pipelineEvents = q(`SELECT COUNT(*) c FROM pipeline_event`);

  const kv = (arr: any[]) => Object.fromEntries(arr.map((x) => [x.k, x.c]));

  res.json({
    // 旧字段兼容
    total,
    approved,
    overdue,
    progress,
    completion: progress,
    // v3 结构化指标
    submits: { total, approved, overdue, progress },
    assets: { total: assetTotal, byCategory: kv(assetsByCategory), byStatus: kv(assetsByStatus) },
    leads: { total: leadTotal, byStatus: kv(leadsByStatus) },
    projects: { total: projectTotal, byStage: kv(projectsByStage), byStatus: kv(projectsByStatus) },
    partners: { total: partnerTotal, byTier: kv(partnersByTier) },
    pipeline: { byStage: kv(pipelinesByStage), totalEvents: pipelineEvents },
  });
});

/** 明细：仅审核可见，BOD 不可见 */
r.get('/detail', authRequired, requirePerm('review'), (_req, res) => {
  const rows = getDb()
    .prepare(`SELECT s.*, u.partner_name FROM form_submit s JOIN sys_user u ON u.id=s.user_id ORDER BY s.id DESC`)
    .all();
  res.json(rows);
});

export default r;
