import nodemailer from 'nodemailer';
import { env } from '../../config/env';

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
 * 把表单文本 + 内存附件包发送到指定工作邮箱。
 * 关键：附件是 Buffer（内存中），不写入磁盘；sendMail 完成后 GC 自动回收。
 */
export async function sendSubmitNotification(opts: {
  docNo: string;
  partnerName: string;
  formText: Record<string, any>;
  attachments: Attachment[];
  to?: string;
}) {
  if (!env.SMTP_HOST) {
    // 未配置 SMTP 时仅打印日志，不阻断主流程（本地开发）。
    // eslint-disable-next-line no-console
    console.log('[notify:email] SMTP not configured — skipping. docNo=', opts.docNo, 'attachments=', opts.attachments.length);
    return;
  }
  const text = [
    `New Phase1 submission`,
    `Doc No: ${opts.docNo}`,
    `Partner: ${opts.partnerName}`,
    ``,
    '--- Form Data ---',
    ...Object.entries(opts.formText).map(([k, v]) => `${k}: ${v}`),
  ].join('\n');

  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: opts.to || env.MAIL_TO,
    subject: `[100Cities] New Phase1 submission — ${opts.docNo}`,
    text,
    attachments: opts.attachments,
  });
}

/**
 * WhatsApp Business 提醒（占位实现）。
 * 生产环境替换为实际 Business API 调用；此处只打日志。
 */
export async function sendWhatsAppNotification(opts: { to?: string; text: string }) {
  if (!env.WA_API_URL) {
    // eslint-disable-next-line no-console
    console.log('[notify:whatsapp] WA not configured — skipping. text=', opts.text);
    return;
  }
  // 生产：fetch(env.WA_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.WA_TOKEN}` }, body: JSON.stringify(...) })
}
