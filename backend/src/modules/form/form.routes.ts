import multer from 'multer';
import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { writeLog } from '../log/log.service';
import { sendSubmitNotification, sendWhatsAppNotification } from '../notify/notify.service';
import type { Lang } from '../notify/templates';

const r = Router();

/**
 * 文件内存流转（核心合规点）：
 * - multer memoryStorage：文件 Buffer 常驻内存，不写磁盘
 * - 提交成功后立即把 Buffer 打包为 ZIP（内存）→ SMTP 发到 MAIL_TO
 * - sendMail 完成后，无引用 Buffer / ZIP 由 GC 回收，服务器零文件残留
 * - 文件不入 DB，form_submit_data 只存表单文本字段
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

function pickLang(req: AuthedRequest): Lang {
  const h = (req.headers['x-lang'] as string) || 'en';
  return (h === 'id' || h === 'zh' ? h : 'en') as Lang;
}

r.get('/:templateKey', authRequired, (req: AuthedRequest, res) => {
  const row = getDb()
    .prepare(`SELECT * FROM form_template WHERE template_key=?`)
    .get(req.params.templateKey) as any;
  if (!row) return res.status(404).json({ error: { message: 'template not found' } });
  const fields = getDb()
    .prepare(`SELECT * FROM form_field WHERE template_id=? AND enabled=1 ORDER BY sort, id`)
    .all(row.id)
    .map((f: any) => ({ ...f, options: f.options ? JSON.parse(f.options) : null }));
  res.json({ ...row, section_config: JSON.parse(row.section_config || '{}'), fields });
});

/** 草稿不存档（业务约束），仅回显 */
r.post('/draft', authRequired, (_req: AuthedRequest, res) => {
  res.json({ ok: true, saved: false, note: 'Drafts are not persisted per business rule.' });
});

/** 正式提交 */
r.post('/submit', authRequired, upload.any(), async (req: AuthedRequest, res) => {
  const db = getDb();
  const user = req.user!;
  let data: Record<string, any> = {};
  try {
    data = JSON.parse((req.body as any).data || '{}');
  } catch (e: any) {
    return res.status(400).json({ error: { code: 'BAD_JSON', message: '`data` field must be valid JSON' } });
  }
  const files = (req.files as Express.Multer.File[]) || [];
  const lang = pickLang(req);

  const docNo = `P1-${Date.now().toString(36).toUpperCase()}-${user.uid}`;

  // 1) 主记录（locked=1，后续触发器保护原始字段）
  const mainInfo = db
    .prepare(
      `INSERT INTO form_submit (doc_no, user_id, template_id, version, status, submit_time, submit_ip, locked)
       VALUES (?, ?, 1, 1, 'pending', datetime('now'), ?, 1)`
    )
    .run(docNo, user.uid, req.ip || '');
  const submitId = mainInfo.lastInsertRowid as number;

  // 2) 文本明细
  const insertField = db.prepare(`INSERT INTO form_submit_data (submit_id, field_key, field_value) VALUES (?, ?, ?)`);
  for (const [k, v] of Object.entries(data)) {
    insertField.run(submitId, k, typeof v === 'string' ? v : JSON.stringify(v));
  }

  // 3) 操作日志
  writeLog(user.uid, 'form.submit', 'form_submit', submitId, {
    docNo,
    fields: Object.keys(data),
    files: files.map((f) => f.originalname),
  });

  // 4) 异步发邮件 + WA（不阻断响应；Buffer 打包 ZIP 后 GC 回收）
  const attachments = files.map((f) => ({ filename: f.originalname, content: f.buffer }));
  const submittedAt = new Date().toISOString();
  sendSubmitNotification({
    lang,
    docNo,
    partnerName: user.username,
    submittedAt,
    formText: data,
    attachments,
  }).catch((e) => console.error('[notify:submit] failed', e));
  sendWhatsAppNotification({ text: `New submission ${docNo} from ${user.username}` }).catch(() => {});

  res.json({ ok: true, doc_no: docNo, submit_id: submitId, locked: true });
});

r.get('/my/submits', authRequired, (req: AuthedRequest, res) => {
  const rows = getDb()
    .prepare(`SELECT id, doc_no, status, submit_time, locked FROM form_submit WHERE user_id=? ORDER BY id DESC`)
    .all(req.user!.uid);
  res.json(rows);
});

export default r;
