# 100Cities Phase1 — REST API 接口清单

Base URL：`/api`
所有业务接口经 JWT 鉴权（`Authorization: Bearer <token>`）+ RBAC 拦截。
合作方只能访问 `my` 作用域数据，无法读取其他合作方单据。

## 1. 认证与账号（Super Admin）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /api/auth/login | 用户名密码登录，返回 JWT | 公开（登录页） |
| GET  | /api/auth/me | 当前用户信息 + 角色 + 可见菜单 | 登录 |
| POST | /api/admin/users | 创建账号 | Super Admin |
| PUT  | /api/admin/users/:id | 启用/停用账号、改密 | Super Admin |
| GET  | /api/admin/users | 用户列表 | Super Admin |
| POST | /api/admin/roles | 新建角色 | Super Admin |
| PUT  | /api/admin/roles/:id | 配置角色菜单权限 | Super Admin |

## 2. 表单配置（Admin 可视化编辑）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET  | /api/admin/templates | 表单模板列表 | Super Admin / 审核 |
| POST | /api/admin/templates | 新建表单模板 | Super Admin |
| PUT  | /api/admin/templates/:id | 编辑字段/增删条目 | Super Admin |
| GET  | /api/forms/:templateKey | 合作方获取当前表单配置 | 填报员 |

## 3. 填报与提交（核心：文件内存流转）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /api/forms/draft | 保存草稿（仅文本入 DB，不存文件） | 填报员 |
| POST | /api/forms/submit | 正式提交（文本入 DB；multipart 文件流内存打包 → SMTP 推 `MAIL_TO` → 销毁；提交记录锁定只读） | 填报员 |
| GET  | /api/forms/my/submits | 我的提交记录 | 填报员 |

## 4. 审核与退回

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET  | /api/review/submits | 全部单据列表 | 审核管理员 |
| POST | /api/review/:id/approve | 审核通过 | 审核管理员 |
| POST | /api/review/:id/reject | 退回补件（手写备注） | 审核管理员 |
| POST | /api/review/:id/remind | 手动催报 | 审核管理员 |

## 5. 通知（服务内部调用）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | /api/notify/email | 发邮件（内部） | 服务内部 |
| POST | /api/notify/whatsapp | 发 WhatsApp 提醒（内部） | 服务内部 |

## 6. 导出（语言跟随 `?lang=en|id|zh`）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /api/export/excel?lang= | 资产+资质汇总 Excel | 审核管理员 |
| GET | /api/export/pdf?lang= | 表单归档 PDF | 审核管理员 |
| GET | /api/export/zip?lang= | 附件包说明 ZIP（仅文字清单 + 指向工作邮箱） | 审核管理员 |
| GET | /api/export/agreement?lang= | 预填充协议附件文档 | 审核管理员 |

## 7. Dashboard

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /api/dashboard/summary | 项目进度 / 逾期 / 完成率汇总 | 审核 / BOD 只读 |
| GET | /api/dashboard/detail | 明细（BOD 不可见） | 审核管理员 |

## 8. 对外招商门户（免登录）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| GET | /api/public/project | 项目介绍（多语言） | 公开 |
| GET | /api/public/invest | 招商信息 | 公开 |

---

## 通用错误结构

```json
{ "error": { "code": "FORBIDDEN", "message": "..." } }
```

HTTP 状态码：400 参数错 / 401 未登录 / 403 无权限 / 404 不存在 / 423 已锁定（对只读记录写操作）/ 500 服务端错。
