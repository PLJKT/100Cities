import multer from 'multer';
import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { writeLog } from '../log/log.service';
import { sendSubmitNotification, sendWhatsAppNotification } from '../notify/notify.service';

const r = Router();

/**
 * 文件内存流转（核心合规点）：
 * - multer memoryStorage：文件 Buffer 常驻内存，不写磁盘
 * - 提交成功后立即把 Buffer 作为邮件附件发到 MAIL_TO
 * - sendMail 完成后，无引用 Buffer 由 GC 回收，服务器零文件残留
 * - 文件不入 DB，form_submit_data 只存表单文本字段
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 }, // 单文件 25MB / 最多 20 个
});

/** 合作方拉取当前表单配置 */
r.get('/:templateKey', authRequired, (req: AuthedRequest, res) => {
  const row = getDb()
    .prepare(`SELECT * FROM form_template WHERE template_key=?`)
    .get(req.params.templateKey) as any;
  if (!row) return res.status(404).json({ error: { message: 'template not found' } });
  res.json({ ...row, section_config: JSON.parse(row.section_config) });
});

/** 保存草稿：仅文本入 DB（不创建 form_submit 主记录，避免产生只读锁） */
r.post('/draft', authRequired, (req: AuthedRequest, res) => {
  // 草稿不落库（按业务约束：草稿不存档）；这里仅回显。
  res.json({ ok: true, saved: false, note: 'Drafts are not persisted per business rule.' });
});

/** 正式提交：multipart 接收文本 + 附件 → 内存打包 → 邮件+WA → 写 DB 并锁只读 */
r.post('/submit', authRequired, upload.any(), async (req: AuthedRequest, res) => {
  const db = getDb();
  const user = req.user!;
  const data: Record<string, any> = JSON.parse((req.body as any).data || '{}');
  const files = (req.files as Express.Multer.File[]) || [];

  const docNo = `P1-${Date.now().toString(36).toUpperCase()}-${user.uid}`;

  // 1) 主记录
  const mainInfo = db
    .prepare(
      `INSERT INTO form_submit (doc_no, user_id, template_id, version, status, submit_time, submit_ip, locked)
       VALUES (?, ?, 1, 1, 'pending', datetime('now'), ?, 1)`
    )
    .run(docNo, user.uid, req.ip || '');
  const submitId = mainInfo.lastInsertRowid as number;

  // 2) 文本明细
  const insertField = db.prepare(`INSERT INTO form_submit_data (submit_id, field_key, field_value) VALUES (?, ?, ?)`);
  for (const [k, v] of Object.entries(data)) insertField.run(submitId, k, typeof v === 'string' ? v : JSON.stringify(v));

  // 3) 操作日志
  writeLog(user.uid, 'form.submit', 'form_submit', submitId, { docNo, fields: Object.keys(data), files: files.map(f => f.originalname) });

  // 4) 内存附件 → 邮件 → WA（异步，不阻断响应）
  const attachments = files.map((f) => ({ filename: f.originalname, content: f.buffer }));
  sendSubmitNotification({
    docNo,
    partnerName: user.username,
    formText: data,
    attachments,
  }).catch((e) => console.error('[notify:email] failed', e));
  sendWhatsAppNotification({ text: `New submission ${docNo} from ${user.username}` }).catch((e) => console.error('[notify:wa] failed', e));

  res.json({ ok: true, doc_no: docNo, submit_id: submitId, locked: true });
});

/** 我的提交（数据隔离：仅本人） */
r.get('/my/submits', authRequired, (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(`SELECT id, doc_no, status, submit_time, locked FROM form_submit WHERE user_id=? ORDER BY id DESC`)
    .all(req.user!.uid);
  res.json(rows);
});

export default r;
