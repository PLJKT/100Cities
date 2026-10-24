import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';

const r = Router();

// 五步阶段概率（参考园区招商漏斗/CRM 加权管道惯例）
const STAGE_PROBABILITY: Record<string, number> = {
  intake: 0.1,
  matching: 0.25,
  site_visit: 0.5,
  proposal: 0.7,
  decision: 0.9,
};

function parseValue(s: any): number | null {
  if (!s) return null;
  const m = String(s).replace(/[,$\s]/g, '').match(/([\d.]+)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return isNaN(n) ? null : n;
}

/** 汇总：审核 / BOD 只读可见（v4：加权管道价值/漏斗/趋势/待办/占用率/停留时长） */
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
  const assetOccupancy = assetTotal
    ? Math.round((q(`SELECT COUNT(*) c FROM asset WHERE enabled=1 AND status IN ('reserved','leased')`) / assetTotal) * 100)
    : 0;

  // 潜客
  const leadTotal = q(`SELECT COUNT(*) c FROM lead`);
  const leadsByStatus = rows(`SELECT status AS k, COUNT(*) c FROM lead GROUP BY status`);
  const leadsBySource = rows(`SELECT source_channel AS k, COUNT(*) c FROM lead WHERE source_channel IS NOT NULL GROUP BY source_channel ORDER BY c DESC LIMIT 6`);
  const leadsByIndustry = rows(`SELECT industry AS k, COUNT(*) c FROM lead WHERE industry IS NOT NULL GROUP BY industry ORDER BY c DESC LIMIT 6`);
  const leadWeekly = rows(`
    SELECT strftime('%Y-%m-%d', created_at) AS k, COUNT(*) c FROM lead
    WHERE created_at >= datetime('now','-14 day') GROUP BY k ORDER BY k`);

  // 加权管道价值（v4：Σ 预计投资额 × 阶段概率）
  const pipelineRows = rows(`
    SELECT p.stage, l.estimated_value FROM pipeline p JOIN lead l ON l.id = p.lead_id
    WHERE l.status NOT IN ('rejected') AND l.estimated_value IS NOT NULL`);
  let weightedValue = 0;
  let pipelineCount = 0;
  for (const row of pipelineRows) {
    const v = parseValue(row.estimated_value);
    if (v) { weightedValue += v * (STAGE_PROBABILITY[row.stage] ?? 0.1); pipelineCount++; }
  }

  // 五步漏斗（当前所处阶段 + 进入该阶段的总数 → 转化率）
  const funnelRows = rows(`
    SELECT stage AS k, COUNT(*) c FROM pipeline WHERE lead_id IS NOT NULL GROUP BY stage`);
  const funnelMap: Record<string, number> = Object.fromEntries(funnelRows.map((x) => [x.k, x.c]));

  // 阶段停留时长（v4：time-in-stage，天）
  const stageAges = rows(`
    SELECT stage AS k, CAST(julianday('now') - julianday(entered_at) AS INTEGER) AS days
    FROM pipeline WHERE lead_id IS NOT NULL`);

  // 待办（v4：任务/提醒清单）
  const todos = {
    leadsToReview: q(`SELECT COUNT(*) c FROM lead WHERE status='new' OR status='under_review'`),
    followupsDue: q(`SELECT COUNT(*) c FROM lead WHERE next_follow_at IS NOT NULL AND next_follow_at <= datetime('now','+7 day') AND status IN ('new','under_review')`),
    overdueSubmits: overdue,
    projectsActive: q(`SELECT COUNT(*) c FROM project WHERE status='active'`),
  };

  // 项目
  const projectTotal = q(`SELECT COUNT(*) c FROM project`);
  const projectsByStage = rows(`SELECT stage AS k, COUNT(*) c FROM project GROUP BY stage`);
  const projectsByStatus = rows(`SELECT status AS k, COUNT(*) c FROM project GROUP BY status`);
  const avgProgress = (db.prepare(`SELECT AVG(progress_pct) a FROM project WHERE status='active'`).get() as any).a || 0;

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
    assets: { total: assetTotal, byCategory: kv(assetsByCategory), byStatus: kv(assetsByStatus), occupancy: assetOccupancy },
    leads: { total: leadTotal, byStatus: kv(leadsByStatus), bySource: kv(leadsBySource), byIndustry: kv(leadsByIndustry), weeklyTrend: leadWeekly },
    projects: { total: projectTotal, byStage: kv(projectsByStage), byStatus: kv(projectsByStatus), avgProgress: Math.round(avgProgress) },
    partners: { total: partnerTotal, byTier: kv(partnersByTier) },
    pipeline: { byStage: kv(pipelinesByStage), totalEvents: pipelineEvents, funnel: funnelMap, weightedValue, pipelineCount, stageAges },
    todos,
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
