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

Call `POST /api/internal/uploads/cleanup` with
`Authorization: Bearer <UPLOAD_CLEANUP_SECRET>` every 15 minutes. It removes
expired incomplete uploads and retries rejected-object deletion. Alert on any
non-2xx response or a sustained non-zero `failed` count.

The malware scanner consumes new document objects independently. Alert if a
document remains `PENDING` for more than ten minutes, if scan `ERROR` grows, or
if any `INFECTED` deletion cannot be confirmed. Never convert pending or error
records to clean manually without a scanner-produced SHA-256 result.

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
