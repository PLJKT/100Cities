import { getDb } from '../../config/db';
import { env } from '../../config/env';
import { nextCaseNo } from '../../db/migrate_v5';
import { emit } from './bus';
import { sendGenericEmail, sendWhatsAppNotification } from '../notify/notify.service';

/**
 * 动作执行器：规则只能调用这里注册的动作，不能写任意 SQL。
 * 每个动作都是"幂等安全"的——重复执行不会产生重复实体（task_key / unique 索引兜底）。
 */

export interface ActionCtx {
  event: any;
  payload: any;
  case: any; // biz_case 行，可能为 null
  eventId: number;
}

type Handler = (params: any, ctx: ActionCtx) => string;

const nowPlus = (hours: number): string => {
  const db = getDb();
  const r = db.prepare(`SELECT datetime('now', ?) AS d`).get(`+${Math.round(hours)} hours`) as any;
  return r.d;
};

function nextDepth(ctx: ActionCtx): number {
  return (ctx.event?.depth ?? 0) + 1;
}

function caseIdOf(ctx: ActionCtx): number | null {
  return ctx.case?.id ?? ctx.event?.case_id ?? null;
}

/** 从事件上下文推导申请主体信息（提交 → 会员 → 线索 三种来源） */
function deriveOrgInfo(ctx: ActionCtx): {
  userId: number | null;
  orgName: string;
  country: string | null;
  industry: string | null;
  companySize: string | null;
  sourceChannel: string | null;
  submitId: number | null;
  leadId: number | null;
  partnerId: number | null;
} {
  const db = getDb();
  const out: any = {
    userId: ctx.payload?.user_id ?? null,
    orgName: '',
    country: null,
    industry: null,
    companySize: null,
    sourceChannel: null,
    submitId: null,
    leadId: null,
    partnerId: null,
  };

  // 来源 1：表单提交
  if (ctx.event.entity_type === 'form_submit') {
    const submitId = ctx.event.entity_id;
    out.submitId = submitId;
    const s = db.prepare(`SELECT * FROM form_submit WHERE id=?`).get(submitId) as any;
    if (s) {
      out.userId = s.user_id;
      const u = db.prepare(`SELECT * FROM sys_user WHERE id=?`).get(s.user_id) as any;
      const data = db.prepare(`SELECT field_key, field_value FROM form_submit_data WHERE submit_id=?`).all(submitId) as any[];
      const kv: Record<string, string> = {};
      for (const d of data) kv[d.field_key] = d.field_value;
      out.orgName = kv['partner_name'] || u?.partner_name || u?.username || `Submission ${submitId}`;
      out.country = kv['entity_nationality'] || null;
      out.sourceChannel = 'submission';
      const prof = db.prepare(`SELECT * FROM partner_profile WHERE user_id=?`).get(s.user_id) as any;
      if (prof) out.partnerId = prof.id;
    }
  }

  // 来源 2：线索
  if (ctx.event.entity_type === 'lead') {
    const leadId = ctx.event.entity_id;
    out.leadId = leadId;
    const l = db.prepare(`SELECT * FROM lead WHERE id=?`).get(leadId) as any;
    if (l) {
      out.userId = l.channel_user_id;
      out.orgName = l.company_name;
      out.industry = l.industry;
      out.companySize = l.company_size;
      out.sourceChannel = l.source_channel;
    }
  }

  // 来源 3：案件已存在 → 以案件为主
  if (ctx.case) {
    out.orgName = ctx.case.org_name || out.orgName;
    out.country = ctx.case.country ?? out.country;
    out.industry = ctx.case.industry ?? out.industry;
    out.companySize = ctx.case.company_size ?? out.companySize;
    out.sourceChannel = ctx.case.source_channel ?? out.sourceChannel;
    out.leadId = ctx.case.lead_id ?? out.leadId;
    out.partnerId = ctx.case.partner_profile_id ?? out.partnerId;
    out.submitId = ctx.case.submit_id ?? out.submitId;
  }

  return out;
}

function loadCase(caseId: number | null): any {
  if (!caseId) return null;
  return getDb().prepare(`SELECT * FROM biz_case WHERE id=?`).get(caseId) || null;
}

/** 确保 pipeline 存在（阶段唯一真相仍是 pipeline.stage） */
function ensurePipeline(caseId: number, ownerId: number | null): any {
  const db = getDb();
  let p = db.prepare(`SELECT * FROM pipeline WHERE case_id=?`).get(caseId) as any;
  if (p) return p;
  const info = db
    .prepare(`INSERT INTO pipeline (case_id, stage, updated_by, entered_at, updated_at) VALUES (?, 'intake', ?, datetime('now'), datetime('now'))`)
    .run(caseId, ownerId);
  p = db.prepare(`SELECT * FROM pipeline WHERE id=?`).get(Number(info.lastInsertRowid));
  return p;
}

/** 按角色取一个可用账号 */
function userByRole(roleId: number | null | undefined): number | null {
  if (!roleId) return null;
  const r = getDb()
    .prepare(`SELECT id FROM sys_user WHERE role_id=? AND enabled=1 ORDER BY id LIMIT 1`)
    .get(roleId) as any;
  return r?.id ?? null;
}

function resolveRecipient(to: string, ctx: ActionCtx): { email: string | null; phone: string | null } {
  const db = getDb();
  const email = (v: any) => (v && String(v).includes('@') ? String(v) : null);

  if (to === 'admin') {
    const u = db.prepare(`SELECT email, phone FROM sys_user WHERE role_id=1 AND enabled=1 ORDER BY id LIMIT 1`).get() as any;
    return { email: email(u?.email) || (email(env.MAIL_TO) ? env.MAIL_TO : null), phone: u?.phone || env.WA_TO };
  }

  if (to === 'applicant') {
    if (ctx.case?.submit_id) {
      const u = db.prepare(`SELECT email, phone FROM sys_user WHERE id=(SELECT user_id FROM form_submit WHERE id=?)`).get(ctx.case.submit_id) as any;
      if (u) return { email: email(u.email), phone: u.phone || null };
    }
    if (ctx.case?.lead_id) {
      const l = db.prepare(`SELECT contact_email, contact_phone FROM lead WHERE id=?`).get(ctx.case.lead_id) as any;
      if (l) return { email: email(l.contact_email), phone: l.contact_phone || null };
    }
    if (ctx.case?.partner_profile_id) {
      const p = db.prepare(`SELECT contact_email, contact_phone FROM partner_profile WHERE id=?`).get(ctx.case.partner_profile_id) as any;
      if (p) return { email: email(p.contact_email), phone: p.contact_phone || null };
    }
    if (ctx.payload?.user_id) {
      const u = db.prepare(`SELECT email, phone FROM sys_user WHERE id=?`).get(ctx.payload.user_id) as any;
      if (u) return { email: email(u.email), phone: u.phone || null };
    }
    return { email: null, phone: null };
  }

  return { email: email(to), phone: String(to) || null };
}

// ---------------- 动作实现 ----------------

const ensurePartner: Handler = (p, ctx) => {
  const db = getDb();
  const info = deriveOrgInfo(ctx);
  if (!info.userId) return 'no user in context';
  const existing = db.prepare(`SELECT * FROM partner_profile WHERE user_id=?`).get(info.userId) as any;
  if (existing) {
    if (p.status && existing.status !== p.status) {
      db.prepare(`UPDATE partner_profile SET status=?, updated_at=datetime('now') WHERE id=?`).run(p.status, existing.id);
      return `partner_profile ${existing.id} status → ${p.status}`;
    }
    return `partner_profile ${existing.id} exists`;
  }
  const info2 = db
    .prepare(
      `INSERT INTO partner_profile (user_id, company_name, nationality, industry, tier, status, contact_email, contact_phone)
       VALUES (?, ?, ?, ?, 'explorer', ?, ?, ?)`
    )
    .run(
      info.userId,
      info.orgName || `Partner ${info.userId}`,
      info.country || 'ID',
      info.industry || null,
      p.status || 'active',
      null,
      null
    );
  return `partner_profile ${Number(info2.lastInsertRowid)} created`;
};

const ensureCase: Handler = (p, ctx) => {
  const db = getDb();
  const info = deriveOrgInfo(ctx);

  // 已存在 → 只更新生命周期/审核状态，不重复建档
  if (ctx.case) {
    if (p.lifecycle) db.prepare(`UPDATE biz_case SET lifecycle=?, updated_at=datetime('now') WHERE id=?`).run(p.lifecycle, ctx.case.id);
    if (p.review_status) db.prepare(`UPDATE biz_case SET review_status=?, updated_at=datetime('now') WHERE id=?`).run(p.review_status, ctx.case.id);
    ensurePipeline(ctx.case.id, ctx.case.owner_user_id ?? null);
    return `case ${ctx.case.case_no} updated`;
  }

  let found: any = null;
  if (info.submitId) found = db.prepare(`SELECT * FROM biz_case WHERE submit_id=?`).get(info.submitId);
  if (!found && info.leadId) found = db.prepare(`SELECT * FROM biz_case WHERE lead_id=?`).get(info.leadId);

  if (found) {
    db.prepare(
      `UPDATE biz_case SET lifecycle=COALESCE(?,lifecycle), review_status=COALESCE(?,review_status), updated_at=datetime('now') WHERE id=?`
    ).run(p.lifecycle ?? null, p.review_status ?? null, found.id);
    ensurePipeline(found.id, found.owner_user_id ?? null);
    ctx.case = found;
    return `case ${found.case_no} linked`;
  }

  const caseNo = nextCaseNo(db);
  const owner =
    ctx.payload?.user_id && ctx.event.actor === 'user' && ctx.event.actor_user_id
      ? ctx.event.actor_user_id
      : userByRole(3);

  const ins = db
    .prepare(
      `INSERT INTO biz_case (case_no, origin, org_name, country, industry, company_size, source_channel,
                             lifecycle, review_status, lead_id, partner_profile_id, submit_id, owner_user_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      caseNo,
      p.origin || 'manual',
      info.orgName || 'Untitled case',
      info.country,
      info.industry,
      info.companySize,
      info.sourceChannel,
      p.lifecycle || 'inquiry',
      p.review_status || 'pending',
      info.leadId,
      info.partnerId,
      info.submitId,
      p.owner_user_id || owner,
      ctx.event.actor_user_id ?? null
    );

  const caseId = Number(ins.lastInsertRowid);
  ensurePipeline(caseId, owner);
  // 回写来源实体，保证双向可查
  if (info.leadId) db.prepare(`UPDATE lead SET updated_at=datetime('now') WHERE id=?`).run(info.leadId);
  if (info.submitId) {
    const p0 = db.prepare(`SELECT id FROM pipeline WHERE case_id=?`).get(caseId) as any;
    if (p0) db.prepare(`UPDATE pipeline SET submit_id=? WHERE id=?`).run(info.submitId, p0.id);
  }

  ctx.case = db.prepare(`SELECT * FROM biz_case WHERE id=?`).get(caseId);
  return `case ${caseNo} created`;
};

const createTask: Handler = (p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  const taskKey = `${p.task_type}:${caseId ?? 'e' + ctx.eventId}:${ctx.eventId}`;

  const existing = db.prepare(`SELECT id, status FROM task WHERE task_key=?`).get(taskKey) as any;
  if (existing) return `task ${existing.id} exists`;

  // 指派优先级：规则显式指定人 → 规则指定角色 → 案件负责人 → Reviewer 角色 → 兜底给超级管理员
  // 兜底的目的：任务永远不要"无人认领"地躺在任务中心里（真实系统里这类孤儿任务就是丢单的开始）
  const assignee =
    p.assign_user ||
    (p.assign_role ? userByRole(Number(p.assign_role)) : null) ||
    (caseId ? loadCase(caseId)?.owner_user_id : null) ||
    userByRole(3) ||
    (db.prepare(`SELECT id FROM sys_user WHERE enabled=1 ORDER BY (role_id=1) DESC, id LIMIT 1`).get() as any)?.id ||
    null;

  const hours = Number(p.due_in_hours ?? p.sla_hours ?? 72);
  const dueAt = p.due_at || nowPlus(hours);

  const info = db
    .prepare(
      `INSERT INTO task (task_key, case_id, project_id, asset_id, task_type, title, title_id, title_zh, detail,
                         assignee_user_id, assign_role, priority, status, due_at, sla_hours, created_by_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
    )
    .run(
      taskKey,
      caseId,
      p.project_id ?? (caseId ? loadCase(caseId)?.project_id : null),
      p.asset_id ?? (caseId ? loadCase(caseId)?.asset_id : null),
      p.task_type,
      p.title || p.task_type,
      p.title_id || null,
      p.title_zh || null,
      p.detail || null,
      assignee,
      p.assign_role ? Number(p.assign_role) : null,
      p.priority || 'normal',
      dueAt,
      p.sla_hours ?? null,
      ctx.eventId
    );
  return `task ${Number(info.lastInsertRowid)} created (${p.task_type})`;
};

const notify: Handler = (p, ctx) => {
  const db = getDb();
  const channel: 'email' | 'whatsapp' = p.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const rc = resolveRecipient(String(p.to || 'applicant'), ctx);
  const to = channel === 'email' ? rc.email : rc.phone;
  if (!to) return `no recipient for ${p.to}`;

  const subject = p.subject || null;
  const body = p.body || '';
  const caseId = caseIdOf(ctx);

  // 发送结果由 notify.service 自己写 notification 记录（sent / failed），这里不再预插一条 queued 造成重复
  if (channel === 'email') {
    void sendGenericEmail({ to, subject: subject || '100 Cities notification', body, refType: 'biz_case', refId: caseId ?? undefined }).catch(() => {});
  } else {
    void sendWhatsAppNotification({ to, text: body, refType: 'biz_case', refId: caseId ?? undefined }).catch(() => {});
  }
  return `notify ${channel} → ${to}`;
};

const setLifecycle: Handler = (p, ctx) => {
  if (!caseIdOf(ctx)) return 'no case';
  const db = getDb();
  db.prepare(`UPDATE biz_case SET lifecycle=?, updated_at=datetime('now') WHERE id=?`).run(p.lifecycle, caseIdOf(ctx));
  if (ctx.case) ctx.case.lifecycle = p.lifecycle;
  return `lifecycle → ${p.lifecycle}`;
};

const holdAsset: Handler = (p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  const c = loadCase(caseId);
  if (!c?.asset_id) return 'case has no linked asset — hold skipped';

  const assetId = Number(c.asset_id);
  const holdType = p.hold_type === 'hard' ? 'hard' : 'soft';
  const hours = Number(p.ttl_hours ?? (holdType === 'hard' ? 720 : 72));
  const expiresAt = nowPlus(hours);

  // 冲突检测：同资产上已存在别的案件的有效预留
  const conflict = db
    .prepare(
      `SELECT h.*, bc.case_no FROM asset_hold h JOIN biz_case bc ON bc.id=h.case_id
       WHERE h.asset_id=? AND h.status IN ('active','confirmed') AND h.case_id<>?`
    )
    .get(assetId, caseId) as any;

  if (conflict) {
    emit({
      type: 'asset.conflict',
      entityType: 'asset',
      entityId: assetId,
      caseId,
      payload: {
        asset_id: assetId,
        message: `Asset ${assetId} already held by case ${conflict.case_no} (${conflict.hold_type}, expires ${conflict.expires_at}). Case ${c.case_no} requested a ${holdType} hold.`,
        message_zh: `资产 ${assetId} 已被案件 ${conflict.case_no} 占用，案件 ${c.case_no} 的预留请求需人工裁决。`,
      },
      causeEventId: ctx.eventId,
      depth: nextDepth(ctx),
    });
    return `asset ${assetId} conflict with ${conflict.case_no} — logged for review`;
  }

  const mine = db
    .prepare(`SELECT * FROM asset_hold WHERE asset_id=? AND case_id=? AND status IN ('active','confirmed')`)
    .get(assetId, caseId) as any;

  if (mine) {
    db.prepare(
      `UPDATE asset_hold SET hold_type=?, expires_at=?, note=? WHERE id=?`
    ).run(
      holdType === 'hard' ? 'hard' : mine.hold_type,
      expiresAt,
      p.note || mine.note,
      mine.id
    );
  } else {
    db.prepare(
      `INSERT INTO asset_hold (asset_id, case_id, hold_type, status, area_desc, note, expires_at, created_by)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
    ).run(assetId, caseId, holdType, p.area_desc || null, p.note || null, expiresAt, ctx.event.actor_user_id ?? null);
  }

  const nextStatus = holdType === 'hard' ? 'reserved' : 'held';
  const cur = db.prepare(`SELECT status FROM asset WHERE id=?`).get(assetId) as any;
  if (cur && cur.status !== 'leased' && cur.status !== 'planning') {
    db.prepare(`UPDATE asset SET status=?, updated_at=datetime('now') WHERE id=?`).run(nextStatus, assetId);
  }
  return `asset ${assetId} ${holdType} hold until ${expiresAt}`;
};

const releaseHolds: Handler = (_p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  if (!caseId) return 'no case';
  const holds = db.prepare(`SELECT * FROM asset_hold WHERE case_id=? AND status IN ('active','confirmed')`).all(caseId) as any[];
  for (const h of holds) {
    db.prepare(`UPDATE asset_hold SET status='released', released_at=datetime('now') WHERE id=?`).run(h.id);
    const others = db
      .prepare(`SELECT COUNT(*) c FROM asset_hold WHERE asset_id=? AND status IN ('active','confirmed')`)
      .get(h.asset_id) as any;
    if (!others.c) {
      const a = db.prepare(`SELECT status FROM asset WHERE id=?`).get(h.asset_id) as any;
      if (a && a.status !== 'planning') {
        db.prepare(`UPDATE asset SET status='available', updated_at=datetime('now') WHERE id=?`).run(h.asset_id);
      }
    }
  }
  return `released ${holds.length} hold(s)`;
};

const leaseAsset: Handler = (_p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  const c = loadCase(caseId);
  if (!c?.asset_id) return 'case has no linked asset — lease skipped';
  const assetId = Number(c.asset_id);

  const mine = db
    .prepare(`SELECT * FROM asset_hold WHERE asset_id=? AND case_id=? AND status IN ('active','confirmed')`)
    .get(assetId, caseId) as any;

  if (!mine) {
    // 没有预留也允许成交（可能是直接签约），补一条 confirmed 记录
    db.prepare(
      `INSERT INTO asset_hold (asset_id, case_id, hold_type, status, expires_at, created_by)
       VALUES (?, ?, 'hard', 'confirmed', NULL, ?)`
    ).run(assetId, caseId, ctx.event.actor_user_id ?? null);
  } else {
    db.prepare(`UPDATE asset_hold SET status='confirmed' WHERE id=?`).run(mine.id);
  }

  // 释放同资产其他案件的有效预留
  const others = db
    .prepare(`SELECT id FROM asset_hold WHERE asset_id=? AND case_id<>? AND status IN ('active','confirmed')`)
    .all(assetId, caseId) as any[];
  for (const o of others) {
    db.prepare(`UPDATE asset_hold SET status='released', released_at=datetime('now') WHERE id=?`).run(o.id);
  }

  db.prepare(`UPDATE asset SET status='leased', updated_at=datetime('now') WHERE id=?`).run(assetId);
  const a = db.prepare(`SELECT name FROM asset WHERE id=?`).get(assetId) as any;
  return `asset ${a?.name || assetId} leased to ${c.case_no}; released ${others.length} competing hold(s)`;
};

const ensureProject: Handler = (_p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  if (!caseId) return 'no case';
  const c = loadCase(caseId);
  if (c?.project_id) {
    const pr = db.prepare(`SELECT id FROM project WHERE id=?`).get(c.project_id) as any;
    if (pr) return `project ${pr.id} exists`;
  }

  const asset = c?.asset_id ? (db.prepare(`SELECT name FROM asset WHERE id=?`).get(c.asset_id) as any) : null;
  const pipe = db.prepare(`SELECT stage FROM pipeline WHERE case_id=?`).get(caseId) as any;
  const name = `${c.org_name}${asset?.name ? ' — ' + asset.name : ''}`;

  const ins = db
    .prepare(
      `INSERT INTO project (case_id, lead_id, member_id, asset_id, name, description, stage, progress_pct, estimated_value, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', datetime('now'))`
    )
    .run(
      caseId,
      c.lead_id,
      c.partner_profile_id,
      c.asset_id,
      name,
      `Auto-opened at proposal stage for case ${c.case_no}.`,
      pipe?.stage || 'proposal',
      c.value_desc
    );

  const projectId = Number(ins.lastInsertRowid);
  db.prepare(`UPDATE biz_case SET project_id=?, updated_at=datetime('now') WHERE id=?`).run(projectId, caseId);
  ctx.case = loadCase(caseId);

  emit({
    type: 'project.created',
    entityType: 'project',
    entityId: projectId,
    caseId,
    payload: { project_id: projectId, case_no: c.case_no, name },
    causeEventId: ctx.eventId,
    depth: nextDepth(ctx),
  });
  return `project ${projectId} created`;
};

const seedMilestones: Handler = (p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  const c = loadCase(caseId);
  if (!c?.project_id) return 'no project — milestones skipped';
  const cnt = db.prepare(`SELECT COUNT(*) c FROM project_milestone WHERE project_id=?`).get(c.project_id) as any;
  if (cnt.c > 0) return 'milestones already seeded';

  const items = Array.isArray(p.items) ? p.items : [];
  const ins = db.prepare(`INSERT INTO project_milestone (project_id, name, due_date, status) VALUES (?, ?, ?, 'pending')`);
  let n = 0;
  for (const it of items) {
    const due = it.due_in_days != null ? nowPlus(Number(it.due_in_days) * 24) : null;
    ins.run(c.project_id, String(it.name), due);
    n++;
  }
  return `seeded ${n} milestone(s) on project ${c.project_id}`;
};

const setProjectStatus: Handler = (p, ctx) => {
  const db = getDb();
  const caseId = caseIdOf(ctx);
  const c = loadCase(caseId);
  if (!c?.project_id) return 'no project';
  db.prepare(`UPDATE project SET status=?, updated_at=datetime('now') WHERE id=?`).run(p.status, c.project_id);
  return `project ${c.project_id} → ${p.status}`;
};

const escalateTask: Handler = (_p, ctx) => {
  const db = getDb();
  const taskId = ctx.payload?.task_id;
  if (!taskId) return 'no task id in event';
  const t = db.prepare(`SELECT * FROM task WHERE id=?`).get(taskId) as any;
  if (!t) return `task ${taskId} not found`;
  const lvl = Number(t.escalation_level || 0) + 1;
  db.prepare(`UPDATE task SET escalation_level=?, last_escalated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(lvl, taskId);

  // 升级到第 2 级时，给管理员补一条督办任务
  if (lvl >= 2) {
    const admin = userByRole(1);
    const key = `task.escalate:${taskId}:lvl${lvl}`;
    const dup = db.prepare(`SELECT id FROM task WHERE task_key=?`).get(key);
    if (!dup) {
      db.prepare(
        `INSERT INTO task (task_key, case_id, project_id, asset_id, task_type, title, detail, assignee_user_id,
                           priority, status, due_at, sla_hours, escalation_level, created_by_event_id)
         VALUES (?, ?, ?, ?, 'task.escalate', ?, ?, ?, 'urgent', 'open', ?, 24, ?, ?)`
      ).run(
        key,
        t.case_id,
        t.project_id,
        t.asset_id,
        `Escalated: ${t.title}`,
        `Auto-escalated from task ${taskId} (level ${lvl}).`,
        admin,
        nowPlus(24),
        lvl,
        ctx.eventId
      );
    }
    return `task ${taskId} escalated to level ${lvl} + supervisor task`;
  }
  return `task ${taskId} escalated to level ${lvl}`;
};

export const ACTIONS: Record<string, Handler> = {
  ensure_partner: ensurePartner,
  ensure_case: ensureCase,
  create_task: createTask,
  notify,
  set_lifecycle: setLifecycle,
  hold_asset: holdAsset,
  release_holds: releaseHolds,
  lease_asset: leaseAsset,
  ensure_project: ensureProject,
  seed_milestones: seedMilestones,
  set_project_status: setProjectStatus,
  escalate_task: escalateTask,
};
