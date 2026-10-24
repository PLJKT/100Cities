# 100Cities — Phase1 Prerequisites & Asset Data Request System

> 百城战略平台 · Phase1 资产与前置资料收集系统
> 双门户（对内业务平台 + 对外招商门户）/ 文件内存流转不落盘 / 三语（EN-ID-ZH）/ RBAC 四级权限 / 提交记录只读锁

## 业务背景

一期仅落地 Phase1 资料收集，整体架构模块化完整，未来可扩展用于「百城、1000 startup」战略平台，无需底层重构。

- 资源方：KIJA
- 合作方：生态合作方（如总统大学）/ 第三方服务方 / 申请入驻方（印尼、新加坡、中国主体）
- 业务闭环：Admin 建号 → 合作方完善企业档案 → 按动态模板填 Phase1 → 提交时后端内存打包附件 → 推送指定工作邮箱 + WhatsApp 提醒 → 内存流销毁 → 文本入 DB 并锁定只读 → 审核员通过/退回（邮件+WA 通知）→ pipeline 五步流转（Intake→Matching→Site Visit→Proposal→Decision）→ 7 天催报 / 60 天停催 → Dashboard + 一键导出（Excel/PDF/ZIP/协议附件，跟随前端语种）。

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

## 后端 v2 能力（已实现）

| 模块 | 接口 | 说明 |
|---|---|---|
| 字段级动态模板 | `GET/POST /api/admin/templates`、`PUT /:id/fields`、`DELETE /:id/fields/:fid` | Admin 可视化维护字段（text/textarea/number/select/multiselect/file、必填、排序、三语标签、选项）；填报端 `GET /api/forms/:templateKey` 只返回 `enabled=1` 的字段 |
| 企业档案 | `GET/POST /api/partners`、`PUT /:id`、`GET /my` | 与 sys_user 一对一；tier 五类（explorer/manufacturer/tech/existing/investor）、status 状态机（invited/active/paused）；合作方仅可改自己 |
| Pipeline 五步流转 | `GET /:id/pipeline`、`PUT /:id/pipeline` | intake→matching→site_visit→proposal→decision，自动建 pipeline、全量事件流留痕（pipeline_event），Admin/Reviewer 可推进 |
| SMTP 配置表 | `GET/PUT /api/admin/settings/email` | `email_settings` 表（id=1）DB 优先、env 兜底；后台随时切换 Gmail/企业邮箱；占位符（example/yourmail 等）自动视为未配置 |
| 通知记录 | `notification` 表 | 邮件/WA 每次发送留痕（pending/sent/failed + error + 重试计数），供后台审计 |
| WhatsApp 适配器 | `notify.service#sendWhatsAppNotification` | **路线 B（当前）**：`WA_API_URL` 未配置时 mock+日志，默认接收号 `WA_TO=+6281513198596`；接官方 Business Cloud API 后替换实现即可，调用方不变 |

默认 Phase1 模板已种子 7 字段：partner_name / entity_nationality / asset_summary / qualifications / cooperation_intent(select,5 选项) / target_segment(multiselect,7 板块) / attachments(file)。

## 核心安全 / 合规约定

1. **文件零落盘**：附件仅 Stream 内存处理，打包推邮件后销毁；不写磁盘、不入 DB。
2. **提交记录只读锁**：`form_submit.locked=true` 后，数据访问层仅允许 SELECT，DB 层触发器禁止 UPDATE/DELETE。
3. **操作日志只增不删**：`sys_operation_log` 永久留痕，满足 BOD 审计。
4. **无自助注册**：所有账号由 Super Admin 手动创建；JWT 短期令牌。
5. **三语专业词库**：en/id/zh 独立 JSON，禁止机器音译；导出语种跟随前端选中。
6. **数据权限隔离**：合作方仅能访问自己 `my` 作用域单据。

## 部署阶段

- **阶段 1（当前）**：GitHub **公开仓库** + GitHub Actions CI + GitHub Pages（Source = GitHub Actions）自动部署，后端本地/临时容器跑 SQLite。
  - 线上地址：https://pljkt.github.io/100Cities/
  - `vite.config.ts` 设置 `base: '/100Cities/'`，路由 `basename={import.meta.env.BASE_URL}`，`dist/404.html` 做 SPA fallback。
  - 每次 `git push origin main` 自动重新构建并部署到 Pages。
- **阶段 2（百城规模化）**：前端 Nginx 独立域名 + 后端云服务器 + MySQL；代码、表单、权限、接口全部复用，无需重构。

## 当前落地页（Landing `/`，免登录）

公开门户内容为三语（EN / ID / ZH），结构自上而下：

1. **Top bar** — 圆形徽章 logo + "100 CITIES CLUB" 标题（`clamp()` 自适应字号，窄屏 flex-wrap 防止语言按钮覆盖）+ 三语切换 + Sign In。
2. **Hero** — 印尼世界级经济地位（G20 唯一东盟成员、名义 GDP 全球第 16、PPP 第 8、2.87 亿人口）+ 百城俱乐部作为 KIJA 发起的邀请制平台、联合政府/本土企业家/全球资本共建 100 城的愿景；背景为金色印尼地图（`mix-blend-mode: screen`）。
3. **Who We Are Working With** — KIJA 35+ 年综合城区/工业园/电力/水务/干港/大学/医院经验，开放给全球伙伴；配 Jababeka 园区横版 banner 与 5 项可信度数字。
4. **Track Record** — 左：园区实绩 bullet；右：KIJA 8 大业务板块彩色矩阵（Real Estate / Industrial / Residential / Commercial / Infrastructure / Power / Water & Estate / Dry Port，标签随语言切换）。
5. **Dual Core** — 印尼侧能力 × 全球合作方需求两栏。
6. **Members** — 5 类邀请对象同一行排列（首次出海考察者 / 制造商与承包商 / 技术供应商 / 已在印尼企业 / 投资者），`clamp()` 自适应字号 + 断词规则。
7. **How a Project Typically Moves** — 5 步水平流程图（Intake → Matching → Site Visit → Proposal → Decision），整行排列，移动端不换行。
8. **Vision + Sign-in** + 页脚免责声明（© 2026 100 Cities Club，包含 early-stage / 不承诺 / no-offer 三段合规语）。

> 前端当前以 **MOCK 模式**独立运行：
> - 本地开发：`frontend/.env.development` 中 `VITE_USE_MOCK=true`，任意账号可登录，后端无需启动。
> - 线上 Pages：`frontend/.env.production` 同样 `VITE_USE_MOCK=true`，因此 GitHub Pages 上**所有页面（登录 / Dashboard / 填报 / 审核 / 管理）都渲染完整排版与演示数据**，可直接浏览。
> - 后端部署到云端后，将两处 `VITE_USE_MOCK` 改为 `false` 并配置真实 base URL 即可切回。
>
> **响应式设计约定**：所有标题/正文/卡片文字使用 `clamp(min, vw, max)` 自适应字号；业务板块和会员卡片加 `word-break: break-word; overflow-wrap: anywhere`，杜绝长词截断；窄屏导航 `flex-wrap` 自动换行。

## 角色矩阵

| 角色 | 登录 | 表单填报 | 审核 | Pipeline 流转 | Dashboard 明细 | Dashboard 汇总 | 对外门户 | 用户/角色/模板/SMTP 配置 |
|---|---|---|---|---|---|---|---|---|---|
| Super Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 浏览 | ✅ |
| 合作方填报员 | ✅ | ✅（仅本人）| ❌ | 仅查看自己 | ❌ | ❌ | 浏览 | ❌ |
| 内部审核管理员 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 浏览 | ❌ |
| BOD 只读 | ✅ | ❌ | ❌ | 仅查看 | ❌ | ✅ | 浏览 | ❌ |
| 访客 | 免登 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

## License

Internal / Confidential — 100Cities Project.
