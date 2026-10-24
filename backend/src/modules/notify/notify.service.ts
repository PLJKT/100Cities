import nodemailer from 'nodemailer';
import archiver from 'archiver';
import { getDb } from '../../config/db';
import { env } from '../../config/env';
import { tplSubmit, tplReject, tplRemind, Lang } from './templates';

/**
 * SMTP 配置来源：email_settings 表（后台可改）优先，未配置时回退 .env。
 * 该表 id 恒为 1，Admin 通过 /api/admin/settings/email 维护。
 */
/**
 * 占位符识别：模板安装时的示例值（yourmail.com / example / your_email 等）
 * 不应被当作"已配置"，否则会触发真实发送而失败。
 */
function isPlaceholder(v?: string | null): boolean {
  if (!v) return true;
  const s = v.toLowerCase();
  return (
    s.includes('example') ||
    s.includes('yourmail') ||
    s.includes('your_email') ||
    s.includes('your_password') ||
    s.includes('your_token') ||
    s.includes('change_me') ||
    s === 'your_email' ||
    s === 'your_password'
  );
}

export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromAddr: string;
  toAddr: string;
}

export function getEmailSettings(): EmailSettings {
  let row: any = null;
  try {
    row = getDb().prepare(`SELECT * FROM email_settings WHERE id=1`).get() as any;
  } catch {
    /* DB 未初始化（如启动早期）时直接走 env */
  }
  if (row && row.host && !isPlaceholder(row.host)) {
    return {
      host: row.host,
      port: Number(row.port || 587),
      secure: Number(row.secure || 0) === 1,
      user: row.user || '',
      pass: row.pass || '',
      fromName: row.from_name || '100 Cities Club',
      fromAddr: row.from_addr || env.MAIL_FROM,
      toAddr: row.to_addr || env.MAIL_TO,
    };
  }
  return {
    host: isPlaceholder(env.SMTP_HOST) ? '' : env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: isPlaceholder(env.SMTP_USER) ? '' : env.SMTP_USER,
    pass: isPlaceholder(env.SMTP_PASS) ? '' : env.SMTP_PASS,
    fromName: '100 Cities Club',
    fromAddr: env.MAIL_FROM,
    toAddr: env.MAIL_TO,
  };
}

export interface Attachment {
  filename: string;
  content: Buffer;
}

/** 记录通知（成功/失败均可留痕，供重试与审计） */
function recordNotification(opts: {
  channel: 'email' | 'whatsapp';
  to: string;
  subject?: string;
  bodySummary?: string;
  refType?: string;
  refId?: number;
  status: 'sent' | 'failed';
  error?: string;
}) {
  try {
    getDb()
      .prepare(
        `INSERT INTO notification (channel, to_addr, subject, body_summary, ref_type, ref_id, status, error, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      )
      .run(opts.channel, opts.to, opts.subject || null, opts.bodySummary || null, opts.refType || null, opts.refId || null, opts.status, opts.error || null);
  } catch {
    /* 记录失败不影响主流程 */
  }
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

function buildTransporter(s: EmailSettings) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
  });
}

/** 提交通知：表单文本（HTML）+ 内存 ZIP 附件包 → 工作邮箱 */
export async function sendSubmitNotification(opts: {
  lang: Lang;
  docNo: string;
  partnerName: string;
  submittedAt: string;
  formText: Record<string, any>;
  attachments: Attachment[];
  to?: string;
  refId?: number;
}) {
  const html = tplSubmit({
    lang: opts.lang,
    docNo: opts.docNo,
    partnerName: opts.partnerName,
    submittedAt: opts.submittedAt,
    fields: opts.formText,
    attachmentNames: opts.attachments.map((a) => a.filename),
  });
  const s = getEmailSettings();

  if (!s.host) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:submit] SMTP not configured. doc=${opts.docNo} files=${opts.attachments.length} -> would send to ${opts.to || s.toAddr}`);
    recordNotification({ channel: 'email', to: opts.to || s.toAddr, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
    return;
  }

  const zipBuf = opts.attachments.length ? await zipInMemory(opts.attachments) : null;
  try {
    await buildTransporter(s).sendMail({
      from: `"${s.fromName}" <${s.fromAddr}>`,
      to: opts.to || s.toAddr,
      subject: html.subject,
      html: html.html,
      attachments: zipBuf ? [{ filename: `attachments-${opts.docNo}.zip`, content: zipBuf }] : [],
    });
    recordNotification({ channel: 'email', to: opts.to || s.toAddr, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
  } catch (e: any) {
    recordNotification({ channel: 'email', to: opts.to || s.toAddr, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'failed', error: String(e?.message || e) });
    throw e;
  }
}

/** 退回通知：发给合作方邮箱（由调用方传入） */
export async function sendRejectNotification(opts: {
  lang: Lang;
  to: string;
  docNo: string;
  remark: string;
  refId?: number;
}) {
  const html = tplReject({ lang: opts.lang, docNo: opts.docNo, remark: opts.remark });
  const s = getEmailSettings();
  if (!s.host) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:reject] SMTP not configured. to=${opts.to} doc=${opts.docNo}`);
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
    return;
  }
  try {
    await buildTransporter(s).sendMail({ from: `"${s.fromName}" <${s.fromAddr}>`, to: opts.to, subject: html.subject, html: html.html });
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
  } catch (e: any) {
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'failed', error: String(e?.message || e) });
    throw e;
  }
}

/** 催报通知 */
export async function sendReminderEmail(opts: {
  lang: Lang;
  to: string;
  docNo: string;
  refId?: number;
}) {
  const html = tplRemind({ lang: opts.lang, docNo: opts.docNo });
  const s = getEmailSettings();
  if (!s.host) {
    // eslint-disable-next-line no-console
    console.log(`[notify:email:remind] SMTP not configured. to=${opts.to} doc=${opts.docNo}`);
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
    return;
  }
  try {
    await buildTransporter(s).sendMail({ from: `"${s.fromName}" <${s.fromAddr}>`, to: opts.to, subject: html.subject, html: html.html });
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'sent' });
  } catch (e: any) {
    recordNotification({ channel: 'email', to: opts.to, subject: html.subject, refType: 'form_submit', refId: opts.refId, status: 'failed', error: String(e?.message || e) });
    throw e;
  }
}

/**
 * WhatsApp 适配器（可插拔）：
 * 当前阶段 = mock + 日志（默认接收人 env.WA_TO = +6281513198596 私人测试号）。
 * 生产接入官方 WhatsApp Business Cloud API 时，替换 send() 实现即可，
 * 调用方接口签名不变。
 */
export interface WhatsAppPayload {
  to?: string;
  text: string;
  refType?: string;
  refId?: number;
}

export async function sendWhatsAppNotification(payload: WhatsAppPayload) {
  const to = payload.to || env.WA_TO || '+6281513198596';
  if (!env.WA_API_URL || isPlaceholder(env.WA_API_URL)) {
    // eslint-disable-next-line no-console
    console.log(`[notify:whatsapp][mock] to=${to} text="${payload.text}"`);
    recordNotification({ channel: 'whatsapp', to, bodySummary: payload.text, refType: payload.refType, refId: payload.refId, status: 'sent' });
    return { mock: true, to };
  }
  // 生产实现示例（官方 Business Cloud API）：
  // await fetch(`${env.WA_API_URL}/messages`, {
  //   method: 'POST',
  //   headers: { Authorization: `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: payload.text } }),
  // });
  try {
    const resp = await fetch(env.WA_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.WA_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text: payload.text }),
    });
    const ok = resp.ok;
    recordNotification({ channel: 'whatsapp', to, bodySummary: payload.text, refType: payload.refType, refId: payload.refId, status: ok ? 'sent' : 'failed', error: ok ? undefined : `HTTP ${resp.status}` });
    return { ok, status: resp.status };
  } catch (e: any) {
    recordNotification({ channel: 'whatsapp', to, bodySummary: payload.text, refType: payload.refType, refId: payload.refId, status: 'failed', error: String(e?.message || e) });
    throw e;
  }
}
