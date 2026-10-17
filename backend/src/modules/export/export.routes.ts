import { Router } from 'express';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { getDb } from '../../config/db';

const r = Router();

/** 导出跟随前端语种：?lang=en|id|zh —— 此处返回结构化清单，生产可接 exceljs/pdfkit 渲染 */
r.get('/excel', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = (req.query.lang as string) || req.headers['x-lang'] || 'en';
  const rows = getDb().prepare(`SELECT * FROM form_submit ORDER BY id DESC`).all();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({ lang, kind: 'excel', rows, note: 'Wire to exceljs in production.' });
});

r.get('/pdf', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = (req.query.lang as string) || 'en';
  res.json({ lang, kind: 'pdf', note: 'Wire to pdfkit in production.' });
});

r.get('/zip', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = (req.query.lang as string) || 'en';
  res.json({
    lang,
    kind: 'zip-manifest',
    note: 'Per security rule, attachments are never stored on the server. This export returns a text manifest pointing to the work mailbox.',
  });
});

r.get('/agreement', authRequired, requirePerm('review'), (req: AuthedRequest, res) => {
  const lang = (req.query.lang as string) || 'en';
  res.json({ lang, kind: 'agreement-draft', note: 'Pre-filled agreement document.' });
});

export default r;
