/**
 * 自动化规则种子（声明式：事件 → 条件 → 动作）
 *
 * 设计约束：
 * - 规则是「数据」，执行器是「代码」。规则只能调用已注册的动作类型，不能写任意 SQL / 表达式。
 * - 条件只对事件 payload 做受限匹配（eq / ne / in / gte / lte / exists），不做 eval。
 * - 参数支持占位符 {{event.payload.x}} / {{case.x}}，由执行器解析，规则本身保持可读。
 *
 * 这一段是整个「模块联动」的目录：看这 13 条就知道系统会自动做什么。
 */

export interface RuleAction {
  type: string;
  params?: Record<string, any>;
}

export interface RuleDef {
  key: string;
  name: string;
  event: string;
  condition?: Record<string, any>;
  actions: RuleAction[];
  priority?: number;
  description?: string;
}

export const AUTOMATION_RULES: RuleDef[] = [
  {
    key: 'R01_submission_approved',
    name: 'Submission approved → open case',
    event: 'submission.approved',
    priority: 10,
    description: '审核通过不再只改一个状态：建会员档案 → 开案 → 生成复核任务 → 通知申请人。',
    actions: [
      { type: 'ensure_partner', params: { status: 'active' } },
      { type: 'ensure_case', params: { origin: 'submission', lifecycle: 'qualified', review_status: 'approved' } },
      {
        type: 'create_task',
        params: {
          task_type: 'review.completeness',
          title: 'Verify submission completeness',
          title_id: 'Verifikasi kelengkapan dokumen',
          title_zh: '资料齐全性复核',
          assign_role: 3,
          sla_hours: 24,
          priority: 'high',
          detail: 'Check that all required Phase 1 fields and attachments were received before the case moves to matching.',
        },
      },
      {
        type: 'notify',
        params: {
          channel: 'email',
          to: 'applicant',
          subject: 'Your Phase 1 submission has been approved',
          body: 'Your submission has been approved and a case has been opened. Our team will contact you for the next step.',
        },
      },
    ],
  },

  {
    key: 'R02_submission_rejected',
    name: 'Submission rejected → revise task',
    event: 'submission.rejected',
    priority: 10,
    description: '退回后自动开/更新案件为 rejected，生成补正跟进任务，并带批注通知申请人。',
    actions: [
      { type: 'ensure_case', params: { origin: 'submission', lifecycle: 'inquiry', review_status: 'rejected' } },
      {
        type: 'create_task',
        params: {
          task_type: 'submission.revise',
          title: 'Follow up revision with applicant',
          title_id: 'Tindak lanjut perbaikan dengan pemohon',
          title_zh: '跟进申请人补正',
          assign_role: 3,
          sla_hours: 48,
          priority: 'high',
          detail: 'Remark: {{event.payload.remark}}',
        },
      },
      {
        type: 'notify',
        params: {
          channel: 'email',
          to: 'applicant',
          subject: 'Your submission needs correction',
          body: 'Please revise the following items and resubmit: {{event.payload.remark}}',
        },
      },
    ],
  },

  {
    key: 'R03_lead_created',
    name: 'Lead captured → case + qualify task',
    event: 'lead.created',
    priority: 10,
    description: '渠道方录入线索即建案，并生成 48 小时内完成资格判定的任务。',
    actions: [
      { type: 'ensure_case', params: { origin: 'lead', lifecycle: 'inquiry' } },
      {
        type: 'create_task',
        params: {
          task_type: 'lead.qualify',
          title: 'Qualify new lead',
          title_id: 'Kualifikasi prospek baru',
          title_zh: '新线索资格判定',
          assign_role: 3,
          sla_hours: 48,
          detail: 'Confirm investment intent, budget range and target segment before moving to matching.',
        },
      },
    ],
  },

  {
    key: 'R04_stage_matching',
    name: 'Stage → matching',
    event: 'case.stage_changed',
    condition: { to_stage: 'matching' },
    priority: 20,
    description: '进入匹配阶段：案件转为 active，生成资产筛选任务。',
    actions: [
      { type: 'set_lifecycle', params: { lifecycle: 'active' } },
      {
        type: 'create_task',
        params: {
          task_type: 'matching.shortlist',
          title: 'Shortlist matching assets',
          title_id: 'Susun daftar aset yang cocok',
          title_zh: '筛选匹配资产',
          assign_role: 3,
          sla_hours: 72,
          detail: 'Use the asset match endpoint to shortlist up to 3 assets and confirm availability with the asset owner.',
        },
      },
    ],
  },

  {
    key: 'R05_stage_site_visit',
    name: 'Stage → site visit',
    event: 'case.stage_changed',
    condition: { to_stage: 'site_visit' },
    priority: 20,
    description: '进入考察阶段：对意向资产下 72 小时软预留（防重复占用），并生成排期任务。',
    actions: [
      { type: 'hold_asset', params: { hold_type: 'soft', ttl_hours: 72 } },
      {
        type: 'create_task',
        params: {
          task_type: 'site_visit.schedule',
          title: 'Schedule site visit and confirm logistics',
          title_id: 'Jadwalkan kunjungan lokasi',
          title_zh: '安排实地考察',
          assign_role: 3,
          sla_hours: 48,
          priority: 'high',
          detail: 'Asset hold expires in 72 hours — confirm the visit date before the hold is released.',
        },
      },
    ],
  },

  {
    key: 'R06_stage_proposal',
    name: 'Stage → proposal (opens project + hard hold)',
    event: 'case.stage_changed',
    condition: { to_stage: 'proposal' },
    priority: 20,
    description: '进入方案阶段：自动建项目、下硬预留（30 天）、铺 5 个里程碑、生成方案任务。这是之前完全缺失的一段联动。',
    actions: [
      { type: 'ensure_project', params: {} },
      { type: 'hold_asset', params: { hold_type: 'hard', ttl_hours: 720 } },
      {
        type: 'seed_milestones',
        params: {
          items: [
            { name: 'Land / space allocation confirmed', due_in_days: 14 },
            { name: 'Commercial terms agreed', due_in_days: 30 },
            { name: 'Due diligence completed', due_in_days: 45 },
            { name: 'Agreement signed', due_in_days: 60 },
            { name: 'Handover and fit-out start', due_in_days: 90 },
          ],
        },
      },
      {
        type: 'create_task',
        params: {
          task_type: 'proposal.prepare',
          title: 'Prepare commercial proposal',
          title_id: 'Siapkan proposal komersial',
          title_zh: '编制商务方案',
          assign_role: 3,
          sla_hours: 72,
          priority: 'high',
          detail: 'Hard hold on the asset is active for 30 days — the proposal must be issued within this window.',
        },
      },
    ],
  },

  {
    key: 'R07_stage_decision',
    name: 'Stage → decision',
    event: 'case.stage_changed',
    condition: { to_stage: 'decision' },
    priority: 20,
    description: '进入决策阶段：生成管理层决策包任务（指派给最高权限角色）。',
    actions: [
      {
        type: 'create_task',
        params: {
          task_type: 'decision.approval',
          title: 'Prepare decision pack for management',
          title_id: 'Siapkan paket keputusan manajemen',
          title_zh: '准备管理层决策包',
          assign_role: 1,
          sla_hours: 48,
          priority: 'urgent',
          detail: 'Include asset allocation, commercial terms and risk notes.',
        },
      },
    ],
  },

  {
    key: 'R08_case_won',
    name: 'Case won → lease asset + close project',
    event: 'case.won',
    priority: 30,
    description: '成交：资产转 leased、释放同资产其他预留、项目转 completed、生成签约交付任务并通知。',
    actions: [
      { type: 'lease_asset', params: {} },
      { type: 'set_project_status', params: { status: 'completed' } },
      {
        type: 'create_task',
        params: {
          task_type: 'handover.contract',
          title: 'Issue agreement and handover pack',
          title_id: 'Terbitkan perjanjian dan paket serah terima',
          title_zh: '出具协议与交付包',
          assign_role: 1,
          sla_hours: 72,
          priority: 'high',
        },
      },
      {
        type: 'notify',
        params: {
          channel: 'whatsapp',
          to: 'admin',
          body: 'Case {{case.case_no}} won — asset allocated and other holds released.',
        },
      },
    ],
  },

  {
    key: 'R09_case_lost',
    name: 'Case lost → release holds + loss review',
    event: 'case.lost',
    priority: 30,
    description: '失单：释放全部预留让资产回到可售池，项目转 paused，生成失单复盘任务。',
    actions: [
      { type: 'release_holds', params: {} },
      { type: 'set_project_status', params: { status: 'paused' } },
      {
        type: 'create_task',
        params: {
          task_type: 'loss.review',
          title: 'Capture loss reason and recycle asset',
          title_id: 'Catat alasan kehilangan dan daur ulang aset',
          title_zh: '记录失单原因并回收资产',
          assign_role: 3,
          sla_hours: 72,
        },
      },
    ],
  },

  {
    key: 'R10_task_overdue',
    name: 'Task overdue → escalate',
    event: 'task.overdue',
    priority: 40,
    description: '任务逾期自动升级（escalation_level +1）并通知，不再依赖人盯着表格。',
    actions: [
      { type: 'escalate_task', params: {} },
      {
        type: 'notify',
        params: {
          channel: 'whatsapp',
          to: 'admin',
          body: 'Task overdue: {{event.payload.title}} (case {{event.payload.case_no}}).',
        },
      },
    ],
  },

  {
    key: 'R11_stage_overdue',
    name: 'Stage SLA breached → recover',
    event: 'case.stage_overdue',
    priority: 40,
    description: '阶段停留超过 SLA（intake/matching 14 天、考察/方案 21 天、决策 14 天）自动生成抢修任务并告警。',
    actions: [
      {
        type: 'create_task',
        params: {
          task_type: 'stage.recover',
          title: 'Stage overdue — recover or re-stage',
          title_id: 'Tahap terlambat — pulihkan atau susun ulang',
          title_zh: '阶段超时——抢修或重排',
          assign_role: 3,
          sla_hours: 24,
          priority: 'urgent',
          detail: 'Stuck in {{event.payload.stage}} for {{event.payload.age_days}} days.',
        },
      },
      {
        type: 'notify',
        params: {
          channel: 'whatsapp',
          to: 'admin',
          body: 'Case {{event.payload.case_no}} stuck in {{event.payload.stage}} for {{event.payload.age_days}} days.',
        },
      },
    ],
  },

  {
    key: 'R12_asset_conflict',
    name: 'Asset hold conflict → resolve',
    event: 'asset.conflict',
    priority: 50,
    description: '同一资产被两个案件争抢时，不静默覆盖，而是留痕 + 指派给管理员裁决。',
    actions: [
      {
        type: 'create_task',
        params: {
          task_type: 'asset.conflict',
          title: 'Resolve asset allocation conflict',
          title_id: 'Selesaikan konflik alokasi aset',
          title_zh: '处理资产分配冲突',
          assign_role: 1,
          sla_hours: 24,
          priority: 'urgent',
          detail: '{{event.payload.message}}',
        },
      },
    ],
  },

  {
    key: 'R13_project_created',
    name: 'Project created → kickoff task',
    event: 'project.created',
    priority: 15,
    description: '项目一建档就生成 kickoff 任务，避免"项目建了没人管"。',
    actions: [
      {
        type: 'create_task',
        params: {
          task_type: 'project.kickoff',
          title: 'Kick off project and confirm owner',
          title_id: 'Mulai proyek dan konfirmasi penanggung jawab',
          title_zh: '项目启动并确认负责人',
          assign_role: 3,
          sla_hours: 48,
        },
      },
    ],
  },
];
