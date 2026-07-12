# CampusLink

CampusLink is a moderated, single-campus platform for sharing learning resources, listing second-hand items, and publishing part-time opportunities.

## Prerequisites

CampusLink requires Node.js 22.12.0 or later, PostgreSQL, and S3-compatible
private object storage.

The imported Stitch pages live in `design/stitch-export/`. They are visual reference only; the application will be rebuilt as a typed, tested Next.js product.

The validated design is in `docs/superpowers/specs/2026-07-12-campuslink-design.md` and the implementation plan is in `docs/superpowers/plans/2026-07-12-campuslink-product-platform.md`.

Direct upload storage configuration for local MinIO and production Cloudflare
R2 is documented in `docs/storage.md`.

## Local development

```sh
Copy-Item .env.example .env
docker compose up -d postgres minio minio-init mailpit
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Mailpit is available at `http://127.0.0.1:8025` and MinIO Console at
`http://127.0.0.1:9001`. The application is available at
`http://localhost:3000`.

## Verification and operations

- `npm run test:unit` runs fast domain and security tests.
- `npm run test:integration` requires live PostgreSQL and MinIO and fails when
  they are not configured.
- `npm run test:e2e` requires provisioned test fixtures and live services.
- `npm run verify:release` runs the complete release matrix.

Deployment, environment variables, scanner integration, backups, cleanup, and
incident response are documented in `docs/deployment.md`,
`docs/operations.md`, and `docs/security.md`.

