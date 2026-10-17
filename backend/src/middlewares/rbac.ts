import { Response, NextFunction } from 'express';
import { AuthedRequest } from './auth';

/**
 * RBAC：按菜单/动作白名单拦截。
 * 用法：router.post('/admin/users', authRequired, requirePerm('admin.users'), handler)
 * Super Admin (data_scope=all) 默认放行。
 */
export function requirePerm(perm: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const perms = req.user?.menu_permissions || [];
    if (req.user?.role_name === 'Super Admin' || perms.includes(perm)) return next();
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Missing permission: ${perm}` } });
  };
}
