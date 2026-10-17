import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { getDb } from '../config/db';

export interface AuthPayload {
  uid: number;
  username: string;
  role_id: number;
}

export interface AuthedRequest extends Request {
  user?: AuthPayload & { role_name?: string; menu_permissions?: string[] };
}

export function signToken(p: AuthPayload) {
  return jwt.sign(p, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES as any });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' } });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
    const row = getDb()
      .prepare(
        `SELECT u.id, u.username, u.role_id, r.role_name, r.menu_permissions
         FROM sys_user u JOIN sys_role r ON r.id = u.role_id
         WHERE u.id = ? AND u.enabled = 1`
      )
      .get(payload.uid) as any;
    if (!row) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'User disabled' } });
    req.user = {
      uid: row.id,
      username: row.username,
      role_id: row.role_id,
      role_name: row.role_name,
      menu_permissions: JSON.parse(row.menu_permissions || '[]'),
    };
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Bad token' } });
  }
}
