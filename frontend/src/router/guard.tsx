import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';

/**
 * 登录守卫：无 token 跳登录页。
 * 菜单级 RBAC 由后端 /api/auth/me 返回的 menu_permissions 决定，
 * AdminLayout 据此渲染侧边栏；此处只做最外层登录校验。
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const token = localStorage.getItem('token');
  const loc = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: loc }} replace />;
  return <>{children}</>;
}
