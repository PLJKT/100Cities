import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/error';

import authRoutes from './modules/auth/auth.routes';
import userRoutes from './modules/user/user.routes';
import roleRoutes from './modules/role/role.routes';
import templateRoutes from './modules/template/template.routes';
import formRoutes from './modules/form/form.routes';
import reviewRoutes from './modules/review/review.routes';
import exportRoutes from './modules/export/export.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import publicRoutes from './modules/public/public.routes';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  app.use('/api/auth', authRoutes);
  app.use('/api/admin/users', userRoutes);
  app.use('/api/admin/roles', roleRoutes);
  app.use('/api/admin/templates', templateRoutes);
  app.use('/api/forms', formRoutes);
  app.use('/api/review', reviewRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/public', publicRoutes);

  app.use(errorHandler);
  return app;
}
