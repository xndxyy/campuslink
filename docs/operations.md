# CampusLink operations

## Local production-like verification

Copy `.env.example` to `.env`, use a database name ending in `_test` for E2E,
then start dependencies:

```sh
docker compose up -d postgres minio minio-init mailpit
npm run db:generate
npm run db:migrate:deploy
npm run test:integration
```

For destructive browser fixtures, set `ALLOW_DESTRUCTIVE_E2E=true`, all
`E2E_*` variables shown in CI, run `npm run e2e:provision`, then
`npm run test:e2e`. Integration and E2E suites fail closed when services are
missing. The commented local skip flags are for an explicitly partial local
run only and are rejected in CI.

## Scheduled jobs

Run one maintenance task every 15 minutes. It must attempt both
`POST /api/internal/uploads/cleanup` and
`POST /api/internal/storage-deletions`, even when the first call fails. Both
calls use `Authorization: Bearer <UPLOAD_CLEANUP_SECRET>`; no second scheduler
secret is required. The first endpoint removes expired incomplete uploads and
retries rejected-object deletion. The second drains queued object deletions
that could not be completed in the originating request.

Alert on any curl, non-2xx, or JSON validation failure; a non-zero upload
`failed` count; or a non-zero storage-deletion `retried` count. Alert when
`deferred` remains non-zero for two consecutive runs, and when `pending` is
non-zero while `oldestPendingAgeSeconds` reaches 3,600 seconds (1 hour). The
task must log only the endpoints' bounded count JSON, never the bearer secret.

The malware scanner consumes new document objects independently. Alert if a
document remains `PENDING` for more than ten minutes, if scan `ERROR` grows, or
if any `INFECTED` deletion cannot be confirmed. Never convert pending or error
records to clean manually without a scanner-produced SHA-256 result.

## Moderation operations

- Page immediately on sustained `AI_CHECK_SKIPPED` growth or any skipped record
  older than 15 minutes. Staff review the dedicated skipped-provider filter;
  provider recovery does not retroactively approve old assessments.
- Administrators maintain blocked words as literal text only. Every create,
  enable/disable, and permanent delete requires a reason and produces an audit
  event. Export the active list before bulk changes and never insert regex.
- `TREE_HOLE_AUTHOR_REVEALED` is a high-sensitivity event. Review it daily and
  require an open or triaged report plus the recorded reason. Do not expose the
  revealed identity in general moderation exports.
- Run the storage-deletions timer every 15 minutes and keep its backlog alerts
  enabled even when uploads are temporarily disabled.

## Key rotation

Use versioned key rotation, never in-place replacement. Add the new
`AI_CONFIG_ENCRYPTION_KEY_V2` or `ANONYMOUS_IDENTITY_KEY_V2` reader first,
re-encrypt records in a bounded audited job, switch writers, verify decrypts,
then retire V1. Do not rotate `ANONYMOUS_FINGERPRINT_KEY` without an explicit
identity-index migration. Rotate provider API keys through the admin page only
after the application encryption key is healthy.

## Backup and restore

- Take encrypted PostgreSQL backups at least daily and retain 30 days. Enable
  point-in-time recovery for production.
- Version or retain deleted S3 objects long enough to investigate incidents,
  subject to campus privacy policy. Incomplete uploads expire after five
  minutes and are cleaned by the scheduler.
- Before each migration, create a named database snapshot and record the
  application commit and migration directory.
- Test restoration quarterly into an isolated database and private bucket.

Example logical backup and restore:

```sh
pg_dump --format=custom --no-owner --file=campuslink.dump "$DATABASE_URL"
createdb campuslink_restore_test
pg_restore --no-owner --dbname="$RESTORE_DATABASE_URL" campuslink.dump
npx prisma migrate status
```

Do not restore over the live database. Validate counts, sign-in, asset links,
campus isolation, and audit history in an isolated environment before cutover.
The pre-expansion tag `pre-community-expansion-2026-07-13` requires a database
snapshot from before the Phase 5 contract migration; code-only rollback cannot
recreate removed tables or columns.

## Incident response

1. Disable affected sessions or suspend the user; do not delete audit records.
2. Hide unsafe content immediately through moderation.
3. For an upload incident, reject the asset in the database before removing
   the object, rotate storage credentials if exposure is suspected, and retain
   hashes and relevant logs.
4. Rotate session, cleanup, scanner, SMTP, database, or storage secrets through
   the provider secret store. Restart all application instances after rotation.
5. Record timeline, affected campus and entities, containment, recovery, and
   follow-up actions outside the mutable application database.

## Stitch MCP configuration

Stitch is a developer design tool, not a runtime dependency. Configure it only
in the user's private Codex configuration under `mcp_servers.stitch`, keep the
API key in that local configuration, and restart Codex for tool discovery. No
Stitch credential belongs in this repository, CI, browser bundle, or deployed
application.
