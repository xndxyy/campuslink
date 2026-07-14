# CampusLink deployment

CampusLink is a Node.js 22.12+ Next.js application backed by PostgreSQL, an
S3-compatible private bucket, TLS SMTP, and an external malware scanner. A
production process refuses to start when a required security setting is
missing. Resource documents cannot be attached, published, or downloaded as a
published file until the scanner records a `CLEAN` verdict.

## Required services

- PostgreSQL 16 or a compatible managed PostgreSQL service.
- A private S3-compatible bucket such as Cloudflare R2. Do not grant anonymous
  object access; all reads use short-lived signed URLs.
- An SMTP provider that supports implicit TLS on port 465 or STARTTLS on other
  ports.
- A malware scanner that can read the private upload object and call the
  authenticated scan-result endpoint.
- A Node-compatible host for `next start`, behind an HTTPS reverse proxy.

## Production environment

| Variable | Requirement |
| --- | --- |
| `APP_URL` | Exact public HTTPS origin, with no path credentials. |
| `NEXT_PUBLIC_APP_URL` | Same public origin used by browser links. |
| `DATABASE_URL` | TLS PostgreSQL connection string. |
| `TRUST_PROXY` | Explicit `true` only if the trusted edge overwrites forwarding headers; otherwise `false`. |
| `S3_ENDPOINT` | HTTPS S3/R2 endpoint. |
| `S3_REGION` | Storage region (`auto` for R2). |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Least-privilege credentials for one private bucket. |
| `S3_BUCKET` | Private bucket name. |
| `S3_FORCE_PATH_STYLE` | `false` for R2; provider-specific elsewhere. |
| `SMTP_HOST`, `SMTP_PORT` | SMTP endpoint. Port 465 uses implicit TLS; other ports require STARTTLS. |
| `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Mail credentials and verified sender. |
| `UPLOAD_CLEANUP_SECRET` | Random 32+ character scheduler bearer secret. |
| `UPLOAD_SCANNER_CALLBACK_SECRET` | Different random 32+ character scanner callback bearer secret. |

Keep every secret in the deployment platform's encrypted secret store. Never
place the Stitch API key, database password, storage secret, SMTP password, or
callback secrets in repository files or client-visible variables.

## Build and release

```sh
npm ci
npm run db:generate
npm run db:migrate:deploy
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run test:e2e
npm start
```

Run migrations once as a release job before shifting traffic. Use a deployment
with health checks and an atomic rollback to the previous application image.
Database migrations are forward-only; restore a pre-migration database backup
if a migration itself must be rolled back.

## Edge configuration

Terminate TLS at the trusted edge, redirect HTTP to HTTPS, and add HSTS there
after the domain and all subdomains are confirmed HTTPS-only. Preserve the
application CSP, `nosniff`, referrer, opener, permissions, and no-store
headers. Limit request bodies at the edge as well as in the application. The
S3 bucket CORS policy should allow only the exact `APP_URL` origin, `PUT`, and
the signed upload headers.

## Scanner contract

Storage events or a scanner queue should scan each `RESOURCE_DOCUMENT` object.
After computing SHA-256, call:

```http
POST /api/internal/uploads/scan-result
Authorization: Bearer <UPLOAD_SCANNER_CALLBACK_SECRET>
Content-Type: application/json

{"assetId":"...","verdict":"CLEAN|INFECTED|ERROR","sha256":"64 hex characters"}
```

`INFECTED` rejects the asset before deletion is attempted. `ERROR` remains
unpublishable and may be retried by sending a later verdict. Rotate the callback
secret by briefly accepting traffic only after the scanner and application
have been updated together.

## Scheduled maintenance

Run one flock-protected maintenance service every 15 minutes. The same run must
attempt both `POST /api/internal/uploads/cleanup` and
`POST /api/internal/storage-deletions`, even if either call fails. Both requests
use `Authorization: Bearer <UPLOAD_CLEANUP_SECRET>`; do not add or expose a
second secret. Validate and log only each endpoint's bounded JSON fields, then
fail the service after both attempts if curl, HTTP status, or JSON validation
failed.

Alert on non-zero upload `failed` or deletion `retried`. Alert when deletion
`deferred` remains non-zero for two consecutive 15-minute runs. Also alert when
`pending` is non-zero and `oldestPendingAgeSeconds` reaches 3,600 seconds
(1 hour), which indicates the durable deletion backlog is not draining.
