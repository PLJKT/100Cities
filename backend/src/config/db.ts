import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from './env';

let db: Database.Database;

export function initDb() {
  if (env.DB_TYPE !== 'sqlite') {
    // 生产 MySQL 切换点：保留接口签名不变，仅替换连接实现。
    // eslint-disable-next-line no-console
    console.warn('[db] DB_TYPE=mysql not yet implemented in this skeleton; falling back to sqlite for local dev.');
  }
  const file = path.resolve(process.cwd(), env.DB_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 先迁移已有库（v4 列/表结构与 schema 种子对齐），再执行 schema（新库全建+种子；已有库补缺表）
  runMigrations();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  seedInitialAdmin();
}

/** 轻量迁移：已存在的库在 schema 变更后重建 pipeline（v3：partner_id 可空 + lead_id；v4：+ entered_at）
 *  注意：SQLite 中 RENAME 总会改写引用方外键（legacy_alter_table 对外键无效），
 *  因此重建必须临时关闭 foreign_keys，并连带重建 pipeline_event，确保 FK 锚定回新表。 */
function runMigrations() {
  const cols = db.prepare(`PRAGMA table_info(pipeline)`).all() as any[];
  const leftoverOld = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pipeline_old'`)
    .get();

  const createV3 = `
    CREATE TABLE pipeline (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      partner_id  INTEGER REFERENCES partner_profile(id),
      lead_id     INTEGER REFERENCES lead(id),
      submit_id   INTEGER REFERENCES form_submit(id),
      stage       TEXT NOT NULL DEFAULT 'intake',
      stage_note  TEXT,
      entered_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by  INTEGER,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE pipeline_event (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
      from_stage  TEXT,
      to_stage    TEXT NOT NULL,
      note        TEXT,
      user_id     INTEGER,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );`;

  /** 重建 pipeline + pipeline_event（数据保真，FK 锚定新表） */
  const rebuild = (old: { p: string; e: string }) => db.exec(`
    PRAGMA foreign_keys = OFF;
    ALTER TABLE pipeline RENAME TO ${old.p};
    ALTER TABLE pipeline_event RENAME TO ${old.e};
    ${createV3}
    INSERT INTO pipeline (id, partner_id, lead_id, submit_id, stage, stage_note, entered_at, updated_by, updated_at, created_at)
      SELECT id, partner_id, lead_id, submit_id, stage, stage_note, datetime('now'), updated_by, updated_at, created_at FROM ${old.p};
    INSERT INTO pipeline_event (id, pipeline_id, from_stage, to_stage, note, user_id, created_at)
      SELECT id, pipeline_id, from_stage, to_stage, note, user_id, created_at FROM ${old.e};
    DROP TABLE ${old.p};
    DROP TABLE ${old.e};
    PRAGMA foreign_keys = ON;`);

  // 修复历史悬空外键：pipeline_event 的 FK 指向已被删除的 pipeline_old → 整体重建
  const evFks = db.prepare(`PRAGMA foreign_key_list(pipeline_event)`).all() as any[];
  if (evFks.some((f) => f.table === 'pipeline_old')) {
    rebuild({ p: 'pipeline_old', e: 'pipeline_event_old' });
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline+events rebuilt: FK re-anchored from *_old');
  }

  const cols2 = db.prepare(`PRAGMA table_info(pipeline)`).all() as any[];
  if (!cols2.length && leftoverOld) {
    // 上次重建中断：pipeline 已改名且未重建 → 从 _old 恢复
    rebuild({ p: 'pipeline_old', e: 'pipeline_event_old' });
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline restored from interrupted rebuild');
    return;
  }

  if (!cols2.length) return;
  const hasLeadId = cols2.some((c) => c.name === 'lead_id');
  const partnerCol = cols2.find((c) => c.name === 'partner_id');
  const partnerNotNull = partnerCol ? partnerCol.notnull === 1 : false;
  const hasEnteredAt = cols2.some((c) => c.name === 'entered_at');
  // 需要重建：v2 缺 lead_id；或 partner_id 仍 NOT NULL；或 v4 缺 entered_at
  if (!hasLeadId || partnerNotNull || !hasEnteredAt) {
    rebuild({ p: 'pipeline_old', e: 'pipeline_event_old' });
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline+events rebuilt v4: partner_id nullable + lead_id + entered_at');
  }

  // v4 列补充（asset/lead/project：建档与台账字段）
  const addColIfMissing = (table: string, col: string, ddl: string) => {
    const c = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    if (!c.some((x) => x.name === col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      // eslint-disable-next-line no-console
      console.log(`[migrate] ${table}.${col} added`);
    }
  };
  addColIfMissing('asset', 'price_desc', `TEXT`);
  addColIfMissing('asset', 'min_area', `TEXT`);
  addColIfMissing('asset', 'max_area', `TEXT`);
  addColIfMissing('asset', 'key_specs', `TEXT`);
  addColIfMissing('asset', 'owner_contact', `TEXT`);
  addColIfMissing('asset', 'image_url', `TEXT`);
  addColIfMissing('lead', 'estimated_value', `TEXT`);
  addColIfMissing('lead', 'priority', `TEXT DEFAULT 'normal'`);
  addColIfMissing('lead', 'assigned_to', `INTEGER REFERENCES sys_user(id)`);
  addColIfMissing('lead', 'next_action', `TEXT`);
  addColIfMissing('lead', 'next_follow_at', `TEXT`);
  addColIfMissing('project', 'asset_id', `INTEGER REFERENCES asset(id)`);
  addColIfMissing('project', 'progress_pct', `INTEGER DEFAULT 0`);
  addColIfMissing('project', 'estimated_value', `TEXT`);
  addColIfMissing('project', 'expected_close', `TEXT`);
}

export function getDb() {
  if (!db) throw new Error('DB not initialized');
  return db;
}

function seedInitialAdmin() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM sys_user').get() as { c: number };
  if (row.c > 0) return;
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(env.INIT_ADMIN_PASSWORD, 10);
  db.prepare(
    `INSERT INTO sys_user (username, password_hash, role_id, partner_name, enabled, created_at)
     VALUES (?, ?, 1, 'Super Admin', 1, datetime('now'))`
  ).run(env.INIT_ADMIN_USERNAME, hash);
  // eslint-disable-next-line no-console
  console.log(`[init] Initial Super Admin created: username=${env.INIT_ADMIN_USERNAME} password=${env.INIT_ADMIN_PASSWORD} (change immediately after first login)`);
}
