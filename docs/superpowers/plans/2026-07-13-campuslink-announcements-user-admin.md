# CampusLink Announcements And User Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-only announcements with reliable permanent image deletion and upgrade user governance to searchable, paginated, audited operations.

**Architecture:** Model announcements independently from moderated user content. Use a database outbox-style `StorageDeletionJob` to bridge transactional database deletion and non-transactional object storage deletion; extend the existing administration domain rather than creating a second admin framework.

**Tech Stack:** Next.js App Router, Prisma/PostgreSQL, S3-compatible storage, Zod, Vitest, Playwright.

---

### Task 1: Add Announcement And Storage Deletion Schema

**Files:**
- Create: `prisma/migrations/20260713170000_add_announcements/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `lib/validation/upload.ts`
- Modify: `lib/storage/keys.ts`
- Test: `tests/unit/announcement-schema.contract.test.ts`
- Test: `tests/unit/upload-policy.test.ts`
- Test: `tests/integration/schema-constraints.test.ts`

- [ ] **Step 1: Write failing schema contracts**

Require `ANNOUNCEMENT_IMAGE`, `ANNOUNCEMENT`, one optional announcement asset relation, and a deletion job with a unique storage key.

```ts
expect(schema).toContain('model Announcement');
expect(schema).toContain('ANNOUNCEMENT_IMAGE');
expect(schema).toMatch(/announcementId\s+String\?\s+@unique/);
expect(schema).toContain('model StorageDeletionJob');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/announcement-schema.contract.test.ts tests/unit/upload-policy.test.ts`  
Expected: FAIL because no announcement models or upload kind exist.

- [ ] **Step 3: Implement expand-only Prisma and upload changes**

Add fields equivalent to:

```prisma
model Announcement {
  id          String   @id @default(cuid())
  campusId    String
  authorId    String
  title       String   @db.VarChar(200)
  body        String   @db.Text
  isPinned    Boolean  @default(false)
  publishedAt DateTime @default(now())
  campus      Campus   @relation(fields: [campusId], references: [id], onDelete: Restrict)
  author      User     @relation(fields: [authorId], references: [id], onDelete: Restrict)
  cover       Asset?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([campusId, isPinned, publishedAt, id])
}

model StorageDeletionJob {
  id          String   @id @default(cuid())
  storageKey  String   @unique @db.VarChar(512)
  attempts    Int      @default(0)
  nextAttempt DateTime @default(now())
  lastError   String?  @db.VarChar(200)
  createdAt   DateTime @default(now())
  @@index([nextAttempt, id])
}
```

Extend `Asset` with unique nullable `announcementId`; add image-only validation and an `announcements/<owner>/<asset>` storage prefix.

- [ ] **Step 4: Verify schema and constraints**

Run: `npm run db:generate`  
Expected: Prisma Client generation succeeds.  
Run: `npm run test:integration -- tests/integration/schema-constraints.test.ts`  
Expected: PASS, including rejection of a second cover for one announcement.

- [ ] **Step 5: Commit**

```powershell
git add prisma lib/validation/upload.ts lib/storage/keys.ts tests
git commit -m "feat: add announcement persistence"
git push
```

### Task 2: Implement Announcement Domain And Reliable Deletion

**Files:**
- Create: `lib/domain/announcements.ts`
- Create: `lib/storage/deletion-jobs.ts`
- Create: `app/api/admin/announcements/route.ts`
- Create: `app/api/internal/storage-deletions/route.ts`
- Modify: `lib/domain/admin-route.ts`
- Modify: `lib/domain/audit.ts`
- Test: `tests/unit/announcements.test.ts`
- Test: `tests/unit/announcement-routes.test.ts`
- Test: `tests/integration/announcements.test.ts`

- [ ] **Step 1: Write failing domain tests**

Cover administrator-only create, one pinned announcement per campus, cover ownership/readiness, minimal delete audit, and retryable storage deletion.

```ts
await createAnnouncement(db, admin, {
  body: '暑期交易请优先选择公共区域。',
  coverAssetId: 'asset_1',
  isPinned: true,
  title: '暑期交易安全提醒',
});
expect(db.announcement.updateMany).toHaveBeenCalledWith(
  expect.objectContaining({ data: { isPinned: false } }),
);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/announcements.test.ts tests/unit/announcement-routes.test.ts`  
Expected: FAIL because the announcement service and route do not exist.

- [ ] **Step 3: Implement typed inputs and transactional operations**

Use a strict schema and explicit actor type:

```ts
export const announcementInput = z.object({
  body: z.string().trim().min(1).max(10_000),
  coverAssetId: z.string().trim().min(1).max(191).nullable(),
  isPinned: z.boolean(),
  title: z.string().trim().min(3).max(200),
}).strict();
```

Create and pin in a serializable transaction. Delete the announcement and asset row, enqueue `storageKey`, and write `ANNOUNCEMENT_DELETED` with only `{ hadCover: boolean }`. After commit, process the job immediately; leave it queued with bounded error text and exponential next-attempt time when S3 fails.

- [ ] **Step 4: Verify unit and integration behavior**

Run: `npm run test:unit -- tests/unit/announcements.test.ts tests/unit/announcement-routes.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/announcements.test.ts`  
Expected: PASS, including idempotent retry when the object is already absent.

- [ ] **Step 5: Commit**

```powershell
git add lib/domain/announcements.ts lib/storage/deletion-jobs.ts app/api/admin/announcements app/api/internal/storage-deletions lib/domain tests
git commit -m "feat: add audited announcement workflows"
git push
```

### Task 3: Build Announcement Admin, Home Banner, And Drawer

**Files:**
- Create: `app/admin/announcements/page.tsx`
- Create: `components/admin/announcement-form.tsx`
- Create: `components/admin/announcement-actions.tsx`
- Create: `app/announcements/page.tsx`
- Create: `components/announcements/announcement-center.tsx`
- Create: `components/announcements/announcement-drawer.tsx`
- Modify: `app/admin/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/announcement-ui.contract.test.ts`
- Test: `tests/e2e/announcements.spec.ts`

- [ ] **Step 1: Write failing UI contracts and E2E scenario**

The E2E flow signs in as admin, publishes a Chinese announcement with an image, pins it, sees it at the bottom of Hero, opens `/announcements?announcement=<id>`, verifies the matching image, then permanently deletes it through the second confirmation.

```ts
await expect(page.getByRole('heading', { name: '公告管理' })).toBeVisible();
await expect(page.getByText('暑期交易安全提醒')).toBeVisible();
await expect(page.getByRole('dialog')).toContainText('不可恢复');
```

- [ ] **Step 2: Run contracts and confirm failure**

Run: `npm run test:unit -- tests/unit/announcement-ui.contract.test.ts`  
Expected: FAIL because none of the pages exist.

- [ ] **Step 3: Implement accessible admin and public views**

Use `FileUploader kind="ANNOUNCEMENT_IMAGE"`, semantic forms, and a native dialog for deletion. On the public page, derive selected ID from `searchParams`; render a right drawer above 760 px and full-screen panel below it. Render the generated brand fallback image when no cover exists. The Hero query selects `isPinned desc, publishedAt desc, id desc` and returns one row.

- [ ] **Step 4: Verify UI behavior**

Run: `npm run test:unit -- tests/unit/announcement-ui.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/announcements.spec.ts`  
Expected: PASS on desktop and mobile projects.

- [ ] **Step 5: Commit**

```powershell
git add app/admin app/announcements app/page.tsx app/globals.css components tests
git commit -m "feat: add announcement management and center"
git push
```

### Task 4: Upgrade User Governance

**Files:**
- Modify: `lib/domain/administration.ts`
- Modify: `app/api/admin/users/route.ts`
- Modify: `app/admin/users/page.tsx`
- Modify: `components/admin/user-action-form.tsx`
- Create: `components/admin/user-filters.tsx`
- Create: `components/admin/user-detail-drawer.tsx`
- Test: `tests/unit/administration.test.ts`
- Test: `tests/unit/admin-routes.test.ts`
- Test: `tests/unit/admin-ui.contract.test.ts`
- Test: `tests/integration/admin-actions.test.ts`
- Test: `tests/e2e/user-management.spec.ts`

- [ ] **Step 1: Write failing query, force-logout, and detail tests**

Require stable cursor pagination, email/name search, role/status/verification filters, aggregate counts, and a dedicated force-logout event.

```ts
expect(result).toMatchObject({ hasNextPage: true, nextCursor: expect.any(String) });
expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
expect(db.auditLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ action: 'USER_SESSIONS_REVOKED' }),
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm run test:unit -- tests/unit/administration.test.ts tests/unit/admin-routes.test.ts tests/unit/admin-ui.contract.test.ts`  
Expected: FAIL because listing returns a bare array and no detail/force-logout operation exists.

- [ ] **Step 3: Implement bounded query parsing and focused operations**

Add a strict query parser with `search`, `role`, `status`, `verified`, `pageSize`, and opaque cursor. Return only the current campus. Add `getManagedUserDetail` and `revokeManagedUserSessions`; retain the existing serializable last-admin check and required reason.

- [ ] **Step 4: Build list filters and detail drawer**

Render server-driven filters in the URL. The drawer has overview, submissions, reports, and audit tabs. Use “普通用户” for the internal `STUDENT` role. Do not add permanent delete or student-verification controls.

- [ ] **Step 5: Verify and checkpoint Phase 2**

Run: `npm run test:unit -- tests/unit/administration.test.ts tests/unit/admin-routes.test.ts tests/unit/admin-ui.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/admin-actions.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/user-management.spec.ts`  
Expected: PASS.

```powershell
git add lib/domain/administration.ts app/api/admin/users app/admin/users components/admin tests
git commit -m "feat: upgrade administrator user governance"
git tag -a community-expansion-phase-2 -m "Announcements and user governance complete"
git push
git push origin community-expansion-phase-2
```
