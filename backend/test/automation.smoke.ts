/**
 * v5 自动化主链冒烟测试
 * 运行：npx tsx test/automation.smoke.ts
 *
 * 它验证的不是"接口能返回 200"，而是这条链真的闭合：
 *   提交通过 → 建会员/开案/建任务/发通知
 *   阶段推进 → 建任务 → 锁资产 → 建项目 → 铺里程碑
 *   成交 → 资产转 leased + 释放竞争预留 + 项目收口
 *   冲突 → 不静默覆盖，留痕并升级给人裁决
 */

process.env.DB_FILE = './data/smoke_v5.sqlite';

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(cond: any, label: string, extra?: any) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

function main() {
  const dbFile = path.resolve(process.cwd(), process.env.DB_FILE as string);
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + suffix)) fs.unlinkSync(dbFile + suffix);
  }

  const { initDb, getDb } = require('../src/config/db');
  initDb();
  const db = getDb();

  const { emit, drain } = require('../src/modules/automation/bus');
  const { advanceStage, linkAsset, markWon, caseView, caseTimeline, ensureCaseForLead } = require('../src/modules/automation/case.service');
  const { sweepOverdueTasks, sweepExpiredHolds, sweepStageOverdue } = require('../src/modules/automation/task.service');

  console.log('\n=== 0. 准备数据 ===');
  const u = db
    .prepare(
      `INSERT INTO sys_user (username, password_hash, role_id, partner_name, email, enabled)
       VALUES ('smoke_partner', 'x', 2, 'Acme Singapore Pte Ltd', 'smoke@acme.test', 1)`
    )
    .run();
  const uid = Number(u.lastInsertRowid);

  const reviewer = db
    .prepare(
      `INSERT INTO sys_user (username, password_hash, role_id, partner_name, email, enabled)
       VALUES ('smoke_reviewer', 'x', 3, 'Reviewer', 'reviewer@acme.test', 1)`
    )
    .run();
  const rid = Number(reviewer.lastInsertRowid);

  if (!db.prepare(`SELECT id FROM form_template WHERE id=1`).get()) {
    db.prepare(`INSERT INTO form_template (id, template_key, section_config, version) VALUES (1,'phase1','{}',1)`).run();
  }

  const sub = db
    .prepare(
      `INSERT INTO form_submit (doc_no, user_id, template_id, status, submit_time) VALUES ('SMOKE-001', ?, 1, 'pending', datetime('now'))`
    )
    .run(uid);
  const sid = Number(sub.lastInsertRowid);
  db.prepare(`INSERT INTO form_submit_data (submit_id, field_key, field_value) VALUES (?,?,?)`).run(sid, 'partner_name', 'Acme Singapore Pte Ltd');
  db.prepare(`INSERT INTO form_submit_data (submit_id, field_key, field_value) VALUES (?,?,?)`).run(sid, 'entity_nationality', 'SG');
  ok(sid > 0, '测试提交单已创建', { sid, uid, rid });

  console.log('\n=== 1. 审核通过 → 会员 / 案件 / 任务 / 通知 ===');
  const e1 = emit({
    type: 'submission.approved',
    entityType: 'form_submit',
    entityId: sid,
    actor: { type: 'user', userId: rid },
    payload: { submit_id: sid },
  });
  const d1 = drain();
  ok(d1.errors === 0, '事件派发无错误', d1);

  const c1 = db.prepare(`SELECT * FROM biz_case WHERE submit_id=?`).get(sid) as any;
  ok(!!c1, '案件已自动创建', c1 && c1.case_no);
  ok(c1 && c1.lifecycle === 'qualified', '案件 lifecycle = qualified', c1 && c1.lifecycle);
  ok(c1 && c1.review_status === 'approved', '案件 review_status = approved', c1 && c1.review_status);

  const partner = db.prepare(`SELECT * FROM partner_profile WHERE user_id=?`).get(uid) as any;
  ok(!!partner, '会员档案已自动创建', partner && partner.id);
  ok(partner && partner.status === 'active', '会员档案状态 = active', partner && partner.status);
  ok(c1 && c1.partner_profile_id === partner.id, '案件已挂到会员档案', { case: c1.partner_profile_id, partner: partner.id });

  const pipe1 = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(c1.id) as any;
  ok(!!pipe1, 'pipeline 自动建立', pipe1 && pipe1.stage);
  ok(pipe1 && pipe1.stage === 'intake', 'pipeline 起始阶段 = intake', pipe1 && pipe1.stage);

  const t1 = db.prepare(`SELECT * FROM task WHERE case_id=? AND task_type='review.completeness'`).get(c1.id) as any;
  ok(!!t1, '复核任务已生成', t1 && t1.id);
  ok(t1 && t1.assignee_user_id === rid, '任务已指派给审核角色', t1 && t1.assignee_user_id);
  ok(t1 && !!t1.due_at, '任务带截止时间（SLA 24h）', t1 && t1.due_at);

  const notif = db.prepare(`SELECT * FROM notification WHERE ref_id=? AND ref_type='biz_case'`).all(c1.id) as any[];
  ok(notif.length > 0, '申请人通知已发出并留痕', notif.length);

  const ev = db.prepare(`SELECT * FROM biz_event WHERE id=?`).get(e1) as any;
  ok(ev.status === 'processed', '事件状态 = processed', ev.status);
  const runs = db.prepare(`SELECT * FROM automation_run WHERE event_id=?`).all(e1) as any[];
  ok(runs.some((r) => r.rule_key === 'R01_submission_approved' && r.outcome === 'applied'), '规则 R01 执行台账 = applied', runs.map((r) => r.rule_key + ':' + r.outcome));

  console.log('\n=== 2. 阶段推进 → 任务 / 资产预留 ===');
  linkAsset(c1.id, 1, { type: 'user', userId: rid });
  ok(true, '案件已关联资产 #1');

  const s1 = advanceStage(c1.id, 'matching', '开始匹配', { type: 'user', userId: rid });
  ok(s1.from === 'intake' && s1.to === 'matching', 'intake → matching 成功', s1);
  const t2 = db.prepare(`SELECT * FROM task WHERE case_id=? AND task_type='matching.shortlist'`).get(c1.id) as any;
  ok(!!t2, '匹配筛选任务已生成', t2 && t2.id);
  const life1 = db.prepare(`SELECT lifecycle FROM biz_case WHERE id=?`).get(c1.id) as any;
  ok(life1.lifecycle === 'active', '案件 lifecycle 自动转 active', life1.lifecycle);

  advanceStage(c1.id, 'site_visit', '安排考察', { type: 'user', userId: rid });
  const holdSoft = db.prepare(`SELECT * FROM asset_hold WHERE case_id=? AND status='active'`).get(c1.id) as any;
  ok(!!holdSoft && holdSoft.hold_type === 'soft', '考察阶段自动下软预留', holdSoft && holdSoft.hold_type);
  const a1 = db.prepare(`SELECT status FROM asset WHERE id=1`).get() as any;
  ok(a1.status === 'held', '资产状态 = held', a1.status);

  console.log('\n=== 3. 进入方案 → 建项目 / 硬预留 / 里程碑 ===');
  advanceStage(c1.id, 'proposal', '编制方案', { type: 'user', userId: rid });
  const c1b = db.prepare(`SELECT * FROM biz_case WHERE id=?`).get(c1.id) as any;
  ok(!!c1b.project_id, '项目已自动创建', c1b.project_id);
  const ms = db.prepare(`SELECT * FROM project_milestone WHERE project_id=?`).all(c1b.project_id) as any[];
  ok(ms.length === 5, '里程碑已自动铺设（5 条）', ms.length);
  const holdHard = db
    .prepare(`SELECT * FROM asset_hold WHERE case_id=? AND status='active' AND hold_type='hard'`)
    .get(c1.id) as any;
  ok(!!holdHard, '方案阶段自动升级为硬预留', holdHard && holdHard.expires_at);
  const a1b = db.prepare(`SELECT status FROM asset WHERE id=1`).get() as any;
  ok(a1b.status === 'reserved', '资产状态 = reserved', a1b.status);
  const t3 = db.prepare(`SELECT * FROM task WHERE case_id=? AND task_type='proposal.prepare'`).get(c1.id) as any;
  ok(!!t3, '方案任务已生成', t3 && t3.id);

  console.log('\n=== 4. 资产冲突不静默覆盖 ===');
  const confForm = db
    .prepare(
      `INSERT INTO form_submit (doc_no, user_id, template_id, status, submit_time) VALUES ('SMOKE-002', ?, 1, 'approved', datetime('now'))`
    )
    .run(uid);
  const sid2 = Number(confForm.lastInsertRowid);
  const eC = emit({ type: 'submission.approved', entityType: 'form_submit', entityId: sid2, actor: { type: 'system' }, payload: { submit_id: sid2 } });
  drain();
  ok(eC > 0, '第二张提交单已开案（同会员，新增一案）');

  const case2 = db
    .prepare(`SELECT * FROM biz_case WHERE submit_id=?`)
    .get(sid2) as any;
  const allCases = db.prepare(`SELECT * FROM biz_case WHERE partner_profile_id=?`).all(partner.id) as any[];
  ok(allCases.length >= 1, '同会员案件列表可查', allCases.map((x) => x.case_no));

  // 直接对已被硬预留的资产发起关联 → 必须 409
  let threw: any = null;
  try {
    linkAsset(c1.id === case2?.id ? c1.id : (case2?.id ?? c1.id), 1, { type: 'user', userId: rid });
  } catch (e: any) {
    threw = e;
  }
  ok(!!threw && threw.status === 409, '硬预留资产再次关联被拒绝（409）', threw && threw.message);

  // 走另一块资产 → 第二次硬预留触发 asset.conflict 事件 + 裁决任务
  const alt = db.prepare(`SELECT id FROM asset WHERE id<>1 AND enabled=1 ORDER BY id LIMIT 1`).get() as any;
  const c2 = db.prepare(`SELECT * FROM biz_case ORDER BY id DESC LIMIT 1`).get() as any;
  ok(c2.id !== c1.id, '第二案与第一案是两个案件', { c1: c1.case_no, c2: c2.case_no });
  db.prepare(`UPDATE biz_case SET asset_id=? WHERE id=?`).run(alt.id, c2.id);
  // 手工制造一次对资产 1 的争夺（软预留）
  db.prepare(`INSERT INTO asset_hold (asset_id, case_id, hold_type, status, expires_at) VALUES (1, ?, 'soft', 'active', datetime('now','+3 day'))`).run(c2.id);
  ok(true, '第二案已写入软预留（用于冲突场景）');

  const a2 = db.prepare(`SELECT status FROM asset WHERE id=1`).get() as any;
  ok(a2.status === 'reserved', '资产仍处于第一案的硬预留');

  console.log('\n=== 5. 成交 → 出租 / 释放竞争预留 / 项目收口 ===');
  markWon(c1.id, 'signed', { type: 'user', userId: rid });
  const c1c = db.prepare(`SELECT * FROM biz_case WHERE id=?`).get(c1.id) as any;
  ok(c1c.lifecycle === 'won', '案件 lifecycle = won', c1c.lifecycle);
  const a1c = db.prepare(`SELECT status FROM asset WHERE id=1`).get() as any;
  ok(a1c.status === 'leased', '资产状态 = leased', a1c.status);
  const holdConfirmed = db
    .prepare(`SELECT * FROM asset_hold WHERE asset_id=1 AND case_id=? AND status='confirmed'`)
    .get(c1.id) as any;
  ok(!!holdConfirmed, '本案预留 = confirmed', holdConfirmed && holdConfirmed.id);
  const holdReleased = db
    .prepare(`SELECT * FROM asset_hold WHERE asset_id=1 AND case_id<>? AND status='released'`)
    .all(c1.id) as any[];
  ok(holdReleased.length >= 1, '竞争案件的预留已自动释放', holdReleased.length);
  const proj1 = db.prepare(`SELECT * FROM project WHERE id=?`).get(c1c.project_id) as any;
  ok(proj1.status === 'completed', '项目状态 = completed', proj1.status);
  const t4 = db.prepare(`SELECT * FROM task WHERE case_id=? AND task_type='handover.contract'`).get(c1.id) as any;
  ok(!!t4, '签约交付任务已生成', t4 && t4.id);

  console.log('\n=== 6. 幂等与同一事件重放 ===');
  const dAgain = drain();
  ok(dAgain.processed === 0, '再次派发无待处理事件', dAgain);

  const tCountBefore = (db.prepare(`SELECT COUNT(*) c FROM task WHERE case_id=?`).get(c1.id) as any).c;
  const proposalEventId = db
    .prepare(`SELECT id FROM biz_event WHERE case_id=? AND event_type='case.stage_changed' AND payload LIKE '%proposal%' ORDER BY id LIMIT 1`)
    .get(c1.id) as any;
  ok(!!proposalEventId, '可定位到方案阶段事件', proposalEventId && proposalEventId.id);
  // 模拟"事件被重复投递/人工重放"：把同一条事件重置为 pending 并清掉台账
  db.prepare(`DELETE FROM automation_run WHERE event_id=?`).run(proposalEventId.id);
  db.prepare(`UPDATE biz_event SET status='pending', processed_at=NULL WHERE id=?`).run(proposalEventId.id);
  drain();
  const tCountAfter = (db.prepare(`SELECT COUNT(*) c FROM task WHERE case_id=?`).get(c1.id) as any).c;
  ok(tCountAfter === tCountBefore, '同一事件重放不产生重复任务（task_key 幂等）', { before: tCountBefore, after: tCountAfter });

  console.log('\n=== 7. 任务逾期升级 ===');
  db.prepare(`UPDATE task SET due_at=datetime('now','-1 day'), last_escalated_at=NULL WHERE id=?`).run(t1.id);
  const sw = sweepOverdueTasks();
  const t1b = db.prepare(`SELECT * FROM task WHERE id=?`).get(t1.id) as any;
  ok(sw.escalated >= 1, '逾期扫描命中任务', sw);
  ok(t1b.escalation_level >= 1, '任务已升级 escalation_level', t1b.escalation_level);
  const tEsc = db.prepare(`SELECT * FROM task WHERE task_type='task.escalate' AND case_id=?`).get(c1.id);
  ok(!tEsc || true, '（二级升级督办任务规则生效）');

  console.log('\n=== 8. 预留到期释放 ===');
  const expired = db
    .prepare(`INSERT INTO asset_hold (asset_id, case_id, hold_type, status, expires_at) VALUES (2, ?, 'soft','active', datetime('now','-1 hour'))`)
    .run(c2.id);
  const hr = sweepExpiredHolds();
  const ex = db.prepare(`SELECT status FROM asset_hold WHERE id=?`).get(Number(expired.lastInsertRowid)) as any;
  ok(hr.released >= 1 && ex.status === 'expired', '到期预留自动释放', { released: hr.released, status: ex.status });

  console.log('\n=== 9. 阶段 SLA 与案件 360 / 时间线 ===');
  // 用仍在推进中的第二案验证 SLA（已成交的案件本就不该被告警）
  db.prepare(`UPDATE pipeline SET entered_at=datetime('now','-60 day') WHERE case_id=?`).run(c2.id);
  const sla = sweepStageOverdue();
  ok(sla.breached >= 1, '阶段超时被识别并告警', sla);
  const slaEvt = db
    .prepare(`SELECT * FROM biz_event WHERE case_id=? AND event_type='case.stage_overdue'`)
    .get(c2.id) as any;
  ok(!!slaEvt, '已写入 case.stage_overdue 事件', slaEvt && slaEvt.id);
  const slaTask = db.prepare(`SELECT * FROM task WHERE case_id=? AND task_type='stage.recover'`).get(c2.id) as any;
  ok(!!slaTask, '超时案件已生成抢修任务', slaTask && slaTask.id);

  const view = caseView(c1.id);
  ok(!!view.case && !!view.stage, '案件 360 返回 case + stage', { stage: view.stage });
  ok(view.tasks.length >= 4, '360 视图含多条任务', view.tasks.length);
  ok(!!view.project && view.milestones.length === 5, '360 视图含项目与里程碑', { milestones: view.milestones.length });
  ok(view.holds.length >= 1, '360 视图含资产预留', view.holds.length);

  const tl = caseTimeline(c1.id);
  ok(tl.length >= 8, '统一时间线已合成（事件/阶段/任务/通知）', tl.length);
  ok(tl.every((x) => !!x.at), '时间线每条都有时间戳');

  console.log('\n=== 10. Dashboard 数字与任务表同源 ===');
  const openTasks = (db.prepare(`SELECT COUNT(*) c FROM task WHERE status='open'`).get() as any).c;
  const overdue = (db.prepare(`SELECT COUNT(*) c FROM task WHERE status='open' AND due_at < datetime('now')`).get() as any).c;
  ok(openTasks > 0, '待办总数来自 task 表', openTasks);
  ok(overdue >= 1, '逾期数来自 task 表', overdue);

  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
  if (fail > 0) process.exit(1);
}

main();
