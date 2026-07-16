# CampusLink Governance, Publishing, and Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver production-ready Chinese publishing, moderation controls, default tags/blocked words, optional resource attachments, safe owner deletion, reliable verification mail, and the simplified homepage.

**Architecture:** Keep the existing Next.js route/domain separation and Prisma models. Introduce shared default-data definitions and a one-time production migration, a shared publish workspace shell, explicit Chinese validation responses, and transactional owner deletion that reuses `StorageDeletionJob`. Preserve reported content with `ownerDeletionRequestedAt` until report resolution.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 7, PostgreSQL 15, Vitest, Playwright, Nodemailer, MinIO/S3-compatible storage, systemd, Caddy.

---

## File Map

**Create**

- `prisma/default-content-data.ts` - canonical preset-tag and starter blocked-word definitions for tests and development seeds.
- `prisma/migrations/20260717100000_seed_publishing_defaults/migration.sql` - one-time production insertion for all active campuses.
- `prisma/migrations/20260717110000_add_owner_deletion_requests/migration.sql` - durable owner-deletion request columns and indexes.
- `components/content/publish-category-tabs.tsx` - top-level category selector reused by all submit pages.
- `components/content/submission-page-shell.tsx` - compact heading plus category tabs plus form slot.
- `lib/validation/content-errors.ts` - stable Chinese Zod/route error mapping.
- `tests/unit/default-content-data.test.ts` - uniqueness and migration contract.
- `tests/unit/content-errors.test.ts` - field-level Chinese error mapping.
- `tests/integration/content-deletion.test.ts` - real-database deletion, report retention, and storage job coverage.
- `tests/e2e/publishing-governance.spec.ts` - user-facing publish/delete/admin smoke path.

**Modify**

- `prisma/schema.prisma` - `ownerDeletionRequestedAt` fields and indexes.
- `prisma/seed-data.ts`, `prisma/seed.ts` - reuse canonical defaults without changing production bootstrap behavior.
- `lib/moderation/content-assessment.ts` - disabled AI becomes local-gate-only auto-pass.
- `components/admin/ai-settings-form.tsx`, `app/admin/ai-settings/page.tsx` - explicit running/paused semantics.
- `lib/validation/content.ts` - optional resource summary and attachments; marketplace remains image-required.
- `lib/domain/content-service.ts` - remove document invariants and add owner deletion.
- `lib/domain/content-routes.ts`, `lib/domain/content-action-route.ts` - Chinese errors and `DELETE` handling.
- `components/content/submission-form.tsx`, `components/content/edit-content-form.tsx`, `components/content/tag-selector.tsx` - optional resource inputs and precise client validation.
- `app/submit/page.tsx`, all five `app/submit/*/page.tsx` files, and `app/globals.css` - top/bottom workspace and compact headings.
- `components/content/owner-actions.tsx`, `app/me/submissions/page.tsx` - delete controls and hidden deletion requests.
- `lib/domain/forum.ts`, `lib/domain/forum-routes.ts`, `components/forum/forum-actions.tsx` - align forum deletion response and deletion-request persistence.
- `lib/domain/moderation.ts` - purge retained owner-deleted targets after report resolution.
- `lib/auth/mailer.ts`, `lib/auth/auth-service.ts`, auth routes/pages - Chinese mail/UI and token replacement.
- `app/page.tsx`, `app/layout.tsx`, `app/globals.css` - simplified homepage sentence and sticky-bottom footer.
- Existing tests under `tests/unit`, `tests/integration`, and `tests/e2e` - update contracts and broaden coverage.
- `docs/DELIVERY.md` and deployment contracts - migration, restart, and production smoke instructions.

### Task 1: Seed Production Preset Tags and Starter Blocked Words

**Files:**
- Create: `prisma/default-content-data.ts`
- Create: `prisma/migrations/20260717100000_seed_publishing_defaults/migration.sql`
- Create: `tests/unit/default-content-data.test.ts`
- Modify: `prisma/seed-data.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Write failing uniqueness and scope tests**

```ts
import { describe, expect, it } from 'vitest';
import { blockedWordDefaults, presetTagDefaults } from '@/prisma/default-content-data';

describe('production default content data', () => {
  it('defines unique preset slugs inside every scope', () => {
    const keys = presetTagDefaults.map((item) => `${item.scope}:${item.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(presetTagDefaults.map((item) => item.scope))).toEqual(
      new Set(['RESOURCE', 'MARKETPLACE', 'CAMPUS_WORK']),
    );
  });

  it('defines conservative, categorized, normalized blocked words', () => {
    expect(blockedWordDefaults.length).toBeGreaterThan(0);
    expect(new Set(blockedWordDefaults.map((item) => item.normalized)).size).toBe(
      blockedWordDefaults.length,
    );
    expect(blockedWordDefaults.every((item) => item.reason.length >= 5)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `npm run test:unit -- tests/unit/default-content-data.test.ts`

Expected: FAIL because `prisma/default-content-data.ts` does not exist.

- [ ] **Step 3: Add typed canonical defaults**

```ts
export type PresetTagDefault = Readonly<{
  label: string;
  scope: 'RESOURCE' | 'MARKETPLACE' | 'CAMPUS_WORK';
  slug: string;
}>;

export const presetTagDefaults: readonly PresetTagDefault[] = [
  { label: '课程笔记', scope: 'RESOURCE', slug: 'course-notes' },
  { label: '课件讲义', scope: 'RESOURCE', slug: 'course-materials' },
  { label: '试题题库', scope: 'RESOURCE', slug: 'exam-bank' },
  { label: '学习工具', scope: 'RESOURCE', slug: 'study-tools' },
  { label: '经验分享', scope: 'RESOURCE', slug: 'experience-sharing' },
  { label: '其他', scope: 'RESOURCE', slug: 'other' },
  { label: '教材书籍', scope: 'MARKETPLACE', slug: 'textbooks' },
  { label: '数码设备', scope: 'MARKETPLACE', slug: 'electronics' },
  { label: '生活用品', scope: 'MARKETPLACE', slug: 'daily-items' },
  { label: '宿舍用品', scope: 'MARKETPLACE', slug: 'dorm-items' },
  { label: '运动户外', scope: 'MARKETPLACE', slug: 'sports-outdoors' },
  { label: '免费赠送', scope: 'MARKETPLACE', slug: 'free' },
  { label: '求购', scope: 'MARKETPLACE', slug: 'wanted' },
  { label: '其他', scope: 'MARKETPLACE', slug: 'other' },
  { label: '校园跑腿', scope: 'CAMPUS_WORK', slug: 'campus-errand' },
  { label: '临时兼职', scope: 'CAMPUS_WORK', slug: 'temporary-job' },
  { label: '家教辅导', scope: 'CAMPUS_WORK', slug: 'tutoring' },
  { label: '活动协助', scope: 'CAMPUS_WORK', slug: 'event-help' },
  { label: '技能服务', scope: 'CAMPUS_WORK', slug: 'skills-service' },
  { label: '设计摄影', scope: 'CAMPUS_WORK', slug: 'design-photography' },
  { label: '其他', scope: 'CAMPUS_WORK', slug: 'other' },
];

export const blockedWordDefaults = [
  { category: '考试诚信', original: '代考', normalized: '代考', reason: '禁止提供或招募代考服务' },
  { category: '考试诚信', original: '代写论文', normalized: '代写论文', reason: '禁止提供学术作弊服务' },
  { category: '诈骗引流', original: '刷单返利', normalized: '刷单返利', reason: '常见诈骗引流话术' },
  { category: '诈骗引流', original: '先交保证金', normalized: '先交保证金', reason: '常见预付款诈骗话术' },
  { category: '违法内容', original: '出借银行卡', normalized: '出借银行卡', reason: '禁止交易或出借金融账户' },
  { category: '色情内容', original: '裸聊', normalized: '裸聊', reason: '禁止色情招揽内容' },
] as const;
```

- [ ] **Step 4: Add the one-time SQL migration**

Use `INSERT ... SELECT` from active `Campus` rows, deterministic IDs based on `md5(campusId || scope || slug)`, and `ON CONFLICT DO NOTHING`. Insert tag rows with `isPreset=true`, `isActive=true`; insert blocked words with `enabled=true`. Do not update existing rows, so later administrator choices remain intact.

- [ ] **Step 5: Reuse the definitions from development seed code**

Replace `campusWorkPresetTags` with `presetTagDefaults` filtering by scope, and keep demo users only in `prisma/seed.ts`. Production deployment runs migrations, not `prisma db seed`.

- [ ] **Step 6: Run tests and migration contract checks**

Run: `npm run test:unit -- tests/unit/default-content-data.test.ts tests/unit/forum-seed.test.ts tests/unit/tag-ui.contract.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/default-content-data.ts prisma/seed-data.ts prisma/seed.ts prisma/migrations/20260717100000_seed_publishing_defaults tests/unit/default-content-data.test.ts
git commit -m "feat: seed publishing and moderation defaults"
```

### Task 2: Make Paused AI Auto-Publish After the Local Gate

**Files:**
- Modify: `lib/moderation/content-assessment.ts:281-302`
- Modify: `components/admin/ai-settings-form.tsx`
- Modify: `app/admin/ai-settings/page.tsx`
- Modify: `tests/unit/content-assessment.test.ts`
- Modify: `tests/unit/moderation.test.ts`

- [ ] **Step 1: Replace the old disabled-AI expectation with pass/block cases**

```ts
it('auto-passes ordinary content while AI is paused', async () => {
  const policy = createConfiguredPublishingPolicy(adapterWithConfig(null));
  const result = await policy.prepare(batch('普通校园内容'));
  expect(result.outcome).toEqual({ kind: 'pass' });
});

it('still blocks an enabled local word while AI is paused', async () => {
  const policy = createConfiguredPublishingPolicy(adapterWithConfig(null));
  const result = await policy.prepare(batch('包含代考服务'));
  expect(result.outcome).toMatchObject({ kind: 'block', source: 'local' });
});
```

- [ ] **Step 2: Run focused tests and verify the ordinary case fails as review**

Run: `npm run test:unit -- tests/unit/content-assessment.test.ts`

Expected: FAIL because the current disabled path converts `pass` to `review`.

- [ ] **Step 3: Return the local-gate result unchanged when AI is disabled**

```ts
if (!config?.enabled) {
  return preparePublishingAssessmentBatch(adapter, input, { localGate });
}
```

This retains local blocking and returns `pass` for ordinary content. Do not call the provider and do not persist a fake provider assessment.

- [ ] **Step 4: Clarify the administrator UI**

Show a status line next to the toggle:

```tsx
<p className="admin-setting-note">
  {form.enabled
    ? 'AI 审核运行中：内容可能自动通过、转人工或被拦截。'
    : 'AI 审核已暂停：屏蔽词仍会拦截，其余内容自动公开。'}
</p>
```

- [ ] **Step 5: Run moderation tests**

Run: `npm run test:unit -- tests/unit/content-assessment.test.ts tests/unit/moderation.test.ts`

Expected: PASS; provider mocks are not called for paused AI.

- [ ] **Step 6: Commit**

```bash
git add lib/moderation/content-assessment.ts components/admin/ai-settings-form.tsx app/admin/ai-settings/page.tsx tests/unit/content-assessment.test.ts tests/unit/moderation.test.ts
git commit -m "feat: auto-publish while AI moderation is paused"
```

### Task 3: Allow Text-Only Resources and Return Chinese Field Errors

**Files:**
- Create: `lib/validation/content-errors.ts`
- Create: `tests/unit/content-errors.test.ts`
- Modify: `lib/validation/content.ts`
- Modify: `lib/domain/content-service.ts:335-438,1005-1046`
- Modify: `lib/domain/content-routes.ts`
- Modify: `lib/domain/content-action-route.ts`
- Modify: `components/content/submission-form.tsx`
- Modify: `components/content/edit-content-form.tsx`
- Modify: `components/content/tag-selector.tsx`
- Modify: `tests/unit/content-validation.test.ts`
- Modify: `tests/unit/content-service.test.ts`
- Modify: `tests/unit/content-routes.test.ts`

- [ ] **Step 1: Add failing schema tests**

```ts
it('accepts a text-only resource with an empty summary', () => {
  expect(
    createResourceSchema.safeParse({
      assetIds: [], customTags: [], presetTagIds: [], summary: '', title: '课程提示',
    }).success,
  ).toBe(true);
});

it('still rejects duplicate custom tags with a Chinese field error', () => {
  const result = createResourceSchema.safeParse({
    assetIds: [], customTags: ['测试', '测试'], presetTagIds: [], summary: '', title: '课程提示',
  });
  expect(toContentValidationError(result.error!).fieldErrors.customTags).toContain(
    '自定义标签不能重复，请修改第二个标签。',
  );
});
```

- [ ] **Step 2: Verify current failures**

Run: `npm run test:unit -- tests/unit/content-validation.test.ts tests/unit/content-errors.test.ts`

Expected: FAIL because resources require an asset, summary requires 20 characters, and the mapper is absent.

- [ ] **Step 3: Split resource and marketplace attachment schemas**

```ts
const optionalAssetIds = assetIdArray.max(8);
const requiredAssetIds = assetIdArray.min(1).max(8);

export const createResourceSchema = z.object({
  assetIds: optionalAssetIds,
  ...tagSelectionShape,
  summary: plainText(0, 5_000, 'summary'),
  title: plainText(3, 200, 'title'),
}).strict().superRefine(enforceTagLimit);
```

Keep `requiredAssetIds` in `createMarketplaceItemSchema`.

- [ ] **Step 4: Remove only the resource-document invariants**

Delete both `assets.some(RESOURCE_DOCUMENT)` checks in `createResource`. In `submitOwnedDraft`, change the resource invariant from `some: RESOURCE_DOCUMENT` to only a conditional `none` check for non-clean documents when documents exist. Continue calling `validateAssets` for every supplied asset.

- [ ] **Step 5: Add stable Chinese error mapping**

```ts
export type ContentValidationResponse = {
  code: 'CONTENT_VALIDATION_FAILED';
  fieldErrors: Record<string, string[]>;
  message: '请检查标出的内容后重试。';
};

export function toContentValidationError(error: z.ZodError): ContentValidationResponse {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'form');
    const message =
      field === 'customTags' && issue.message.includes('unique')
        ? '自定义标签不能重复，请修改第二个标签。'
        : field === 'assetIds'
          ? '附件数量或状态不正确。'
          : field === 'title'
            ? '标题长度应为 3 到 200 个字符。'
            : field === 'summary'
              ? '内容说明不能超过 5000 个字符。'
              : '内容格式不正确。';
    fieldErrors[field] = [...(fieldErrors[field] ?? []), message];
  }
  return {
    code: 'CONTENT_VALIDATION_FAILED',
    fieldErrors,
    message: '请检查标出的内容后重试。',
  };
}
```

Use this response from create/edit routes. Map `TagValidationError` to tag-specific Chinese messages instead of `Invalid content details.`.

- [ ] **Step 6: Add client preflight for duplicate custom tags**

Before `fetch`, normalize both non-empty custom tags. If duplicates exist, set field error state and focus the second custom-tag input. Remove `minLength={20}` and `required` from the resource summary textarea; display “内容说明（可选）”.

- [ ] **Step 7: Run focused tests**

Run: `npm run test:unit -- tests/unit/content-validation.test.ts tests/unit/content-errors.test.ts tests/unit/content-service.test.ts tests/unit/content-routes.test.ts tests/unit/submission-form.contract.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/validation/content.ts lib/validation/content-errors.ts lib/domain/content-service.ts lib/domain/content-routes.ts lib/domain/content-action-route.ts components/content/submission-form.tsx components/content/edit-content-form.tsx components/content/tag-selector.tsx tests/unit
git commit -m "feat: support text-only resources with Chinese validation"
```

### Task 4: Build the Top-Category Publish Workspace

**Files:**
- Create: `components/content/publish-category-tabs.tsx`
- Create: `components/content/submission-page-shell.tsx`
- Modify: `app/submit/page.tsx`
- Modify: `app/submit/resource/page.tsx`
- Modify: `app/submit/marketplace/page.tsx`
- Modify: `app/submit/campus-work/page.tsx`
- Modify: `app/submit/forum/page.tsx`
- Modify: `app/submit/tree-hole/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/unit/submission-form.contract.test.ts`
- Modify: `tests/e2e/publish-content.spec.ts`

- [ ] **Step 1: Write structural contract tests**

```ts
it('renders all publish categories before the form slot', () => {
  expect(shellSource.indexOf('<PublishCategoryTabs')).toBeLessThan(
    shellSource.indexOf('{children}'),
  );
  for (const label of ['学习资源', '二手交易', '校园工作', '校园论坛', '匿名树洞']) {
    expect(tabsSource).toContain(label);
  }
});
```

Also assert that the four removed descriptions are absent from submit page sources.

- [ ] **Step 2: Run contract tests and verify failure**

Run: `npm run test:unit -- tests/unit/submission-form.contract.test.ts`

Expected: FAIL because the shared shell and tabs do not exist.

- [ ] **Step 3: Implement the shared category tabs**

```tsx
const categories = [
  ['/submit/resource', '学习资源'],
  ['/submit/marketplace', '二手交易'],
  ['/submit/campus-work', '校园工作'],
  ['/submit/forum', '校园论坛'],
  ['/submit/tree-hole', '匿名树洞'],
] as const;

export function PublishCategoryTabs({ active }: { active: string }) {
  return (
    <nav aria-label="发布分类" className="publish-category-tabs">
      {categories.map(([href, label]) => (
        <Link aria-current={href === active ? 'page' : undefined} href={href} key={href}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Implement the shell and migrate all submit pages**

`SubmissionPageShell` renders the compact eyebrow/title, tabs, then `<div className="publish-form-area">{children}</div>`. Each page passes its active route and form. Make `/submit` redirect to `/submit/resource` so the first useful screen is a form, not a landing page.

- [ ] **Step 5: Replace the side-by-side CSS with vertical layout**

Set `.form-page` to `display:block`; constrain the form to a readable width; make `.publish-category-tabs` a stable five-column desktop grid and horizontally scrollable or two-column/wrapped on narrow screens. Keep headings under `3rem` and do not scale typography with viewport width.

- [ ] **Step 6: Run unit and Playwright tests**

Run: `npm run test:unit -- tests/unit/submission-form.contract.test.ts tests/unit/tag-selector.test.ts`

Run: `npm run test:e2e -- tests/e2e/publish-content.spec.ts`

Expected: PASS on desktop and mobile projects; no horizontal overflow.

- [ ] **Step 7: Commit**

```bash
git add components/content/publish-category-tabs.tsx components/content/submission-page-shell.tsx app/submit app/globals.css tests/unit/submission-form.contract.test.ts tests/e2e/publish-content.spec.ts
git commit -m "feat: unify publish pages in a vertical workspace"
```

### Task 5: Add Safe Owner Deletion Across Content Types

**Files:**
- Create: `prisma/migrations/20260717110000_add_owner_deletion_requests/migration.sql`
- Create: `tests/integration/content-deletion.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `lib/domain/content-service.ts`
- Modify: `lib/domain/content-action-route.ts`
- Modify: three `app/api/{resources,marketplace,campus-work}/[id]/route.ts` files
- Modify: `components/content/owner-actions.tsx`
- Modify: `app/me/submissions/page.tsx`
- Modify: `lib/domain/forum.ts`
- Modify: `lib/domain/forum-routes.ts`
- Modify: `lib/domain/moderation.ts`
- Modify: `tests/unit/content-actions-integration.contract.test.ts`
- Modify: `tests/unit/forum.test.ts`
- Modify: `tests/unit/moderation.test.ts`

- [ ] **Step 1: Write failing domain and integration tests**

Cover these exact cases:

```ts
it.each(['DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'HIDDEN', 'ARCHIVED'])(
  'deletes an owned resource in %s state when there is no active report',
  async (status) => {
    const fixture = await createResourceFixture({ status });
    const result = await deleteOwnedContent(db, fixture.actor, 'resource', fixture.id);
    expect(result).toEqual({ archived: false, deleted: true, id: fixture.id });
    expect(await db.resource.findUnique({ where: { id: fixture.id } })).toBeNull();
    expect(await db.storageDeletionJob.count({ where: { storageKey: fixture.storageKey } })).toBe(1);
  },
);

it('archives and marks an owner deletion when an active report exists', async () => {
  const fixture = await createReportedResourceFixture();
  const result = await deleteOwnedContent(db, fixture.actor, 'resource', fixture.id);
  expect(result.archived).toBe(true);
  expect(await db.resource.findUnique({ where: { id: fixture.id } })).toMatchObject({
    status: 'ARCHIVED',
    ownerDeletionRequestedAt: expect.any(Date),
  });
});
```

Also assert cross-user deletion is rejected and no storage job is created.

- [ ] **Step 2: Run focused tests and verify missing API/domain failures**

Run: `npm run test:integration -- tests/integration/content-deletion.test.ts`

Expected: FAIL because columns and `deleteOwnedContent` are absent.

- [ ] **Step 3: Add deletion-request columns**

Add `ownerDeletionRequestedAt DateTime?` to `Resource`, `MarketplaceItem`, `CampusWorkPost`, and `ForumPost`, with indexes containing campus/owner plus the nullable timestamp. Migration uses `ADD COLUMN` and non-concurrent indexes inside one transaction.

- [ ] **Step 4: Implement transactional deletion for typed content**

Extend `ContentAdapter` with `report.findFirst`, `storageDeletionJob.upsert`, `asset.deleteMany`, `favourite.deleteMany`, and delegate `deleteMany`. `deleteOwnedContent` must:

1. Find and validate the owned row plus READY asset storage keys.
2. Query active reports using the correct `ReportTargetType` (`RESOURCE`, `MARKETPLACE_ITEM`, `JOB_POST`).
3. On report: update status to `ARCHIVED` and set `ownerDeletionRequestedAt`.
4. Without report: upsert one `StorageDeletionJob` per asset key, delete asset rows, delete polymorphic favourites, then delete exactly one owned content row.
5. Return `{ archived, deleted, id }`.

- [ ] **Step 5: Expose HTTP DELETE and owner UI**

The three dynamic API routes call `handleContentDelete`; `OwnerActions` adds a red “删除” button for every status and uses `window.confirm('确认永久删除这条内容吗？此操作不可撤销。')`. On success, remove the row via `router.refresh()` and show the Chinese server message.

- [ ] **Step 6: Align forum deletion and owner lists**

When a forum post has an active report, set both `status:'ARCHIVED'` and `ownerDeletionRequestedAt:new Date()`. Filter all four owner queries with `ownerDeletionRequestedAt:null` so deletion-requested content disappears immediately. Preserve the existing anonymous fingerprint ownership check.

- [ ] **Step 7: Purge retained targets during report resolution**

After `resolveReport` changes the report to `RESOLVED`, detect `ownerDeletionRequestedAt != null` on the target and invoke the same transaction-safe purge path. Queue asset keys before removing typed content. Do not purge on `TRIAGE`; on `DISMISS`, restore/hide behavior remains an explicit moderator decision.

- [ ] **Step 8: Run deletion, forum, moderation, and route tests**

Run: `npm run test:unit -- tests/unit/content-actions-integration.contract.test.ts tests/unit/forum.test.ts tests/unit/moderation.test.ts`

Run: `npm run test:integration -- tests/integration/content-deletion.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260717110000_add_owner_deletion_requests lib/domain/content-service.ts lib/domain/content-action-route.ts lib/domain/forum.ts lib/domain/forum-routes.ts lib/domain/moderation.ts app/api components/content/owner-actions.tsx app/me/submissions/page.tsx tests
git commit -m "feat: let owners safely delete published content"
```

### Task 6: Localize and Harden Verification Mail Resending

**Files:**
- Modify: `lib/auth/mailer.ts`
- Modify: `lib/auth/auth-service.ts`
- Modify: `app/api/auth/resend-verification/route.ts`
- Modify: `app/api/auth/verify/route.ts`
- Modify: `app/auth/sign-up/page.tsx`
- Modify: `app/auth/sign-in/page.tsx`
- Modify: `app/auth/verify/page.tsx`
- Modify: `tests/unit/auth-mailer.test.ts`
- Modify: `tests/unit/auth-completion.test.ts`
- Modify: `tests/integration/auth-flow.test.ts`

- [ ] **Step 1: Add failing mail and token-replacement tests**

```ts
it('sends a Chinese verification message with the canonical origin', async () => {
  await mailer.sendVerificationEmail({ recipient: 'member@qq.com', verificationUrl });
  expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
    subject: '验证你的 CampusLink 邮箱',
    text: expect.stringContaining('完成邮箱验证'),
  }));
});

it('invalidates the previous token when resending', async () => {
  const first = await issueVerification(email);
  const second = await resendVerificationEmail(email, dependencies);
  await expect(verifyEmail(first.token, dependencies)).rejects.toThrow();
  await expect(verifyEmail(second.token, dependencies)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run auth tests and confirm English/multiple-token failures**

Run: `npm run test:unit -- tests/unit/auth-mailer.test.ts tests/unit/auth-completion.test.ts`

Expected: FAIL on Chinese content and token replacement.

- [ ] **Step 3: Replace tokens transactionally**

Inside resend, normalize the email, delete all `VerificationToken` rows for the identifier, create one hashed token, then send the mail. If SMTP fails, return the existing non-enumerating response and log the server failure; do not claim success to the client.

- [ ] **Step 4: Localize mail and pages**

Use the existing `getApplicationUrl()` loader backed by `APP_URL`; production already rejects non-HTTPS values. Mail subject: `验证你的 CampusLink 邮箱`; button: `验证邮箱`; include expiry guidance. Translate all auth headings, labels, password requirements, errors, resend state, invalid/expired state, and success state.

- [ ] **Step 5: Add the 60-second client countdown**

Disable the resend button after success and render `60 秒后可重新发送`, decrementing once per second. Re-enable at zero. Server rate limiting remains authoritative.

- [ ] **Step 6: Run auth unit and integration tests**

Run: `npm run test:unit -- tests/unit/auth-mailer.test.ts tests/unit/auth-completion.test.ts tests/unit/auth-csrf.test.ts`

Run: `npm run test:integration -- tests/integration/auth-flow.test.ts`

Expected: PASS; old token fails and new token verifies.

- [ ] **Step 7: Commit**

```bash
git add lib/auth app/api/auth app/auth tests/unit/auth-mailer.test.ts tests/unit/auth-completion.test.ts tests/integration/auth-flow.test.ts
git commit -m "feat: localize and harden verification email"
```

### Task 7: Simplify the Homepage and Pin the Footer on Short Pages

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `tests/unit/app-layout.contract.test.ts`
- Create: `tests/e2e/home-layout.spec.ts`

- [ ] **Step 1: Write failing source/layout assertions**

```ts
expect(homeSource).toContain('CampusLink 是面向西大学子的校园公共空间。');
expect(homeSource).not.toContain('公开内容经过审核，匿名树洞也为表达保留边界。');
expect(css).toMatch(/body\s*\{[\s\S]*min-height:\s*100vh[\s\S]*display:\s*flex/);
expect(css).toMatch(/#main-content\s*\{[\s\S]*flex:\s*1/);
```

- [ ] **Step 2: Run the contract test and verify failure**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts`

Expected: FAIL because the second sentence remains and the root is not a flex column.

- [ ] **Step 3: Apply the approved copy and layout**

Keep only `CampusLink 是面向西大学子的校园公共空间。`. Set `body { min-height:100vh; display:flex; flex-direction:column; }` and `#main-content { flex:1 0 auto; }`; keep footer in normal flow. Desktop may keep the sentence on one line when space permits; mobile wraps naturally.

- [ ] **Step 4: Run unit and visual checks**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts`

Run: `npm run test:e2e -- tests/e2e/home-layout.spec.ts`

Expected: PASS at desktop and mobile widths; the footer bottom is at or below the viewport bottom and no text overlaps.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/layout.tsx app/globals.css tests/unit/app-layout.contract.test.ts tests/e2e/home-layout.spec.ts
git commit -m "fix: simplify homepage copy and anchor footer"
```

### Task 8: Complete the Chinese UI and API Error Sweep

**Files:**
- Modify: user-facing `app/**/*.tsx`, `components/**/*.tsx`, and route/domain response strings in scope.
- Create or modify: `tests/unit/chinese-ui.contract.test.ts`

- [ ] **Step 1: Add an allowlisted English-string contract**

Scan rendered/source user-facing strings and permit only product/technical terms such as `CampusLink`, `API Key`, `OpenAI`, model IDs, URLs, and email addresses. Assert known failures such as `Invalid content details.`, `Authentication is required.`, `Latest moderator decision`, `Upload is ready.`, and `Verify your e-mail` are absent.

- [ ] **Step 2: Run the contract and capture the failing string inventory**

Run: `npm run test:unit -- tests/unit/chinese-ui.contract.test.ts`

Expected: FAIL with exact files/strings still exposed in English.

- [ ] **Step 3: Translate the inventory by workflow**

Translate authentication, upload, publish, owner submissions, moderation decision, tag administration, blocked-word administration, AI settings, and common API errors. Keep logs/config errors in English only when they are server-only and never returned to users.

- [ ] **Step 4: Re-run the contract and targeted route tests**

Run: `npm run test:unit -- tests/unit/chinese-ui.contract.test.ts tests/unit/content-routes.test.ts tests/unit/tag-routes.test.ts tests/unit/admin-route-security.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app components lib tests/unit/chinese-ui.contract.test.ts
git commit -m "fix: complete Chinese user-facing copy"
```

### Task 9: End-to-End Verification and Production Delivery Contract

**Files:**
- Create: `tests/e2e/publishing-governance.spec.ts`
- Modify: `docs/DELIVERY.md`
- Modify: `scripts/verify-release.ts`
- Modify: `tests/unit/release-contract.test.ts`
- Modify: `tests/unit/storage-deletion-deployment.contract.test.ts`

- [ ] **Step 1: Add a full workflow Playwright test**

The test must:

1. Log in as a verified user.
2. Open the shared publish workspace and verify category tabs precede the form.
3. Publish a text-only resource with a short/empty description and a preset tag.
4. Verify duplicate custom tags show Chinese inline feedback.
5. Delete the created resource from “我的发布”.
6. Log in as admin, confirm starter blocked words exist, pause AI, and verify the paused-state explanation.
7. Assert the homepage contains only the approved sentence and that the footer does not float above the viewport bottom.

- [ ] **Step 2: Run the new E2E test and fix only test-environment setup defects**

Run: `npm run test:e2e -- tests/e2e/publishing-governance.spec.ts`

Expected: PASS on desktop and mobile projects.

- [ ] **Step 3: Update delivery and release verification**

Document this exact order:

```text
npm ci
npm run db:generate
npm run build
npm run db:migrate:deploy
npm prune --omit=dev
systemctl restart campuslink
systemctl restart campuslink-upload-cleanup.timer
```

Add read-only production checks for migration status, preset counts by `TagScope`, enabled blocked-word count, service status, and HTTPS pages. Explicitly state that `prisma db seed` must not run in production.

- [ ] **Step 4: Run the full local quality gate**

Run:

```text
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run build
npm run verify:release
```

Expected: every command exits 0.

- [ ] **Step 5: Inspect final diff and production migration safety**

Run `git diff --check`, verify migrations contain no accidental table drops or demo data, verify no secrets are present, and verify `.superpowers/` preview artifacts remain untracked and excluded from commits.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/publishing-governance.spec.ts docs/DELIVERY.md scripts/verify-release.ts tests
git commit -m "test: verify publishing governance release"
```

- [ ] **Step 7: Prepare production handoff**

Report the exact commit range, migration names, test results, and one-step-at-a-time server commands. Do not expose SMTP, database, AI, or server credentials in output.
