# Object storage

CampusLink uploads files directly from the browser to an S3-compatible service.
The application creates a pending database intent, signs a five-minute,
write-once PUT for its exact content type and byte length, and verifies the
stored object's key, size, and content type before marking the asset ready. A
resource document is independently marked scan-pending; ready does not mean
malware-clean. Production binding, publication, restoration, and signed reads
require the authenticated scanner callback to record a clean SHA-256 verdict. The
signature includes `content-length`, `content-type`, and `if-none-match`; the
browser sends `Content-Type` and `If-None-Match: *`, while the browser-managed
request body supplies `Content-Length`. This flow does not issue download URLs.

The uploader stores an unfinished intent and phase in session storage. A retry
resumes that PUT or calls the idempotent completion endpoint for the same asset;
it does not allocate a replacement until the server has rejected the old one.

## Local MinIO

Start PostgreSQL and MinIO with
`docker compose up -d postgres minio minio-init`. Use the
`S3_*` defaults in `.env.example`; `S3_FORCE_PATH_STYLE=true` is required for
the local endpoint. The integration test creates the configured bucket when it
does not exist. A browser deployment must also configure MinIO bucket CORS to
allow PUT requests from `APP_URL` with the `Content-Type` header.
Allow the `If-None-Match` request header as well.

## Cloudflare R2

Set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
`S3_REGION=auto`, the R2 access-key ID and secret, the bucket name, and
`S3_FORCE_PATH_STYLE=false`. Configure the R2 bucket CORS origin to the exact
production `APP_URL`; do not expose the S3 credentials to browser environment
variables.

## Scheduled storage maintenance

Configure a random `UPLOAD_CLEANUP_SECRET`, then run one maintenance task every
15 minutes. It must independently attempt authenticated calls to both
`POST /api/internal/uploads/cleanup` and
`POST /api/internal/storage-deletions` with
`Authorization: Bearer <UPLOAD_CLEANUP_SECRET>`. These machine endpoints do not
use browser Origin checks and return bounded counts only. A failure from one
endpoint must not prevent the task from attempting the other, but any curl,
non-2xx, or JSON failure makes the task fail after both attempts.

The cleanup conditionally claims each expired `PENDING` row as `CLEANING`
before touching storage. A concurrent completion that reaches `READY` first
makes the claim fail, so its object is not deleted. A claimed row cannot become
ready. After storage deletion succeeds the claimed row is deleted; a storage
failure leaves it `CLEANING` and eligible for the next scheduled run. Existing
`REJECTED` records remain for audit history after their residual object is
removed.

The deletion response includes `retried`, `deferred`, `pending`, and
`oldestPendingAgeSeconds`. Alert immediately when `retried` is non-zero, when
`deferred` remains non-zero for two consecutive runs, or when `pending` is
non-zero and `oldestPendingAgeSeconds` is at least 3,600 seconds (1 hour).

## Integration-test gate

`npm run test:integration` requires `DATABASE_URL` and all six `S3_*` settings;
missing configuration is a failure. A developer who intentionally has no local
services may set `ALLOW_SKIPPED_INTEGRATION=true` for that command, which makes
the suites report explicit skips. CI never accepts this escape hatch.
