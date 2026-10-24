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

  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  db.exec(schema);

  runMigrations();
  seedInitialAdmin();
}

/** 轻量迁移：已存在的库在 schema 变更后重建 pipeline（v3：partner_id 可空 + lead_id）
 *  注意：foreign_keys=ON 时 ALTER TABLE RENAME 会把引用方外键改指向 *_old，
 *  因此重建必须用 legacy_alter_table=ON 保护，且要修复历史上已悬空的外键。 */
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
      updated_by  INTEGER,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );`;

  // 修复历史悬空外键：pipeline_event 的 FK 若指向已被删除的 pipeline_old → 重建回锚到 pipeline
  const evFks = db.prepare(`PRAGMA foreign_key_list(pipeline_event)`).all() as any[];
  if (evFks.some((f) => f.table === 'pipeline_old')) {
    db.exec(`
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE pipeline_event RENAME TO pipeline_event_old;
      CREATE TABLE pipeline_event (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        pipeline_id INTEGER NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
        from_stage  TEXT,
        to_stage    TEXT NOT NULL,
        note        TEXT,
        user_id     INTEGER,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO pipeline_event (id, pipeline_id, from_stage, to_stage, note, user_id, created_at)
        SELECT id, pipeline_id, from_stage, to_stage, note, user_id, created_at FROM pipeline_event_old;
      DROP TABLE pipeline_event_old;
      PRAGMA legacy_alter_table = OFF;`);
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline_event FK re-anchored to pipeline');
  }

  if (!cols.length && leftoverOld) {
    // 上次重建中断：pipeline 已改名且未重建 → 从 _old 恢复
    db.exec(`${createV3}
      INSERT INTO pipeline (id, partner_id, lead_id, submit_id, stage, stage_note, updated_by, updated_at, created_at)
        SELECT id, partner_id, NULL, submit_id, stage, stage_note, updated_by, updated_at, created_at FROM pipeline_old;
      DROP TABLE pipeline_old;`);
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline restored from interrupted rebuild');
    return;
  }

  if (!cols.length) return;
  const hasLeadId = cols.some((c) => c.name === 'lead_id');
  const partnerCol = cols.find((c) => c.name === 'partner_id');
  const partnerNotNull = partnerCol ? partnerCol.notnull === 1 : false;
  // 需要重建的两种状态：v2 缺 lead_id；或部分迁移已加 lead_id 但 partner_id 仍 NOT NULL
  if (!hasLeadId || partnerNotNull) {
    const leadExpr = hasLeadId ? 'lead_id' : 'NULL';
    db.exec(`
      PRAGMA legacy_alter_table = ON;
      ALTER TABLE pipeline RENAME TO pipeline_old;
      ${createV3}
      INSERT INTO pipeline (id, partner_id, lead_id, submit_id, stage, stage_note, updated_by, updated_at, created_at)
        SELECT id, partner_id, ${leadExpr}, submit_id, stage, stage_note, updated_by, updated_at, created_at FROM pipeline_old;
      DROP TABLE pipeline_old;
      PRAGMA legacy_alter_table = OFF;`);
    // eslint-disable-next-line no-console
    console.log('[migrate] pipeline rebuilt: partner_id nullable + lead_id added');
  }
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
