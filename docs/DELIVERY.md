# CampusLink 生产交付

本文档用于 `swuerlink.top` 的生产发布。所有命令都应在已验证的发布目录中执行，环境变量继续由 systemd 的 `EnvironmentFile` 提供，不要把数据库、SMTP、存储或 AI 密钥写入仓库。

> **当前状态（2026-07-22）：暂停生产部署。** 这是已部署环境的历史交付记录，不是当前发布授权。合规、验证邮件、运营治理、扫描 Worker 和 live 发布矩阵完成前，不要直接执行本文件的生产命令；当前分支与验证证据以 [`CAMPUSLINK_HANDOFF.md`](CAMPUSLINK_HANDOFF.md) 为准。

## 发布顺序

先停止定时任务，避免它在依赖目录更新期间启动；然后严格按下面的顺序完成安装、构建、迁移和重启：

```sh
sudo systemctl stop campuslink-upload-cleanup.timer

npm ci
npm run db:generate
npm run build
npm run db:migrate:deploy
npm prune --omit=dev
sudo systemctl restart campuslink
sudo systemctl restart campuslink-upload-cleanup.timer
```

生产环境不得运行 `prisma db seed`。默认标签和初始屏蔽词由迁移 `20260717100000_seed_publishing_defaults` 写入；`20260717110000_add_owner_deletion_requests` 增加安全删除所需字段。迁移只补充缺失数据，不覆盖管理员后续启用、停用或删除的结果。

## 只读核验

先确认 Prisma 已无待执行迁移：

```sh
sudo systemd-run --wait --collect \
  --unit="campuslink-migrate-status-$(date +%s)" \
  --uid=campuslink \
  --gid=campuslink \
  --property="WorkingDirectory=/opt/campuslink/current" \
  --property="EnvironmentFile=/etc/campuslink/migration.env" \
  /opt/campuslink/current/node_modules/.bin/prisma migrate status
```

使用只读 SQL 核对每个标签范围的预设数量，以及当前启用的屏蔽词数量：

```sql
SELECT scope, count(*) AS preset_count
FROM "TagDefinition"
WHERE "isPreset" = true
GROUP BY scope
ORDER BY scope;

SELECT count(*) AS enabled_blocked_word_count
FROM "BlockedWord"
WHERE enabled = true;
```

最后检查应用、维护定时器和公开 HTTPS 页面：

```sh
sudo systemctl is-active campuslink
sudo systemctl is-active campuslink-upload-cleanup.timer

curl --fail --silent --show-error --max-time 15 https://swuerlink.top/ >/dev/null
curl --fail --silent --show-error --max-time 15 https://swuerlink.top/auth/sign-in >/dev/null
curl --fail --silent --show-error --max-time 15 https://swuerlink.top/submit/resource >/dev/null
```

## 回滚边界

应用代码可以切回上一版本，但包含删除列或表的历史迁移不能靠切换代码撤销。发布前保留 PostgreSQL 快照；若迁移本身必须回滚，应恢复与上一应用版本匹配的数据库快照。不要手工删除 `_prisma_migrations` 中的失败或回滚历史记录。
