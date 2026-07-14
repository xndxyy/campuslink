# CampusLink Forum And Anonymous Tree Hole Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a public one-level campus forum and a verified-user-only anonymous tree hole whose author can be revealed only by an administrator handling an active report.

**Architecture:** Use one `ForumPost` aggregate with a strict `DISCUSSION | TREE_HOLE` kind and separate comments/likes. Normal posts have a direct author relation; tree-hole posts store only authenticated ciphertext plus an HMAC fingerprint, keeping author identity out of ordinary ORM relations and serializers.

**Tech Stack:** Prisma/PostgreSQL, Node `crypto`, Next.js App Router, React, Zod, Vitest, Playwright.

---

### Task 1: Add Forum, Comment, Like, And Report Schema

**Files:**
- Create: `prisma/migrations/20260713200000_add_forum/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.ts`
- Test: `tests/unit/forum-schema.contract.test.ts`
- Test: `tests/integration/schema-constraints.test.ts`

- [ ] **Step 1: Write failing schema contracts**

Require forum kinds/status indexes, nullable normal author, encrypted tree-hole fields, one-level comments, unique likes, and report targets for posts and comments.

```ts
expect(schema).toContain('enum ForumPostKind');
expect(schema).toContain('DISCUSSION');
expect(schema).toContain('TREE_HOLE');
expect(schema).toMatch(/@@unique\(\[userId, postId\]\)/);
expect(schema).toContain('FORUM_COMMENT');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/forum-schema.contract.test.ts`  
Expected: FAIL because forum models are absent.

- [ ] **Step 3: Implement expand migration and models**

Use fields equivalent to:

```prisma
model ForumPost {
  id                    String        @id @default(cuid())
  campusId              String
  kind                  ForumPostKind
  authorId              String?
  anonymousCiphertext   String?       @db.Text
  anonymousFingerprint String?        @db.VarChar(64)
  anonymousKeyVersion   Int?
  publicCode            String?       @unique @db.VarChar(12)
  title                 String        @db.VarChar(200)
  body                  String        @db.Text
  category              String        @db.VarChar(64)
  status                ContentStatus @default(DRAFT)
  createdAt             DateTime      @default(now())
  updatedAt             DateTime      @updatedAt
  @@index([campusId, kind, status, createdAt, id])
}
```

Add a database check constraint: `DISCUSSION` requires `authorId` and null anonymous fields; `TREE_HOLE` requires null `authorId` and all anonymous fields. Add a check or trigger preventing comments from referencing tree-hole posts.

- [ ] **Step 4: Verify database constraints**

Run: `npm run db:generate`  
Expected: success.  
Run: `npm run test:integration -- tests/integration/schema-constraints.test.ts`  
Expected: PASS, including direct SQL attempts to create a tree-hole comment being rejected.

- [ ] **Step 5: Commit**

```powershell
git add prisma tests/unit/forum-schema.contract.test.ts tests/integration/schema-constraints.test.ts
git commit -m "feat: add forum persistence constraints"
git push
```

### Task 2: Implement Anonymous Identity Cryptography And Reveal Gate

**Files:**
- Create: `lib/security/anonymous-identity.ts`
- Create: `lib/domain/tree-hole-identity.ts`
- Create: `app/api/admin/tree-hole-identity/route.ts`
- Modify: `lib/security/runtime-config.ts`
- Modify: `.env.example`
- Test: `tests/unit/anonymous-identity.test.ts`
- Test: `tests/unit/tree-hole-identity.test.ts`
- Test: `tests/integration/forum.test.ts`

- [ ] **Step 1: Write failing crypto and authorization tests**

Cover AES-256-GCM round trip, tamper rejection, deterministic HMAC fingerprint, distinct key versions, moderator denial, admin denial without an active report, and audited admin reveal with a required reason.

```ts
const sealed = sealAnonymousUserId('user_1', keys);
expect(openAnonymousUserId(sealed, keys)).toBe('user_1');
expect(() => openAnonymousUserId({ ...sealed, ciphertext: sealed.ciphertext + 'x' }, keys))
  .toThrow(AnonymousIdentityError);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/anonymous-identity.test.ts tests/unit/tree-hole-identity.test.ts`  
Expected: FAIL because identity modules do not exist.

- [ ] **Step 3: Implement versioned encryption and fingerprinting**

Define the stored envelope and keep keys server-only:

```ts
export interface AnonymousIdentityEnvelope {
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
}

export function fingerprintAnonymousUser(userId: string, hmacKey: Buffer) {
  return createHmac('sha256', hmacKey).update(userId, 'utf8').digest('hex');
}
```

Require base64-decoded 32-byte `ANONYMOUS_IDENTITY_KEY_V1` and a separate 32-byte `ANONYMOUS_FINGERPRINT_KEY`. Never reuse the AI configuration key.

- [ ] **Step 4: Implement active-report reveal**

`revealTreeHoleAuthor` must verify `actor.role === 'ADMIN'`, reason length 5-1000, a non-dismissed report targeting the post, and the post kind. Return only `{ userId }` and write `TREE_HOLE_AUTHOR_REVEALED` with report/post IDs and reason; do not put decrypted identity in audit details.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/anonymous-identity.test.ts tests/unit/tree-hole-identity.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/forum.test.ts`  
Expected: PASS with no author ID visible in ordinary tree-hole queries.

```powershell
git add lib/security lib/domain/tree-hole-identity.ts app/api/admin/tree-hole-identity .env.example tests
git commit -m "feat: protect anonymous tree hole identity"
git push
```

### Task 3: Implement Forum Domain, Comments, Likes, And Reports

**Files:**
- Create: `lib/domain/forum.ts`
- Create: `lib/validation/forum.ts`
- Create: `lib/domain/forum-routes.ts`
- Create: `app/api/forum/posts/route.ts`
- Create: `app/api/forum/posts/[id]/route.ts`
- Create: `app/api/forum/posts/[id]/comments/route.ts`
- Create: `app/api/forum/posts/[id]/likes/route.ts`
- Modify: `lib/domain/reports.ts`
- Modify: `app/api/reports/route.ts`
- Test: `tests/unit/forum.test.ts`
- Test: `tests/unit/forum-routes.test.ts`
- Test: `tests/unit/reports.test.ts`
- Test: `tests/integration/forum.test.ts`

- [ ] **Step 1: Write failing domain tests**

Cover public discussion reads, verified-only writes, verified-only tree-hole reads, one-level comments, tree-hole comment rejection, unique like toggles, owner edit/delete, hidden-content behavior, and report target validation.

```ts
await expect(createForumComment(db, verifiedUser, {
  body: '不应允许的评论', postId: 'tree_1',
})).rejects.toBeInstanceOf(ForumConflictError);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/forum.test.ts tests/unit/forum-routes.test.ts tests/unit/reports.test.ts`  
Expected: FAIL because forum services and target types are missing.

- [ ] **Step 3: Implement bounded forum operations**

Use strict schemas: title 3-200, post body 10-5000, comment body 2-1000, category from the seeded allowlist. Generate a per-post public tree-hole code from random bytes; never derive it from identity. Return no anonymous ciphertext/fingerprint from presenter functions.

- [ ] **Step 4: Integrate report and moderation targets**

Allow `FORUM_POST` and `FORUM_COMMENT`; preserve duplicate-open-report and self-report rules. A tree-hole author cannot be identified to enforce self-report through a public relation, so compare the current user's HMAC fingerprint inside the domain service without exposing it.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/forum.test.ts tests/unit/forum-routes.test.ts tests/unit/reports.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/forum.test.ts`  
Expected: PASS.

```powershell
git add lib/domain/forum.ts lib/domain/forum-routes.ts lib/validation/forum.ts lib/domain/reports.ts app/api/forum app/api/reports tests
git commit -m "feat: add governed campus forum domain"
git push
```

### Task 4: Build Forum And Tree-Hole Interfaces

**Files:**
- Create: `app/forum/page.tsx`
- Create: `app/forum/[id]/page.tsx`
- Create: `app/submit/forum/page.tsx`
- Create: `app/submit/tree-hole/page.tsx`
- Create: `components/forum/forum-tabs.tsx`
- Create: `components/forum/forum-list.tsx`
- Create: `components/forum/forum-post-form.tsx`
- Create: `components/forum/comment-list.tsx`
- Create: `components/forum/forum-actions.tsx`
- Modify: `app/submit/page.tsx`
- Modify: `components/content/publish-type-list.tsx`
- Modify: `app/me/submissions/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/forum-ui.contract.test.ts`
- Test: `tests/e2e/forum.spec.ts`
- Test: `tests/e2e/tree-hole.spec.ts`

- [ ] **Step 1: Write failing UI and E2E tests**

The forum test publishes a discussion, comments once, likes, and reports. The tree-hole test proves an unverified/anonymous browser cannot open the tab, a verified user can publish and self-manage, no comment control exists, and neither public HTML nor API JSON contains author identity.

```ts
await expect(page.getByRole('tab', { name: '匿名树洞' })).toBeVisible();
await expect(page.getByRole('button', { name: '发表评论' })).toHaveCount(0);
expect(JSON.stringify(treeHoleResponse)).not.toContain(authorId);
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/forum-ui.contract.test.ts`  
Expected: FAIL because forum components do not exist.

- [ ] **Step 3: Implement accessible, URL-stable views**

Use `/forum?view=discussion|tree-hole&category=<slug>&page=<n>`. Render ordinary post author names; render tree-hole `publicCode` only. Activate the forum and tree-hole destinations in the unified publish center. Use no nested cards and keep action dimensions stable. Hide tree-hole server-side for users without a verified active session.

- [ ] **Step 4: Verify workflows and privacy**

Run: `npm run test:unit -- tests/unit/forum-ui.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/forum.spec.ts tests/e2e/tree-hole.spec.ts`  
Expected: PASS on desktop and mobile.

- [ ] **Step 5: Commit and checkpoint Phase 4**

```powershell
git add app/forum app/submit/forum app/submit/tree-hole app/me/submissions components/forum app/globals.css tests
git commit -m "feat: launch campus forum and anonymous tree hole"
git tag -a community-expansion-phase-4 -m "Forum and anonymous tree hole complete"
git push
git push origin community-expansion-phase-4
```
