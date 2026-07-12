# CampusLink Product Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Stitch prototype into a tested, deployable CampusLink platform with authentication, uploads, publishing, favourites, reports, and moderated administration.

**Architecture:** A single Next.js App Router application owns the UI and server-side business actions. Prisma persists typed domain aggregates in PostgreSQL. E-mail/password authentication uses bcrypt plus an opaque server-side database session: only SHA-256 token hashes are stored, while the random value is delivered only in the verification e-mail or the `HttpOnly`, host-only session cookie. S3-compatible storage receives direct browser uploads through signed, constrained intents.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Prisma, PostgreSQL, Zod, bcryptjs, Nodemailer, Vitest, Playwright, Docker Compose, MinIO, Mailpit.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `app/` | Pages, layouts, route handlers, server actions, and error boundaries. |
| `components/` | Accessible UI primitives and domain-focused forms/lists. |
| `lib/auth/` | Password helpers, opaque session lifecycle, SMTP mailer, rate limiter, and server role guards. |
| `lib/domain/` | State transitions, permissions, and shared query policies. |
| `lib/storage/` | S3 client, upload intent policy, storage keys, and signed reads. |
| `lib/validation/` | Zod schemas for every external mutation. |
| `prisma/` | Schema, migrations, and deterministic local seed data. |
| `tests/unit/` | Fast domain and validation tests. |
| `tests/integration/` | Database and route-action tests using local services. |
| `tests/e2e/` | Browser-level user journeys. |
| `docker-compose.yml` | PostgreSQL, MinIO, and Mailpit for development and tests. |

### Task 1: Create the runnable application baseline

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `vitest.config.ts`, `playwright.config.ts`, `docker-compose.yml`, `.env.example`
- Modify: `.gitignore`, `README.md`
- Test: `tests/unit/smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { appName } from '@/lib/config';

describe('application configuration', () => {
  it('identifies CampusLink', () => expect(appName).toBe('CampusLink'));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- tests/unit/smoke.test.ts`  
Expected: FAIL because `@/lib/config` does not exist.

- [ ] **Step 3: Create the Next.js project and configuration module**

```ts
// lib/config.ts
export const appName = 'CampusLink';
export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
```

Run: `npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir=false --import-alias='@/*' --use-npm --yes`, then add Vitest, Playwright, Docker services, and the configuration module.

- [ ] **Step 4: Verify baseline tooling**

Run: `npm run lint && npm run typecheck && npm run test:unit -- tests/unit/smoke.test.ts && npm run build`  
Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts tsconfig.json postcss.config.mjs app lib/config.ts tests docker-compose.yml .env.example README.md .gitignore
git commit -m "feat: create CampusLink application baseline"
```

### Task 2: Define schema, migration, and local seed data

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `lib/db.ts`, `lib/domain/content-status.ts`
- Test: `tests/unit/content-status.test.ts`, `tests/integration/schema-constraints.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import { expect, it } from 'vitest';
import { transitionContent } from '@/lib/domain/content-status';

it('allows a pending resource to become published', () => {
  expect(transitionContent('PENDING', 'PUBLISHED')).toBe('PUBLISHED');
});

it('rejects a published resource returning to pending', () => {
  expect(() => transitionContent('PUBLISHED', 'PENDING')).toThrow('Invalid content transition');
});
```

- [ ] **Step 2: Run the lifecycle tests**

Run: `npm run test:unit -- tests/unit/content-status.test.ts`  
Expected: FAIL because the domain module does not exist.

- [ ] **Step 3: Implement the Prisma schema and transition guard**

```ts
const validTransitions = {
  DRAFT: ['PENDING'], PENDING: ['PUBLISHED', 'REJECTED', 'ARCHIVED'],
  PUBLISHED: ['HIDDEN', 'ARCHIVED'], REJECTED: ['DRAFT'], HIDDEN: ['PUBLISHED', 'ARCHIVED'], ARCHIVED: [],
} as const;

export function transitionContent(from: keyof typeof validTransitions, to: string) {
  if (!validTransitions[from].includes(to as never)) throw new Error('Invalid content transition');
  return to;
}
```

Create models and unique constraints described in the design for `Campus`, `User`, `Session`, `VerificationToken`, `Asset`, each content type, `Favourite`, `Report`, `ModerationAction`, and `AuditLog`; seed verified student, moderator, admin, categories, and published examples.

- [ ] **Step 4: Migrate and prove constraints**

Run: `docker compose up -d postgres && npm run db:migrate && npm run db:seed && npm run test:integration -- tests/integration/schema-constraints.test.ts`  
Expected: migration and seed succeed; a duplicate favourite and duplicate open report are rejected.

- [ ] **Step 5: Commit**

```bash
git add prisma lib/db.ts lib/domain/content-status.ts tests/unit/content-status.test.ts tests/integration/schema-constraints.test.ts
git commit -m "feat: add CampusLink domain schema"
```

### Task 3: Implement verified credentials authentication and RBAC

**Files:**
- Create: `app/api/auth/sign-up/route.ts`, `app/api/auth/sign-in/route.ts`, `app/api/auth/sign-out/route.ts`, `app/api/auth/verify/route.ts`, `app/auth/sign-in/page.tsx`, `app/auth/sign-up/page.tsx`, `app/auth/verify/page.tsx`, `lib/auth/credentials.ts`, `lib/auth/auth-service.ts`, `lib/auth/session.ts`, `lib/auth/guards.ts`, `lib/auth/mailer.ts`, `lib/auth/rate-limit.ts`
- Test: `tests/unit/auth-*.test.ts`, `tests/integration/auth-flow.test.ts`; add Playwright only once a disposable seeded test database can execute the browser flow reliably.

- [ ] **Step 1: Write failing password and guard tests**

```ts
expect(validatePassword('CampusLink2026!').success).toBe(true);
expect(validatePassword('short').success).toBe(false);
await expect(requireRole({ role: 'STUDENT' }, 'MODERATOR')).rejects.toThrow('Forbidden');
```

- [ ] **Step 2: Run the focused tests**

Run: `npm run test:unit -- tests/unit/password.test.ts tests/unit/guards.test.ts`  
Expected: FAIL because authentication helpers do not exist.

- [ ] **Step 3: Add server-only opaque-session authentication implementation**

```ts
export async function requireRole(required: ('MODERATOR' | 'ADMIN')[]) {
  // Resolve and verify the opaque session server-side, then enforce RBAC.
}
```

Hash passwords with bcrypt, normalize e-mail before the campus-domain check, and issue 32-byte opaque random tokens. Store only SHA-256 hashes for the 24-hour verification token and database session; return the raw verification token only in SMTP delivery and the raw session token only in the `HttpOnly`, `Secure`-in-production, `SameSite=Lax`, `__Host-campuslink-session` cookie. One-time verification activates the account, sign-out revokes the stored session hash, and pending/suspended users cannot create or retain mutating sessions. The injectable in-memory rate limiter is local/single-instance protection only; production multi-instance deployment requires a shared replacement. SMTP fallback must never log a link or token.

- [ ] **Step 4: Verify browser flow**

Run: `npm run test:integration -- tests/integration/auth-flow.test.ts`
Expected: when `DATABASE_URL` is available, sign-up writes a pending user, verification activates it once, unverified sign-in fails, verified sign-in creates only a hashed session, and guards reject missing/insufficient roles. Without `DATABASE_URL`, this integration suite explicitly skips; no empty browser test is claimed as coverage.

- [ ] **Step 5: Commit**

```bash
git add auth.ts app/api/auth app/auth lib/auth lib/validation/auth.ts tests
git commit -m "feat: add verified user authentication and RBAC"
```

### Task 4: Implement constrained direct-to-storage uploads

**Files:**
- Create: `lib/storage/client.ts`, `lib/storage/keys.ts`, `lib/storage/policy.ts`, `app/api/uploads/intent/route.ts`, `app/api/uploads/complete/route.ts`, `components/uploads/file-uploader.tsx`, `lib/validation/upload.ts`
- Test: `tests/unit/upload-policy.test.ts`, `tests/integration/uploads.test.ts`

- [ ] **Step 1: Write failing upload-policy tests**

```ts
expect(validateUpload({ kind: 'RESOURCE', contentType: 'application/pdf', sizeBytes: 1024, fileName: 'notes.pdf' }).success).toBe(true);
expect(validateUpload({ kind: 'MARKETPLACE_IMAGE', contentType: 'image/svg+xml', sizeBytes: 1024, fileName: 'x.svg' }).success).toBe(false);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- tests/unit/upload-policy.test.ts`  
Expected: FAIL because the upload policy does not exist.

- [ ] **Step 3: Implement intent, upload completion, and uploader UI**

```ts
export function buildStorageKey(ownerId: string, assetId: string, extension: string) {
  return `campus/${ownerId}/${assetId}.${extension}`;
}
```

Mint a five-minute PUT URL after Zod policy validation. On completion issue a `HEAD` request, compare stored content type and size with the intent, create a `READY` asset record, and return its ID. The client shows validation errors, byte progress, cancellation, and retry.

- [ ] **Step 4: Verify storage integration**

Run: `docker compose up -d minio && npm run test:integration -- tests/integration/uploads.test.ts`  
Expected: a PDF creates a ready asset; SVG and oversize files are rejected; another user cannot finalize the first user's intent.

- [ ] **Step 5: Commit**

```bash
git add lib/storage app/api/uploads components/uploads lib/validation/upload.ts tests
git commit -m "feat: add safe direct file uploads"
```

### Task 5: Build typed content creation, discovery, and ownership views

**Files:**
- Create: `lib/validation/content.ts`, `lib/domain/content-service.ts`, `app/resources/page.tsx`, `app/resources/[id]/page.tsx`, `app/marketplace/page.tsx`, `app/marketplace/[id]/page.tsx`, `app/jobs/page.tsx`, `app/jobs/[id]/page.tsx`, `app/submit/resource/page.tsx`, `app/submit/marketplace/page.tsx`, `app/submit/job/page.tsx`, `app/me/submissions/page.tsx`, `components/content/*`
- Test: `tests/unit/content-service.test.ts`, `tests/integration/content-actions.test.ts`, `tests/e2e/publish-content.spec.ts`

- [ ] **Step 1: Write failing submission tests**

```ts
await expect(submitResource({ actorId: student.id, title: 'Algorithms notes', assetIds: [] })).rejects.toThrow('Resource requires a document');
await expect(submitMarketplaceItem({ actorId: student.id, title: 'Desk lamp', imageIds: [] })).rejects.toThrow('Marketplace item requires an image');
```

- [ ] **Step 2: Run the service test**

Run: `npm run test:unit -- tests/unit/content-service.test.ts`  
Expected: FAIL because the content service does not exist.

- [ ] **Step 3: Implement content actions and responsive UI**

```ts
if (!assetIds.length) throw new Error(kind === 'RESOURCE' ? 'Resource requires a document' : 'Marketplace item requires an image');
await assertOwnedReadyAssets(actorId, assetIds, kind);
return prisma.resource.update({ where: { id }, data: { status: 'PENDING' } });
```

Use route query parameters for search, category, price, and pagination. Render only published records outside the owner and moderator views. Use the CampusLink tokens from `design/stitch-export/DESIGN.md` in a responsive navigation, cards, forms, empty states, and error states.

- [ ] **Step 4: Verify the three publishing journeys**

Run: `npm run test:integration -- tests/integration/content-actions.test.ts && npm run test:e2e -- tests/e2e/publish-content.spec.ts`  
Expected: a verified student can create draft, upload required assets, submit resource/marketplace/job, and see `PENDING`; an unverified account cannot do so.

- [ ] **Step 5: Commit**

```bash
git add app/resources app/marketplace app/jobs app/submit app/me components/content lib/domain/content-service.ts lib/validation/content.ts tests
git commit -m "feat: add moderated campus content publishing"
```

### Task 6: Add favourites, contact requests, and reports

**Files:**
- Create: `lib/domain/favourites.ts`, `lib/domain/reports.ts`, `app/api/favourites/route.ts`, `app/api/reports/route.ts`, `app/api/marketplace/[id]/contact/route.ts`, `app/me/favourites/page.tsx`, `components/content/favourite-button.tsx`, `components/content/report-dialog.tsx`
- Test: `tests/unit/reports.test.ts`, `tests/integration/favourites-and-reports.test.ts`, `tests/e2e/favourite-report.spec.ts`

- [ ] **Step 1: Write failing domain tests**

```ts
await expect(createReport({ reporterId: 'u1', targetOwnerId: 'u1', targetId: 'r1', reason: 'SPAM' })).rejects.toThrow('Cannot report own content');
await toggleFavourite({ userId: 'u1', targetType: 'RESOURCE', targetId: 'r1' });
expect(await hasFavourite('u1', 'RESOURCE', 'r1')).toBe(true);
```

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- tests/unit/reports.test.ts`  
Expected: FAIL because report and favourite domain services do not exist.

- [ ] **Step 3: Implement idempotent actions**

```ts
await prisma.favourite.upsert({
  where: { userId_targetType_targetId: { userId, targetType, targetId } },
  update: {}, create: { userId, targetType, targetId },
});
```

Validate target visibility before creating a favourite/report, reject duplicate open reports, redact private moderator notes from reporter responses, and audit every contact request.

- [ ] **Step 4: Verify end-to-end**

Run: `npm run test:integration -- tests/integration/favourites-and-reports.test.ts && npm run test:e2e -- tests/e2e/favourite-report.spec.ts`  
Expected: favourite toggles exactly once, duplicate/self reports fail, and a marketplace contact request is logged.

- [ ] **Step 5: Commit**

```bash
git add app/api/favourites app/api/reports app/api/marketplace app/me/favourites components/content lib/domain/favourites.ts lib/domain/reports.ts tests
git commit -m "feat: add favourites reports and contact requests"
```

### Task 7: Deliver moderator and administrator workspaces

**Files:**
- Create: `app/admin/layout.tsx`, `app/admin/moderation/page.tsx`, `app/admin/reports/page.tsx`, `app/admin/users/page.tsx`, `app/admin/audit-log/page.tsx`, `lib/domain/moderation.ts`, `lib/domain/audit.ts`, `components/admin/*`
- Test: `tests/unit/moderation.test.ts`, `tests/integration/admin-actions.test.ts`, `tests/e2e/moderation.spec.ts`

- [ ] **Step 1: Write failing decision test**

```ts
await approveContent({ actor: moderator, subjectType: 'RESOURCE', subjectId: resource.id, reason: 'Course and file are appropriate' });
expect((await getResource(resource.id)).status).toBe('PUBLISHED');
expect(await countModerationActions(resource.id)).toBe(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- tests/unit/moderation.test.ts`  
Expected: FAIL because moderation service does not exist.

- [ ] **Step 3: Implement review queues and immutable audit records**

```ts
await prisma.$transaction([
  prisma.resource.update({ where: { id: subjectId }, data: { status: 'PUBLISHED' } }),
  prisma.moderationAction.create({ data: { actorId: actor.id, subjectType, subjectId, action: 'APPROVE', reason } }),
  prisma.auditLog.create({ data: { actorId: actor.id, event: 'CONTENT_APPROVED', entityType: subjectType, entityId: subjectId } }),
]);
```

Gate all `/admin` pages on moderator or administrator role. Require a non-empty reason for every decision. Restrict role changes and campus domain edits to administrators, and prevent demoting the final active administrator.

- [ ] **Step 4: Verify permission boundaries and review flow**

Run: `npm run test:integration -- tests/integration/admin-actions.test.ts && npm run test:e2e -- tests/e2e/moderation.spec.ts`  
Expected: student access to `/admin` is denied; moderator can approve/hide/resolve; every action has an audit record.

- [ ] **Step 5: Commit**

```bash
git add app/admin components/admin lib/domain/moderation.ts lib/domain/audit.ts tests
git commit -m "feat: add audited moderation and administration"
```

### Task 8: Harden, document, and verify the release

**Files:**
- Create: `middleware.ts`, `lib/security/rate-limit.ts`, `lib/security/sanitize.ts`, `.github/workflows/ci.yml`, `docs/deployment.md`, `docs/operations.md`, `tests/e2e/authorization.spec.ts`
- Modify: `README.md`, `.env.example`, `docker-compose.yml`

- [ ] **Step 1: Write failing authorization cases**

```ts
await expect(downloadAsset(anonymous, privateAsset.id)).rejects.toThrow('Unauthenticated');
await expect(downloadAsset(otherStudent, privateAsset.id)).rejects.toThrow('Forbidden');
```

- [ ] **Step 2: Run focused tests**

Run: `npm run test:unit -- tests/unit/security.test.ts`  
Expected: FAIL because access policy is not implemented.

- [ ] **Step 3: Add layered release protections and documentation**

```ts
export function assertAssetReadable(asset: { ownerId: string; status: string }, userId?: string) {
  if (asset.status === 'PUBLISHED') return;
  if (!userId) throw new Error('Unauthenticated');
  if (asset.ownerId !== userId) throw new Error('Forbidden');
}
```

Add security headers, origin checks for mutations, rate limits, text sanitization, CI stages, a complete environment-variable table, database backup instructions, upload-retention policy, malware-scanner integration point, and deployment commands.

- [ ] **Step 4: Run the full verification matrix**

Run: `npm run format:check && npm run lint && npm run typecheck && npm run test:unit && npm run test:integration && npm run build && npm run test:e2e`  
Expected: every command exits 0; Playwright covers sign-up, verification, submission, upload, favourite, report, and moderation.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts lib/security .github docs README.md .env.example docker-compose.yml tests
git commit -m "chore: harden and document production release"
```

### Task 9: Register Stitch MCP without exposing secrets

**Files:**
- Modify: user-level Codex configuration outside the repository
- Test: Codex tool discovery after restart

- [ ] **Step 1: Back up and patch the user configuration**

Add the supplied HTTP MCP endpoint below `[mcp_servers]` and keep its API key only in the user-level config:

```toml
[mcp_servers.stitch]
url = "https://stitch.googleapis.com/mcp"

[mcp_servers.stitch.http_headers]
# Insert the API key supplied by the user in this private configuration file.
```

- [ ] **Step 2: Restart Codex and inspect exposed tools**

Expected: Stitch tools are listed in the next Codex session. The secret is absent from the Git repository and from command output.

- [ ] **Step 3: Commit repository documentation only**

```bash
git add docs/operations.md
git commit -m "docs: describe Stitch MCP setup"
```

## Plan self-review

The tasks map every required capability to a verified implementation: Task 3 is login and identity, Task 4 is resource and product upload infrastructure, Task 5 is content publishing, Task 6 is favourites and reports, Task 7 is staff review, and Task 8 is release-quality protection and test evidence. The plan does not include unstated payment, shipping, or chat features. All named services, transitions, endpoints, limits, and verification commands are defined before their use.
