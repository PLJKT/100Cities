import { Navigate, Route, Routes } from 'react-router-dom';
import Login from '../pages/login';
import AdminLayout from '../layouts/AdminLayout';
import Landing from '../pages/landing/Landing';
import FormFill from '../pages/partner/FormFill';
import MySubmits from '../pages/partner/MySubmits';
import ReviewList from '../pages/review/ReviewList';
import ReviewDetail from '../pages/review/ReviewDetail';
import UserManage from '../pages/admin/UserManage';
import RoleManage from '../pages/admin/RoleManage';
import TemplateEditor from '../pages/admin/TemplateEditor';
import Members from '../pages/admin/Members';
import Dashboard from '../pages/dashboard/Dashboard';
import RequireAuth from './guard';

export default function AppRouter() {
  return (
    <Routes>
      {/* 对外公开落地页（免登录） */}
      <Route index element={<Landing />} />
      <Route path="login" element={<Login />} />

      {/* 内部业务平台：登录 + RBAC */}
      <Route
        path="app"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="partner/form" element={<FormFill />} />
        <Route path="partner/my" element={<MySubmits />} />
        <Route path="review" element={<ReviewList />} />
        <Route path="review/:id" element={<ReviewDetail />} />
        <Route path="members" element={<Members />} />
        <Route path="admin/users" element={<UserManage />} />
        <Route path="admin/roles" element={<RoleManage />} />
        <Route path="admin/templates" element={<TemplateEditor />} />
      </Route>

      {/* 兼容旧链接 */}
      <Route path="portal" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
