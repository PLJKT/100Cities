import schedule from 'node-schedule';
import { getDb } from '../config/db';
import { env } from '../config/env';
import { sendWhatsAppNotification } from '../modules/notify/notify.service';
import { writeLog } from '../modules/log/log.service';

/**
 * 定时任务：
 * - 每天 09:00 扫描 pending 单据
 * - 逾期满 REMIND_EVERY_DAYS 天 → 发催报
 * - 满 ABANDON_AFTER_DAYS 天 → 状态置 abandoned，停催
 */
export function startReminderScheduler() {
  schedule.scheduleJob('0 9 * * *', async () => {
    const db = getDb();
    const pending = db
      .prepare(
        `SELECT id, doc_no, user_id FROM form_submit
         WHERE status='pending'
           AND submit_time IS NOT NULL
           AND submit_time < datetime('now', ?)`
      )
      .all(`-${env.REMIND_EVERY_DAYS} day`) as any[];

    for (const row of pending) {
      const ageDays = Math.floor((Date.now() - new Date(row.submit_time).getTime()) / 86400000);
      if (ageDays >= env.ABANDON_AFTER_DAYS) {
        try {
          db.prepare(`UPDATE form_submit SET status='abandoned' WHERE id=?`).run(row.id);
          writeLog(null, 'scheduler.abandon', 'form_submit', row.id, { ageDays });
        } catch (e) {
          console.error('[scheduler:abandon]', e);
        }
      } else {
        sendWhatsAppNotification({ text: `Reminder: please complete submission ${row.doc_no}.` }).catch(() => {});
        writeLog(null, 'scheduler.remind', 'form_submit', row.id, { ageDays });
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[scheduler] daily scan done, ${pending.length} pending items reviewed.`);
  });
}
