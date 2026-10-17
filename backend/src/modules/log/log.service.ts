import { getDb } from '../config/db';

export function writeLog(userId: number | null, action: string, targetType: string, targetId: number | null, detail: any) {
  getDb()
    .prepare(
      `INSERT INTO sys_operation_log (user_id, action, target_type, target_id, detail)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, action, targetType, targetId, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
