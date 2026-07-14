# CampusLink Publishing, Tags, And Campus Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give resources, marketplace items, and campus work consistent preset/custom tags, complete the unified publishing paths, and replace legacy jobs with audited campus-work contact reveal.

**Architecture:** Use a scoped `TagDefinition` table plus explicit foreign-key join tables, avoiding generic target IDs. Migrate `JobPost` in expand/contract steps and preserve `/jobs` redirects while new code reads and writes `CampusWorkPost` semantics.

**Tech Stack:** Prisma/PostgreSQL, Next.js App Router, React, Zod, Vitest, Playwright.

---

### Task 1: Add Scoped Tags And Campus Work Expand Migration

**Files:**
- Create: `prisma/migrations/20260713190000_add_tags_and_campus_work/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`
- Test: `tests/unit/content-migrations.contract.test.ts`
- Test: `tests/unit/prisma-schema.contract.test.ts`
- Test: `tests/integration/schema-constraints.test.ts`

- [ ] **Step 1: Write failing migration and schema contracts**

Require `TagScope`, `TagDefinition`, three join models, campus-work contact, and the approved initial tags.

```ts
for (const tag of ['COS委托', '校园跑腿', '临时兼职', '技能服务', '其他']) {
  expect(seedSource).toContain(tag);
}
expect(schema).toContain('model CampusWorkTag');
expect(schema).toContain('contact      String');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/content-migrations.contract.test.ts tests/unit/prisma-schema.contract.test.ts`  
Expected: FAIL because tags and campus-work fields do not exist.

- [ ] **Step 3: Implement expand models and non-destructive SQL**

Use one definition model and explicit joins:

```prisma
enum TagScope { RESOURCE MARKETPLACE CAMPUS_WORK }

model TagDefinition {
  id        String   @id @default(cuid())
  campusId  String
  scope     TagScope
  label     String   @db.VarChar(32)
  slug      String   @db.VarChar(40)
  isPreset  Boolean  @default(false)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  @@unique([campusId, scope, slug])
  @@index([campusId, scope, isActive, label])
}
```

Add nullable campus-work contact and compatibility fields first. Copy every `JobPost` row without changing IDs, author IDs, campus IDs, timestamps, or statuses. Do not drop the legacy table/columns in this task.

Deployment note: migration `20260713190000` takes a short `SHARE ROW EXCLUSIVE` lock on `JobPost` while it installs and verifies the compatibility copy. After commit, a sync trigger bridges legacy inserts, updates, and deletes until the Phase 5 contract migration removes the legacy writer path.

- [ ] **Step 4: Verify migration integrity**

Run: `npm run db:generate`  
Expected: success.  
Run: `npm run test:integration -- tests/integration/schema-constraints.test.ts`  
Expected: PASS, including scoped tag uniqueness and join foreign keys.

- [ ] **Step 5: Commit**

```powershell
git add prisma tests/unit/content-migrations.contract.test.ts tests/unit/prisma-schema.contract.test.ts tests/integration/schema-constraints.test.ts
git commit -m "feat: add scoped tags and campus work schema"
git push
```

### Task 2: Implement Tag Domain, Admin, And Validation

**Files:**
- Create: `lib/domain/tags.ts`
- Create: `lib/validation/tags.ts`
- Create: `app/api/admin/tags/route.ts`
- Create: `app/admin/tags/page.tsx`
- Create: `components/admin/tag-management.tsx`
- Modify: `app/admin/layout.tsx`
- Test: `tests/unit/tags.test.ts`
- Test: `tests/unit/tag-routes.test.ts`
- Test: `tests/unit/tag-ui.contract.test.ts`
- Test: `tests/integration/tags.test.ts`

- [ ] **Step 1: Write failing normalization and permission tests**

Cover NFKC normalization, whitespace collapse, case-insensitive slug uniqueness, five-tag total, two-custom maximum, inactive preset rejection, admin-only promotion, and historical display of inactive tags.

```ts
expect(normalizeTagLabel('  ＣＯＳ   委托  ')).toBe('COS 委托');
expect(() => validateSelectedTags({ custom: ['a', 'b', 'c'], presetIds: [] }))
  .toThrow(TagValidationError);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/tags.test.ts tests/unit/tag-routes.test.ts`  
Expected: FAIL because tag services do not exist.

- [ ] **Step 3: Implement typed tag operations**

Expose `listAvailableTags`, `resolveContentTags`, `createPresetTag`, `setTagActive`, and `promoteCustomTag`. `resolveContentTags` returns database IDs only after normalization, scope matching, local validation, and count enforcement.

- [ ] **Step 4: Build the admin page and verify**

Use a scope segmented control and active toggle. Every mutation requires an admin reason and writes `TAG_CREATED`, `TAG_STATUS_CHANGED`, or `TAG_PROMOTED` without storing private content.

Run: `npm run test:unit -- tests/unit/tags.test.ts tests/unit/tag-routes.test.ts tests/unit/tag-ui.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/tags.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/domain/tags.ts lib/validation/tags.ts app/api/admin/tags app/admin/tags components/admin app/admin/layout.tsx tests
git commit -m "feat: add governed content tags"
git push
```

### Task 3: Update Publishing Forms And Resource/Marketplace Services

**Files:**
- Create: `components/content/tag-selector.tsx`
- Modify: `components/content/submission-form.tsx`
- Modify: `components/content/publish-type-list.tsx`
- Modify: `components/content/edit-content-form.tsx`
- Modify: `lib/validation/content.ts`
- Modify: `lib/domain/content-service.ts`
- Modify: `lib/domain/public-content.ts`
- Modify: `app/submit/resource/page.tsx`
- Modify: `app/submit/marketplace/page.tsx`
- Test: `tests/unit/content-validation.test.ts`
- Test: `tests/unit/content-service.test.ts`
- Test: `tests/unit/submission-form.contract.test.ts`
- Test: `tests/integration/content-actions.test.ts`

- [ ] **Step 1: Write failing form and service tests**

Assert resource forms contain no `courseCode`, both forms submit `presetTagIds` and `customTags`, and services persist exactly the resolved tag relations.

```ts
expect(resourceFormSource).not.toContain('name="courseCode"');
expect(createResourceSchema.safeParse({ ...valid, customTags: ['高数'], presetTagIds: [] }).success).toBe(true);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/content-validation.test.ts tests/unit/content-service.test.ts tests/unit/submission-form.contract.test.ts`  
Expected: FAIL because forms use a comma-separated resource tag field and marketplace has no tags.

- [ ] **Step 3: Implement one reusable tag selector and transactional writes**

Use checkbox/swatch-style preset choices and at most two custom text inputs. Resolve tags inside the same transaction that creates or updates content. Keep `courseCode` readable during compatibility but stop accepting or rendering it.

- [ ] **Step 4: Verify resource and marketplace flows**

Run: `npm run test:unit -- tests/unit/content-validation.test.ts tests/unit/content-service.test.ts tests/unit/submission-form.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/content-actions.test.ts`  
Expected: PASS with tag relations rolled back when content creation fails.

- [ ] **Step 5: Commit**

```powershell
git add components/content lib/validation/content.ts lib/domain app/submit tests
git commit -m "feat: add tags to resource and marketplace publishing"
git push
```

### Task 4: Complete Campus Work Routes, UI, And Contact Reveal

**Files:**
- Create: `app/campus-work/page.tsx`
- Create: `app/campus-work/[id]/page.tsx`
- Create: `app/submit/campus-work/page.tsx`
- Create: `app/api/campus-work/route.ts`
- Create: `app/api/campus-work/[id]/route.ts`
- Create: `app/api/campus-work/[id]/contact/route.ts`
- Create: `lib/domain/campus-work-contact.ts`
- Modify: `components/content/submission-form.tsx`
- Modify: `components/content/public-list.tsx`
- Modify: `components/content/public-detail.tsx`
- Modify: `app/jobs/page.tsx`
- Modify: `app/jobs/[id]/page.tsx`
- Modify: `app/me/submissions/page.tsx`
- Test: `tests/unit/campus-work.test.ts`
- Test: `tests/unit/campus-work-contact.test.ts`
- Test: `tests/integration/content-actions.test.ts`
- Test: `tests/e2e/publish-content.spec.ts`

- [ ] **Step 1: Write failing campus-work and contact tests**

Require title, description, location, pay text, contact, tags, owner, and campus. Public presenters must omit `contact`; only a verified active non-owner can reveal it, producing `CAMPUS_WORK_CONTACT_VIEWED`.

```ts
expect(publicItem).not.toHaveProperty('contact');
expect(result).toEqual({ contact: '微信 campus-helper' });
expect(db.auditLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ action: 'CAMPUS_WORK_CONTACT_VIEWED' }),
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/campus-work.test.ts tests/unit/campus-work-contact.test.ts`  
Expected: FAIL because only legacy job routes exist.

- [ ] **Step 3: Implement campus-work service and compatibility redirects**

Follow `marketplace-contact.ts` for authorization and no-store responses. Replace legacy pages with `permanentRedirect('/campus-work...')`; do not keep duplicate writers. Update the unified publish entry from the compatibility job route to `/submit/campus-work`. Render the safety note about public meetups and no advance payment.

- [ ] **Step 4: Verify workflows**

Run: `npm run test:unit -- tests/unit/campus-work.test.ts tests/unit/campus-work-contact.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/publish-content.spec.ts`  
Expected: PASS for resource, marketplace, and campus-work publish/reveal flows.

- [ ] **Step 5: Commit and checkpoint Phase 3**

```powershell
git add app/campus-work app/submit/campus-work app/api/campus-work app/jobs lib/domain/campus-work-contact.ts components tests
git commit -m "feat: launch tagged campus work"
git tag -a community-expansion-phase-3 -m "Publishing tags and campus work complete"
git push
git push origin community-expansion-phase-3
```
