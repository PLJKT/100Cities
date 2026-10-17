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
