import nodemailer from 'nodemailer';
import archiver from 'archiver';
import { env } from '../../config/env';
import { tplSubmit, tplReject, tplRemind, Lang } from './templates';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface Attachment {
  filename: string;
  content: Buffer;
}

/**
 * 用 archiver 在内存中把多个附件打包成一个 ZIP Buffer。
 * 关键：全程不写磁盘，resolve 后 Buffer 由 GC 回收。
 */
function zipInMemory(files: Attachment[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('data', (c) => chunks.push(c));
    archive.on('error', reject);
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.content, { name: f.filename });
    archive.finalize();
  });
}

/** 提交通知：表单文本（HTML）+ 内存 ZIP 附件包 → 指定工作邮箱 */
export async function sendSubmitNotification(opts: {
  lang: Lang;
  docNo: string;
  partnerName: string;
  submittedAt: string;
  formText: Record<string, any>;
  attachments: Attachment[];
  to?: string;
}) {
  const html = tplSubmit({
    lang: opts.lang,
    docNo: opts.docNo,
    partnerName: opts.partnerName,
    submittedAt: opts.submittedAt,
    fields: opts.formText,
    attachmentNames: opts.attachments.map((a) => a.filename),
  });

  if (!env.SMTP_HOST) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:submit] SMTP not configured. doc=${opts.docNo} files=${opts.attachments.length} -> would send to ${opts.to || env.MAIL_TO}`);
    return;
  }

  const zipBuf = opts.attachments.length ? await zipInMemory(opts.attachments) : null;

  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: opts.to || env.MAIL_TO,
    subject: html.subject,
    html: html.html,
    attachments: zipBuf
      ? [{ filename: `attachments-${opts.docNo}.zip`, content: zipBuf }]
      : [],
  });
}

/** 退回通知：发给合作方邮箱（由调用方传入） */
export async function sendRejectNotification(opts: {
  lang: Lang;
  to: string;
  docNo: string;
  remark: string;
}) {
  const html = tplReject({ lang: opts.lang, docNo: opts.docNo, remark: opts.remark });
  if (!env.SMTP_HOST) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:reject] SMTP not configured. to=${opts.to} doc=${opts.docNo}`);
    return;
  }
  await getTransporter().sendMail({ from: env.MAIL_FROM, to: opts.to, subject: html.subject, html: html.html });
}

/** 催报通知 */
export async function sendReminderEmail(opts: {
  lang: Lang;
  to: string;
  docNo: string;
}) {
  const html = tplRemind({ lang: opts.lang, docNo: opts.docNo });
  if (!env.SMTP_HOST) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:remind] SMTP not configured. to=${opts.to} doc=${opts.docNo}`);
    return;
  }
  await getTransporter().sendMail({ from: env.MAIL_FROM, to: opts.to, subject: html.subject, html: html.html });
}

/** WhatsApp Business 提醒（生产替换为实际 Business API） */
export async function sendWhatsAppNotification(opts: { to?: string; text: string }) {
  if (!env.WA_API_URL) {
    // eslint-disable-next-line no-console
    console.log(`[notify:whatsapp] WA not configured. text=${opts.text}`);
    return;
  }
  // 生产：fetch(env.WA_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.WA_TOKEN}` }, body: ... })
}
