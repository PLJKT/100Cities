import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';
import { STAGE_SLA_DAYS } from '../automation/case.service';

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

  // ---------- v5：待办/联动改为读持久化实体 ----------
  // 关键变化：todos 不再用 COUNT(*) 现拼，而是读 task 表，和任务中心是同一份数据
  const tasksOpen = q(`SELECT COUNT(*) c FROM task WHERE status='open'`);
  const tasksOverdue = q(`SELECT COUNT(*) c FROM task WHERE status='open' AND due_at IS NOT NULL AND due_at < datetime('now')`);
  const tasksByType = rows(`SELECT task_type AS k, COUNT(*) c FROM task WHERE status='open' GROUP BY task_type ORDER BY c DESC`);
  const tasksByAssignee = rows(
    `SELECT COALESCE(u.username,'Unassigned') AS k, COUNT(*) c
     FROM task t LEFT JOIN sys_user u ON u.id=t.assignee_user_id
     WHERE t.status='open' GROUP BY k ORDER BY c DESC`
  );
  const casesByLifecycle = rows(`SELECT lifecycle AS k, COUNT(*) c FROM biz_case GROUP BY lifecycle`);
  const casesByStage = rows(`
    SELECT COALESCE(p.stage,'intake') AS k, COUNT(*) c FROM biz_case c
    LEFT JOIN pipeline p ON p.case_id=c.id
    WHERE c.lifecycle NOT IN ('won','lost','dropped') GROUP BY k`);
  const eventTotal = q(`SELECT COUNT(*) c FROM biz_event`);
  const eventPending = q(`SELECT COUNT(*) c FROM biz_event WHERE status='pending'`);
  const ruleApplied = q(`SELECT COUNT(*) c FROM automation_run WHERE outcome='applied'`);
  const ruleErrors = q(`SELECT COUNT(*) c FROM automation_run WHERE outcome='error'`);
  const holdActive = q(`SELECT COUNT(*) c FROM asset_hold WHERE status IN ('active','confirmed')`);

  // 阶段 SLA 违约（按每阶段阈值在 JS 里判，避免写死 SQL）
  const stageAgeRows = rows(`
    SELECT c.case_no, c.org_name, p.stage, p.entered_at FROM biz_case c
    JOIN pipeline p ON p.case_id=c.id
    WHERE c.lifecycle NOT IN ('won','lost','dropped')`);
  const slaBreaches = stageAgeRows
    .map((r: any) => {
      const age = Math.floor((Date.now() - new Date(String(r.entered_at).replace(' ', 'T') + 'Z').getTime()) / 86400000);
      return { ...r, age_days: age, sla_days: STAGE_SLA_DAYS[r.stage] ?? 14 };
    })
    .filter((r: any) => r.age_days >= r.sla_days)
    .sort((a: any, b: any) => b.age_days - b.sla_days - (a.age_days - a.sla_days));

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
    // v5：任务即待办（与 /api/tasks 同源）
    tasks: {
      open: tasksOpen,
      overdue: tasksOverdue,
      byType: kv(tasksByType),
      byAssignee: kv(tasksByAssignee),
    },
    // v5：案件主链（lifecycle 与 stage 两条视角）
    cases: { byLifecycle: kv(casesByLifecycle), byStage: kv(casesByStage) },
    // v5：自动化健康度
    automation: {
      events: eventTotal,
      pendingEvents: eventPending,
      rulesApplied: ruleApplied,
      ruleErrors: ruleErrors,
      activeHolds: holdActive,
      slaBreaches: slaBreaches.slice(0, 20),
      slaBreachCount: slaBreaches.length,
    },
    todos: { ...todos, openTasks: tasksOpen, overdueTasks: tasksOverdue },
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
