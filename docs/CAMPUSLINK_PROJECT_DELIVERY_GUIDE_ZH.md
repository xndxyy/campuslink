# CampusLink 项目交付、使用与服务器部署手册

> 版本日期：2026-07-13
> 适用对象：项目负责人、首次接手的开发者、服务器运维人员
> 项目目录：`outputs/campuslink`

## 1. 项目结论

CampusLink 是一个面向单校区的校园内容平台，覆盖学习资料、二手市集、兼职机会、收藏、举报、内容审核、用户治理和审计追踪。

它不是只展示页面的原型，而是具备数据库、身份认证、权限控制、私有文件存储、恶意文件扫描门禁、自动化测试和生产部署约束的完整 Next.js 产品。

当前发布验证结果：

- 单元测试：305 项通过。
- PostgreSQL/MinIO 集成测试：22 项通过。
- Playwright 真实浏览器流程：11 项通过。
- Prisma 迁移：11 个，全部已验证。
- ESLint、TypeScript、Prettier、Prisma Schema 校验通过。
- Next.js production build 通过。
- 独立代码审查最终无 Critical 或 Important 问题。

本次功能验证绑定的代码基线：

| 证据 | 值 |
| --- | --- |
| 功能基线 Commit | `5228e43c70bff6b2b33654a5cd21a55b024ee822` |
| CI Node | `22.12.0` |
| 最终本地复核 Node/npm | `v24.14.1` / `11.11.0` |
| PostgreSQL 测试镜像 | `postgres:16-alpine` |
| MinIO 测试镜像 | `minio/minio:RELEASE.2025-09-07T16-13-09Z` |
| `package-lock.json` SHA-256 | `841ac04b1f0e7dff7342b0e0b704e74554442ab6f002d1ef197fd8b7aec01077` |

代码当前位于 `master` 分支。本地开发服务器可使用 `http://127.0.0.1:3000`。本手册之后的纯文档 Commit 不改变上述功能基线；正式发布仍应为目标 Commit 重新生成验证证据，不能永久复用本表。

> **生产上线判定：** Web 应用本身已经具备部署条件；但仓库只实现了文件扫描回调和发布门禁，没有交付扫描 Worker。若要开放“学习资料文档”功能，恶意文件扫描器属于上线阻塞项。未接入时文档会停留在 `PENDING`，不能送审、发布或下载。二手市集、兼职、审核和用户治理不依赖扫描 Worker，但不能据此宣称整个产品已完成生产上线。

## 2. 这个项目优秀在哪里

### 2.1 产品闭环完整

CampusLink 已形成从用户进入到平台治理的完整闭环：

1. 用户使用任意有效邮箱注册并完成邮箱验证。
2. 用户登录后发布资料、二手物品或兼职信息。
3. 文件通过私有对象存储上传，不经过应用服务器转发大文件。
4. 内容进入草稿、待审核、已发布、拒绝、隐藏等明确状态。
5. 审核员处理内容和举报。
6. 管理员管理用户角色、用户状态、校区设置和审计记录。
7. 用户可收藏内容、举报违规信息、请求查看二手物品联系方式。
8. 所有敏感治理动作保留审计证据。

这意味着系统不仅“能发布”，还具备审核、纠错、隐藏、恢复和追责能力。

### 2.2 权限模型清晰

系统包含三类角色：

| 角色 | 能力 |
| --- | --- |
| `STUDENT` | 浏览内容、发布内容、管理自己的提交、收藏、举报、请求联系方式 |
| `MODERATOR` | 审核内容、处理举报、隐藏或恢复内容 |
| `ADMIN` | 拥有审核能力，并可管理用户、角色、校区设置和审计日志 |

所有权限都在服务端重新验证，不依赖浏览器隐藏按钮来保证安全。每次写操作都会重新解析 Session、校区、角色、所有权和当前业务状态。

### 2.3 校区数据隔离

用户、内容、举报、审计记录和管理操作均带有校区归属。管理员和审核员只能处理自己校区内的数据，避免不同学校之间的数据串读或越权治理。

### 2.4 身份认证设计可靠

- 密码使用 `bcrypt` 哈希保存。
- Session 使用不可预测的随机令牌，数据库只保存令牌哈希。
- Session Cookie 使用 `HttpOnly`、`SameSite` 等安全属性。
- 未验证邮箱不能进入需要可信身份的业务流程。
- 登录、注册、验证和敏感操作具有速率限制。
- 修改用户状态或权限后会撤销相关 Session。

### 2.5 文件上传安全性较强

文件上传采用“数据库意图 + 短时效签名 URL + 完成校验”的模式：

- 浏览器直接上传到 S3/R2/MinIO，应用不承担大文件中转压力。
- 上传 URL 只允许指定对象键、类型和大小，有效期为 5 分钟。
- 使用 `If-None-Match: *` 防止覆盖已有对象。
- 完成上传时再次检查对象键、大小和 MIME 类型。
- 私有文件读取通过短时效签名 URL，不开放公共 Bucket。
- 图片和资料文档采用不同扫描策略。

资料文档必须由外部扫描器回调并标记为 `CLEAN`，之后才能绑定、重提、发布、恢复或下载。`PENDING`、`ERROR`、`INFECTED` 文件均无法绕过门禁。

### 2.6 Web 安全边界完善

- Next.js 16 `proxy.ts` 统一添加安全响应头。
- CSP 使用每次请求生成的 nonce，生产环境不允许 `unsafe-eval`。
- 生产 CSP 不接受本机 HTTP 对象存储地址。
- 写操作使用精确 Origin 校验，防止跨站请求伪造。
- JSON 请求体按实际 UTF-8 字节限制为 64 KiB，并在超限时返回 413。
- 私有页面和敏感响应使用 `no-store`。
- 用户内容以纯文本方式渲染，不使用 `dangerouslySetInnerHTML`。
- 反向代理头只有在明确配置 `TRUST_PROXY=true` 后才会被信任。

### 2.7 审核与审计不是装饰功能

审核操作具备严格状态机和并发冲突保护。例如已被其他审核员处理的记录不能被旧页面重复覆盖。用户角色变化、封禁、恢复、校区配置变化、内容治理和联系方式请求均可进入审计记录。

系统还保护“最后一个有效管理员”，避免误操作导致整个校区失去管理权限。

### 2.8 工程质量可验证

项目包含：

- TypeScript 严格类型检查。
- Prisma Schema 和 11 个前向迁移。
- 305 项单元测试。
- 22 项真实 PostgreSQL/MinIO 集成测试。
- 11 项真实浏览器端到端测试。
- 完整发布命令 `npm run verify:release`。
- GitHub Actions CI。
- 独立运行的 E2E 数据夹具和清理逻辑。
- 数据库备份、事故响应、存储和部署文档。

E2E 测试使用 cookie 哈希定位自己的 Session，并使用运行级主键清理用户、报告、对象和上传记录，能够在并行执行时避免互相删除数据。

### 2.9 与开源项目相比，CampusLink 的定位更聚焦

后续演进可以继续参考 GitHub 上成熟项目的治理思路：

- [Discourse](https://github.com/discourse/discourse)：社区审核、信任等级、举报和运营治理。
- [Moodle](https://github.com/moodle/moodle)：校园身份、课程资源和教育场景中的权限边界。
- [Sharetribe](https://github.com/sharetribe/sharetribe)：双边市场、交易信息和平台运营。
- [OWASP Cheat Sheet Series](https://github.com/OWASP/CheatSheetSeries)：认证、文件上传、会话与部署安全基线。

CampusLink 没有复制这些大型系统的全部功能，而是选择单校区、内容发布和治理闭环作为边界。这种聚焦使当前代码更容易理解、验证和交付；未来要扩展聊天、支付、多校区或推荐系统时，应先重新做威胁建模和数据边界设计，而不是直接把功能堆进现有模块。

## 3. 系统架构

```mermaid
flowchart LR
    Browser[浏览器] -->|HTTPS| Edge[Nginx / CDN / TLS]
    Edge --> Next[Next.js 16 应用]
    Next --> Postgres[(PostgreSQL)]
    Browser -->|签名 PUT| Storage[(S3 / R2 / MinIO 私有 Bucket)]
    Next -->|生成签名 URL、校验对象| Storage
    Next --> SMTP[SMTP 邮件服务]
    Scanner[恶意文件扫描器] -->|带 Bearer Secret 的扫描结果| Next
    Scanner -->|读取待扫描对象| Storage
    Scheduler[定时任务] -->|清理过期上传| Next
```

主要技术：

- Next.js 16 + React 19。
- TypeScript。
- PostgreSQL 16。
- Prisma 7。
- S3 SDK，支持 Cloudflare R2、AWS S3 和 MinIO。
- Playwright + Vitest。
- Nodemailer。
- Tailwind/PostCSS 样式工具链。

## 4. 用户如何使用

### 4.1 普通学生

1. 打开网站首页。
2. 进入“注册”，使用任意有效的普通邮箱创建账号。
3. 打开验证邮件并完成验证；该步骤只证明用户能够控制此邮箱，不代表学生身份认证。
4. 登录后可进入：
   - 资源：查看和发布学习资料。
   - 市集：查看和发布二手物品。
   - 工作：查看和发布兼职机会。
   - 我的提交：查看草稿、待审、拒绝、发布或隐藏状态。
   - Favourites：查看收藏内容。
5. 被拒绝的内容可以编辑后重新提交。
6. 对可疑内容可以举报。
7. 二手物品联系方式只有登录且验证后的用户才能请求查看，该请求会被审计。

### 4.2 审核员

审核员进入 `/admin/moderation` 和 `/admin/reports`：

- 批准或拒绝待审内容。
- 查看审核理由和历史记录。
- 处理举报并按需要隐藏目标内容。
- 对已修正内容执行恢复。

每次操作必须填写理由。

### 4.3 管理员

管理员进入 `/admin`：

- 管理用户角色和状态。
- 暂停或恢复用户。
- 查看校区信息；用户归属由运维配置的默认社区决定，后台不提供邮箱域名准入设置。
- 过滤和查询审计日志。
- 执行审核员拥有的全部治理操作。

## 5. 本地运行

### 5.1 环境要求

- Node.js 22 LTS，最低 `22.12.0`。生产环境不要未经验证直接跨到新的 Node 主版本。
- npm。
- Docker Desktop。
- Git。

### 5.2 启动依赖

在项目目录运行：

```powershell
Copy-Item .env.example .env
docker compose up -d postgres minio minio-init mailpit
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

macOS、Linux 或 Git Bash：

```bash
cp .env.example .env
docker compose up -d postgres minio minio-init mailpit
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

本地服务地址：

| 服务 | 地址 |
| --- | --- |
| CampusLink | `http://127.0.0.1:3000` 或 `.env` 中配置的 `APP_URL` |
| Mailpit | `http://127.0.0.1:8025` |
| MinIO API | `http://127.0.0.1:9000` |
| MinIO Console | `http://127.0.0.1:9001` |
| PostgreSQL | `127.0.0.1:5432` |

必须始终使用同一个主机名访问本地网站。例如 `APP_URL` 为 `http://127.0.0.1:3000` 时，不要又改用 `http://localhost:3000`，否则 Host-only Cookie 可能不会跟随。

### 5.3 本地测试账号

先按照 `.env.example` 的注释配置 `E2E_*` 测试变量，并确保测试数据库名称以 `_test` 或 `_e2e` 结尾。然后执行：

```powershell
$env:ALLOW_DESTRUCTIVE_E2E = "true"
npm run e2e:provision
```

provision 脚本会使用你配置的 `E2E_VERIFIED_EMAIL` 和 `E2E_VERIFIED_PASSWORD`，登录时以这两个值为准。只有在把它们设置成下列示例值时，才可使用：

```text
邮箱：student@campuslink.test
密码：CampusLinkE2E2026!
```

该账号只用于本地测试，禁止复制到生产环境。

### 5.4 验证项目

快速检查：

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

完整发布检查需要测试 PostgreSQL、MinIO 和完整 E2E 环境变量：

```powershell
npm run verify:release
```

破坏性 E2E 只能连接名称以 `_test` 或 `_e2e` 结尾的数据库，并且必须显式设置：

```text
ALLOW_DESTRUCTIVE_E2E=true
```

绝不能对生产数据库设置该变量。

## 6. 生产上线前必须准备的外部资源

项目代码已经完成，但生产环境仍需由部署方准备以下资源：

1. 正式域名、DNS 和 HTTPS 证书。
2. PostgreSQL 16，推荐托管数据库并启用 TLS、自动备份和时间点恢复。
3. 私有 S3 兼容对象存储，推荐 Cloudflare R2 或 AWS S3。
4. 支持证书校验与 TLS 的 SMTP 邮件服务。
5. 独立恶意文件扫描 Worker、消息队列和失败队列。
6. 每 15 分钟调用上传清理接口的定时任务。
7. 集中式密钥管理、监控、告警和异地备份能力。

建议提前创建不同权限的机器身份：

| 身份 | 只授予的权限 |
| --- | --- |
| 应用数据库账号 | 业务表的运行期读取和写入；不授予建表、改表、创建扩展等 DDL 权限 |
| 数据库迁移账号 | 仅发布窗口使用，可执行 Prisma 迁移；不写入应用运行环境 |
| 应用对象存储账号 | 指定私有 Bucket/前缀的 `PutObject`、`GetObject`、`HeadObject`、`DeleteObject` |
| 扫描 Worker 账号 | 待扫描前缀的只读 `GetObject` 和队列消费权限；不授予数据库权限 |
| 备份账号 | 数据库只读备份或云厂商快照权限；与应用账号分离 |

数据库迁移账号必须具备为 `pg_trgm` 执行 `CREATE EXTENSION IF NOT EXISTS` 的权限；托管 PostgreSQL 平台若限制扩展创建，应由 DBA 在发布窗口预先启用该扩展，再由迁移账号继续执行固定名称的索引迁移。应用数据库账号不得获得创建扩展权限。

恶意文件扫描器是学习资料文档生产上线的硬性依赖。仓库已实现扫描回调、状态机和发布门禁，但**没有**内置 ClamAV、队列消费者或第三方扫描引擎。部署 Web 应用不等于扫描链路已经交付；未接入扫描 Worker 时，文档会保持 `PENDING`，不能送审、发布或下载。

## 7. 推荐服务器部署方案

推荐结构：

- Ubuntu 24.04 LTS VPS 或云主机。
- Nginx 负责 HTTPS 和反向代理。
- Node.js 22 LTS，最低 22.12.0，运行 Next.js。
- systemd 管理应用进程。
- 托管 PostgreSQL。
- Cloudflare R2 私有 Bucket。
- 第三方 SMTP。
- 独立扫描 Worker、扫描队列和死信队列。

当前仓库没有 Dockerfile，因此以下方案使用 Node.js + systemd。不要在没有新增、验证 Dockerfile 的情况下直接声称应用已容器化。

全新服务器的线性执行顺序是：安装依赖（7.1）→ 创建用户/目录（7.2）→ 配置 Secret（7.3）→ 构建 release（7.4）→ 安装 systemd/Nginx/TLS（7.5-7.8）→ 按 9.1 执行迁移并原子启用首个版本 → 按第 8 节创建 Campus 和首管 → 接通扫描 Worker（7.9）→ 启用清理 timer（7.10）→ 完成第 11 节验收。章节按主题组织，因此首次部署应以本顺序为准。

### 7.1 安装受支持的系统依赖

```bash
sudo apt update
sudo apt install -y \
  age ca-certificates certbot curl git gnupg jq nginx openssl rclone \
  postgresql-client python3-certbot-nginx ufw unattended-upgrades
```

使用 NodeSource、企业内部镜像或经过审核的二进制安装 Node.js 22 LTS。使用 NodeSource 时先下载并审阅安装脚本，再执行：

```bash
curl --fail --silent --show-error --location \
  --connect-timeout 5 --max-time 30 \
  https://deb.nodesource.com/setup_22.x \
  --output /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
rm -f /tmp/nodesource_setup.sh
```

确认实际二进制路径和版本：

```bash
node --version
command -v node
command -v npm
npm --version
rclone version
```

只支持 Node 22 LTS，且版本不得低于 22.12.0。后文 systemd 示例假设 `command -v npm` 返回 `/usr/bin/npm`；若不同，必须把单元文件中的路径改成实际绝对路径。

上线前还要完成主机基线：创建使用 SSH Key 的非 root sudo 管理员；在确认第二个 SSH 会话可登录后禁用 root/密码远程登录；启用安全更新；云安全组或 UFW 默认拒绝入站，只允许受控管理网段访问 SSH，并只开放 80/443。不得把 3000、5432、9000 或 9001 暴露到公网。若使用 Cloudflare，第 7.7 节会进一步把 80/443 限制为 Cloudflare 官方网段。启用防火墙前必须核对云厂商控制台救援方式，避免把自己锁在服务器外。

### 7.2 创建隔离的系统用户和版本目录

首次部署执行：

```bash
getent group campuslink >/dev/null || sudo groupadd --system campuslink
getent group campuslink-build >/dev/null || sudo groupadd --system campuslink-build

id -u campuslink >/dev/null 2>&1 || sudo useradd \
  --system --gid campuslink --create-home \
  --home-dir /var/lib/campuslink --shell /usr/sbin/nologin campuslink

id -u campuslink-build >/dev/null 2>&1 || sudo useradd \
  --system --gid campuslink-build --groups campuslink --create-home \
  --home-dir /var/lib/campuslink-build \
  --shell /usr/sbin/nologin campuslink-build

id -u campuslink-migrate >/dev/null 2>&1 || sudo useradd \
  --system --gid campuslink --create-home \
  --home-dir /var/lib/campuslink-migrate \
  --shell /usr/sbin/nologin campuslink-migrate

sudo install -d -o root -g campuslink -m 0750 /srv/campuslink
sudo install -d -o root -g campuslink -m 0750 /srv/campuslink/releases
sudo install -d -o campuslink -g campuslink -m 0750 /var/cache/campuslink/next
sudo install -d -o root -g root -m 0700 /etc/campuslink
sudo install -d -o root -g root -m 0700 /var/backups/campuslink
sudo install -d -o root -g www-data -m 0750 /var/lib/campuslink-edge
```

正式版本放在 `/srv/campuslink/releases/<UTC时间>-<提交SHA>`。`campuslink-build` 只负责离线构建，`campuslink-migrate` 只负责迁移，`campuslink` 只负责运行。`/srv/campuslink/current` 和 `/srv/campuslink/previous` 由 root 管理且只作为软链接，绝不直接在 `current` 目录里执行 `git pull`、覆盖文件或构建。

### 7.3 配置环境变量和最小权限凭据

创建 `/etc/campuslink/campuslink.env`：

```dotenv
NODE_ENV=production
APP_URL=https://campus.example.edu
NEXT_PUBLIC_APP_URL=https://campus.example.edu
DEFAULT_CAMPUS_SLUG=campuslink
TRUST_PROXY=true

DATABASE_URL=postgresql://campuslink_app:URL_ENCODED_PASSWORD@DB_HOST:5432/campuslink?sslmode=verify-full

S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=REPLACE_ME
S3_SECRET_ACCESS_KEY=REPLACE_ME
S3_BUCKET=campuslink-production
S3_FORCE_PATH_STYLE=false

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=REPLACE_ME
SMTP_PASSWORD=REPLACE_ME
MAIL_FROM="CampusLink <noreply@example.edu>"

UPLOAD_CLEANUP_SECRET=REPLACE_WITH_RANDOM_32_PLUS_CHARACTERS
UPLOAD_SCANNER_CALLBACK_SECRET=REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET
```

任意符合格式的邮箱都可以请求注册，邮箱验证只证明用户能够控制该邮箱。运行时会把新用户分配给 `slug` 与 `DEFAULT_CAMPUS_SLUG` 一致且处于启用状态的 Campus；如果没有匹配的启用 Campus，注册接口仍返回防止账号枚举的统一确认信息，但不会创建用户。数据库 URL 中的用户名和密码必须按 URL userinfo 规则编码，尤其要编码 `@`、`:`、`/`、`?`、`#` 和 `%`。

创建只供迁移任务读取的 `/etc/campuslink/migration.env`：

```dotenv
DATABASE_URL=postgresql://campuslink_migrate:URL_ENCODED_PASSWORD@DB_HOST:5432/campuslink?sslmode=verify-full
```

创建 `/etc/campuslink/build.env`。它只提供构建期校验需要的公开配置和不可用占位值，绝不能包含生产数据库、存储、SMTP 或回调 Secret：

```dotenv
NODE_ENV=production
APP_URL=https://campus.example.edu
NEXT_PUBLIC_APP_URL=https://campus.example.edu
DEFAULT_CAMPUS_SLUG=campuslink
TRUST_PROXY=true

DATABASE_URL=postgresql://build_only:build_only@127.0.0.1:5432/campuslink_build?sslmode=require

S3_ENDPOINT=https://storage.invalid
S3_REGION=auto
S3_ACCESS_KEY_ID=build-only
S3_SECRET_ACCESS_KEY=build-only-not-a-real-secret
S3_BUCKET=build-only
S3_FORCE_PATH_STYLE=false

SMTP_HOST=smtp.invalid
SMTP_PORT=587
SMTP_USER=build-only
SMTP_PASSWORD=build-only-not-a-real-secret
MAIL_FROM="CampusLink <noreply@example.edu>"

UPLOAD_CLEANUP_SECRET=build-only-cleanup-000000000000000000000000
UPLOAD_SCANNER_CALLBACK_SECRET=build-only-scanner-000000000000000000000000
```

保留的 `.invalid` 域和不存在的本机数据库使意外外连快速失败。如果新代码在 `next build` 期间尝试访问数据库、存储或 SMTP，构建应失败并接受审查，而不是获得生产凭据。

数据库角色由 DBA 或托管数据库控制台在首次迁移前创建。下面的默认权限确保以后由迁移账号创建的新表也会自动授权给应用账号：

```sql
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campuslink_app') THEN
    CREATE ROLE campuslink_app LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'campuslink_migrate') THEN
    CREATE ROLE campuslink_migrate LOGIN
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$roles$;

REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE campuslink FROM PUBLIC;
GRANT CONNECT ON DATABASE campuslink TO campuslink_app;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE campuslink TO campuslink_migrate;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO campuslink_app;
GRANT USAGE, CREATE ON SCHEMA public TO campuslink_migrate;

ALTER DEFAULT PRIVILEGES FOR ROLE campuslink_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO campuslink_app;
ALTER DEFAULT PRIVILEGES FOR ROLE campuslink_migrate IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO campuslink_app;
```

通过 `psql` 的交互式 `\password campuslink_app` 和 `\password campuslink_migrate` 或云厂商 Secret 界面设置不同随机密码，不要把密码放进 SQL 文件。首次迁移后补齐现有对象并撤销应用对 Prisma 迁移表的访问：

```sql
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO campuslink_app;
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public TO campuslink_app;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM campuslink_app;
```

所有 schema 对象应持续由 `campuslink_migrate` 拥有。若数据库已经由其他角色完成迁移，应由 DBA 审核并转移对象所有权，不能只补 `GRANT` 后假设后续 `ALTER TABLE` 会成功。

生成两个不同的机器密钥：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

设置权限：

```bash
sudo chown root:root /etc/campuslink/campuslink.env
sudo chmod 600 /etc/campuslink/campuslink.env
sudo chown root:root /etc/campuslink/migration.env
sudo chmod 600 /etc/campuslink/migration.env
sudo chown root:root /etc/campuslink/build.env
sudo chmod 600 /etc/campuslink/build.env
```

不要在 Bash 中 `source /etc/campuslink/campuslink.env`。该文件采用 systemd `EnvironmentFile` 语法，且包含引号和可能有特殊字符的密码；只让 systemd 加载它。SMTP 端口 465 使用隐式 TLS，其他端口由代码强制 STARTTLS；同时要验证 SMTP 服务端证书，并为发件域名配置 SPF、DKIM 和 DMARC。

`Campus.allowedEmailDomain` 是可空的遗留兼容字段，不参与注册准入；管理后台不提供该字段的编辑入口。切换默认社区属于运维配置变更：先确认目标 Campus 已启用且 `slug` 唯一匹配新值，再更新 root-only 环境文件中的 `DEFAULT_CAMPUS_SLUG`、重启应用并用普通邮箱完成注册验证，同时保留变更和验证记录。该操作改变用户归属社区，不会限制可注册的邮箱域名。

### 7.4 在非在线目录构建版本并固化发布证据

以下示例从一个已审核的 Git 引用创建版本目录；私有仓库应使用只读部署凭据，且不要把凭据写进命令历史：

```bash
export REPOSITORY_URL=https://github.com/your-org/campuslink.git
export RELEASE_REF=v1.0.0
export STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export STAGING_DIR="/srv/campuslink/releases/.staging-${STAMP}"

sudo install -d -o campuslink-build -g campuslink -m 2750 "$STAGING_DIR"
sudo -u campuslink-build git clone --no-checkout \
  "$REPOSITORY_URL" "$STAGING_DIR"
sudo -u campuslink-build git -C "$STAGING_DIR" \
  checkout --detach "$RELEASE_REF"

export COMMIT_SHA="$(sudo -u campuslink-build git -C "$STAGING_DIR" rev-parse HEAD)"
export RELEASE_DIR="/srv/campuslink/releases/${STAMP}-${COMMIT_SHA:0:12}"
sudo mv "$STAGING_DIR" "$RELEASE_DIR"

export NPM_BIN="$(command -v npm)"
sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" ci
```

`prisma generate` 加载 `prisma.config.ts` 时必须存在 `DATABASE_URL`。用 transient systemd unit 注入 build-only 环境，不读取生产凭据：

```bash
sudo systemd-run --wait --collect \
  --unit="campuslink-generate-${STAMP}" \
  --uid=campuslink-build --gid=campuslink-build \
  --property="SupplementaryGroups=campuslink" \
  --property="WorkingDirectory=${RELEASE_DIR}" \
  --property="EnvironmentFile=/etc/campuslink/build.env" \
  "$NPM_BIN" run db:generate

sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" run format:check
sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" run lint
sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" run typecheck
sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" run test:unit
```

生产构建用 transient systemd unit 读取环境文件，避免在 shell 里解析或展开 Secret：

```bash
sudo systemd-run --wait --collect \
  --unit="campuslink-build-${STAMP}" \
  --uid=campuslink-build --gid=campuslink-build \
  --property="SupplementaryGroups=campuslink" \
  --property="WorkingDirectory=${RELEASE_DIR}" \
  --property="EnvironmentFile=/etc/campuslink/build.env" \
  "$NPM_BIN" run build
```

每个发布必须绑定以下证据，并把副本存到发布系统或异地审计存储：

- Git tag/Commit SHA，以及 tag 签名或评审记录。
- Node、npm、PostgreSQL 客户端版本和实际数据库主版本。
- 对象存储供应商/区域及 MinIO 版本（如使用 MinIO）。
- `package-lock.json` 的 SHA-256。
- `npm run verify:release` 的完整日志和成功时间。
- 数据库迁移目录清单、变更单号和批准人。

可在版本目录生成基础证据文件：

```bash
{
  echo "release_ref=${RELEASE_REF}"
  echo "commit_sha=${COMMIT_SHA}"
  node --version
  npm --version
  psql --version
  sha256sum "${RELEASE_DIR}/package-lock.json"
} | sudo -u campuslink-build tee "${RELEASE_DIR}/release-evidence.txt" >/dev/null
```

完整集成和 E2E 验证应在 CI 或隔离的预发布数据库/Bucket 上执行。绝不能让 E2E 连接生产数据库，也不能在生产设置 `ALLOW_DESTRUCTIVE_E2E=true`。此时 release 仍由构建用户拥有，但尚未在线；第 9.1 节会在迁移完成、devDependencies 裁剪后把它固化为 root 只读，固化前禁止切换 `current`。

### 7.5 创建 systemd 服务

创建 `/etc/systemd/system/campuslink.service`：

```ini
[Unit]
Description=CampusLink Next.js application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=campuslink
Group=campuslink
WorkingDirectory=/srv/campuslink/current
EnvironmentFile=/etc/campuslink/campuslink.env
ExecStart=/usr/bin/npm start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5
TimeoutStopSec=30
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/cache/campuslink /var/lib/campuslink
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
```

确认 `ExecStart` 中的 npm 路径与 `command -v npm` 一致。先加载并设为开机启动；首次发布切换 `current` 软链接后再启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable campuslink
sudo systemctl status campuslink --no-pager
```

不要在顺序部署命令中使用会一直阻塞的 `journalctl -f`。检查最近日志使用：

```bash
sudo journalctl -u campuslink -n 100 --no-pager
```

### 7.6 先启用 HTTP，再申请证书，最后切换 TLS

先确认正式域名已解析到服务器。创建 HTTP-only 的 `/etc/nginx/sites-available/campuslink`：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name campus.example.edu;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

幂等启用并检查：

```bash
sudo ln -sfnT /etc/nginx/sites-available/campuslink \
  /etc/nginx/sites-enabled/campuslink
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
curl --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  http://campus.example.edu/
```

此时若应用尚未首次启动，Nginx 可能返回 502，但 DNS 和 Nginx 必须已经可达。之后申请证书：

```bash
sudo certbot --nginx -d campus.example.edu
sudo systemctl status certbot.timer --no-pager
```

证书存在后，将站点整理为最终 TLS 配置。下面的证书路径必须与 Certbot 实际输出一致：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name campus.example.edu;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name campus.example.edu;

    ssl_certificate /etc/letsencrypt/live/campus.example.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/campus.example.edu/privkey.pem;

    client_max_body_size 1m;

    # 紧急维护时由 root 创建该文件以冻结所有写入；恢复前删除并 reload。
    if (-f /var/lib/campuslink-edge/maintenance) {
        return 503;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

检查配置并重载：

```bash
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  https://campus.example.edu/auth/sign-in
```

Nginx 明确覆盖 `X-Forwarded-For`，因此应用可以设置 `TRUST_PROXY=true`。不要把客户端传入的同名请求头原样追加给应用。

确认所有子域都已支持 HTTPS 后，再在可信边缘增加 HSTS。不要覆盖或删除应用返回的 CSP、`no-store`、`nosniff`、Referrer Policy 等安全响应头。

### 7.7 Cloudflare 场景下恢复真实客户端 IP

若域名前面没有 Cloudflare，跳过本节。若使用 Cloudflare：

1. 从 Cloudflare 官方 IP 列表生成 `/etc/nginx/conf.d/cloudflare-realip.conf`，为每个 IPv4/IPv6 网段写入 `set_real_ip_from`。
2. 配置：

```nginx
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

3. 云防火墙/安全组只允许 Cloudflare 官方网段访问源站 80/443，禁止公网绕过 Cloudflare 直连源站。
4. 官方网段变化时自动更新配置，更新后必须执行 `nginx -t` 再 reload。
5. 从两个不同公网出口访问并检查应用/边缘日志，确认记录的是终端客户端 IP，而不是 Cloudflare 节点 IP；同时验证直连源站被拒绝。

只有完成这些约束后，Cloudflare 场景才可以继续使用 `TRUST_PROXY=true`。否则限速和安全审计可能记录错误来源 IP。

### 7.8 配置 Cloudflare R2 CORS

Bucket 必须保持私有。CORS 只允许正式网站 Origin：

```json
[
  {
    "AllowedOrigins": ["https://campus.example.edu"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

不要把 `S3_ACCESS_KEY_ID` 或 `S3_SECRET_ACCESS_KEY` 放进 `NEXT_PUBLIC_*` 变量。

### 7.9 接入恶意文件扫描器

再次强调：仓库没有扫描 Worker。生产级参考链路应为：

```text
S3/R2 对象创建事件
  -> 持久消息队列
  -> 隔离的扫描 Worker
  -> GetObject 流式下载、恶意文件扫描、SHA-256
  -> CampusLink 扫描回调
  -> 成功确认消息；失败重试或进入死信队列
```

对象键由真实代码 `lib/storage/keys.ts` 生成：

```text
campus/{ownerId}/{assetId}.{extension}
```

当前资料文档扩展名为 `pdf`、`docx`、`pptx`、`xlsx` 或 `zip`。Worker 应从经过 URL 解码和规范化的对象键中严格解析 `assetId`，拒绝不符合该结构的键，不能信任用户文件名。然后：

1. 使用只读存储凭据流式 `GetObject`，不落入 Web 应用服务器。
2. 在隔离容器/虚拟机中扫描，限制 CPU、内存、临时磁盘、解压层数和总解压大小，防止压缩炸弹。
3. 在同一字节流上计算 SHA-256，扫描引擎更新失败时返回 `ERROR`，不能返回 `CLEAN`。
4. 调用：

```http
POST https://campus.example.edu/api/internal/uploads/scan-result
Authorization: Bearer <UPLOAD_SCANNER_CALLBACK_SECRET>
Content-Type: application/json

{"assetId":"...","verdict":"CLEAN|INFECTED|ERROR","sha256":"64位十六进制"}
```

回调行为和重试规则：

- `CLEAN`/`INFECTED` 回调返回 2xx：记录成功并确认队列消息。
- `ERROR` 回调返回 2xx：只表示 CampusLink 已记录本次失败。Worker 不能永久确认原消息；应延迟重新入队或让消息在可见性超时后重投。后续扫描可从 `ERROR` 转为最终状态，达到最大尝试次数后才进入死信队列。
- 网络错误或 5xx：指数退避重试，使用随机抖动，并设置最大次数。
- 400/401/404：进入死信队列并立即报警，不要无限重试。
- 409：表示资产状态已变化或重复回调。当前回调不是“重复 CLEAN 仍返回 2xx”的完全幂等接口；应进入对账流程，不能直接当作扫描成功或继续无限重试。
- `ERROR` 状态允许重新扫描后再提交最终结果；绝不能由人工直接改数据库为 `CLEAN`。
- `INFECTED` 会先在数据库中拒绝资产，再尝试删除对象。当前应用会吞掉首次删除异常以保证回调不暴露对象，因此没有直接的“首次删除失败”指标；Worker 应在回调后延迟执行 `HeadObject` 对账，清理任务的 `failed` 也必须报警，直到确认对象不存在。

队列可见性超时必须长于最大扫描时间，消息以 `assetId + 对象版本/ETag` 作为 Worker 去重键。Bucket 始终保持私有，`PENDING`/`ERROR`/`INFECTED` 对象处于逻辑隔离状态。若学校政策要求保留恶意样本，应复制到独立取证存储并使用单独权限，不能把应用 Bucket 直接开放给分析人员。

至少监控：队列最老消息年龄、`PENDING` 超过 10 分钟数量、`ERROR` 数量、死信队列深度、回调 4xx/5xx、扫描引擎签名更新时间和感染对象删除失败数。

### 7.10 配置过期上传清理

创建 `/usr/local/sbin/campuslink-upload-cleanup`，脚本不读取也不 `source` 环境文件，只使用 systemd 注入的变量：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

: "${UPLOAD_CLEANUP_SECRET:?UPLOAD_CLEANUP_SECRET is required}"

response="$(curl \
  --fail-with-body --silent --show-error \
  --connect-timeout 5 --max-time 45 \
  --retry 3 --retry-delay 2 --retry-all-errors \
  --request POST \
  --header "Authorization: Bearer ${UPLOAD_CLEANUP_SECRET}" \
  https://campus.example.edu/api/internal/uploads/cleanup)"

failed="$(jq -er '.failed // 0' <<<"$response")"
printf '%s\n' "$response"
if [[ "$failed" != "0" ]]; then
  exit 1
fi
```

```bash
sudo chown root:root /usr/local/sbin/campuslink-upload-cleanup
sudo chmod 755 /usr/local/sbin/campuslink-upload-cleanup
```

创建 `/etc/systemd/system/campuslink-upload-cleanup.service`：

```ini
[Unit]
Description=Clean expired CampusLink uploads
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=campuslink
Group=campuslink
EnvironmentFile=/etc/campuslink/campuslink.env
RuntimeDirectory=campuslink
RuntimeDirectoryMode=0750
ExecStart=/usr/bin/flock --nonblock /run/campuslink/upload-cleanup.lock /usr/local/sbin/campuslink-upload-cleanup
TimeoutStartSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
```

创建 `/etc/systemd/system/campuslink-upload-cleanup.timer`：

```ini
[Unit]
Description=Run CampusLink upload cleanup every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min
RandomizedDelaySec=30s
Persistent=true
Unit=campuslink-upload-cleanup.service

[Install]
WantedBy=timers.target
```

只在第 9.1 节已经成功启用应用、源站健康检查通过后，才启用并立即测试：

```bash
sudo systemctl daemon-reload
sudo systemctl start campuslink-upload-cleanup.service
sudo systemctl enable --now campuslink-upload-cleanup.timer
sudo systemctl status campuslink-upload-cleanup.timer --no-pager
sudo journalctl -u campuslink-upload-cleanup.service -n 50 --no-pager
```

监控系统必须对 service 失败、持续非 2xx 或响应中的 `failed` 非零告警。`flock` 和 systemd 单元共同阻止任务并发重入。

## 8. 首个生产管理员如何建立

不要在生产运行开发 Seed，也不要直接插入带明文或临时密码的管理员。注册逻辑在创建用户前会查找 `slug` 与 `DEFAULT_CAMPUS_SLUG` 匹配的启用 Campus，因此初始化顺序必须是“创建启用的默认 Campus → 使用任意普通邮箱注册 → 完成邮箱验证 → 提升管理员”。所有 SQL 使用数据库迁移账号或云厂商受审计控制台执行，应用数据库账号不应拥有这些权限。

本节的前置条件是 11 个 Prisma 迁移已经成功执行。全新部署应先完成第 7.4 节，并按第 9.1 节执行迁移、切换 `current` 和启动应用；首次业务烟雾测试可以等首管创建完成后再补做，然后回到本节。

### 8.1 在开放注册前创建首个 Campus

先确认 `/etc/campuslink/campuslink.env` 中：

```dotenv
DEFAULT_CAMPUS_SLUG=campuslink
```

在变更单中记录真实执行人和工单号，替换下列占位符后执行：

```sql
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO "Campus" (
  "id", "slug", "name", "allowedEmailDomain",
  "isActive", "createdAt", "updatedAt"
) VALUES (
  'campus-prod-campuslink-001',
  'campuslink',
  '西大同学 CampusLink',
  NULL,
  true,
  now(),
  now()
);

INSERT INTO "AuditLog" (
  "id", "campusId", "actorId", "action",
  "subjectType", "subjectId", "details", "createdAt"
) VALUES (
  'bootstrap_' || md5(random()::text || clock_timestamp()::text),
  'campus-prod-campuslink-001',
  NULL,
  'BOOTSTRAP_CAMPUS_CREATED',
  'CAMPUS',
  'campus-prod-campuslink-001',
  jsonb_build_object(
    'performedBy', 'REPLACE_WITH_OPERATOR_ID',
    'changeTicket', 'REPLACE_WITH_TICKET_ID',
    'defaultCampusSlug', 'campuslink'
  ),
  now()
);

COMMIT;
```

该插入故意不是 `ON CONFLICT DO NOTHING`：如果 ID 或 slug 已经存在，应中止并人工核对，不能静默跳过。确认查询只返回一个启用的 Campus，且其 `slug` 与环境变量完全一致；遗留字段 `allowedEmailDomain` 应为 `NULL`：

```sql
SELECT "id", "slug", "name", "allowedEmailDomain", "isActive"
FROM "Campus"
WHERE "slug" = 'campuslink' AND "isActive" = true;
```

### 8.2 注册、验证并严格提升一个账号

1. 启动应用。
2. 管理员本人通过正式页面使用普通邮箱 `admin@example.com` 注册。
3. 管理员本人打开验证邮件、设置符合规则的密码并完成验证。
4. 运维确认该账号状态为 `ACTIVE`、`emailVerifiedAt` 非空、`passwordHash` 非空。
5. 替换下列邮箱、执行人和工单号，在一个事务中严格提升账号、撤销全部旧 Session 并写入审计记录：

```sql
\set ON_ERROR_STOP on
BEGIN;

DO $bootstrap$
DECLARE
  target_user_id text;
  target_campus_id text;
BEGIN
  SELECT "id", "campusId"
  INTO STRICT target_user_id, target_campus_id
  FROM "User"
  WHERE lower("email") = lower('admin@example.com')
    AND "status" = 'ACTIVE'
    AND "emailVerifiedAt" IS NOT NULL
    AND "passwordHash" IS NOT NULL
  FOR UPDATE;

  UPDATE "User"
  SET "role" = 'ADMIN', "status" = 'ACTIVE', "updatedAt" = now()
  WHERE "id" = target_user_id;

  DELETE FROM "Session"
  WHERE "userId" = target_user_id;

  INSERT INTO "AuditLog" (
    "id", "campusId", "actorId", "action",
    "subjectType", "subjectId", "details", "createdAt"
  ) VALUES (
    'bootstrap_' || md5(random()::text || clock_timestamp()::text),
    target_campus_id,
    NULL,
    'BOOTSTRAP_ADMIN_GRANTED',
    'USER',
    target_user_id,
    jsonb_build_object(
      'performedBy', 'REPLACE_WITH_OPERATOR_ID',
      'changeTicket', 'REPLACE_WITH_TICKET_ID',
      'email', 'admin@example.com',
      'sessionsRevoked', true
    ),
    now()
  );
END
$bootstrap$;

COMMIT;
```

`INTO STRICT` 会在匹配不到账号或匹配多条时让事务失败，不会出现“SQL 执行成功但没有提升任何人”。执行后检查：

```sql
SELECT "id", "campusId", "email", "role", "status", "emailVerifiedAt"
FROM "User"
WHERE lower("email") = lower('admin@example.com');

SELECT count(*) AS active_sessions
FROM "Session"
WHERE "userId" = (
  SELECT "id" FROM "User"
  WHERE lower("email") = lower('admin@example.com')
);
```

确认只有目标账号成为管理员、Session 数为 0、两条 bootstrap 审计记录存在。管理员重新登录后，后续角色管理必须通过后台完成。首管初始化 SQL、数据库审计日志和外部变更单应作为同一份交付证据保存。

## 9. 发布升级流程

### 9.1 正常发布

每次发布先完成第 7.4 节的版本构建和证据固化，再执行：

1. 确认 Commit、锁文件哈希和 `verify:release` 日志一致。
2. 确认新迁移采用 expand/contract 设计：先新增兼容字段/表，再发布兼容代码，最后在后续版本删除旧结构。
3. 创建命名数据库快照或确认 PITR 连续可用，并记录时间点。
4. 对不兼容迁移或明确要求停写的变更，先由 root 创建维护标记、reload Nginx，并验证公网返回 503：

```bash
sudo install -o root -g www-data -m 0640 /dev/null \
  /var/lib/campuslink-edge/maintenance
sudo nginx -t
sudo systemctl reload nginx
curl --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  https://campus.example.edu/
```

预期 HTTP 状态为 503。但维护页只会拒绝新请求，不会自动回滚已经进入应用的事务。若本次变更要求真正停写，还必须暂停外部扫描队列消费者，并执行：

```bash
sudo systemctl stop campuslink-upload-cleanup.timer
sudo systemctl stop campuslink-upload-cleanup.service
sudo systemctl stop campuslink
sudo systemctl is-active --quiet campuslink && exit 1 || true
```

等待应用优雅退出后，由 DBA 在数据库控制台检查：

```sql
SELECT pid, state, "xact_start", query
FROM pg_stat_activity
WHERE usename = 'campuslink_app'
  AND "xact_start" IS NOT NULL;
```

结果必须为 0 行。仍有事务时先判断能否安全等待；只有事故负责人批准后才能使用 `pg_terminate_backend`。完成“新请求 503、扫描消费暂停、清理停止、应用停止、数据库无在途事务”五项后，才算真正冻结写入。

如果本次维护还要求数据库与对象存储保持同一快照时间点，必须额外冻结 Bucket 写入。已签发的直传 URL 有效期为 5 分钟，浏览器不经过 Nginx 就能直接 `PutObject`。首选在 Bucket/IAM 临时添加只针对应用上传主体和 `campus/*` 前缀的显式 `Deny PutObject`，并用维护前签发的 URL 验证返回 403；若供应商无法临时拒绝，则至少等待所有签名 URL 过期和在途上传结束，并从对象存储访问日志确认不再出现新 PUT。记录最终对象清单和时间戳后，才算数据库与对象同时冻结。

5. 使用独立迁移账号执行迁移：

```bash
set -Eeuo pipefail
export RELEASE_DIR=/srv/campuslink/releases/REPLACE_WITH_RELEASE
export RELEASE_ID="$(basename "$RELEASE_DIR")"
export NPM_BIN="$(command -v npm)"
: "${RELEASE_DIR:?}" "${RELEASE_ID:?}" "${NPM_BIN:?}"
sudo test -f "$RELEASE_DIR/package.json"

sudo systemd-run --wait --collect \
  --unit="campuslink-migrate-${RELEASE_ID}" \
  --uid=campuslink-migrate --gid=campuslink \
  --property="WorkingDirectory=${RELEASE_DIR}" \
  --property="EnvironmentFile=/etc/campuslink/migration.env" \
  "$NPM_BIN" run db:migrate:deploy

sudo -u campuslink-build "$NPM_BIN" --prefix "$RELEASE_DIR" \
  prune --omit=dev

resolved_release="$(readlink -f "$RELEASE_DIR")"
case "$resolved_release" in
  /srv/campuslink/releases/*) ;;
  *)
    echo "Invalid release path: $resolved_release" >&2
    exit 1
    ;;
esac

sudo rm -rf -- "$resolved_release/.next/cache"
sudo chown -R root:campuslink "$resolved_release"
sudo chmod -R u=rwX,g=rX,o= "$resolved_release"

sudo install -d -o campuslink -g campuslink -m 0750 \
  "/var/cache/campuslink/${RELEASE_ID}/next"
sudo ln -sfnT "/var/cache/campuslink/${RELEASE_ID}/next" \
  "$resolved_release/.next/cache"
```

`20260713180000_add_user_governance_indexes` 必须保持非事务，不能在 migration 中加入 `BEGIN`/`COMMIT`。它使用 `CREATE INDEX CONCURRENTLY`，不会阻塞 `User` 表的常规 `INSERT`、`UPDATE`、`DELETE`，但索引构建仍会消耗磁盘与 I/O；发布期间必须监控 `pg_stat_progress_create_index`、数据库磁盘余量、I/O 延迟和复制延迟。

如果该 migration 失败，不要在还有索引构建活动时重试。先用 `pg_stat_progress_create_index` 和 `pg_stat_activity` 确认没有仍在运行的 create-index 进程，再在同一个已审核 release、同一个迁移账号环境中执行 `prisma migrate resolve --rolled-back 20260713180000_add_user_governance_indexes`，然后重新运行 `npm run db:migrate:deploy`。重跑时 migration 只会清理它自己的三个 partial/invalid 索引：`User_campus_createdAt_id_idx`、`User_name_trgm_idx`、`User_email_trgm_idx`，随后重新并发创建；不得在生产手工删除其他索引。若实际数据库状态与这个白名单不一致，应停止发布并交由 DBA 审核。

这一步把 release 固化为 `root:campuslink`，运行用户只有读取/执行权限；唯一可写位置是独立的版本缓存目录。固化后禁止再运行 `npm install`、构建或直接修改文件，任何改动都必须生成新 release。

6. 原子切换版本并启动：

```bash
for link in /srv/campuslink/current /srv/campuslink/previous; do
  if [ -e "$link" ] && [ ! -L "$link" ]; then
    echo "Refusing to replace non-symlink path: $link" >&2
    exit 1
  fi
done

if [ -L /srv/campuslink/current ]; then
  sudo ln -sfnT "$(readlink -f /srv/campuslink/current)" \
    /srv/campuslink/previous
fi

sudo ln -sfnT "$RELEASE_DIR" /srv/campuslink/current
sudo systemctl restart campuslink
sudo systemctl is-active --quiet campuslink
```

7. 先检查源站和日志；只有未启用维护模式时才立即检查公网：

```bash
curl --fail --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  http://127.0.0.1:3000/auth/sign-in

if [ ! -e /var/lib/campuslink-edge/maintenance ]; then
  curl --fail --silent --show-error --head \
    --connect-timeout 5 --max-time 15 \
    https://campus.example.edu/auth/sign-in
fi

sudo journalctl -u campuslink -n 100 --no-pager
```

当前仓库没有专用 `/health` 或 `/ready` 路由，因此 `/auth/sign-in` 只能作为弱健康检查。启用维护模式时，公网预期仍为 503，不能在删除维护标记前把公网 curl 失败误判成应用失败。

8. 若使用维护模式，源站检查通过后先撤销临时 `Deny PutObject` 并确认应用存储凭据恢复可用，再删除维护文件并 reload，完成公网和业务验证，最后恢复清理 timer 和外部扫描消费者：

```bash
sudo rm -f /var/lib/campuslink-edge/maintenance
sudo nginx -t
sudo systemctl reload nginx

curl --fail --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  https://campus.example.edu/auth/sign-in

# 人工或受控烟雾测试：登录、校区隔离、上传/扫描、审核和后台权限。
sudo systemctl start campuslink-upload-cleanup.timer
# 在队列平台恢复扫描消费者，并观察 5xx、积压和死信队列。
```

未使用维护模式时，也必须在第 7 步公网检查后执行同一组业务烟雾测试。

9. 观察应用错误率、数据库、扫描队列、死信队列和清理任务。稳定观察期结束后再清理旧版本，至少保留 `current`、`previous` 和一个更早版本。

### 9.2 代码回滚与数据库灾难恢复必须分开

**代码回滚**只在数据库迁移对旧代码仍然兼容时执行：

```bash
set -Eeuo pipefail
export ORIGINAL_RELEASE="$(readlink -f /srv/campuslink/current)"
export PREVIOUS_RELEASE="$(readlink -f /srv/campuslink/previous)"

if [ -z "$ORIGINAL_RELEASE" ] || [ ! -d "$ORIGINAL_RELEASE" ] \
  || [ -z "$PREVIOUS_RELEASE" ] || [ ! -d "$PREVIOUS_RELEASE" ]; then
  echo "Current or previous release is unavailable" >&2
  exit 1
fi

sudo install -o root -g www-data -m 0640 /dev/null \
  /var/lib/campuslink-edge/maintenance
sudo nginx -t
sudo systemctl reload nginx

sudo ln -sfnT "$PREVIOUS_RELEASE" /srv/campuslink/current
sudo systemctl restart campuslink

if ! sudo systemctl is-active --quiet campuslink \
  || ! curl --fail --silent --show-error --head \
      --connect-timeout 5 --max-time 15 \
      --retry 5 --retry-delay 2 --retry-all-errors \
      http://127.0.0.1:3000/auth/sign-in; then
  sudo ln -sfnT "$ORIGINAL_RELEASE" /srv/campuslink/current
  sudo systemctl restart campuslink
  sudo journalctl -u campuslink -n 100 --no-pager
  echo "Rollback candidate failed; original release restored and maintenance remains enabled" >&2
  exit 1
fi

sudo rm -f /var/lib/campuslink-edge/maintenance
sudo nginx -t
sudo systemctl reload nginx

if ! curl --fail --silent --show-error --head \
  --connect-timeout 5 --max-time 15 \
  --retry 5 --retry-delay 2 --retry-all-errors \
  https://campus.example.edu/auth/sign-in; then
  sudo install -o root -g www-data -m 0640 /dev/null \
    /var/lib/campuslink-edge/maintenance
  sudo systemctl reload nginx
  sudo ln -sfnT "$ORIGINAL_RELEASE" /srv/campuslink/current
  sudo systemctl restart campuslink
  sudo journalctl -u campuslink -n 100 --no-pager
  echo "Public rollback check failed; original release restored and maintenance re-enabled" >&2
  exit 1
fi

sudo ln -sfnT "$ORIGINAL_RELEASE" /srv/campuslink/previous
sudo journalctl -u campuslink -n 100 --no-pager
```

上述检查通过后仍要执行登录、校区隔离、上传/扫描和后台权限的受控烟雾测试。`systemctl is-active` 单独不能证明稳定，因为 `Restart=always` 下崩溃循环可能短暂显示 active；必须同时依赖重复 HTTP 检查、日志和业务验证。若恢复原版本也失败，保持维护模式并进入数据库/依赖事故流程，不要反复切换链接。

如果迁移删除/改名了旧代码仍需要的结构，不能只切回旧 Commit。Prisma 迁移是前向迁移，项目没有可安全通用执行的 down migration。

**数据库灾难恢复**适用于破坏性迁移、数据误写或数据库损坏：

1. 立即按第 9.1 节第 4 步完成真正停写：维护页 503、暂停扫描消费者、停止清理 timer、停止应用，并确认 `campuslink_app` 没有在途数据库事务。事故涉及对象一致性时还要拒绝 `PutObject` 或等待签名 URL/在途上传结束并核对访问日志。只创建维护文件不算冻结完成；让外部队列保留消息并重试。
2. 保存应用、Nginx、数据库、队列和对象存储日志，记录最后可信写入时间和事故时间线。
3. 选择 PITR 时间点时评估发布后已经发生的合法写入。绝不能在已有新写入后盲目恢复“发布前快照”，否则会静默丢失用户数据。
4. 恢复到一个新的隔离数据库实例，验证后再切换 `DATABASE_URL`；不要直接覆盖在线生产库。
5. 在恢复库开放前删除全部 `Session` 和 `VerificationToken`，强制所有用户重新登录/重新发起验证；对照外部事故记录复核管理员、角色、封禁状态和邮箱验证状态，防止恢复旧快照时复活已撤销权限或已使用令牌。
6. 同步评估对象存储：数据库回到过去但 Bucket 保持现在状态时，可能出现孤儿对象或缺失引用。使用对象版本、备份清单和 SHA-256 做对账。
7. 对账恢复时间点之后的扫描队列消息；指向不存在资产的回调会返回 404，应进入人工对账而不是无限重试。
8. 形成需要补录/回放的写入清单，经业务负责人确认数据损失范围后再恢复流量。

上线前应由负责人批准可量化目标。单实例初期可把 **RPO 设为 15 分钟、RTO 设为 2 小时**作为建议起点，但只有 PITR、异地备份和恢复演练实际达到这些数字后，才能对外承诺。

## 10. 备份和恢复

最低基线：

- PostgreSQL 启用连续 PITR；每日生成独立加密备份，保留至少 30 天，并按合规要求保留月度副本。
- 每次迁移前创建带 Commit SHA、迁移名和变更单号的命名快照。
- 备份文件权限为 0600、目录为 0700，生成 SHA-256 校验文件。
- 备份必须上传到不同账号或不同故障域的异地存储；只留在应用服务器不算备份。
- 数据库备份、对象清单/版本和发布证据使用同一时间戳关联。
- 每季度恢复到隔离环境；每年至少进行一次包含 DNS/应用切换的完整演练。

优先使用云数据库原生加密快照和 PITR。以下逻辑备份示例假设 Secret Manager 已把专用备份账号的标准 libpq 变量 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`、`PGSSLMODE=verify-full`、必要的 `PGSSLROOTCERT`，以及公钥 `AGE_RECIPIENT` 注入当前受控任务。命令不会从应用环境文件读取凭据，也不会把数据库 URL 放进进程参数：

```bash
set -Eeuo pipefail
umask 077
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGPASSWORD:?}"
: "${PGSSLMODE:?}" "${PGSSLROOTCERT:?}"
: "${AGE_RECIPIENT:?}"
if [[ "$PGSSLMODE" != "verify-full" ]]; then
  echo "PGSSLMODE must be verify-full" >&2
  exit 1
fi
export BACKUP_DIR=/var/backups/campuslink
export BACKUP_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
export BACKUP_FILE="${BACKUP_DIR}/campuslink-${BACKUP_STAMP}.dump.age"
export BACKUP_PARTIAL="${BACKUP_FILE}.partial"

cleanup_partial() {
  rm -f "$BACKUP_PARTIAL"
}
trap cleanup_partial EXIT

pg_dump --format=custom --no-owner --no-privileges \
  | age --recipient "$AGE_RECIPIENT" --output "$BACKUP_PARTIAL"

mv "$BACKUP_PARTIAL" "$BACKUP_FILE"
trap - EXIT

(
  cd "$BACKUP_DIR"
  sha256sum "$(basename "$BACKUP_FILE")" \
    > "$(basename "$BACKUP_FILE").sha256"
)
chmod 600 "$BACKUP_FILE" "${BACKUP_FILE}.sha256"
```

随后由备份平台 Agent、`rclone`、云厂商 CLI 或对象锁定服务把 `.age` 和 `.sha256` 一起上传到异地存储，并验证远端大小和校验和。保留策略自动删除过期副本，但最近一次已验证可恢复副本不得被生命周期规则提前删除。

对象存储若支持版本控制、对象锁或跨账号复制，应启用合适策略；若 R2 套餐或所选供应商不提供满足要求的版本能力，就定期把对象和清单复制到独立备份 Bucket。备份账号不能与应用账号共用密钥。

可执行的供应商中立参考流程是使用两个最小权限 `rclone` remote：`campuslink-prod` 只有生产 Bucket 读取权，`campuslink-backup` 只有独立备份账号的写入/读取权。配置文件由 root 管理并设为 0600。沿用数据库备份的同一个 `BACKUP_STAMP`：

```bash
set -Eeuo pipefail
: "${BACKUP_STAMP:?BACKUP_STAMP is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"
export RCLONE_CONFIG=/etc/campuslink/rclone.conf
export OBJECT_SNAPSHOT="snapshots/${BACKUP_STAMP}"
export OBJECT_MANIFEST="/var/backups/campuslink/objects-${BACKUP_STAMP}.manifest.age"
trap 'rm -f "${OBJECT_MANIFEST}.partial"' EXIT

rclone copy \
  campuslink-prod:campuslink-production \
  "campuslink-backup:campuslink-object-backups/${OBJECT_SNAPSHOT}" \
  --immutable --checkers 16 --transfers 8

rclone lsf campuslink-prod:campuslink-production \
  --recursive --format pst \
  | age --recipient "$AGE_RECIPIENT" \
      --output "${OBJECT_MANIFEST}.partial"

rclone check \
  campuslink-prod:campuslink-production \
  "campuslink-backup:campuslink-object-backups/${OBJECT_SNAPSHOT}" \
  --one-way

mv "${OBJECT_MANIFEST}.partial" "$OBJECT_MANIFEST"
trap - EXIT
```

`copy` 不删除历史快照，`--immutable` 防止同名快照被覆盖。季度演练应增加 `rclone check --download` 做字节级校验，代价是读取全部对象。若业务要求数据库与对象的严格同一时点快照，应在维护停写窗口执行，或使用供应商的版本化连续复制并按数据库 PITR 时间点选择对象版本。

对象恢复时先创建全新的私有 Bucket，再把指定快照复制进去并执行 `rclone check --download`。只在隔离应用中把 `S3_BUCKET` 指向恢复 Bucket，核对数据库所有 `Asset.storageKey` 都存在、文档 SHA-256 一致且没有意外公共权限。生产对象备份 remote、保留策略和一次成功恢复的证据没有完成前，第 11 节备份验收不能勾选。

在与生产隔离的恢复主机上，检出备份对应的 Commit 并执行 `npm ci`。先按第 7.3 节在恢复实例创建 `campuslink_migrate`/`campuslink_app`、默认权限和全新空数据库，`RESTORE_DATABASE_URL` 使用恢复实例的迁移账号。为避免密码出现在 `pg_restore` 进程参数中，另创建 root-only 的 `/etc/campuslink/pg_service.conf`：

```ini
[campuslink_restore]
host=RESTORE_DB_HOST
port=5432
dbname=campuslink_restore
user=campuslink_migrate
sslmode=verify-full
sslrootcert=/etc/ssl/certs/RESTORE_DB_CA.pem
```

在 0600 的 `/etc/campuslink/restore.pgpass` 中按 libpq 格式保存密码：

```text
RESTORE_DB_HOST:5432:campuslink_restore:campuslink_migrate:REPLACE_WITH_PASSWORD
```

```bash
sudo chown root:root /etc/campuslink/pg_service.conf /etc/campuslink/restore.pgpass
sudo chmod 600 /etc/campuslink/pg_service.conf /etc/campuslink/restore.pgpass
```

由于这两个连接文件是 `root:root 0600`，下面整个代码块必须在受控的 root shell 或等价的 root-owned 一次性恢复任务中执行；普通 sudo 运维用户直接运行会因无法读取文件而失败。只在隔离恢复主机、精确校验过的 Commit 上这样做，完成后退出 root shell。Prisma Client 生成必须显式指向恢复数据库，不能依赖主机原有环境：

```bash
set -Eeuo pipefail
if [[ "$(id -u)" != "0" ]]; then
  echo "Run this restore block as root on the isolated recovery host" >&2
  exit 1
fi
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
export PGSERVICE=campuslink_restore
export PGSERVICEFILE=/etc/campuslink/pg_service.conf
export PGPASSFILE=/etc/campuslink/restore.pgpass
: "${PGSERVICE:?}" "${PGSERVICEFILE:?}" "${PGPASSFILE:?}"

DATABASE_URL="$RESTORE_DATABASE_URL" npm run db:generate
sha256sum --check campuslink-RESTORE_TIMESTAMP.dump.age.sha256

age --decrypt campuslink-RESTORE_TIMESTAMP.dump.age \
  | pg_restore \
      --exit-on-error \
      --no-owner \
      --no-privileges \
      --dbname="service=${PGSERVICE}"

DATABASE_URL="$RESTORE_DATABASE_URL" npx prisma migrate status
```

恢复目标必须是全新创建、与生产隔离的空数据库。`--exit-on-error` 与 `pipefail` 保证校验、解密或恢复任一环节失败时立即中止；`--dbname="service=..."` 保证 `pg_restore` 真正写入目标库且不把密码放入参数；`--no-privileges` 避免备份中的旧 ACL 引用不存在角色。必须人工核对 libpq service 与 `RESTORE_DATABASE_URL` 指向同一恢复实例。恢复后重新执行第 7.3 节的现有表/序列 `GRANT` 和 `_prisma_migrations` `REVOKE`。这里还必须显式使用 `DATABASE_URL="$RESTORE_DATABASE_URL"`，防止 Prisma 意外检查生产数据库。若恢复的是旧版本备份，应先用对应 Commit 验证迁移状态，再经过正式升级流程应用后续迁移，不能用迁移命令掩盖空恢复或错误恢复。恢复后验证：用户/内容/审计数量、唯一约束、管理员可用性、校区隔离、Session 策略、对象键关联、扫描 SHA-256 和随机抽样下载。验证完成前不要修改生产 `DATABASE_URL`。

## 11. 上线检查清单

### 基础设施

- [ ] SSH Key、非 root sudo、安全更新、云安全组/UFW 已完成，管理端口不会锁死。
- [ ] 3000、5432、9000、9001 均未暴露公网。
- [ ] 域名解析完成。
- [ ] 先用 HTTP 验证 Nginx 和 DNS，再申请证书，最后启用 TLS 跳转。
- [ ] HTTPS 证书有效且可自动续期。
- [ ] PostgreSQL 启用 TLS、PITR、异地备份和恢复演练。
- [ ] 应用数据库账号与迁移账号分离，权限经过核对。
- [ ] 迁移角色拥有 schema 对象，默认权限会授权后续新表给应用角色。
- [ ] 私有 R2/S3 Bucket 已建立。
- [ ] Bucket CORS 只允许正式 `APP_URL`。
- [ ] 应用存储账号与扫描 Worker 账号分离且均为最小权限。
- [ ] SMTP STARTTLS/证书校验、SPF、DKIM、DMARC 和发件域名已验证。
- [ ] 扫描 Worker、队列、死信队列和回调已完成真实文件端到端测试。
- [ ] 上传清理 systemd timer 已启用，并能对失败报警。
- [ ] 日志、错误、数据库、队列、磁盘和证书监控已接入。

### 安全配置

- [ ] `APP_URL` 和 `NEXT_PUBLIC_APP_URL` 是同一个正式 HTTPS Origin。
- [ ] `DEFAULT_CAMPUS_SLUG` 与数据库中一个启用的 `Campus.slug` 完全一致，普通邮箱注册烟雾测试成功。
- [ ] 未依赖 `Campus.allowedEmailDomain` 或后台域名控制进行注册准入；该可空遗留字段不参与准入且后台没有编辑入口。
- [ ] `TRUST_PROXY` 与真实网络拓扑一致。
- [ ] Cloudflare 场景已配置官方可信 CIDR、源站防火墙和真实 IP 验证。
- [ ] 数据库连接包含 TLS 要求。
- [ ] 数据库 URL 中的账号和密码已正确 URL 编码。
- [ ] S3 Endpoint 使用 HTTPS。
- [ ] Bucket 非公开。
- [ ] 清理 Secret 和扫描 Secret 不同，且长度不少于 32 字符。
- [ ] 所有 Secret 存在服务器 Secret Store 或 root 可读配置中。
- [ ] 已制定数据库、存储、SMTP、清理和扫描 Secret 轮换流程并演练。
- [ ] 应用以 `campuslink` 非 root 用户运行，迁移以独立用户运行。
- [ ] `build.env` 不含任何生产 Secret，构建期间无法连接生产依赖。
- [ ] release 已固化为 root 只读，运行用户只能写独立 `/var/cache`/`/var/lib`。
- [ ] 未把 Stitch API Key 或任何服务端密钥提交到仓库。

### 发布验证

- [ ] 发布绑定明确 Git tag/Commit SHA 和变更单。
- [ ] 已记录 Node/npm/PostgreSQL/对象存储版本和锁文件 SHA-256。
- [ ] `npm ci` 成功。
- [ ] `npm run db:generate` 成功。
- [ ] `npm run format:check` 成功。
- [ ] `npm run lint` 成功。
- [ ] `npm run typecheck` 成功。
- [ ] `npm run test:unit` 成功。
- [ ] 测试环境中的集成和 E2E 成功。
- [ ] `npm run build` 成功。
- [ ] 新版本在非在线 release 目录由非 root 用户构建。
- [ ] 迁移已审查为 expand/contract 兼容或已批准维护窗口。
- [ ] 迁移前快照/PITR 时间点已记录，`npm run db:migrate:deploy` 成功。
- [ ] `current`/`previous` 软链接正确，旧 release 未被覆盖。
- [ ] systemd 和 Nginx 状态正常。
- [ ] `/auth/sign-in` 弱健康检查与登录业务烟雾测试均成功。

### 业务验证

- [ ] 注册邮件可以收到。
- [ ] 邮箱验证成功。
- [ ] 普通学生不能访问管理后台。
- [ ] 管理员和审核员只能看到本校区数据。
- [ ] 资料上传后会进入扫描等待状态。
- [ ] `CLEAN` 后可以送审和下载。
- [ ] `INFECTED`、`ERROR`、`PENDING` 文件不能发布。
- [ ] 举报、审核、隐藏、恢复和审计日志正常。
- [ ] 首个 Campus、管理员、Session 撤销和 bootstrap 审计记录正确。

### 恢复与运营

- [ ] 备份已加密、生成校验和并成功上传到异地存储。
- [ ] 在隔离数据库执行过真实恢复，Prisma 状态和业务抽样检查通过。
- [ ] 数据库与对象存储按同一时间点完成过一致性对账。
- [ ] 对象已复制到独立账号/Bucket，清单、`rclone check` 和隔离恢复成功。
- [ ] 监控告警已实际触发，不只是配置存在。
- [ ] 维护模式、代码回滚和数据库灾难恢复分别演练。
- [ ] 停写演练确认扫描/清理/应用均停止且数据库无在途写事务，不只验证 503 页面。
- [ ] 严格快照演练能拒绝旧签名 URL 的 `PutObject`，或证明 URL/在途上传已失效且 Bucket 无新增对象。
- [ ] RPO/RTO 已由负责人批准，并由演练数据证明可以达到。

## 12. 当前需要持续关注的事项

### 12.1 风险登记表

| 风险 | 当前状态 | 影响 | 上线处置 |
| --- | --- | --- | --- |
| 扫描 Worker 未在仓库交付 | 回调、状态机和门禁已完成，Worker/队列未实现 | 学习资料文档无法完成生产发布；扫描积压会阻塞新文档 | **资料功能上线阻塞项**；先交付 Worker、DLQ、监控和恢复流程 |
| 扫描服务中断 | 新文档保持 `PENDING`，已有 `CLEAN` 文档不受影响 | 新资料不能送审/下载，队列可能堆积 | 队列持久化、10 分钟积压告警、容量预案、错误重扫 |
| 单实例 Node/systemd | 当前手册部署一个应用实例 | 发布重启有短暂中断，主机故障会导致服务不可用 | 初期接受计划内秒级中断；后续增加负载均衡、多实例和共享限速/会话约束验证 |
| 没有 `/health`、`/ready` | 暂用 `/auth/sign-in` 弱检查 | 无法准确区分进程存活、数据库可用和依赖就绪 | 增加不泄露敏感信息的 liveness/readiness 路由 |
| 没有集中式可观测性 | 仓库未绑定具体日志、指标和错误追踪供应商 | 事故发现慢、难以量化 SLO | 上线前至少接入日志和关键告警；错误追踪与指标列为高优先级 |
| 发布需要原子切换后重启 | systemd 单实例 restart | 正常发布存在短暂连接中断 | 发布窗口、维护提示；未来使用多实例滚动发布 |
| 数据库/对象恢复一致性 | 数据库引用私有 Bucket 对象 | 单独回滚数据库可能产生孤儿或缺失对象 | 同时间戳清单、对象版本/备份、恢复后 SHA-256 对账 |
| RPO/RTO 尚未用演练证明 | 建议目标为 RPO 15 分钟、RTO 2 小时 | 不能对外做可用性承诺 | 完成季度恢复演练并用实测结果修订目标 |
| 未提供生产 Dockerfile | 当前采用 Node.js + systemd | 不能直接按容器平台标准发布 | 当前方案可用；容器化前新增并验证多阶段镜像、非 root 和扫描结果 |

### 12.2 依赖安全告警

2026-07-13 的 `npm audit` 结果：

- Critical：0。
- High：0。
- Moderate：5。
- Low：完整依赖树中 1 个；仅生产范围报告中为 0。

告警主要来自：

- [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)：PostCSS CSS stringify 在特定不可信 CSS 输入下可能产生 XSS，告警通过 Next.js 依赖链出现。
- [GHSA-92pp-h63x-v22m](https://github.com/advisories/GHSA-92pp-h63x-v22m)：Prisma 工具链中的 `@hono/node-server` 静态文件中间件可被重复斜杠绕过。
- [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)：esbuild 在 Windows 开发服务器场景可能允许任意文件读取；该项为 Low，生产依赖审计不包含它。

当前补偿控制：应用不接受用户上传或编辑 CSS；Prisma CLI 只在受控迁移任务使用，生产应用启动前执行 `npm prune --omit=dev`；开发服务器只绑定受控本机环境，不开放到不可信网络。这些控制降低可达性，但不能替代升级。

当前 `npm audit` 建议的自动修复包含将 Next 或 Prisma 降到不兼容主版本的方案，因此不能执行 `npm audit fix --force`。推荐每周检查 Next、Prisma 和相关锁文件更新，在独立分支升级后重新运行完整发布矩阵。

这些告警目前没有 Critical 或 High，但也不等于可以忽略。由平台维护负责人每周复查；兼容修复版本发布后 7 天内完成升级分支和回归验证。若在修复前上线，负责人应记录临时风险接受，复查日期不得晚于 2026-08-13。每次发布都要重新运行完整依赖树和 `--omit=dev` 两种审计，并以供应商修复版本、实际可达性和回归测试为依据升级。

### 12.3 建议后续增强

建议按以下优先级迭代：

1. P0：交付扫描 Worker、队列、死信队列、对账任务和部署模板。
2. P0：上线集中日志和关键告警，完成备份恢复演练。
3. P1：增加专用 `/health` 和 `/ready` 路由。
4. P1：提供管理员初始化 CLI，替代一次性 SQL并保留审计证据。
5. P1：接入错误追踪和业务指标，例如登录失败率、扫描延迟、清理失败数。
6. P2：根据真实流量完成容量测试、多实例设计和无中断发布。
7. P2：提供经过验证的多阶段 Dockerfile 和镜像供应链扫描。

## 13. 常用命令速查

```bash
# 开发
npm run dev

# 生成 Prisma Client
npm run db:generate

# 开发数据库迁移
npm run db:migrate

# 生产数据库迁移
npm run db:migrate:deploy

# Seed，仅用于开发/测试
npm run db:seed

# 单元测试
npm run test:unit

# 集成测试
npm run test:integration

# E2E
npm run e2e:provision
npm run test:e2e

# 完整发布验证
npm run verify:release

# 构建和启动
npm run build
npm start
```

## 14. 相关文档

- `docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md`：本手册，作为交付、使用和安全上线的统一入口。
- `README.md`：快速开始。
- `docs/deployment.md`：生产部署约束。
- `docs/operations.md`：备份、清理和事故响应。
- `docs/security.md`：安全模型。
- `docs/storage.md`：对象存储和上传生命周期。
- `docs/superpowers/specs/2026-07-12-campuslink-design.md`：产品设计规格。
- `docs/superpowers/plans/2026-07-12-campuslink-product-platform.md`：实现计划。

## 15. 最终交付说明

CampusLink 已经具备真实产品的核心代码基础：完整业务闭环、服务端权限、校区隔离、私有上传、审核审计、状态机和可复现测试。它优秀的地方不只是页面完成度，而是关键业务规则能够在服务端被验证，并有测试证据支撑。

Web 应用可以按本手册部署；但完整产品上线还取决于域名/TLS、数据库、私有对象存储、SMTP、扫描 Worker、队列、监控和备份恢复。尤其不能跳过扫描器：仓库没有交付扫描 Worker，在它完成之前，学习资料文档功能不满足生产上线条件。

完成上线检查清单、首个管理员受审计初始化、扫描链路端到端测试和一次隔离恢复演练后，CampusLink 才适合作为单校区产品正式开放。后续扩展多校区、支付、聊天或推荐系统时，应重新评估数据隔离、隐私合规、滥用治理和可用性目标。
