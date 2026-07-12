# CampusLink Governance Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Task 7 governance review gaps with campus-scoped persistence, exact state transitions, safe serialization, complete staff workspaces, strict audit browsing, and concurrency-safe final-admin protection.

**Architecture:** Persist `campusId` directly on every report and audit record, backfill it from the owning actor in the unapplied Task 7 migration, and require it in every application write and staff predicate. Keep governance transitions in domain services with conditional writes and immutable history, expose only JSON-safe DTOs from route handlers, and exercise live behavior behind the existing fail-closed integration/E2E gates.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Zod, Vitest, Playwright.

---

### Task 1: Define the red governance contract

**Files:**
- Create: `tests/unit/admin-governance-remediation.test.ts`
- Modify: `tests/unit/admin-schema.contract.test.ts`
- Modify: `tests/unit/moderation.test.ts`
- Modify: `tests/unit/administration.test.ts`
- Modify: `tests/unit/admin-routes.test.ts`
- Modify: `tests/unit/content-service.test.ts`
- Modify: `tests/unit/admin-ui.contract.test.ts`
- Modify: `tests/integration/admin-actions.test.ts`
- Modify: `tests/e2e/moderation.spec.ts`

- [ ] **Step 1: Add failing schema and campus-isolation assertions**

```ts
expect(schema).toMatch(/model Report[\s\S]*campusId\s+String/);
expect(schema).toMatch(/model AuditLog[\s\S]*campusId\s+String/);
expect(reportQuery.where).toMatchObject({ campusId: actor.campusId });
expect(auditQuery.where).toMatchObject({ campusId: actor.campusId });
```

- [ ] **Step 2: Add failing lifecycle, DTO, decision, filter, and retry assertions**

```ts
expect(triageWhere).toEqual({ campusId, id: reportId, status: 'OPEN' });
expect(resolveWhere).toEqual({ campusId, id: reportId, status: 'TRIAGED' });
expect(responseBody.items[0].assets[0].sizeBytes).toBe('4096');
expect(latestDecision).toMatchObject({ decisionAction: 'RESTORE', decisionReason: reason });
await expect(exhaustedSerializationRetry).rejects.toBeInstanceOf(AdminConflictError);
```

- [ ] **Step 3: Run the focused unit suite and verify failures are caused by the missing behavior**

Run: `npm run test:unit -- tests/unit/admin-schema.contract.test.ts tests/unit/moderation.test.ts tests/unit/administration.test.ts tests/unit/admin-routes.test.ts tests/unit/content-service.test.ts tests/unit/admin-ui.contract.test.ts tests/unit/admin-governance-remediation.test.ts`

Expected: FAIL on campus predicates/columns, report transitions, BigInt serialization, latest-action selection, audit parsing/pagination, and serialization retry.

- [ ] **Step 4: Commit the red contract**

```bash
git add docs/superpowers/plans tests prisma/migrations
git commit -m "test: define campus-scoped governance remediation"
```

### Task 2: Persist immutable campus ownership

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/20260712223000_add_admin_moderation_actions/migration.sql`
- Modify: `lib/domain/reports.ts`
- Modify: `lib/domain/marketplace-contact.ts`
- Modify: `lib/domain/moderation.ts`
- Modify: `lib/domain/administration.ts`
- Modify: integration/E2E fixture writes under `tests/`

- [ ] **Step 1: Add required relations and indexes**

```prisma
model Report {
  campusId String
  campus Campus @relation(fields: [campusId], references: [id], onDelete: Restrict)
  @@index([campusId, status, createdAt, id])
}

model AuditLog {
  campusId String
  campus Campus @relation(fields: [campusId], references: [id], onDelete: Restrict)
  @@index([campusId, createdAt, id])
}
```

- [ ] **Step 2: Backfill safely and reject actorless legacy audit rows**

```sql
UPDATE "Report" r SET "campusId" = u."campusId" FROM "User" u WHERE r."reporterId" = u.id;
UPDATE "AuditLog" a SET "campusId" = u."campusId" FROM "User" u WHERE a."actorId" = u.id;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "AuditLog" WHERE "campusId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot backfill actorless AuditLog campus ownership';
  END IF;
END $$;
```

- [ ] **Step 3: Supply `campusId` in every report/audit write and predicate**

```ts
data: { campusId: actor.campusId, actorId: actor.id, ... }
where: { campusId: actor.campusId, id: input.reportId, status: 'TRIAGED' }
```

- [ ] **Step 4: Run schema and campus tests**

Run: `npm run test:unit -- tests/unit/admin-schema.contract.test.ts tests/unit/reports.test.ts tests/unit/marketplace-contact.test.ts tests/unit/moderation.test.ts tests/unit/administration.test.ts`

Expected: PASS.

### Task 3: Enforce exact report transitions and safe queues

**Files:**
- Modify: `lib/domain/moderation.ts`
- Modify: `app/api/admin/moderation/route.ts`
- Modify: `app/api/admin/reports/route.ts`

- [ ] **Step 1: Implement exact conditional transitions**

```ts
const reportTransitions = {
  TRIAGE: { from: 'OPEN', to: 'TRIAGED' },
  DISMISS: { from: 'TRIAGED', to: 'DISMISSED' },
  RESOLVE: { from: 'TRIAGED', to: 'RESOLVED' },
} as const;
```

- [ ] **Step 2: Add status-aware content queues and a JSON-safe DTO**

```ts
export function toModerationQueueDto(items: ModerationQueueItem[]) {
  return items.map((item) => ({
    ...item,
    assets: item.assets.map((asset) => ({ ...asset, sizeBytes: String(asset.sizeBytes) })),
  }));
}
```

- [ ] **Step 3: Run route and moderation tests**

Run: `npm run test:unit -- tests/unit/moderation.test.ts tests/unit/admin-routes.test.ts`

Expected: PASS.

### Task 4: Show current decisions and complete moderation/report UI

**Files:**
- Modify: `lib/domain/content-service.ts`
- Modify: `app/me/submissions/page.tsx`
- Modify: `app/admin/moderation/page.tsx`
- Modify: `app/admin/reports/page.tsx`
- Modify: `components/admin/report-action-form.tsx`

- [ ] **Step 1: Select the latest action across all content decisions**

```ts
where: { action: { in: ['APPROVE', 'REJECT', 'HIDE', 'RESTORE', 'ARCHIVE'] }, ... }
```

- [ ] **Step 2: Render PENDING/PUBLISHED/HIDDEN queues with valid actions**

```ts
const actions = status === 'PENDING'
  ? ['APPROVE', 'REJECT', 'ARCHIVE']
  : status === 'PUBLISHED'
    ? ['HIDE', 'ARCHIVE']
    : ['RESTORE', 'ARCHIVE'];
```

- [ ] **Step 3: Add target links and safe immutable history to report cards**

```tsx
<Link href={targetHref(report.targetType, report.targetId)}>Open target details</Link>
<ol aria-label="Prior moderation history">...</ol>
```

- [ ] **Step 4: Run content/UI contract tests**

Run: `npm run test:unit -- tests/unit/content-service.test.ts tests/unit/admin-ui.contract.test.ts`

Expected: PASS.

### Task 5: Add strict campus-scoped audit browsing

**Files:**
- Modify: `lib/domain/audit.ts`
- Modify: `app/api/admin/audit-log/route.ts`
- Modify: `app/admin/audit-log/page.tsx`

- [ ] **Step 1: Parse only strict audit filters and opaque cursors**

```ts
parseAuditQuery({ actor, event, entityType, entityId, from, to, pageSize, cursor });
```

- [ ] **Step 2: Apply campus scope and stable `(createdAt,id)` pagination**

```ts
where: { campusId: actor.campusId, ...filters, OR: cursorPredicate }
```

- [ ] **Step 3: Populate the filter form and preserve filters in the next link**

```tsx
<input defaultValue={filters.event ?? ''} name="event" />
<Link href={`?${nextSearchParams}`}>Next page</Link>
```

- [ ] **Step 4: Run audit route/UI tests**

Run: `npm run test:unit -- tests/unit/administration.test.ts tests/unit/admin-routes.test.ts tests/unit/admin-ui.contract.test.ts`

Expected: PASS.

### Task 6: Retry final-admin serialization races

**Files:**
- Modify: `lib/domain/administration.ts`
- Modify: `tests/integration/admin-actions.test.ts`

- [ ] **Step 1: Retry bounded serialization failures and translate exhaustion**

```ts
for (let attempt = 0; attempt < 3; attempt += 1) {
  try { return await adapter.$transaction(operation, { isolationLevel: 'Serializable' }); }
  catch (error) { if (!isSerializationFailure(error)) throw error; }
}
throw new AdminConflictError('Concurrent administration change');
```

- [ ] **Step 2: Add a live concurrent demotion/suspension test**

```ts
await Promise.allSettled([
  updateManagedUser(db, adminA, { userId: adminB.id, role: 'STUDENT', reason }),
  updateManagedUser(db, adminB, { userId: adminA.id, status: 'SUSPENDED', reason }),
]);
expect(await activeAdminCount()).toBe(1);
```

- [ ] **Step 3: Run unit retry tests and gated integration test**

Run: `npm run test:unit -- tests/unit/administration.test.ts`

Run: `npm run test:integration -- tests/integration/admin-actions.test.ts`

Expected: unit PASS; live integration PASS when services are provisioned, otherwise the local explicit gate skips and CI remains fail-closed.

### Task 7: Expand deterministic live governance coverage

**Files:**
- Modify: `tests/integration/admin-actions.test.ts`
- Modify: `tests/e2e/moderation.spec.ts`
- Modify: `tests/helpers/e2e-environment.ts`
- Modify: `.env.example`

- [ ] **Step 1: Cover role/status/session revocation, campus config, isolation, reject/restore, privacy, and audit filters in integration**

- [ ] **Step 2: Cover moderator reject/restore and administrator controls in E2E with run-scoped rows and exact cleanup**

- [ ] **Step 3: Run both gate demonstrations**

Run: `$env:ALLOW_SKIPPED_INTEGRATION='true'; npm run test:integration`

Run: `$env:ALLOW_SKIPPED_E2E='true'; npm run test:e2e`

Expected: explicit local skips without services; CI rejects the skip flags.

### Task 8: Verify and commit the green implementation

**Files:** all Task 7 files changed above.

- [ ] **Step 1: Run full verification**

```powershell
npm run test:unit
npm run typecheck
npm run lint
npm run format:check
npx prisma validate
npm run db:generate
npm run build
```

- [ ] **Step 2: Commit the fix**

```bash
git add .
git commit -m "fix(admin): enforce campus-scoped governance"
```

- [ ] **Step 3: Confirm clean status**

Run: `git status --short --branch`

Expected: clean `feat/campuslink-product` worktree.
