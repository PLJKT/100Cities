# Phase1 收集系统 — GitHub 项目结构与部署配置（交付物2）

> 用途：私有 GitHub 仓库的目录结构、GitHub Actions 流水线、Docker 配置、环境变量模板。
> 配套：`system-design-phase1.md`（业务约束）、`deliverable1-architecture.md`（架构/接口）。

---

## 一、GitHub 仓库目录结构

```
phase1-asset-collection/
├── README.md
├── .gitignore
├── .env.example
├── .env.production.example
├── docker-compose.yml
├── frontend/                          # React18 + Vite + TS
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── router/
│       │   ├── index.tsx              # React Router 6 动态路由
│       │   └── guard.tsx              # 登录 + RBAC 路由守卫
│       ├── i18n/
│       │   ├── index.ts
│       │   ├── en.json               # 英文专业词库
│       │   ├── id.json               # 印尼文专业词库
│       │   └── zh.json               # 简体中文专业词库
│       ├── layouts/
│       │   ├── AdminLayout.tsx
│       │   └── PortalLayout.tsx
│       ├── pages/
│       │   ├── login/
│       │   ├── partner/              # 合作方：填报表单
│       │   │   ├── FormFill.tsx
│       │   │   └── MySubmits.tsx
│       │   ├── review/               # 审核管理员
│       │   │   ├── ReviewList.tsx
│       │   │   └── ReviewDetail.tsx
│       │   ├── admin/                # Super Admin
│       │   │   ├── UserManage.tsx
│       │   │   ├── RoleManage.tsx
│       │   │   └── TemplateEditor.tsx
│       │   ├── dashboard/            # BOD/审核看板
│       │   │   └── Dashboard.tsx
│       │   └── portal/               # 对外招商门户
│       │       └── PublicPortal.tsx
│       ├── services/
│       │   └── api.ts                 # Axios 封装 + JWT 注入
│       └── components/
│           ├── FileUpload.tsx
│           └── LangSwitcher.tsx
│
├── backend/                           # Node.js + Express
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts                  # 启动入口
│       ├── app.ts                     # Express 应用
│       ├── config/
│       │   ├── env.ts
│       │   └── db.ts                  # SQLite 连接(可切换MySQL)
│       ├── middlewares/
│       │   ├── auth.ts                # JWT 鉴权
│       │   ├── rbac.ts                # 角色-菜单-按钮权限
│       │   └── error.ts
│       ├── modules/
│       │   ├── auth/                  # 登录
│       │   ├── user/                  # 账号管理(Admin)
│       │   ├── role/                  # 角色权限
│       │   ├── template/              # 表单配置
│       │   ├── form/                  # 填报/提交
│       │   │   └── fileStream.ts      # 文件内存流转(不落盘)
│       │   ├── review/                # 审核/退回
│       │   ├── notify/                # 邮件+WhatsApp
│       │   ├── export/                # Excel/PDF/ZIP
│       │   ├── log/                   # 操作日志
│       │   └── dashboard/             # 看板
│       ├── scheduler/
│       │   └── remind.ts              # 7天催报/2个月停催
│       ├── db/
│       │   ├── schema.sql             # 建表 + 只读锁约束
│       │   └── migrations/
│       └── utils/
│
├── .github/
│   └── workflows/
│       ├── ci.yml                     # 构建+测试
│       └── deploy-preview.yml         # 前端部署 GitHub Pages 预览
└── docs/
    ├── api.md
    └── deploy.md
```

---

## 二、GitHub Actions 流水线配置

### 2.1 CI 流水线 `ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - name: Install deps
        run: npm ci
        working-directory: frontend
      - name: Type-check
        run: npx tsc --noEmit
        working-directory: frontend
      - name: Build
        run: npm run build
        working-directory: frontend
      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: frontend-dist
          path: frontend/dist

  build-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: backend/package-lock.json
      - name: Install deps
        run: npm ci
        working-directory: backend
      - name: Type-check
        run: npx tsc --noEmit
        working-directory: backend
      - name: Unit tests
        run: npm test
        working-directory: backend
```

### 2.2 预览部署 `deploy-preview.yml`（前端 → GitHub Pages）

```yaml
name: Deploy Preview to GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Build frontend
        run: |
          cd frontend
          npm ci
          npm run build
      - name: Configure Pages
        uses: actions/configure-pages@v5
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/dist
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

> 说明：测试阶段后端跑本地/临时容器，前端预览走 GitHub Pages；正式阶段切换 Nginx + 云服务器。

---

## 三、Docker 配置

### 3.1 `docker-compose.yml`

```yaml
version: "3.9"

services:
  backend:
    build: ./backend
    container_name: phase1-backend
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8080:8080"
    volumes:
      - ./data/sqlite:/app/data
    networks:
      - app-net

  frontend:
    build: ./frontend
    container_name: phase1-frontend
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend
    networks:
      - app-net

networks:
  app-net:
    driver: bridge
```

### 3.2 `backend/Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

### 3.3 `frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 3.4 `frontend/nginx.conf`（正式独立域名阶段）

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 四、环境变量模板

### 4.1 `.env.example`（测试）

```env
# --- Server ---
PORT=8080
NODE_ENV=development

# --- Database (SQLite 测试；正式可切 MySQL) ---
DB_TYPE=sqlite
DB_FILE=./data/phase1.sqlite

# --- JWT ---
JWT_SECRET=change_me_in_production
JWT_EXPIRES=12h

# --- SMTP Mail ---
SMTP_HOST=smtp.yourmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_password
MAIL_TO=target_work_mailbox@company.com   # 指定工作邮箱(收附件包)

# --- WhatsApp API ---
WA_API_URL=https://api.whatsapp.example
WA_TOKEN=your_token

# --- Multi-language ---
DEFAULT_LANG=en

# --- Reminder schedule ---
REMIND_EVERY_DAYS=7
ABANDON_AFTER_DAYS=60

# --- Export ---
EXPORT_TMP_DIR=./tmp/export
```

### 4.2 `.env.production.example`（正式迁移阶段）

```env
PORT=8080
NODE_ENV=production
DB_TYPE=mysql
DB_HOST=your-rds-host
DB_PORT=3306
DB_NAME=phase1
DB_USER=app_user
DB_PASS=secret
JWT_SECRET=strong-random-secret
SMTP_HOST=smtp.provider.com
SMTP_PORT=587
SMTP_USER=no-reply@domain.com
SMTP_PASS=secret
MAIL_TO=target_work_mailbox@company.com
WA_API_URL=https://api.whatsapp.business
WA_TOKEN=secret
DEFAULT_LANG=en
REMIND_EVERY_DAYS=7
ABANDON_AFTER_DAYS=60
```

---

## 五、.gitignore（防敏感信息入库）

```gitignore
node_modules/
dist/
.env
.env.local
data/
*.sqlite
*.sqlite3
tmp/
.vscode/
.idea/
```

---

## 六、关键实现要点（开发提醒）

1. **文件内存流转（核心）**：`backend/src/modules/form/fileStream.ts` 用 Node Stream 接收 multipart，内存打包为临时压缩包 → 通过 SMTP 发到 `MAIL_TO` → 立即释放流。**不写入磁盘、不入 DB**。
2. **提交只读锁**：`form_submit` 表提交成功后设置 `locked=true`；所有数据访问层对已锁定记录仅允许 `SELECT`，从代码与数据库双重约束禁止修改。
3. **动态 RBAC 菜单**：登录后 `/api/auth/me` 返回该角色可见菜单，前端 `guard.tsx` 按菜单白名单渲染路由，实现不同账号见不同版块。
4. **三语词库**：`en.json / id.json / zh.json` 使用商务专业词汇，禁止音译；导出接口接收 `lang` 参数按对应词库渲染。
5. **定时催报**：`scheduler/remind.ts` 持久化任务状态；每 7 天发送催报，满 60 天（2 个月）自动停催并标记放弃。
6. **账号无自助注册**：仅 `POST /api/admin/users` 由 Super Admin 创建；关闭一切公开注册路由。

---

## 七、下一步（新豆包项目可直接执行）
1. 按本目录结构初始化仓库（或让新项目 agent 直接生成）。
2. 落地 `backend` 各模块 + `frontend` 各页面。
3. 配置 `.env`（测试用 SQLite + 目标邮箱）。
4. 提交代码触发 `ci.yml` / `deploy-preview.yml`，前端预览上线 GitHub Pages。
5. 试点跑通后按 `.env.production.example` 迁移 MySQL + 独立域名。
