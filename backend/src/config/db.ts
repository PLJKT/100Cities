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

  seedInitialAdmin();
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
