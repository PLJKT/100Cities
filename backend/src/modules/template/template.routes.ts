import { Router } from 'express';
import { getDb } from '../../config/db';
import { authRequired, AuthedRequest } from '../../middlewares/auth';
import { requirePerm } from '../../middlewares/rbac';
import { writeLog } from '../log/log.service';

const r = Router();

/** 列出模板（含字段），供管理端与填报端共用 */
function withFields(tpl: any) {
  const fields = getDb()
    .prepare(`SELECT * FROM form_field WHERE template_id=? ORDER BY sort, id`)
    .all(tpl.id)
    .map((f: any) => ({
      ...f,
      options: f.options ? JSON.parse(f.options) : null,
    }));
  return { ...tpl, section_config: JSON.parse(tpl.section_config || '{}'), fields };
}

r.get('/', authRequired, requirePerm('admin.templates'), (_req, res) => {
  const rows = getDb().prepare(`SELECT * FROM form_template ORDER BY id`).all();
  res.json(rows.map(withFields));
});

/** 填报端取模板（任意登录角色可读，含字段级定义） */
r.get('/:templateKey', authRequired, (req, res) => {
  const row = getDb()
    .prepare(`SELECT * FROM form_template WHERE template_key=?`)
    .get(req.params.templateKey) as any;
  if (!row) return res.status(404).json({ error: { message: 'template not found' } });
  res.json(withFields(row));
});

r.post('/', authRequired, requirePerm('admin.templates'), (req: AuthedRequest, res) => {
  const { template_key, section_config, fields } = req.body || {};
  if (!template_key) return res.status(400).json({ error: { message: 'template_key required' } });
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO form_template (template_key, section_config, version) VALUES (?, ?, 1)`)
    .run(template_key, JSON.stringify(section_config || {}));
  const tplId = info.lastInsertRowid as number;
  if (Array.isArray(fields) && fields.length) saveFields(db, tplId, fields);
  writeLog(req.user!.uid, 'template.create', 'form_template', tplId, { template_key });
  res.json({ id: tplId });
});

/** 更新模板元数据 + 版本号 */
r.put('/:id', authRequired, requirePerm('admin.templates'), (req, res) => {
  const { section_config } = req.body || {};
  getDb()
    .prepare(`UPDATE form_template SET section_config=?, version=version+1, updated_at=datetime('now') WHERE id=?`)
    .run(JSON.stringify(section_config || {}), req.params.id);
  res.json({ ok: true });
});

/**
 * 批量保存字段（替换式）：前端 TemplateEditor 一次提交整份字段数组。
 * 不传 fields 时仅更新 section_config 元数据。
 */
r.put('/:id/fields', authRequired, requirePerm('admin.templates'), (req: AuthedRequest, res) => {
  const db = getDb();
  const tplId = Number(req.params.id);
  const tpl = db.prepare(`SELECT id FROM form_template WHERE id=?`).get(tplId);
  if (!tpl) return res.status(404).json({ error: { message: 'template not found' } });
  const { fields } = req.body || {};
  if (!Array.isArray(fields)) return res.status(400).json({ error: { message: 'fields array required' } });
  saveFields(db, tplId, fields);
  db.prepare(`UPDATE form_template SET version=version+1, updated_at=datetime('now') WHERE id=?`).run(tplId);
  writeLog(req.user!.uid, 'template.fields.save', 'form_template', tplId, { count: fields.length });
  res.json({ ok: true, count: fields.length });
});

/** 删除单个字段 */
r.delete('/:id/fields/:fid', authRequired, requirePerm('admin.templates'), (req: AuthedRequest, res) => {
  const info = getDb()
    .prepare(`DELETE FROM form_field WHERE id=? AND template_id=?`)
    .run(req.params.fid, req.params.id);
  if (!info.changes) return res.status(404).json({ error: { message: 'field not found' } });
  writeLog(req.user!.uid, 'template.field.delete', 'form_field', Number(req.params.fid), {});
  res.json({ ok: true });
});

/** 内部工具：清空并重写字段（单事务） */
function saveFields(db: any, tplId: number, fields: any[]) {
  const del = db.prepare(`DELETE FROM form_field WHERE template_id=?`);
  const ins = db.prepare(
    `INSERT INTO form_field (template_id, field_key, field_type, required, sort, en_label, id_label, zh_label, options, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(tplId);
    fields.forEach((f, i) => {
      ins.run(
        tplId,
        f.field_key,
        f.field_type || 'text',
        f.required ? 1 : 0,
        f.sort ?? i + 1,
        f.en_label || f.field_key,
        f.id_label || null,
        f.zh_label || null,
        f.options ? JSON.stringify(f.options) : null,
        f.enabled === false ? 0 : 1,
      );
    });
  })();
}

export default r;
