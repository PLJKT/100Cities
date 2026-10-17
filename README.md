# 100Cities — Phase1 Prerequisites & Asset Data Request System

> 百城战略平台 · Phase1 资产与前置资料收集系统
> 双门户（对内业务平台 + 对外招商门户）/ 文件内存流转不落盘 / 三语（EN-ID-ZH）/ RBAC 四级权限 / 提交记录只读锁

## 业务背景

一期仅落地 Phase1 资料收集，整体架构模块化完整，未来可扩展用于「百城、1000 startup」战略平台，无需底层重构。

- 资源方：KIJA
- 合作方：生态合作方（如总统大学）/ 第三方服务方 / 申请入驻方（印尼、新加坡、中国主体）
- 业务闭环：Admin 建号 → 合作方登录填表传附件 → 提交时后端内存打包附件 → 推送指定工作邮箱 + WhatsApp 提醒 → 内存流销毁 → 文本入 DB 并锁定只读 → 审核员通过/退回（邮件+WA 通知）→ 7 天催报 / 60 天停催 → Dashboard + 一键导出（Excel/PDF/ZIP/协议附件，跟随前端语种）。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Ant Design 5 + React Router 6 + react-i18next + Axios |
| 后端 | Node.js 20 + Express + TypeScript + JWT + node-schedule + Nodemailer |
| 数据库 | SQLite（测试），可无缝切 MySQL（生产） |
| 文件处理 | multipart Stream 内存接收 → 打包 → SMTP 转发 → 销毁，**不落地、不入 DB** |
| CI/CD | GitHub Actions（CI + GitHub Pages 预览） |
| 容器 | Docker + docker-compose（backend node:20-alpine / frontend nginx:alpine） |

## 目录结构

```
100Cities/
├── frontend/        # React18+Vite+TS+AntD5
├── backend/         # Node+Express+TS
├── .github/workflows/  # ci.yml / deploy-preview.yml
├── docs/            # api.md / deploy.md / 设计交付物
├── docker-compose.yml
├── .env.example / .env.production.example
└── README.md
```

详细结构见 `docs/deploy.md` 与根目录三份中文设计交付物（架构 / GitHub 部署 / 系统业务约束）。

## 快速开始（本地）

```bash
# 1. 后端
cd backend
cp ../.env.example .env
npm install
npm run dev          # http://localhost:8080

# 2. 前端（另一终端）
cd frontend
npm install
npm run dev          # http://localhost:5173, /api 代理到 8080
```

首次启动后端会自动建表并写入初始 Super Admin（用户名 `admin`，密码见后端启动日志，**首次登录后立即改密**）。

## 核心安全 / 合规约定

1. **文件零落盘**：附件仅 Stream 内存处理，打包推邮件后销毁；不写磁盘、不入 DB。
2. **提交记录只读锁**：`form_submit.locked=true` 后，数据访问层仅允许 SELECT，DB 层触发器禁止 UPDATE/DELETE。
3. **操作日志只增不删**：`sys_operation_log` 永久留痕，满足 BOD 审计。
4. **无自助注册**：所有账号由 Super Admin 手动创建；JWT 短期令牌。
5. **三语专业词库**：en/id/zh 独立 JSON，禁止机器音译；导出语种跟随前端选中。
6. **数据权限隔离**：合作方仅能访问自己 `my` 作用域单据。

## 部署阶段

- **阶段 1（当前）**：GitHub 私有仓库 + GitHub Actions CI + GitHub Pages 前端预览，后端本地/临时容器跑 SQLite。
- **阶段 2（百城规模化）**：前端 Nginx 独立域名 + 后端云服务器 + MySQL；代码、表单、权限、接口全部复用，无需重构。

## 角色矩阵

| 角色 | 登录 | 表单填报 | 审核 | Dashboard 明细 | Dashboard 汇总 | 对外门户 | 用户/角色/表单配置 |
|---|---|---|---|---|---|---|---|
| Super Admin | ✅ | ✅ | ✅ | ✅ | ✅ | 浏览 | ✅ |
| 合作方填报员 | ✅ | ✅（仅本人）| ❌ | ❌ | ❌ | 浏览 | ❌ |
| 内部审核管理员 | ✅ | ❌ | ✅ | ✅ | ✅ | 浏览 | ❌ |
| BOD 只读 | ✅ | ❌ | ❌ | ❌ | ✅ | 浏览 | ❌ |
| 访客 | 免登 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

## License

Internal / Confidential — 100Cities Project.
