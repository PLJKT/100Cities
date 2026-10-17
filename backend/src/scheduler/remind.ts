import schedule from 'node-schedule';
import { getDb } from '../config/db';
import { env } from '../config/env';
import { sendReminderEmail, sendWhatsAppNotification } from '../modules/notify/notify.service';
import { writeLog } from '../modules/log/log.service';

/**
 * 定时任务（每天 09:00）：
 * - 扫 pending 单据
 * - 逾期满 REMIND_EVERY_DAYS 天 → 发催报邮件 + WA
 * - 满 ABANDON_AFTER_DAYS 天 → 状态置 abandoned，停催
 */
export function startReminderScheduler() {
  schedule.scheduleJob('0 9 * * *', async () => {
    const db = getDb();
    const pending = db
      .prepare(
        `SELECT s.id, s.doc_no, s.user_id, s.submit_time, u.email
         FROM form_submit s JOIN sys_user u ON u.id=s.user_id
         WHERE s.status='pending' AND s.submit_time IS NOT NULL`
      )
      .all() as any[];

    for (const row of pending) {
      const ageDays = Math.floor((Date.now() - new Date(row.submit_time).getTime()) / 86400000);
      if (ageDays >= env.ABANDON_AFTER_DAYS) {
        try {
          db.prepare(`UPDATE form_submit SET status='abandoned' WHERE id=?`).run(row.id);
          writeLog(null, 'scheduler.abandon', 'form_submit', row.id, { ageDays });
        } catch (e) {
          console.error('[scheduler:abandon]', e);
        }
      } else if (ageDays >= env.REMIND_EVERY_DAYS) {
        if (row.email) {
          sendReminderEmail({ lang: 'en', to: row.email, docNo: row.doc_no }).catch(() => {});
        }
        sendWhatsAppNotification({ text: `Reminder: please complete submission ${row.doc_no}.` }).catch(() => {});
        writeLog(null, 'scheduler.remind', 'form_submit', row.id, { ageDays });
      }
    }
    console.log(`[scheduler] daily scan done, ${pending.length} pending items reviewed.`);
  });
}
