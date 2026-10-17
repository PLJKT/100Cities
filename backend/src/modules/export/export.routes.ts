import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';

const r = Router();

/** 资产+资质汇总 Excel（跟随 lang） */
r.get('/excel', authRequired, requirePerm('review'), async (req: AuthedRequest, res) => {
  const lang = ((req.query.lang as string) || (req.headers['x-lang'] as string) || 'en') as string;
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.doc_no, s.status, s.submit_time, u.username, u.partner_name
       FROM form_submit s JOIN sys_user u ON u.id=s.user_id ORDER BY s.id DESC`
    )
    .all() as any[];

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Phase1');
  ws.columns = [
    { header: 'Doc No.', key: 'doc_no', width: 24 },
    { header: 'Partner', key: 'partner_name', width: 28 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Submitted At', key: 'submit_time', width: 22 },
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach((row) => ws.addRow(row));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="phase1-export-${lang}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/** 表单归档 PDF（跟随 lang） */
r.get('/pdf', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = ((req.query.lang as string) || 'en') as string;
  const rows = getDb()
    .prepare(`SELECT s.doc_no, s.status, s.submit_time, u.partner_name FROM form_submit s JOIN sys_user u ON u.id=s.user_id ORDER BY s.id DESC`)
    .all() as any[];

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="phase1-archive-${lang}.pdf"`);

  const doc = new PDFDocument({ margin: 50 });
  doc.pipe(res);
  doc.fontSize(18).text('100Cities — Phase1 Submission Archive', { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Language: ${lang}    Generated: ${new Date().toISOString()}`);
  doc.moveDown();
  for (const row of rows) {
    doc.fontSize(11).text(`${row.doc_no}  |  ${row.partner_name}  |  ${row.status}  |  ${row.submit_time}`);
    doc.moveDown(0.5);
  }
  doc.end();
});

/** ZIP 清单：按合规约定附件不存服务器，仅返回文字清单 */
r.get('/zip', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = ((req.query.lang as string) || 'en') as string;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    lang,
    note: 'Per security rule, attachments are never stored on the server. They were packaged in-memory and forwarded to the work mailbox at submission time.',
    mail_to: process.env.MAIL_TO || 'work mailbox on file',
  });
});

/** 预填充协议附件（占位：返回 JSON 结构，生产可接 docx 模板） */
r.get('/agreement', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = ((req.query.lang as string) || 'en') as string;
  res.json({
    lang,
    template: 'phase1-agreement',
    note: 'Pre-filled agreement draft generated from partner data. Wire to docx-templater in production.',
  });
});

export default r;
