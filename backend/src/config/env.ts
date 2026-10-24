import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const env = {
  PORT: Number(process.env.PORT || 8080),
  NODE_ENV: process.env.NODE_ENV || 'development',

  DB_TYPE: process.env.DB_TYPE || 'sqlite',
  DB_FILE: process.env.DB_FILE || './data/100cities.sqlite',

  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  JWT_EXPIRES: process.env.JWT_EXPIRES || '12h',

  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || '100Cities <no-reply@localhost>',
  MAIL_TO: process.env.MAIL_TO || 'target@example.com',

  WA_API_URL: process.env.WA_API_URL || '',
  WA_TOKEN: process.env.WA_TOKEN || '',
  WA_FROM: process.env.WA_FROM || '',
  WA_TO: process.env.WA_TO || '+6281513198596',

  DEFAULT_LANG: process.env.DEFAULT_LANG || 'en',
  REMIND_EVERY_DAYS: Number(process.env.REMIND_EVERY_DAYS || 7),
  ABANDON_AFTER_DAYS: Number(process.env.ABANDON_AFTER_DAYS || 60),

  INIT_ADMIN_USERNAME: process.env.INIT_ADMIN_USERNAME || 'admin',
  INIT_ADMIN_PASSWORD: process.env.INIT_ADMIN_PASSWORD || 'ChangeMe!2026',
};
