# Object storage

CampusLink uploads files directly from the browser to an S3-compatible service.
The application creates a pending database intent, signs a five-minute,
write-once PUT for its exact content type and byte length, and verifies the
stored object's key, size, and content type before marking the asset ready. The
signature includes `content-length`, `content-type`, and `if-none-match`; the
browser sends `Content-Type` and `If-None-Match: *`, while the browser-managed
request body supplies `Content-Length`. This flow does not issue download URLs.

The uploader stores an unfinished intent and phase in session storage. A retry
resumes that PUT or calls the idempotent completion endpoint for the same asset;
it does not allocate a replacement until the server has rejected the old one.

## Local MinIO

Start PostgreSQL and MinIO with `docker compose up -d postgres minio`. Use the
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

## Expired upload cleanup

Configure a random `UPLOAD_CLEANUP_SECRET`, then schedule an authenticated
`POST /api/internal/uploads/cleanup` with
`Authorization: Bearer <UPLOAD_CLEANUP_SECRET>`. This machine endpoint does not
use browser Origin checks and returns counts only.

The cleanup conditionally claims each expired `PENDING` row as `CLEANING`
before touching storage. A concurrent completion that reaches `READY` first
makes the claim fail, so its object is not deleted. A claimed row cannot become
ready. After storage deletion succeeds the claimed row is deleted; a storage
failure leaves it `CLEANING` and eligible for the next scheduled run. Existing
`REJECTED` records remain for audit history after their residual object is
removed.

## Integration-test gate

`npm run test:integration` requires `DATABASE_URL` and all six `S3_*` settings;
missing configuration is a failure. A developer who intentionally has no local
services may set `ALLOW_SKIPPED_INTEGRATION=true` for that command, which makes
the suites report explicit skips. CI never accepts this escape hatch.
