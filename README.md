# CampusLink｜校园内容与治理平台

CampusLink 是面向单校区的校园社区应用，把学习资源、二手交易、带标签的校园工作、论坛和匿名树洞放在同一套发布、审核与治理流程中。项目已包含 Next.js 应用、数据库、身份认证、私有文件存储和管理后台，不只是页面原型。

**适合学习与实践：** 内容平台的权限边界、文件直传、规则与 AI 辅助审核，以及可追踪的社区治理。它不是学习管理系统，也不包含支付、即时聊天或多校区自助开通服务。

> **先了解上线边界：** 仓库有生产部署与发布验证脚本，但安装成功或本地构建成功不代表可直接上线。学习资料文档需要外部恶意文件扫描器；完整发布还需要真实 PostgreSQL、S3、浏览器测试夹具和确定性的 HTTPS AI 测试服务。详见[中文交付手册](docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md)。

## 已实现的主要能力

| 模块 | 当前能力 |
| --- | --- |
| 学习资源 | 资料发布、标签、私有附件上传与受控读取 |
| 二手交易 | 物品发布、筛选、收藏、举报与受控联系方式查看 |
| 校园工作 | 工作、跑腿等校园信息发布，预设和自定义标签 |
| 校园论坛 | 普通帖子、评论、点赞与举报 |
| 匿名树洞 | 登录后访问，匿名发布、点赞和举报；**不开放评论** |
| 公告 | 管理员发布、置顶和永久删除，首页公告入口与历史浏览 |
| 我的内容 | 查看提交状态、编辑重提，以及适用状态下的内容管理 |
| 社区治理 | 人工审核、举报处理、用户角色与状态、标签、屏蔽词和审计日志 |
| AI 辅助审核 | 可配置的 OpenAI 兼容接口、加密保存凭据、受限的出站请求 |

邮箱验证仅证明用户能控制该邮箱，**不等于学生身份认证**。当前开放有效邮箱注册，默认社区由 `DEFAULT_CAMPUS_SLUG` 指定。

### 审核不是“所有内容都先人工批准”

公开发布先经过确定性的屏蔽词检查，再按管理员配置进行 AI 评估：

- `PASS`：公开发布。
- `REVIEW`：进入人工待审。
- `BLOCK`：拒绝，并向作者返回中文原因和修改建议。
- **供应商失败采用可观测的 fail-open**：内容继续发布，同时记录 `AI_CHECK_SKIPPED`。运营必须为跳过检查的记录配置告警与人工处置，不能把它视作 AI 已通过。

资料文档的恶意文件扫描是另一条独立门禁，不能用 AI 评估替代。生产中的文档绑定、发布和签名读取要求扫描器回传 `CLEAN` 与 SHA-256 结果；仓库只提供回调和门禁，**未交付扫描 Worker**。

## 技术结构

- **应用：** Next.js 16、React 19、TypeScript。
- **数据：** PostgreSQL、Prisma 7。
- **文件：** S3 兼容私有 Bucket；本地使用 MinIO，可配置 R2。
- **邮件：** SMTP；本地可使用 Mailpit。
- **验证：** Vitest、Playwright、ESLint、类型检查与 GitHub Actions。

```text
app/              页面与 API 路由
components/       发布、内容、论坛、认证与后台组件
lib/              认证、领域规则、审核、安全和存储
prisma/           数据模型、前向迁移和开发种子数据
scripts/          迁移部署、E2E 夹具与发布验证
tests/           单元、集成与浏览器测试
docs/            交付、部署、运维、安全与存储说明
design/          历史视觉参考，不是运行时应用
```

`design/stitch-export/` 中的设计稿仅供视觉参考；实际产品已经在 `app/`、`components/` 和 `lib/` 中实现。Stitch 不是运行时依赖。

## 本地启动

### 前置条件

- Node.js **22.12.0 或以上**、npm、Git。
- 已启动的 Docker Engine / Docker Desktop 与 Compose。
- 可用的本地 PostgreSQL 和 MinIO 端口。

在项目根目录执行以下 **PowerShell** 命令；已有 `.env` 时请先核对内容，不要覆盖自己的配置：

```powershell
Copy-Item .env.example .env
docker compose up -d postgres minio minio-init mailpit
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

macOS / Linux 可把第一行替换为 `cp .env.example .env`，后续命令相同。

| 服务 | 本地地址 |
| --- | --- |
| CampusLink | <http://localhost:3000> |
| Mailpit 邮件界面 | <http://127.0.0.1:8025> |
| MinIO Console | <http://127.0.0.1:9001> |
| MinIO API | `http://localhost:9000` |
| PostgreSQL | `localhost:5432` |

始终使用与 `.env` 中 `APP_URL` 一致的应用 origin，不要交替使用 `localhost` 和 `127.0.0.1`。本地未配置 SMTP 时，开发环境会显式记录验证链接；要通过 Mailpit 收取邮件，应按配置示例与部署文档补全 SMTP 设置。

完成注册与邮箱验证后，可从“发布内容”进入业务流程。开发账号与首个生产管理员的创建方式不同，见[交付手册](docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md)；不要把 E2E 测试账号当作生产默认管理员。

## 验证与测试

### 快速检查

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

### 依赖真实服务的检查

| 命令 | 额外要求 |
| --- | --- |
| `npm run test:integration` | 配置完整的 PostgreSQL 与 `S3_*`，并启动对应服务 |
| `npm run e2e:provision` | 隔离测试数据库、测试账号与内容夹具配置 |
| `npm run test:e2e` | 运行中的应用、真实依赖服务和已准备的 E2E 夹具；AI 场景另需确定性 HTTPS fixture |
| `npm run verify:release` | 按脚本顺序执行格式、生成、Lint、类型、单元、**迁移部署**、集成、构建、**夹具准备**和 E2E |

**`verify:release` 不是只读检查，会执行数据库迁移和测试数据准备。** 只在隔离发布验收环境执行，切勿指向生产账号、数据库或 Bucket。破坏性 E2E 要求数据库名以 `_test` 或 `_e2e` 结尾，并显式设置 `ALLOW_DESTRUCTIVE_E2E=true`。

缺少真实服务时的发布结论是 **UNKNOWN / 未完成验证**，不是通过。仅供本地部分运行的跳过开关不能作为发布证据，CI 也不接受这些跳过开关。完整变量说明见 [.env.example](.env.example)、[运维文档](docs/operations.md)和 [CI 配置](.github/workflows/ci.yml)。

本 README 描述代码和脚本的现状，不宣称在当前环境完成了测试或生产验收。交付手册中的历史测试数量与结果也不能替代目标提交的新一轮验证记录。

## 生产部署与安全边界

本地 Compose **只启动依赖服务，不会部署 CampusLink 应用**。生产应用采用 Node.js 运行方式，需准备 HTTPS 入口、PostgreSQL、私有对象存储、TLS SMTP 和扫描器，并按文档注入配置与密钥。

- 普通用户、审核员、管理员的权限在服务端校验，不靠隐藏按钮保护数据。
- 树洞不是不可追责系统：仅管理员可在处理有效未关闭举报时通过受保护 API 揭示作者，必须记录理由与审计事件；当前没有专用揭示按钮。
- 私有 Bucket 不应开放匿名对象访问；下载使用短期签名 URL。
- 开发示例密码和所有 `E2E_*` 凭据禁止用于生产；真实密钥只进入受控密钥存储。
- `TRUST_PROXY=true` 只适用于可信代理会覆盖转发头的部署。
- 定时维护必须同时尝试上传清理与排队对象删除，并监控失败、重试和积压。
- **生产不得执行开发 seed。** 默认发布数据由相应迁移补充；生产发布步骤见 [DELIVERY.md](docs/DELIVERY.md)。

### 数据库回滚边界

迁移采用 **forward-only（只向前）** 策略。Phase 5 收缩迁移删除历史表和字段，切换回旧应用镜像不会恢复这些数据结构。回到 `pre-community-expansion-2026-07-13` 需要匹配的迁移前数据库快照，不能只回滚代码，也不要手动删除迁移历史。每次发布前备份，并在隔离环境演练恢复。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [中文项目交付手册](docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md) | 产品原理、角色使用、首个管理员、部署、回滚与风险登记 |
| [部署配置](docs/deployment.md) | 外部服务、环境变量、扫描器契约与发布要求 |
| [生产交付步骤](docs/DELIVERY.md) | 既定生产部署的更新顺序和只读核验 |
| [日常运维](docs/operations.md) | 定时任务、告警、备份、密钥轮换与事故响应 |
| [文件存储](docs/storage.md) | MinIO / R2、直传、CORS、扫描与删除队列 |
| [安全模型](docs/security.md) | 信任边界、匿名身份、审核和漏洞报告注意事项 |

进一步扩展聊天、支付、多校区或推荐系统前，应重新确认威胁模型、数据边界和验收标准，而不是假定现有权限与部署方案可以直接覆盖。

