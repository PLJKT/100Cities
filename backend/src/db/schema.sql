-- 100Cities Phase1 — SQLite schema
-- 关键约束：
--   1) form_submit.locked=1 后触发器禁止 UPDATE/DELETE（仅允许 SELECT）
--   2) sys_operation_log 只增不删（触发器禁止 DELETE/UPDATE）
--   3) 文件不入任何表；附件仅在内存流转

CREATE TABLE IF NOT EXISTS sys_role (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name     TEXT NOT NULL UNIQUE,
  menu_permissions JSON NOT NULL DEFAULT '[]',
  data_scope    TEXT NOT NULL DEFAULT 'self'
);

INSERT OR IGNORE INTO sys_role (id, role_name, menu_permissions, data_scope) VALUES
  (1, 'Super Admin',     '["dashboard","partner.form","partner.my","review","admin.users","admin.roles","admin.templates"]', 'all'),
  (2, 'Partner Filler',  '["partner.form","partner.my"]', 'self'),
  (3, 'Reviewer',        '["dashboard","review"]', 'review'),
  (4, 'BOD Read-only',   '["dashboard"]', 'summary');

CREATE TABLE IF NOT EXISTS sys_menu (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  path      TEXT NOT NULL UNIQUE,
  en_label  TEXT NOT NULL,
  id_label  TEXT NOT NULL,
  zh_label  TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sys_user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES sys_role(id),
  partner_name  TEXT,
  email         TEXT,
  phone         TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_template (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_key  TEXT NOT NULL UNIQUE,
  section_config JSON NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_submit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_no      TEXT NOT NULL UNIQUE,
  user_id     INTEGER NOT NULL REFERENCES sys_user(id),
  template_id INTEGER NOT NULL REFERENCES form_template(id),
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending / approved / rejected / abandoned
  submit_time TEXT,
  submit_ip   TEXT,
  remark      TEXT,
  locked      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS form_submit_data (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  submit_id   INTEGER NOT NULL REFERENCES form_submit(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  field_value TEXT
);

CREATE TABLE IF NOT EXISTS sys_operation_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 只读锁：locked=1 的 form_submit 禁止篡改原始字段，
--            但允许工作流字段（status/remark）随审核事件推进 ----------
CREATE TRIGGER IF NOT EXISTS trg_form_submit_no_update_when_locked
BEFORE UPDATE ON form_submit
FOR EACH ROW
WHEN OLD.locked = 1
 AND (
   NEW.doc_no      IS NOT OLD.doc_no
OR NEW.user_id     IS NOT OLD.user_id
OR NEW.template_id IS NOT OLD.template_id
OR NEW.version     IS NOT OLD.version
OR NEW.submit_time IS NOT OLD.submit_time
OR NEW.submit_ip   IS NOT OLD.submit_ip
OR NEW.locked      IS NOT OLD.locked
 )
BEGIN
  SELECT RAISE(ABORT, 'form_submit original fields are locked read-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_form_submit_no_delete_when_locked
BEFORE DELETE ON form_submit
FOR EACH ROW
WHEN OLD.locked = 1
BEGIN
  SELECT RAISE(ABORT, 'form_submit record is locked read-only');
END;

-- 明细数据 form_submit_data：一旦写入即不可改、不可删
CREATE TRIGGER IF NOT EXISTS trg_submit_data_no_update
BEFORE UPDATE ON form_submit_data
BEGIN
  SELECT RAISE(ABORT, 'form_submit_data is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_submit_data_no_delete
BEFORE DELETE ON form_submit_data
BEGIN
  SELECT RAISE(ABORT, 'form_submit_data is immutable');
END;

-- ---------- 日志只增不删 ----------
CREATE TRIGGER IF NOT EXISTS trg_log_no_update
BEFORE UPDATE ON sys_operation_log
BEGIN
  SELECT RAISE(ABORT, 'sys_operation_log is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_log_no_delete
BEFORE DELETE ON sys_operation_log
BEGIN
  SELECT RAISE(ABORT, 'sys_operation_log is append-only');
END;

-- ---------- 默认 Phase1 模板 ----------
INSERT OR IGNORE INTO form_template (id, template_key, section_config, version)
VALUES (1, 'phase1', '{"sections":[{"title":"Partner Information","fields":["partner_name","entity_nationality"]},{"title":"Assets","fields":["asset_summary","qualifications"]}]}', 1);

-- ============================================================
-- v2 — 企业档案 / 字段级模板 / pipeline / SMTP 配置 / 通知记录
-- ============================================================

-- 企业档案（与 sys_user 一对一；tier 对应 5 类邀请对象）
CREATE TABLE IF NOT EXISTS partner_profile (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES sys_user(id),
  company_name  TEXT NOT NULL,
  nationality   TEXT NOT NULL DEFAULT 'ID',   -- ID / SG / CN / MY / JP / ...
  industry      TEXT,
  tier          TEXT NOT NULL DEFAULT 'explorer',  -- explorer/manufacturer/tech/existing/investor
  status        TEXT NOT NULL DEFAULT 'invited',   -- invited/active/paused
  contact_email TEXT,
  contact_phone TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 字段级动态模板：一个模板多个字段，字段三语标签 + 选项 + 排序
CREATE TABLE IF NOT EXISTS form_field (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES form_template(id) ON DELETE CASCADE,
  field_key   TEXT NOT NULL,
  field_type  TEXT NOT NULL DEFAULT 'text',  -- text/textarea/number/select/multiselect/file
  required    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  en_label    TEXT NOT NULL,
  id_label    TEXT,
  zh_label    TEXT,
  options     JSON,
  enabled     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(template_id, field_key)
);

-- 项目管道：五步流转（intake→matching→site_visit→proposal→decision）
-- v3：同时支持关联 partner_profile 或 lead（渠道录入的潜在客户审核流）
CREATE TABLE IF NOT EXISTS pipeline (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id  INTEGER REFERENCES partner_profile(id),
  lead_id     INTEGER REFERENCES lead(id),
  submit_id   INTEGER REFERENCES form_submit(id),
  stage       TEXT NOT NULL DEFAULT 'intake',
  stage_note  TEXT,
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pipeline_event (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
  from_stage  TEXT,
  to_stage    TEXT NOT NULL,
  note        TEXT,
  user_id     INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- SMTP 配置：DB 优先、env 兜底；后台可改（id 恒为 1）
CREATE TABLE IF NOT EXISTS email_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  host       TEXT,
  port       INTEGER DEFAULT 587,
  secure     INTEGER DEFAULT 0,
  user       TEXT,
  pass       TEXT,
  from_name  TEXT DEFAULT '100 Cities Club',
  from_addr  TEXT,
  to_addr    TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 通知发送记录（邮件 / WhatsApp）
CREATE TABLE IF NOT EXISTS notification (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT NOT NULL,                -- email / whatsapp
  to_addr      TEXT NOT NULL,
  subject      TEXT,
  body_summary TEXT,
  ref_type     TEXT,
  ref_id       INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending/sent/failed
  retries      INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT
);

-- ---------- 默认 Phase1 字段种子（与旧 section_config 兼容，新 UI 走 form_field） ----------
INSERT OR IGNORE INTO form_field (id, template_id, field_key, field_type, required, sort, en_label, id_label, zh_label, options) VALUES
  (1, 1, 'partner_name',       'text',     1, 1, 'Partner / Company Name', 'Nama Mitra / Perusahaan', '合作方 / 公司名称', NULL),
  (2, 1, 'entity_nationality', 'text',     1, 2, 'Entity Nationality (ID / SG / CN)', 'Kebangsaan Entitas (ID / SG / CN)', '主体国籍（ID / SG / CN）', NULL),
  (3, 1, 'asset_summary',      'textarea', 1, 3, 'Asset Summary', 'Ringkasan Aset', '资产摘要', NULL),
  (4, 1, 'qualifications',     'textarea', 0, 4, 'Qualifications', 'Kualifikasi', '资质与优势', NULL),
  (5, 1, 'cooperation_intent', 'select',   1, 5, 'Cooperation Intent', 'Niat Kerja Sama', '合作意向',
    '[{"value":"market_entry","en":"Market entry","id":"Masuk pasar","zh":"市场进入"},{"value":"capacity","en":"Capacity relocation","id":"Relokasi kapasitas","zh":"产能转移"},{"value":"tech","en":"Technology partnership","id":"Kemitraan teknologi","zh":"技术合作"},{"value":"invest","en":"Investment","id":"Investasi","zh":"投资"},{"value":"tenancy","en":"Industrial tenancy","id":"Sewa kawasan","zh":"园区入驻"}]'),
  (6, 1, 'target_segment',     'multiselect', 0, 6, 'Target Segment', 'Segmen Sasaran', '目标板块',
    '[{"value":"industrial","en":"Industrial","id":"Industri","zh":"工业"},{"value":"residential","en":"Residential","id":"Perumahan","zh":"住宅"},{"value":"commercial","en":"Commercial","id":"Komersial","zh":"商业"},{"value":"infra","en":"Infrastructure","id":"Infrastruktur","zh":"基础设施"},{"value":"power","en":"Power","id":"Ketenagalistrikan","zh":"电力"},{"value":"water","en":"Water & Estate","id":"Air & Kawasan","zh":"水务与园区"},{"value":"dryport","en":"Dry Port","id":"Dry Port","zh":"内陆港"}]'),
  (7, 1, 'attachments',        'file',     0, 7, 'Attachments', 'Lampiran', '附件', NULL);

-- ============================================================
-- v3 — 资产（JB 可合作资产）/ 潜在客户（渠道录入）/ 项目（会员合作进度）
-- ============================================================

-- 资产：Jababeka 可合作资产清单与说明（前端资产页面展示）
CREATE TABLE IF NOT EXISTS asset (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'industrial',  -- industrial/residential/commercial/power/water/dryport/sez/infra/education
  location    TEXT,
  size_desc   TEXT,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'available',   -- available/reserved/leased/planning
  sort        INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 潜在客户：渠道合作方录入（行业/规模/诉求），进入审核流
CREATE TABLE IF NOT EXISTS lead (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_user_id  INTEGER NOT NULL REFERENCES sys_user(id),
  company_name     TEXT NOT NULL,
  industry         TEXT,
  company_size     TEXT DEFAULT 'SME',  -- SME / Mid / Large / Enterprise
  need_description TEXT,                -- 诉求
  contact_name     TEXT,
  contact_phone    TEXT,
  contact_email    TEXT,
  source_channel   TEXT DEFAULT 'direct',
  status           TEXT NOT NULL DEFAULT 'new',  -- new/under_review/approved/rejected/converted
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 项目：会员合作项目信息与进度说明
CREATE TABLE IF NOT EXISTS project (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER REFERENCES lead(id),
  member_id     INTEGER REFERENCES partner_profile(id),
  name          TEXT NOT NULL,
  description   TEXT,
  stage         TEXT NOT NULL DEFAULT 'intake',  -- 复用五步 intake/matching/site_visit/proposal/decision
  progress_note TEXT,
  status        TEXT NOT NULL DEFAULT 'active',  -- active/paused/completed
  started_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 默认资产种子（8 大业务板块，与落地页矩阵一致） ----------
INSERT OR IGNORE INTO asset (id, name, category, location, size_desc, description, status, sort) VALUES
  (1, 'Cikarang Jababeka City – Industrial Plots', 'industrial', 'Cikarang, West Java', '~2,000 ha developed',
   'Indonesia''s pioneer township & industrial estate since 1989. Ready-to-build factory plots, road grid, power, water and dry port inside the estate.', 'available', 1),
  (2, 'Kendal Industrial Park', 'industrial', 'Kendal, Central Java', '~2,200 ha SEZ',
   'Jointly opened Nov 2016 by the President of Indonesia and the Prime Minister of Singapore. Ideal for export-oriented manufacturers.', 'available', 2),
  (3, 'Tanjung Lesung SEZ', 'sez', 'Pandeglang, Banten', '~1,500 ha',
   'Tourism & MICE special economic zone on the Sunda Strait coast, with international hotel operators and resort land.', 'planning', 3),
  (4, 'Morotai SEZ', 'sez', 'Morotai, North Maluku', '~800 ha',
   'Island logistics & fisheries hub SEZ in eastern Indonesia, part of the national growth corridor.', 'planning', 4),
  (5, 'Jababeka Gas-Fired Power Plant', 'power', 'Cikarang, West Java', '130 MW',
   'Captive gas-fired power supporting estate industries with stable, own-grid electricity supply.', 'available', 5),
  (6, 'Jababeka Dry Port (CTC)', 'dryport', 'Cikarang, West Java', '~200 ha',
   'Integrated container terminal & customs facility inside the estate, connecting to Tanjung Priok and Tanjung Perak.', 'available', 6),
  (7, 'Water Treatment & Estate Utilities', 'water', 'Cikarang, West Java', 'multiple plants',
   'Water treatment, wastewater and estate-wide utilities serving 1.2M residents and 2,000+ factories.', 'available', 7),
  (8, 'Jababeka University & Teaching Hospital', 'education', 'Cikarang, West Java', 'campus + hospital',
   'President University and Jababeka Hospital – education & healthcare anchors for talent and community life.', 'available', 8);

-- ---------- 示例潜在客户（演示审核流） ----------
INSERT OR IGNORE INTO lead (id, channel_user_id, company_name, industry, company_size, need_description, contact_name, contact_phone, contact_email, source_channel, status) VALUES
  (1, 1, 'Hangzhou GreenTech Co., Ltd.', 'Renewable Energy', 'Mid', 'Looking for 5–10 ha industrial land in Java to set up solar module assembly and export to ASEAN.',
   'Mr. Chen Wei', '+86 571 8888 6666', 'chen.wei@greentech.example', 'Singapore Chamber Intro', 'under_review');

-- ---------- 示例项目（演示进度页） ----------
INSERT OR IGNORE INTO project (id, lead_id, member_id, name, description, stage, progress_note, status, started_at) VALUES
  (1, 1, 1, 'GreenTech Solar Module Plant – Cikarang', 'Solar module assembly plant on Cikarang industrial plot A7, targeting 2027 COD.',
   'site_visit', 'Site visit completed Nov 2026; land allocation draft under review.', 'active', '2026-10-05');
