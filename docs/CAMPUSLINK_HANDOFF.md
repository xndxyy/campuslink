# CampusLink 当前状态与交接

更新时间：2026-07-22

本文档只记录当前状态和下一步入口，不重复交付手册中的部署细节。完整的跨对话交接包位于 D:\CampusLink，其中 CODEX_HANDOFF_ZH.md 是新 Codex 的第一阅读材料。

## 当前代码基线

| 项目 | 当前值 |
| --- | --- |
| Git 分支 | codex/single-row-navigation-forum-marketplace |
| HEAD | f182fc90634bff09c3db6fe94ad83830fdac63b8 |
| GitHub | https://github.com/xndxyy/campuslink |
| 草稿 PR | https://github.com/xndxyy/campuslink/pull/2 |
| Node 要求 | >=22.12.0 |
| 单元测试文件 | 109 |
| Prisma migration 目录 | 24 |

最新功能分支包含单行全局导航、统一论坛发布入口、论坛分类种子、校园内容入口布局和桌面/手机间距回归修复。精确行为以代码、测试和提交历史为准，不以旧截图或历史计划推断。

## 验证状态

历史验证已覆盖 Prettier、ESLint、TypeScript、生产构建、单元测试和多尺寸浏览器检查；2026-07-19 交接记录包含 1105 项单元测试通过。live PostgreSQL/MinIO/AI 集成测试和真实业务 E2E 不能因为本机缺少服务而标记为通过，发布前必须在隔离环境重新执行 npm run verify:release。

本次文档整理只做了文档一致性修改；修改代码后必须重新运行：

~~~powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
~~~

## 生产决策

CampusLink 曾在 swuerlink.top 有过部署验证，但截至 2026-07-22 生产部署暂停。原因是合规、邮件验证和运营治理仍需端到端确认。不要自动连接服务器、读取生产环境文件、修改 systemd/Caddy/数据库或合并 PR。

生产放行至少要重新确认：

- 隐私政策、用户协议、邮箱验证告知和数据留存；
- 举报、复核、下架、申诉、审计和树洞身份揭示边界；
- 屏蔽词管理员维护、AI 审核启停、费用控制和失败降级；
- 注册、验证邮件、设置密码、登录和手机端链接；
- 恶意文件扫描 Worker、队列、死信队列、监控和备份恢复。

## 文档导航

- README.md：本地安装和命令入口。
- docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md：完整交付、部署、备份、回滚和风险清单；其中历史证据必须以本文件的当前基线为准。
- docs/deployment.md：部署前置条件和安全配置。
- docs/operations.md：定时任务、审核运维、轮换和事故响应。
- docs/security.md：信任边界、上传、审核和匿名身份安全模型。
- docs/storage.md：对象存储、扫描门禁和清理队列。
- docs/superpowers/：设计规格与实施计划，按日期保存为历史决策材料，不是当前发布状态。

## 交接与安全

新 Codex 请先读取：

~~~text
D:\CampusLink\README_FIRST.md
D:\CampusLink\CODEX_HANDOFF_ZH.md
~~~

不要从旧聊天记录恢复密码、API Key、数据库连接串、证书或 SSH 私钥。D:\CampusLink 已排除这些内容、node_modules、.next 和聊天附件；完整旧 Git 引用在 D:\CampusLink\git-backup\campuslink-all-refs.bundle。
