import { getDb } from '../../config/db';

/**
 * 业务事件总线
 *
 * 语义边界（这是本次重构的核心）：
 *   - sys_operation_log = 审计（谁在何时做了什么），只增不删，不驱动任何下游；
 *   - biz_event         = 业务事实（系统里发生了什么），驱动自动化，可追溯、可重放；
 *   - automation_run    = 决策台账（某条规则为什么执行/为什么跳过），用于解释联动。
 *
 * 投递模型：同库事务内写入 + 出站后同步派发（等价于 outbox + relay 的单进程版本）。
 * SQLite 单写者场景下不需要消息中间件，但保留了 at-least-once 所需的幂等键。
 */

export type Actor = { type: 'user' | 'system'; userId?: number | null };

export interface EventInput {
  type: string;
  entityType: string;
  entityId?: number | null;
  caseId?: number | null;
  payload?: Record<string, any>;
  actor?: Actor;
  causeEventId?: number | null;
  depth?: number;
}

const MAX_DEPTH = 4;
const MAX_EVENTS_PER_DRAIN = 200;

function safeParse(s: any): any {
  if (!s) return {};
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return {};
  }
}

/** 写入一条业务事件（必须在业务事务内调用，才能保证"改数据"和"发事件"同生共死） */
export function emit(input: EventInput): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO biz_event (event_type, entity_type, entity_id, case_id, actor_user_id, actor, payload, depth, cause_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.type,
      input.entityType,
      input.entityId ?? null,
      input.caseId ?? null,
      input.actor?.userId ?? null,
      input.actor?.type ?? 'system',
      JSON.stringify(input.payload ?? {}),
      input.depth ?? 0,
      input.causeEventId ?? null
    );
  return Number(info.lastInsertRowid);
}

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 解析动作参数里的 {{event.payload.x}} / {{case.x}} 占位符 */
export function resolveParams(params: any, ctx: any): any {
  const walk = (v: any): any => {
    if (typeof v === 'string') {
      const whole = v.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
      if (whole) return getPath(ctx, whole[1].trim());
      return v.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_s, p) => {
        const r = getPath(ctx, String(p).trim());
        return r == null ? '' : String(r);
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: any = {};
      for (const k of Object.keys(v)) o[k] = walk(v[k]);
      return o;
    }
    return v;
  };
  return walk(params);
}

/**
 * 受限条件匹配：只读事件 payload，不做 eval、不查库。
 * 支持：字面等值、数组 = in、{op: eq/ne/in/gte/lte/exists/not_exists}
 */
export function matchCondition(cond: any, payload: any): boolean {
  if (!cond || typeof cond !== 'object' || Object.keys(cond).length === 0) return true;
  for (const key of Object.keys(cond)) {
    const expect = cond[key];
    const actual = getPath(payload, key);

    if (Array.isArray(expect)) {
      if (!expect.includes(actual)) return false;
      continue;
    }
    if (expect && typeof expect === 'object' && 'op' in expect) {
      const op = (expect as any).op;
      const v = (expect as any).value;
      switch (op) {
        case 'eq':
          if (actual !== v) return false;
          break;
        case 'ne':
          if (actual === v) return false;
          break;
        case 'in':
          if (!Array.isArray(v) || !v.includes(actual)) return false;
          break;
        case 'gte':
          if (!(actual >= v)) return false;
          break;
        case 'lte':
          if (!(actual <= v)) return false;
          break;
        case 'exists':
          if (actual === undefined || actual === null) return false;
          break;
        case 'not_exists':
          if (actual !== undefined && actual !== null) return false;
          break;
        default:
          return false;
      }
      continue;
    }
    if (actual !== expect) return false;
  }
  return true;
}

function recordRun(opts: {
  ruleKey: string;
  eventId: number;
  eventType: string;
  caseId: number | null;
  idemKey: string;
  outcome: 'applied' | 'skipped' | 'error';
  detail?: string;
}) {
  try {
    getDb()
      .prepare(
        `INSERT OR IGNORE INTO automation_run (rule_key, event_id, event_type, case_id, idem_key, outcome, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(opts.ruleKey, opts.eventId, opts.eventType, opts.caseId, opts.idemKey, opts.outcome, opts.detail || null);
  } catch {
    /* 台账写入失败不影响主流程 */
  }
}

/**
 * 派发待处理事件。同步执行（better-sqlite3 全同步），返回处理计数。
 * 单条事件失败不影响后续事件；失败原因写进 biz_event.error 与 automation_run。
 */
export function drain(): { processed: number; errors: number } {
  // 延迟 require：避免 bus ↔ engine ↔ actions 的循环依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { runRule } = require('./engine');

  const db = getDb();
  let processed = 0;
  let errors = 0;

  for (let i = 0; i < MAX_EVENTS_PER_DRAIN; i++) {
    const ev = db
      .prepare(`SELECT * FROM biz_event WHERE status='pending' ORDER BY id LIMIT 1`)
      .get() as any;
    if (!ev) break;

    if (ev.depth > MAX_DEPTH) {
      db.prepare(`UPDATE biz_event SET status='failed', error=?, processed_at=datetime('now') WHERE id=?`)
        .run('max cascade depth exceeded', ev.id);
      errors++;
      continue;
    }

    const payload = safeParse(ev.payload);
    // event.payload 要是已解析的对象，规则里的 {{event.payload.x}} 才解析得到值（DB 里存的是 JSON 字符串）
    const ctx = { event: { ...ev, payload }, payload, case: null, eventId: ev.id };

    const rules = db
      .prepare(`SELECT * FROM automation_rule WHERE enabled=1 AND event_type=? ORDER BY priority, id`)
      .all(ev.event_type) as any[];

    for (const rule of rules) {
      const idemKey = `event:${ev.id}`;
      // 同一事件 + 同一规则只执行一次（重放/重复投递防护）
      const dup = db
        .prepare(`SELECT id FROM automation_run WHERE idem_key=? AND rule_key=?`)
        .get(idemKey, rule.rule_key);
      if (dup) continue;

      const cond = safeParse(rule.condition_json);
      if (!matchCondition(cond, payload)) {
        recordRun({
          ruleKey: rule.rule_key,
          eventId: ev.id,
          eventType: ev.event_type,
          caseId: ev.case_id ?? null,
          idemKey,
          outcome: 'skipped',
          detail: 'condition not matched',
        });
        continue;
      }

      try {
        const actions = safeParse(rule.actions_json);
        const detail = runRule(rule, ctx, actions);
        recordRun({
          ruleKey: rule.rule_key,
          eventId: ev.id,
          eventType: ev.event_type,
          caseId: ev.case_id ?? null,
          idemKey,
          outcome: 'applied',
          detail,
        });
      } catch (e: any) {
        const msg = String(e?.message || e);
        recordRun({
          ruleKey: rule.rule_key,
          eventId: ev.id,
          eventType: ev.event_type,
          caseId: ev.case_id ?? null,
          idemKey,
          outcome: 'error',
          detail: msg,
        });
        db.prepare(`UPDATE biz_event SET error=? WHERE id=?`).run(msg, ev.id);
        errors++;
        // eslint-disable-next-line no-console
        console.error(`[automation] rule ${rule.rule_key} failed on ${ev.event_type}: ${msg}`);
      }
    }

    db.prepare(`UPDATE biz_event SET status='processed', processed_at=datetime('now') WHERE id=?`).run(ev.id);
    processed++;
  }

  return { processed, errors };
}

/** 发一条事件并立刻派发（路由层唯一入口） */
export function emitAndDrain(input: EventInput): { eventId: number; processed: number; errors: number } {
  const eventId = emit(input);
  const r = drain();
  return { eventId, ...r };
}
