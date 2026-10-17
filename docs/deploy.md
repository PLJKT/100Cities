# 100Cities — 部署说明

## 阶段 1（当前）：GitHub 测试环境

- 代码托管：GitHub 私有仓库 `PLJKT/100Cities`
- CI：`.github/workflows/ci.yml` — push/PR 到 main 时安装依赖、tsc 类型检查、构建前端、构建后端
- 预览：`.github/workflows/deploy-preview.yml` — main 分支 push 后自动把 `frontend/dist` 发布到 GitHub Pages
- 后端：本地 `npm run dev`（SQLite 文件），或 `docker-compose up backend`

### 首次部署步骤

1. `git clone git@github.com:PLJKT/100Cities.git && cd 100Cities`
2. 后端：`cp .env.example backend/.env`，改 `JWT_SECRET`、`SMTP_*`、`MAIL_TO`、`WA_*`
3. `cd backend && npm install && npm run build && npm start`
4. `cd frontend && npm install && npm run build`（或 `npm run dev` 本地开发）
5. GitHub 仓库 Settings → Pages → Source 选 "GitHub Actions"
6. 后端启动日志会打印一次初始 Super Admin 密码，登录后立即改密

## 阶段 2（百城规模化）：独立域名

- 前端：Nginx 托管 `frontend/dist`，绑定独立域名，反向代理 `/api/` 到后端
- 后端：云服务器跑 `docker-compose up -d`，数据库切 MySQL（改 `.env.production` 的 `DB_TYPE=mysql`）
- 数据库迁移：执行 `backend/src/db/schema.sql` 的 MySQL 版本（与 SQLite schema 字段对齐，仅类型差异）
- 原有业务代码、表单配置、权限、接口**全部复用，无需重构**

## 环境变量

见根目录 `.env.example`（测试）与 `.env.production.example`（生产）。**切勿把真实 `.env` 提交到仓库**（已在 `.gitignore` 中屏蔽）。

## 关键实现要点

1. **文件内存流转**：`backend/src/modules/form/fileStream.ts` 用 `multer` memoryStorage 接收 multipart → `archiver` 内存打包 → Nodemailer 附件发送到 `MAIL_TO` → 流结束自动释放。**不落盘、不入 DB**。
2. **提交只读锁**：`form_submit.locked=true` 后，DAO 层拒绝 UPDATE/DELETE；SQLite 触发器兜底（见 `db/schema.sql`）。
3. **动态 RBAC**：登录后 `/api/auth/me` 返回角色菜单，前端 `router/guard.tsx` 按菜单白名单渲染路由。
4. **三语词库**：`frontend/src/i18n/{en,id,zh}.json` 独立专业词库；导出接口 `lang` 参数渲染。
5. **定时催报**：`scheduler/remind.ts` 启动时加载未结单据，每 7 天催报，满 60 天标记 `abandoned` 并停催。
6. **无自助注册**：关闭一切公开注册路由，账号由 Super Admin 创建。
