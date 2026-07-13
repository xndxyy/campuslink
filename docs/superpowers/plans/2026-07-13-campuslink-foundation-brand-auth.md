# CampusLink Foundation, Brand, And Open Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open registration to any verified email, establish the approved CampusLink brand shell, and replace the resource-only publish button with a unified publish center.

**Architecture:** Keep the existing opaque-session authentication and assign all registrations to the seeded active CampusLink community without using the email domain as an admission rule. Introduce focused brand and publish-entry components so later content modules can add destinations without growing `app/layout.tsx` or `app/page.tsx`.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/PostgreSQL, Zod, Vitest, Playwright, Image2-generated raster brand assets.

---

### Task 1: Open Email Registration Without Weakening Verification

**Files:**
- Create: `prisma/migrations/20260713160000_open_email_registration/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `lib/auth/auth-service.ts`
- Modify: `lib/auth/credentials.ts`
- Modify: `lib/config.ts`
- Modify: `app/admin/settings/page.tsx`
- Modify: `components/admin/campus-settings-form.tsx`
- Test: `tests/unit/auth-foundation.test.ts`
- Test: `tests/unit/auth-sign-up-route.test.ts`
- Test: `tests/integration/auth-flow.test.ts`

- [ ] **Step 1: Write failing open-registration tests**

Add cases that create the default active campus, sign up `member@qq.com`, and assert the new user is `PENDING_VERIFICATION` with that campus ID. Add a second case proving an inactive default campus causes the generic no-op response. Keep the existing case that requires token consumption before `ACTIVE`.

```ts
it('registers any normalized email in the default active community', async () => {
  await signUpWithPassword(
    { email: 'member@qq.com', name: 'Member' },
    { db, mailer },
  );
  await expect(db.user.findUnique({ where: { email: 'member@qq.com' } }))
    .resolves.toMatchObject({ campusId, status: 'PENDING_VERIFICATION' });
});
```

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `npm run test:unit -- tests/unit/auth-foundation.test.ts tests/unit/auth-sign-up-route.test.ts`  
Expected: FAIL because `signUpWithPassword` still looks up a campus by `allowedEmailDomain`.

- [ ] **Step 3: Implement default-campus lookup and retire domain admission**

Add a single configuration function and use it in `signUpWithPassword`:

```ts
export function getDefaultCampusSlug(env = process.env) {
  return env.DEFAULT_CAMPUS_SLUG?.trim() || 'campuslink';
}

const campus = await db.campus.findFirst({
  where: { isActive: true, slug: getDefaultCampusSlug() },
});
```

Make `Campus.allowedEmailDomain` nullable in Prisma and the expand migration. Remove domain validation from sign-up and campus settings while preserving email normalization, generic responses, rate limiting, token hashing, and SMTP verification.

- [ ] **Step 4: Run unit and integration tests**

Run: `npm run test:unit -- tests/unit/auth-foundation.test.ts tests/unit/auth-sign-up-route.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/auth-flow.test.ts`  
Expected: PASS with QQ-style and school-style email addresses using the same campus.

- [ ] **Step 5: Commit the authentication boundary**

```powershell
git add prisma lib/auth lib/config.ts app/admin/settings components/admin tests/unit tests/integration/auth-flow.test.ts
git commit -m "feat: open registration to verified email users"
git push
```

### Task 2: Generate And Install The Book-Ridge Brand Assets

**Files:**
- Create: `public/brand/campuslink-mark-light.png`
- Create: `public/brand/campuslink-mark-dark.png`
- Create: `public/brand/campuslink-icon.png`
- Create: `components/brand/site-brand.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/app-layout.contract.test.ts`

- [ ] **Step 1: Write the failing layout contract**

Assert that the layout imports `SiteBrand`, uses the visible text `西大同学 CampusLink`, references `/brand/campuslink-mark-light.png`, and contains the non-official footer wording.

```ts
expect(layoutSource).toContain("import { SiteBrand }");
expect(layoutSource).toContain('西大同学 CampusLink');
expect(layoutSource).toContain('非西南大学官方平台');
```

- [ ] **Step 2: Run the contract test and confirm failure**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts`  
Expected: FAIL because the current layout renders the `CL` square.

- [ ] **Step 3: Generate the approved raster assets once**

Use the `gpt-image-2-gen` skill after `EVOLINK_API_KEY` is present. Submit exactly one generation request with this approved prompt:

```text
Create an original university-community logo for “西大同学 CampusLink”.
Concept: an open book whose pages form layered Chongqing mountain ridges.
Style: compact geometric mark, academic but friendly, high legibility at 32 px,
navy and fresh green on transparent background. Do not imitate or include any
official Southwest University seal, crest, gate, motto, or official emblem.
No mockup, no extra text, no gradient, no shadow.
```

Export the approved result into the three named PNG files. Do not rerun the paid generation automatically; if the first output is unusable, stop and request user approval before a second request.

- [ ] **Step 4: Implement `SiteBrand` and responsive header usage**

```tsx
export function SiteBrand() {
  return (
    <Link className="site-brand" href="/" aria-label="西大同学 CampusLink 首页">
      <Image alt="" height={40} priority src="/brand/campuslink-mark-light.png" width={40} />
      <span>西大同学 <b>CampusLink</b></span>
    </Link>
  );
}
```

Replace the `CL` block, keep keyboard focus styles, and add a footer statement that this is not an official Southwest University platform.

- [ ] **Step 5: Verify and commit the brand shell**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts`  
Expected: PASS.  
Run: `npm run build`  
Expected: exit `0` with all brand images resolved.

```powershell
git add public/brand components/brand app/layout.tsx app/globals.css tests/unit/app-layout.contract.test.ts
git commit -m "feat: add CampusLink book ridge identity"
git push
```

### Task 3: Add The Unified Publish Center And Four-Section Home Shell

**Files:**
- Create: `app/submit/page.tsx`
- Create: `components/content/publish-type-list.tsx`
- Create: `components/home/category-strip.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/app-layout.contract.test.ts`
- Test: `tests/unit/submission-form.contract.test.ts`
- Test: `tests/e2e/authorization.spec.ts`

- [ ] **Step 1: Write failing publish-navigation contracts**

Assert the header action points to `/submit`, the home page contains the four approved category routes, and the publish center lists the five approved destinations. This task verifies the shared navigation contract; the destination workflow tests are owned by Phases 3 and 4.

```ts
expect(layoutSource).toContain('href="/submit"');
for (const label of ['学习资源', '二手交易', '校园工作', '论坛帖子', '匿名树洞']) {
  expect(submitSource).toContain(label);
}
```

- [ ] **Step 2: Run the contracts and confirm failure**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts tests/unit/submission-form.contract.test.ts`  
Expected: FAIL because the header still links directly to `/submit/resource` and `/submit` does not exist.

- [ ] **Step 3: Implement focused navigation components**

Define the publish entries in one typed constant:

```ts
export const publishTypes = [
  { href: '/submit/resource', label: '学习资源' },
  { href: '/submit/marketplace', label: '二手交易' },
  { href: '/submit/campus-work', label: '校园工作' },
  { href: '/submit/forum', label: '论坛帖子' },
  { href: '/submit/tree-hole', label: '匿名树洞' },
] as const;
```

Use an unframed editorial list, not nested cards. Add the approved four-column home strip and remove the old recent-content section and query.

- [ ] **Step 4: Verify desktop/mobile routing**

Run: `npm run test:unit -- tests/unit/app-layout.contract.test.ts tests/unit/submission-form.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/authorization.spec.ts`  
Expected: PASS, including keyboard navigation to `/submit`.

- [ ] **Step 5: Commit and create Phase 1 checkpoint**

```powershell
git add app components/home components/content tests
git commit -m "feat: add unified publish and home navigation"
git tag -a community-expansion-phase-1 -m "Open email, brand, and navigation complete"
git push
git push origin community-expansion-phase-1
```
