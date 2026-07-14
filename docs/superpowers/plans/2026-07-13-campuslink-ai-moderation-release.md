# CampusLink AI Moderation And Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply local blocked-word checks and configurable OpenAI-compatible AI assessment to all public user content, then complete contract migrations, security validation, deployment documentation, and release verification.

**Architecture:** Put a deterministic local gate before a provider-isolated AI client. Encrypt provider credentials at rest, validate outbound targets against an operator allowlist and resolved IP policy, persist only structured assessments, and centralize publish-state mapping so every content type receives the same PASS/REVIEW/BLOCK/fail-open semantics.

**Tech Stack:** Next.js Route Handlers, Prisma/PostgreSQL, Node `crypto`/`dns`, Zod, OpenAI-compatible HTTPS API, Vitest, Playwright.

---

### Task 1: Add Blocked Words And AI Assessment Persistence

**Files:**
- Create: `prisma/migrations/20260713210000_add_content_assessment/migration.sql`
- Modify: `prisma/schema.prisma`
- Test: `tests/unit/moderation-schema.contract.test.ts`
- Test: `tests/integration/schema-constraints.test.ts`

- [ ] **Step 1: Write failing schema contracts**

Require blocked words, one campus AI configuration, encrypted-key metadata, assessment decisions, provider execution status, and generic target references bounded by an enum.

```ts
expect(schema).toContain('model BlockedWord');
expect(schema).toContain('model AiModerationConfig');
expect(schema).toContain('model ContentAssessment');
expect(schema).toContain('SKIPPED');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/moderation-schema.contract.test.ts`  
Expected: FAIL because moderation persistence does not exist.

- [ ] **Step 3: Implement expand-only moderation models**

Store only encrypted key material and structured output:

```prisma
model AiModerationConfig {
  id                 String  @id @default(cuid())
  campusId           String  @unique
  enabled            Boolean @default(false)
  baseUrl            String  @db.VarChar(500)
  model              String  @db.VarChar(200)
  encryptedApiKey    String  @db.Text
  apiKeyLastFour     String  @db.VarChar(4)
  encryptionVersion  Int
  timeoutMs          Int     @default(8000)
  reviewThreshold    Int     @default(40)
  blockThreshold     Int     @default(80)
}
```

Add constraints `0 <= reviewThreshold < blockThreshold <= 100`, unique normalized blocked-word entries per campus, and indexes for pending assessments and skipped checks.

- [ ] **Step 4: Verify constraints**

Run: `npm run db:generate`  
Expected: success.  
Run: `npm run test:integration -- tests/integration/schema-constraints.test.ts`  
Expected: PASS, including invalid threshold rejection.

- [ ] **Step 5: Commit**

```powershell
git add prisma tests/unit/moderation-schema.contract.test.ts tests/integration/schema-constraints.test.ts
git commit -m "feat: add content assessment persistence"
git push
```

### Task 2: Implement Blocked-Word Domain And Admin Page

**Files:**
- Create: `lib/domain/blocked-words.ts`
- Create: `lib/security/text-normalization.ts`
- Create: `app/api/admin/blocked-words/route.ts`
- Create: `app/admin/blocked-words/page.tsx`
- Create: `components/admin/blocked-word-management.tsx`
- Modify: `app/admin/layout.tsx`
- Test: `tests/unit/blocked-words.test.ts`
- Test: `tests/unit/blocked-word-routes.test.ts`
- Test: `tests/unit/blocked-word-ui.contract.test.ts`
- Test: `tests/integration/blocked-words.test.ts`

- [ ] **Step 1: Write failing normalization and mutation tests**

Cover NFKC, lower casing, whitespace and common separator removal, plain-text-only entries, enabled-only matching, reason requirements, and admin-only CRUD.

```ts
expect(normalizeModerationText('违 规－交 易')).toBe('违规交易');
expect(findBlockedWord('这是违/规/交/易', ['违规交易'])).toBe('违规交易');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/blocked-words.test.ts tests/unit/blocked-word-routes.test.ts`  
Expected: FAIL because the local gate does not exist.

- [ ] **Step 3: Implement deterministic matching and audited management**

Do not accept regex patterns. Compile enabled normalized strings into a bounded matcher cached per campus and invalidated after admin mutation. Return a category and generic Chinese message; never return the full list.

- [ ] **Step 4: Build admin UI and verify**

Use add, enable/disable, and permanent-delete commands with required reason. Audit `BLOCKED_WORD_CREATED`, `BLOCKED_WORD_STATUS_CHANGED`, and `BLOCKED_WORD_DELETED`; sanitize details.

Run: `npm run test:unit -- tests/unit/blocked-words.test.ts tests/unit/blocked-word-routes.test.ts tests/unit/blocked-word-ui.contract.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/blocked-words.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add lib/domain/blocked-words.ts lib/security/text-normalization.ts app/api/admin/blocked-words app/admin/blocked-words components/admin app/admin/layout.tsx tests
git commit -m "feat: add governed blocked word checks"
git push
```

### Task 3: Secure AI Configuration, Secrets, And Outbound URLs

**Files:**
- Create: `lib/security/encrypted-secret.ts`
- Create: `lib/security/outbound-url.ts`
- Create: `lib/domain/ai-settings.ts`
- Create: `app/api/admin/ai-settings/route.ts`
- Create: `app/api/admin/ai-settings/test/route.ts`
- Create: `app/admin/ai-settings/page.tsx`
- Create: `components/admin/ai-settings-form.tsx`
- Modify: `lib/security/runtime-config.ts`
- Modify: `.env.example`
- Test: `tests/unit/encrypted-secret.test.ts`
- Test: `tests/unit/outbound-url.test.ts`
- Test: `tests/unit/ai-settings.test.ts`
- Test: `tests/unit/ai-settings-routes.test.ts`
- Test: `tests/unit/ai-settings-ui.contract.test.ts`

- [ ] **Step 1: Write failing secret and SSRF tests**

Cover authenticated encryption/tamper failure, last-four-only presenter output, HTTPS requirement, credentials-in-URL rejection, hostname allowlist, loopback/private/link-local/reserved IPv4 and IPv6 rejection, and redirect revalidation.

```ts
await expect(validateOutboundAiUrl('https://127.0.0.1/v1', policy))
  .rejects.toBeInstanceOf(OutboundUrlRejectedError);
expect(presentAiSettings(record)).not.toHaveProperty('encryptedApiKey');
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/encrypted-secret.test.ts tests/unit/outbound-url.test.ts tests/unit/ai-settings.test.ts`  
Expected: FAIL because these security boundaries do not exist.

- [ ] **Step 3: Implement versioned key encryption and URL policy**

Require a base64-decoded 32-byte `AI_CONFIG_ENCRYPTION_KEY_V1` and parse `AI_ALLOWED_HOSTS` as exact normalized hostnames. Resolve all addresses with `dns.promises.lookup({ all: true })`; reject when any address is non-public. Re-run validation for each redirect and cap redirects at two.

```ts
export interface SecretEnvelope {
  ciphertext: string;
  iv: string;
  keyVersion: number;
  tag: string;
}
```

- [ ] **Step 4: Implement admin configuration and fixed-text connection test**

The GET presenter returns `enabled`, `baseUrl`, `model`, timeout, thresholds, and `apiKeyLastFour` only. POST accepts a new key or keeps the existing encrypted key. The test route sends only `CampusLink moderation connection test` and returns a generic success/failure message.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/encrypted-secret.test.ts tests/unit/outbound-url.test.ts tests/unit/ai-settings.test.ts tests/unit/ai-settings-routes.test.ts tests/unit/ai-settings-ui.contract.test.ts`  
Expected: PASS.

```powershell
git add lib/security lib/domain/ai-settings.ts app/api/admin/ai-settings app/admin/ai-settings components/admin .env.example tests
git commit -m "feat: secure configurable AI moderation"
git push
```

### Task 4: Implement OpenAI-Compatible Assessment Client

**Files:**
- Create: `lib/moderation/assessment-types.ts`
- Create: `lib/moderation/openai-compatible-client.ts`
- Create: `lib/moderation/content-assessment.ts`
- Test: `tests/unit/openai-compatible-client.test.ts`
- Test: `tests/unit/content-assessment.test.ts`

- [ ] **Step 1: Write failing response and failure-mode tests**

Cover valid JSON, fenced/malformed output rejection, timeout, 401/429/500 redaction, categories allowlist, reason/suggestion length, score mapping, and no private fields in request payload.

```ts
expect(parseAssessment('{"decision":"BLOCK","riskScore":91,"categories":["诈骗引流"],"reasonZh":"包含诱导转账内容","suggestionZh":"删除转账诱导后重试","adminSignals":[]}'))
  .toMatchObject({ decision: 'BLOCK', riskScore: 91 });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/openai-compatible-client.test.ts tests/unit/content-assessment.test.ts`  
Expected: FAIL because no assessment client exists.

- [ ] **Step 3: Implement strict provider request and parser**

POST to the validated OpenAI-compatible `chat/completions` endpoint with `Authorization: Bearer <decrypted key>`, `temperature: 0`, and a JSON-only system contract. Validate the provider response with Zod and discard raw response text after parsing.

- [ ] **Step 4: Implement common assessment decision**

Run the blocked-word gate first. Return one discriminated union:

```ts
type PublishAssessment =
  | { kind: 'pass'; assessmentId: string }
  | { kind: 'review'; assessmentId: string; reasonZh: string }
  | { kind: 'block'; assessmentId: string; categories: string[]; reasonZh: string; suggestionZh: string }
  | { kind: 'skipped'; assessmentId: string };
```

On provider failure, persist `skipped`, write `AI_CHECK_SKIPPED`, and return the fail-open result. Do not bypass local blocked words.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/openai-compatible-client.test.ts tests/unit/content-assessment.test.ts`  
Expected: PASS with no secret values in snapshots or errors.

```powershell
git add lib/moderation tests/unit/openai-compatible-client.test.ts tests/unit/content-assessment.test.ts
git commit -m "feat: add structured content assessment client"
git push
```

### Task 5: Integrate Assessment With Every Public Write Path

**Files:**
- Modify: `lib/domain/content-service.ts`
- Modify: `lib/domain/forum.ts`
- Modify: `lib/domain/tags.ts`
- Modify: `lib/domain/content-status.ts`
- Modify: `lib/domain/moderation.ts`
- Modify: `app/admin/moderation/page.tsx`
- Modify: `components/admin/moderation-action-form.tsx`
- Modify: `app/api/resources/route.ts`
- Modify: `app/api/marketplace/route.ts`
- Modify: `app/api/campus-work/route.ts`
- Modify: `app/api/forum/posts/route.ts`
- Modify: `app/api/forum/posts/[id]/comments/route.ts`
- Modify: `components/content/submission-form.tsx`
- Modify: `components/forum/forum-post-form.tsx`
- Test: `tests/unit/content-workflows.test.ts`
- Test: `tests/unit/forum.test.ts`
- Test: `tests/integration/content-actions.test.ts`
- Test: `tests/integration/forum.test.ts`
- Test: `tests/e2e/moderation-ai.spec.ts`

- [ ] **Step 1: Write failing cross-content decision tests**

For resource, marketplace, campus work, forum, tree hole, comment, and custom tag, assert: blocked word returns 400 without provider call; PASS publishes; REVIEW persists `PENDING`; BLOCK persists `REJECTED` and returns Chinese reason/suggestion; provider failure publishes and audits `AI_CHECK_SKIPPED`.

```ts
expect(await submitWithAssessment({ result: { kind: 'review' } }))
  .toMatchObject({ status: 'PENDING' });
expect(await submitWithAssessment({ result: { kind: 'skipped' } }))
  .toMatchObject({ status: 'PUBLISHED' });
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm run test:unit -- tests/unit/content-workflows.test.ts tests/unit/forum.test.ts`  
Expected: FAIL because current workflows always use the manual moderation lifecycle.

- [ ] **Step 3: Integrate one orchestration function**

Create one internal `assessAndChooseStatus` orchestration used by every public writer. Pass only public title/body/location/pay/tag/comment fields. Exclude contact, email, asset bytes, and anonymous identity. Persist content and its assessment in one database transaction after the provider result is known.

- [ ] **Step 4: Return consistent user feedback and admin queue data**

Map BLOCK to a stable response body `{ code: 'CONTENT_BLOCKED', categories, reason, suggestion }`; map REVIEW to `{ status: 'PENDING', message: '内容正在人工审核' }`; never return `adminSignals` to users. Extend the moderation page with AI decision, confidence, admin-only signals, and a visible `AI_CHECK_SKIPPED` filter/alert.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:unit -- tests/unit/content-workflows.test.ts tests/unit/forum.test.ts`  
Expected: PASS.  
Run: `npm run test:integration -- tests/integration/content-actions.test.ts tests/integration/forum.test.ts`  
Expected: PASS.  
Run: `npm run test:e2e -- tests/e2e/moderation-ai.spec.ts`  
Expected: PASS for PASS, REVIEW, BLOCK, blocked-word, and skipped outcomes.

```powershell
git add lib/domain lib/moderation app/api components tests
git commit -m "feat: enforce content assessment across publishing"
git push
```

### Task 6: Contract Migration, Documentation, And Release Verification

**Files:**
- Create: `prisma/migrations/20260713220000_contract_legacy_content/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `tests/unit/content-migrations.contract.test.ts`
- Modify: `scripts/provision-e2e.ts`
- Modify: `scripts/verify-release.ts`
- Modify: `docs/CAMPUSLINK_PROJECT_DELIVERY_GUIDE_ZH.md`
- Modify: `docs/deployment.md`
- Modify: `docs/operations.md`
- Modify: `docs/security.md`
- Modify: `README.md`
- Test: `tests/unit/release-contract.test.ts`
- Test: `tests/unit/security.test.ts`
- Test: `tests/e2e/authorization.spec.ts`

- [ ] **Step 1: Write failing contract and release tests**

Require no runtime reference to `courseCode` or legacy job writers, exact environment documentation for `DEFAULT_CAMPUS_SLUG`, AI and anonymous keys, storage deletion secret, new E2E specs, and release verification gates.

```ts
expect(allRuntimeSource).not.toMatch(/courseCode/);
expect(allRuntimeSource).not.toContain("app/api/jobs");
for (const variable of ['AI_ALLOWED_HOSTS', 'AI_CONFIG_ENCRYPTION_KEY_V1', 'ANONYMOUS_IDENTITY_KEY_V1', 'ANONYMOUS_FINGERPRINT_KEY']) {
  expect(envExample).toContain(variable);
}
```

- [ ] **Step 2: Run release contracts and confirm failure**

Run: `npm run test:unit -- tests/unit/content-migrations.contract.test.ts tests/unit/release-contract.test.ts tests/unit/security.test.ts`  
Expected: FAIL while compatibility fields and incomplete documentation remain.

- [ ] **Step 3: Implement the contract migration**

Before dropping anything, assert migrated row counts and null-free required campus-work fields in SQL. Drop `Resource.courseCode`, legacy domain-admission configuration, and obsolete job columns/tables only after those guards pass. Keep `/jobs` HTTP redirects in application code.

- [ ] **Step 4: Update deployment and operations documentation**

Document secret generation, key rotation/versioning, AI host allowlists, fail-open alerting, anonymous-author reveal audit, blocked-word operations, storage deletion timer, SMTP for arbitrary emails, backup/restore, and rollback to `pre-community-expansion-2026-07-13`. Update the Chinese delivery guide's feature matrix and production blockers with current evidence only.

- [ ] **Step 5: Run full verification**

```powershell
npm run db:generate
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run e2e:provision
npm run test:e2e
npm run build
npm run verify:release
```

Expected: every command exits `0`; unit/integration/E2E output reports zero failures; production build completes; release verifier confirms all new suites and migrations.

- [ ] **Step 6: Commit, checkpoint, and push**

```powershell
git add prisma scripts docs README.md .env.example tests
git commit -m "docs: complete CampusLink community release"
git tag -a community-expansion-phase-5 -m "CampusLink community expansion release verified"
git push
git push origin community-expansion-phase-5
```
