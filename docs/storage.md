# Object storage

CampusLink uploads files directly from the browser to an S3-compatible service.
The application creates a pending database intent, signs a five-minute PUT for
its exact content type, and verifies the stored object's key, size, and content
type before marking the asset ready. This flow does not issue download URLs.

## Local MinIO

Start PostgreSQL and MinIO with `docker compose up -d postgres minio`. Use the
`S3_*` defaults in `.env.example`; `S3_FORCE_PATH_STYLE=true` is required for
the local endpoint. The integration test creates the configured bucket when it
does not exist. A browser deployment must also configure MinIO bucket CORS to
allow PUT requests from `APP_URL` with the `Content-Type` header.

## Cloudflare R2

Set `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`,
`S3_REGION=auto`, the R2 access-key ID and secret, the bucket name, and
`S3_FORCE_PATH_STYLE=false`. Configure the R2 bucket CORS origin to the exact
production `APP_URL`; do not expose the S3 credentials to browser environment
variables.
