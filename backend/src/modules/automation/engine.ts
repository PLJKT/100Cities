import { getDb } from '../../config/db';
import { resolveParams } from './bus';
import { ACTIONS } from './actions';

/**
 * 规则执行引擎：解析占位符 → 调用动作执行器。
 * 只认 ACTIONS 里注册过的动作类型，规则文件无法触达任意 SQL。
 */
export function runRule(rule: any, ctx: any, actions: any[]): string {
  const db = getDb();
  const notes: string[] = [];

  for (const a of Array.isArray(actions) ? actions : []) {
    const handler = ACTIONS[a?.type];
    if (!handler) {
      notes.push(`unknown action '${a?.type}'`);
      continue;
    }

    // 每个动作执行前重读案件，保证上一个动作写入的 project_id / asset_id 立刻可见
    const caseId = ctx.case?.id ?? ctx.event?.case_id ?? null;
    ctx.case = caseId ? (db.prepare(`SELECT * FROM biz_case WHERE id=?`).get(caseId) as any) : null;

    const params = resolveParams(a.params || {}, {
      event: ctx.event,
      payload: ctx.payload,
      case: ctx.case,
    });

    try {
      // 注意：把同一个 ctx 传进去（不是副本），ensure_case 新建的案件要能被后续动作看到
      const note = handler(params, ctx);
      if (note) notes.push(`${a.type}: ${note}`);
      if (ctx.case?.id) {
        ctx.case = db.prepare(`SELECT * FROM biz_case WHERE id=?`).get(ctx.case.id) as any;
      }
    } catch (e: any) {
      notes.push(`${a.type}: ERROR ${e?.message || e}`);
      throw new Error(`action ${a.type} failed: ${e?.message || e}`);
    }
  }

  return notes.join(' | ');
}
