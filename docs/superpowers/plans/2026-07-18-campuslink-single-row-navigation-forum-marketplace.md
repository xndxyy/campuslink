# CampusLink Single-Row Navigation, Forum Defaults, and Marketplace Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved single-row global navigation, shared seven-category forum defaults, unified forum publishing entry, and yuan-based two-column marketplace price filters.

**Architecture:** Keep the existing Next.js server-rendered boundaries and Prisma models. Convert public yuan query text to integer cents at the validation boundary, return validation failures before database access, seed missing forum categories through an idempotent data migration, and flatten the shared Header into one horizontally scrollable track without duplicating navigation markup.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod 4, Prisma 7/PostgreSQL 15, Vitest, Playwright, CSS.

---

## File Map

- `lib/validation/content.ts`: validate yuan query strings and produce integer-cent domain bounds.
- `lib/domain/public-content.ts`: normalize public query values, preserve form text, and return validation errors before database access.
- `components/content/public-list.tsx`: render public filters, price error feedback, and the marketplace-specific 2x2 grid.
- `app/resources/page.tsx`, `app/marketplace/page.tsx`, `app/campus-work/page.tsx`: pass preserved filter values into `PublicList`.
- `prisma/seed-data.ts`: define the seven shared forum category defaults without overwriting existing governance.
- `prisma/migrations/20260718100000_seed_forum_categories/migration.sql`: insert missing defaults for every campus.
- `components/forum/forum-list.tsx`: remove the duplicate forum/tree-hole publish call to action.
- `app/layout.tsx`, `components/brand/site-brand.tsx`, `app/globals.css`: implement the one-line global Header and responsive horizontal scrolling.
- `tests/unit/content-validation.test.ts`, `tests/unit/public-content.test.ts`, `tests/unit/public-list.contract.test.ts`: cover price parsing, no-query validation failure, and filter markup.
- `tests/unit/forum-seed.test.ts`, `tests/unit/forum-schema.contract.test.ts`, `tests/unit/forum-category-defaults-migration.contract.test.ts`: cover the seven defaults and migration safety.
- `tests/integration/forum-category-defaults-migration.test.ts`: execute the real data migration twice in an isolated PostgreSQL schema.
- `tests/unit/forum-ui.contract.test.ts`, `tests/unit/app-layout.contract.test.ts`: lock the unified publish and Header contracts.
- `tests/e2e/forum.spec.ts`, `tests/e2e/tree-hole.spec.ts`, `tests/e2e/forum-layout.spec.ts`, `tests/e2e/home-layout.spec.ts`: exercise the real user paths and responsive geometry.

### Task 1: Parse Marketplace Yuan Filters Into Integer Cents

**Files:**
- Modify: `tests/unit/content-validation.test.ts`
- Modify: `lib/validation/content.ts`

- [ ] **Step 1: Write failing yuan query tests**

Add these cases to `tests/unit/content-validation.test.ts`:

```ts
it.each([
  [{ minPrice: '0' }, { minPriceCents: 0 }],
  [{ minPrice: '12.5' }, { minPriceCents: 1250 }],
  [{ maxPrice: '12.50' }, { maxPriceCents: 1250 }],
  [
    { maxPrice: '100.00', minPrice: '19.99' },
    { maxPriceCents: 10_000, minPriceCents: 1_999 },
  ],
])('parses public yuan price filters without floating point math', (raw, expected) => {
  expect(contentListQuerySchema.parse(raw)).toMatchObject(expected);
});

it.each([
  { minPrice: '-1' },
  { minPrice: '1.001' },
  { minPrice: 'not-a-price' },
  { maxPrice: '21474836.48' },
])('rejects invalid public yuan price filters', (raw) => {
  expect(() => contentListQuerySchema.parse(raw)).toThrow();
});

it('rejects a marketplace price range whose maximum is below its minimum', () => {
  expect(() =>
    contentListQuerySchema.parse({ maxPrice: '9.99', minPrice: '10.00' }),
  ).toThrow('最高价不能低于最低价');
});

it('treats empty public price fields as absent and rejects legacy cent parameters', () => {
  expect(contentListQuerySchema.parse({ maxPrice: '', minPrice: '' })).toEqual({
    page: 1,
    pageSize: 12,
  });
  expect(() =>
    contentListQuerySchema.parse({ minPriceCents: '100' }),
  ).toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/content-validation.test.ts
```

Expected: FAIL because `minPrice` and `maxPrice` are rejected and the old cent fields are still accepted.

- [ ] **Step 3: Add exact yuan parsing and range validation**

In `lib/validation/content.ts`, add the reusable integer parser beside `MAX_PRICE_CENTS`:

```ts
export function yuanTextToCents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return Number(cents);
}

function optionalYuanPrice(label: '最低价' | '最高价') {
  return z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, {
        message: `${label}必须是非负金额，最多保留两位小数`,
      })
      .transform((raw) => ({ cents: yuanTextToCents(raw), raw }))
      .refine((value) => value.cents <= MAX_PRICE_CENTS, {
        message: `${label}超出允许范围`,
      })
      .optional(),
  );
}
```

Replace the `minPriceCents` and `maxPriceCents` input fields in `contentListQuerySchema` with `minPrice` and `maxPrice`, refine the transformed cent values, and return the existing domain names:

```ts
export const contentListQuerySchema = z
  .object({
    condition: z.enum(marketplaceConditions).optional(),
    location: z.string().trim().max(200).optional(),
    maxPrice: optionalYuanPrice('最高价'),
    minPrice: optionalYuanPrice('最低价'),
    page: z.coerce.number().int().min(1).max(50).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
    search: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(32).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minPrice &&
      value.maxPrice &&
      value.maxPrice.cents < value.minPrice.cents
    ) {
      context.addIssue({
        code: 'custom',
        message: '最高价不能低于最低价',
        path: ['maxPrice'],
      });
    }
  })
  .transform(({ maxPrice, minPrice, ...query }) => ({
    ...query,
    ...(maxPrice ? { maxPriceCents: maxPrice.cents } : {}),
    ...(minPrice ? { minPriceCents: minPrice.cents } : {}),
  }));
```

Update the existing marketplace create/update `price` transform to call `yuanTextToCents(value)` so every yuan conversion uses the same exact parser.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/content-validation.test.ts
```

Expected: all content validation tests pass.

- [ ] **Step 5: Commit the validation boundary**

```bash
git add lib/validation/content.ts tests/unit/content-validation.test.ts
git commit -m "feat: parse marketplace filters in yuan"
```

### Task 2: Return Filter Errors Before Database Access and Render the 2x2 Grid

**Files:**
- Create: `tests/unit/public-content.test.ts`
- Modify: `tests/unit/public-list.contract.test.ts`
- Modify: `lib/domain/public-content.ts`
- Modify: `components/content/public-list.tsx`
- Modify: `app/resources/page.tsx`
- Modify: `app/marketplace/page.tsx`
- Modify: `app/campus-work/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write failing domain and markup tests**

Create `tests/unit/public-content.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { ContentAdapter } from '@/lib/domain/content-service';
import { listPublicContent } from '@/lib/domain/content-service';
import { loadPublicList } from '@/lib/domain/public-content';

describe('public content query boundary', () => {
  it('returns a recoverable filter error without touching the database', async () => {
    const list = vi.fn<typeof listPublicContent>();

    const result = await loadPublicList(
      'marketplace',
      { maxPrice: '9.99', minPrice: '10.00' },
      { adapter: {} as ContentAdapter, list },
    );

    expect(list).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      filterError: '最高价不能低于最低价',
      filters: { maxPrice: '9.99', minPrice: '10.00' },
      items: [],
      total: 0,
    });
  });

  it('passes validated integer cents to the content service', async () => {
    const list = vi.fn<typeof listPublicContent>().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 12,
      total: 0,
    });
    const adapter = {} as ContentAdapter;

    const result = await loadPublicList(
      'marketplace',
      { maxPrice: '20.00', minPrice: '12.50' },
      { adapter, list },
    );

    expect(list).toHaveBeenCalledWith(adapter, 'marketplace', {
      maxPriceCents: 2000,
      minPriceCents: 1250,
      page: 1,
      pageSize: 12,
    });
    expect(result).toMatchObject({
      filters: { maxPrice: '20.00', minPrice: '12.50' },
    });
  });
});
```

Extend `tests/unit/public-list.contract.test.ts` to read `app/globals.css` and assert the public names, yuan labels, alert, and dedicated class:

```ts
it('renders a stable two-column marketplace filter in yuan', () => {
  expect(source).toContain('className="filter-row marketplace-filter-row"');
  expect(source).toContain('name="minPrice"');
  expect(source).toContain('name="maxPrice"');
  expect(source).toContain('placeholder="最低价（元）"');
  expect(source).toContain('placeholder="最高价（元）"');
  expect(source).not.toContain('name="minPriceCents"');
  expect(source).not.toContain('name="maxPriceCents"');
  expect(source).toContain('role="alert"');
  expect(globalStyles).toMatch(
    /\.search-form \.filter-row\.marketplace-filter-row\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npx vitest run tests/unit/public-content.test.ts tests/unit/public-list.contract.test.ts
```

Expected: FAIL because `loadPublicList` throws validation failures and the form still exposes cent fields in the shared three-column grid.

- [ ] **Step 3: Preserve raw public filters and add a testable dependency boundary**

In `lib/domain/public-content.ts`, define the browser-facing keys and optional dependencies:

```ts
const publicFilterKeys = [
  'condition',
  'location',
  'maxPrice',
  'minPrice',
  'search',
  'tag',
] as const;

export type PublicListFilterValues = Partial<
  Record<(typeof publicFilterKeys)[number], string>
>;

export interface PublicListDependencies {
  adapter?: ContentAdapter;
  list?: typeof listPublicContent;
}

function publicFilterValues(
  normalized: Record<string, string>,
): PublicListFilterValues {
  return Object.fromEntries(
    publicFilterKeys.flatMap((key) =>
      normalized[key] === undefined ? [] : [[key, normalized[key]]],
    ),
  );
}
```

Change `loadPublicList` to use `safeParse` and return before resolving `getDb()`:

```ts
export async function loadPublicList(
  kind: PublicContentKind,
  raw: Record<string, string | string[] | undefined>,
  dependencies: PublicListDependencies = {},
) {
  const normalized = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      return first === '' || first === undefined ? [] : [[key, first]];
    }),
  ) as Record<string, string>;
  const filters = publicFilterValues(normalized);
  const parsed = contentListQuerySchema.safeParse(normalized);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? '');
    return {
      filterError: ['minPrice', 'maxPrice'].includes(field)
        ? (issue?.message ?? '筛选条件无效，请修改后重试。')
        : '筛选条件无效，请修改后重试。',
      filters,
      items: [],
      page: 1,
      pageSize: 12,
      query: {},
      total: 0,
    };
  }

  const query = parsed.data;
  const list = dependencies.list ?? listPublicContent;
  const adapter =
    dependencies.adapter ?? (getDb() as unknown as ContentAdapter);
  const result = await list(adapter, kind, query);
  return { ...result, filters, query };
}
```

- [ ] **Step 4: Render preserved filter strings and validation feedback**

Change `PublicList` to accept `filters: PublicListFilterValues` and `filterError?: string`. Remove its `query` prop completely. Use `filters` for visible form defaults and pagination parameters; keep the internal cent query object out of browser URLs. Remove `query={result.query}` from all three page call sites.

Replace the marketplace block with:

```tsx
<div className="filter-row marketplace-filter-row">
  <select defaultValue={filters.condition ?? ''} name="condition">
    <option value="">全部状态</option>
    <option value="NEW">全新</option>
    <option value="LIKE_NEW">近乎全新</option>
    <option value="GOOD">良好</option>
    <option value="FAIR">有使用痕迹</option>
    <option value="POOR">明显磨损</option>
  </select>
  <input defaultValue={filters.tag} name="tag" placeholder="标签" />
  <input
    defaultValue={filters.minPrice}
    inputMode="decimal"
    name="minPrice"
    placeholder="最低价（元）"
  />
  <input
    defaultValue={filters.maxPrice}
    inputMode="decimal"
    name="maxPrice"
    placeholder="最高价（元）"
  />
</div>
{filterError ? (
  <p className="filter-error" role="alert">
    {filterError}
  </p>
) : null}
```

Use `filters.search`, `filters.tag`, and `filters.location` for the other visible controls. Build pagination from `Object.entries(filters)`, then add `page` and `pageSize` explicitly.

Guard the empty state, editorial list, result count, and pagination with `!error && !filterError`. A validation failure must show only the preserved filter form and its alert, never a misleading “0 条内容” result.

Pass `filters={result.filters ?? {}}` and the guarded `filterError` prop from all three public list pages. Add `filters: {}` to each database-error fallback object.

- [ ] **Step 5: Add marketplace-only grid CSS**

Add after the shared `.filter-row` rule:

```css
.search-form .filter-row.marketplace-filter-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.marketplace-filter-row input,
.marketplace-filter-row select {
  width: 100%;
  min-width: 0;
}
.filter-error {
  margin: 0.65rem 0 0;
  color: #9f1d16;
  font-size: 0.78rem;
  font-weight: 750;
}
```

Replace the mobile one-column override with:

```css
.search-form .filter-row:not(.marketplace-filter-row) {
  grid-template-columns: 1fr;
}
.search-form .filter-row.marketplace-filter-row {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
```

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npx vitest run tests/unit/content-validation.test.ts tests/unit/public-content.test.ts tests/unit/public-list.contract.test.ts
```

Expected: all focused tests pass.

```bash
git add lib/domain/public-content.ts components/content/public-list.tsx app/resources/page.tsx app/marketplace/page.tsx app/campus-work/page.tsx app/globals.css tests/unit/public-content.test.ts tests/unit/public-list.contract.test.ts
git commit -m "feat: improve marketplace price filtering"
```

### Task 3: Expand Shared Forum Seed Defaults Without Overwriting Governance

**Files:**
- Modify: `tests/unit/forum-seed.test.ts`
- Modify: `tests/unit/forum-schema.contract.test.ts`
- Modify: `prisma/seed-data.ts`

- [ ] **Step 1: Expand the failing seed contract to seven categories**

In `tests/unit/forum-seed.test.ts`, change the expected row and call counts from five to seven and add:

```ts
expect(rows.get('campus_1:help-and-advice')).toStrictEqual({
  campusId: 'campus_1',
  isActive: true,
  label: '求助建议',
  slug: 'help-and-advice',
});
expect(rows.get('campus_1:emotional-support')).toStrictEqual({
  campusId: 'campus_1',
  isActive: true,
  label: '情感交流',
  slug: 'emotional-support',
});
expect(calls.every((call) => Object.keys(call.update).length === 0)).toBe(true);
```

Extend the category label loop in `tests/unit/forum-schema.contract.test.ts` with `求助建议` and `情感交流`.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/unit/forum-seed.test.ts tests/unit/forum-schema.contract.test.ts
```

Expected: FAIL because the current seed contains only five categories.

- [ ] **Step 3: Add the two missing defaults**

Add these entries before `other` in `forumCategorySeeds`:

```ts
{ isActive: true, label: '求助建议', slug: 'help-and-advice' },
{ isActive: true, label: '情感交流', slug: 'emotional-support' },
```

Keep the existing `update: {}` branch unchanged so repeated seeds do not undo administrator changes.

- [ ] **Step 4: Run focused tests and commit**

```bash
npx vitest run tests/unit/forum-seed.test.ts tests/unit/forum-schema.contract.test.ts
git add prisma/seed-data.ts tests/unit/forum-seed.test.ts tests/unit/forum-schema.contract.test.ts
git commit -m "feat: add shared forum category defaults"
```

Expected: both test files pass and the commit contains no Prisma schema change.

### Task 4: Add and Execute the Idempotent Production Category Migration

**Files:**
- Create: `prisma/migrations/20260718100000_seed_forum_categories/migration.sql`
- Create: `tests/unit/forum-category-defaults-migration.contract.test.ts`
- Create: `tests/integration/forum-category-defaults-migration.test.ts`

- [ ] **Step 1: Write the failing migration contract**

Create `tests/unit/forum-category-defaults-migration.contract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260718100000_seed_forum_categories/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('production forum category defaults migration', () => {
  it('inserts every shared category for every campus without overwriting governance', () => {
    expect(migration).toMatch(/^BEGIN;/);
    expect(migration).toMatch(/COMMIT;\s*$/);
    expect(migration).toContain('FROM "Campus" AS campus');
    expect(migration).toContain(
      'ON CONFLICT ("campusId", "slug") DO NOTHING',
    );
    for (const [slug, label] of [
      ['campus-life', '校园生活'],
      ['study-help', '学习互助'],
      ['lost-and-found', '失物招领'],
      ['interests', '兴趣交流'],
      ['help-and-advice', '求助建议'],
      ['emotional-support', '情感交流'],
      ['other', '其他'],
    ]) {
      expect(migration).toContain(`('${slug}', '${label}')`);
    }
    expect(migration).not.toMatch(/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/DO UPDATE/i);
  });
});
```

- [ ] **Step 2: Write the real PostgreSQL idempotency test**

Create `tests/integration/forum-category-defaults-migration.test.ts` using `Client` and `assertSafeTestDatabase`. The test must create an isolated schema, execute the real SQL twice, and preserve the pre-existing disabled row:

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabase } from '../helpers/database-safety';

const describeWithDatabase = describe.skipIf(!process.env.DATABASE_URL);
const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../prisma/migrations/20260718100000_seed_forum_categories/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describeWithDatabase('forum category defaults migration', () => {
  it('is idempotent across campuses and preserves existing governance', async () => {
    assertSafeTestDatabase(process.env);
    const schema = `forum_category_defaults_${randomUUID().replaceAll('-', '')}`;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(`
        CREATE TABLE "Campus" (
          "id" TEXT PRIMARY KEY
        );
        CREATE TABLE "ForumCategory" (
          "id" TEXT PRIMARY KEY,
          "campusId" TEXT NOT NULL,
          "slug" VARCHAR(64) NOT NULL,
          "label" VARCHAR(100) NOT NULL,
          "isActive" BOOLEAN NOT NULL DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL,
          UNIQUE ("campusId", "slug")
        );
        INSERT INTO "Campus" ("id") VALUES ('campus-a'), ('campus-b');
        INSERT INTO "ForumCategory"
          ("id", "campusId", "slug", "label", "isActive", "updatedAt")
        VALUES
          ('existing', 'campus-a', 'campus-life', '管理员命名', false, CURRENT_TIMESTAMP);
      `);

      await client.query(migration);
      await client.query(migration);

      const counts = await client.query<{ campusId: string; count: string }>(
        `SELECT "campusId", COUNT(*)::text AS count
         FROM "ForumCategory"
         GROUP BY "campusId"
         ORDER BY "campusId"`,
      );
      expect(counts.rows).toEqual([
        { campusId: 'campus-a', count: '7' },
        { campusId: 'campus-b', count: '7' },
      ]);
      const existing = await client.query(
        `SELECT "label", "isActive"
         FROM "ForumCategory"
         WHERE "id" = 'existing'`,
      );
      expect(existing.rows).toEqual([
        { isActive: false, label: '管理员命名' },
      ]);
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
});
```

- [ ] **Step 3: Run the unit contract and verify RED**

```bash
npx vitest run tests/unit/forum-category-defaults-migration.contract.test.ts
```

Expected: FAIL because the migration file does not exist.

- [ ] **Step 4: Create the data-only migration**

Create `prisma/migrations/20260718100000_seed_forum_categories/migration.sql`:

```sql
BEGIN;

WITH defaults("slug", "label") AS (
  VALUES
    ('campus-life', '校园生活'),
    ('study-help', '学习互助'),
    ('lost-and-found', '失物招领'),
    ('interests', '兴趣交流'),
    ('help-and-advice', '求助建议'),
    ('emotional-support', '情感交流'),
    ('other', '其他')
)
INSERT INTO "ForumCategory" (
  "id",
  "campusId",
  "slug",
  "label",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  'forum_category_' || substr(md5(campus."id" || ':' || defaults."slug"), 1, 24),
  campus."id",
  defaults."slug",
  defaults."label",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Campus" AS campus
CROSS JOIN defaults
ON CONFLICT ("campusId", "slug") DO NOTHING;

COMMIT;
```

- [ ] **Step 5: Run unit and live integration verification**

```bash
npx vitest run tests/unit/forum-category-defaults-migration.contract.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/forum-category-defaults-migration.test.ts
```

Expected: the unit contract passes; with the required test PostgreSQL environment, the real migration passes twice and produces seven rows per campus.

- [ ] **Step 6: Commit the migration and its tests**

```bash
git add prisma/migrations/20260718100000_seed_forum_categories/migration.sql tests/unit/forum-category-defaults-migration.contract.test.ts tests/integration/forum-category-defaults-migration.test.ts
git commit -m "feat: seed forum categories in production"
```

### Task 5: Route Forum and Tree-Hole Publishing Through the Unified Center

**Files:**
- Modify: `tests/unit/forum-ui.contract.test.ts`
- Modify: `tests/e2e/forum-layout.spec.ts`
- Modify: `tests/e2e/forum.spec.ts`
- Modify: `tests/e2e/tree-hole.spec.ts`
- Modify: `components/forum/forum-list.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the failing unified-entry contract**

Add to `tests/unit/forum-ui.contract.test.ts`:

```ts
it('uses only the shared publish center from forum list surfaces', () => {
  const list = source('components/forum/forum-list.tsx');
  const layout = source('app/layout.tsx');
  expect(layout).toContain('className="header-action"');
  expect(layout).toContain('href="/submit"');
  expect(list).not.toContain("'/submit/tree-hole'");
  expect(list).not.toContain("'/submit/forum'");
  expect(list).not.toContain('发布讨论');
  expect(list).not.toContain('发布树洞');
});
```

Update `expectForumMastheadSpacing` in `tests/e2e/forum-layout.spec.ts` to assert the masthead has no CTA:

```ts
async function expectForumMastheadSpacing(page: Page) {
  const masthead = await page.locator('.forum-masthead').boundingBox();
  const tabs = await page.locator('.forum-tabs').boundingBox();
  await expect(page.locator('.forum-masthead .primary-link')).toHaveCount(0);
  expect(masthead).not.toBeNull();
  expect(tabs).not.toBeNull();
  expect(masthead!.y + masthead!.height).toBeLessThanOrEqual(tabs!.y);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
```

- [ ] **Step 2: Run the unit contract and verify RED**

```bash
npx vitest run tests/unit/forum-ui.contract.test.ts
```

Expected: FAIL because `ForumList` still renders `/submit/forum` or `/submit/tree-hole`.

- [ ] **Step 3: Remove list-page publishing links and simplify masthead CSS**

Delete the `primary-link` `<Link>` from `.forum-masthead` in `components/forum/forum-list.tsx`. Keep `Link` imported because post titles and pagination still use it.

Change the base masthead rule to:

```css
.forum-masthead {
  display: block;
  padding-bottom: 1.7rem;
  border-bottom: 5px solid var(--navy);
}
```

Remove the obsolete mobile `.forum-masthead .primary-link` rule.

- [ ] **Step 4: Make live forum tests enter through `/submit`**

In `tests/e2e/forum.spec.ts`, replace the direct submit navigation with:

```ts
await page.goto('/forum');
await page.getByRole('link', { name: '发布内容' }).click();
await expect(page).toHaveURL(/\/submit$/);
await page.getByRole('link', { name: '普通论坛' }).click();
await expect(page).toHaveURL(/\/submit\/forum$/);
```

In `tests/e2e/tree-hole.spec.ts`, replace the direct submit navigation with:

```ts
await page.goto('/forum?view=tree-hole');
await page.getByRole('link', { name: '发布内容' }).click();
await expect(page).toHaveURL(/\/submit$/);
await page.getByRole('link', { name: '匿名树洞' }).click();
await expect(page).toHaveURL(/\/submit\/tree-hole$/);
```

Keep the existing form submission, privacy, comment rejection, likes, and reporting assertions unchanged.

- [ ] **Step 5: Run focused tests and commit**

```bash
npx vitest run tests/unit/forum-ui.contract.test.ts
git add components/forum/forum-list.tsx app/globals.css tests/unit/forum-ui.contract.test.ts tests/e2e/forum-layout.spec.ts tests/e2e/forum.spec.ts tests/e2e/tree-hole.spec.ts
git commit -m "feat: unify forum publishing entry"
```

Expected: the unit contract passes. Live E2E remains scheduled for Task 7, when the complete test environment is available.

### Task 6: Flatten the Shared Header Into One Scrollable Row

**Files:**
- Modify: `tests/unit/app-layout.contract.test.ts`
- Modify: `tests/e2e/home-layout.spec.ts`
- Modify: `components/brand/site-brand.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Replace the two-tier unit contract with the approved order**

Replace the two-tier and mobile Header tests in `tests/unit/app-layout.contract.test.ts` with:

```ts
it('renders every global entry in one ordered horizontal track', () => {
  const orderedTokens = [
    '<SiteBrand />',
    'href="/resources"',
    'href="/marketplace"',
    'href="/campus-work"',
    'href="/forum"',
    'href="/me/submissions"',
    'href="/me/favourites"',
    'className="header-action" href="/submit"',
  ];
  const positions = orderedTokens.map((token) => layout.indexOf(token));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(layout).toContain('className="header-scroll-region"');
  expect(layout).toContain('aria-label="全站导航"');
  expect(layout).not.toContain('header-brand-row');
  expect(layout).not.toContain('header-navigation-row');
});

it('keeps the complete mobile header on one horizontally scrollable line', () => {
  expect(globalStyles).toMatch(
    /\.header-scroll-region\s*\{[^}]*overflow-x:\s*auto;/,
  );
  expect(globalStyles).toMatch(
    /\.header-navigation\s*\{[^}]*width:\s*max-content;[^}]*display:\s*flex;/,
  );
  expect(globalStyles).toMatch(
    /\.site-navigation a\s*\{[^}]*white-space:\s*nowrap;[^}]*flex:\s*0 0 auto;/,
  );
  expect(globalStyles).toMatch(
    /\.header-navigation\s*\{[^}]*flex-wrap:\s*nowrap;/,
  );
  expect(siteBrand).toContain('site-brand-label-full');
  expect(siteBrand).toContain('site-brand-label-compact');
});
```

- [ ] **Step 2: Add failing browser geometry assertions**

Extend `tests/e2e/home-layout.spec.ts` after loading the homepage:

```ts
const headerMetrics = await page.locator('.header-scroll-region').evaluate(
  (region) => {
    const track = region.querySelector<HTMLElement>('.header-navigation');
    const entries = [
      ...region.querySelectorAll<HTMLElement>('.site-brand, .site-navigation a'),
    ];
    if (!track || entries.length !== 8) {
      throw new Error('Single-row Header contract is missing.');
    }
    return {
      clientWidth: region.clientWidth,
      entryTops: entries.map((entry) =>
        Math.round(entry.getBoundingClientRect().top),
      ),
      scrollHeight: track.scrollHeight,
      scrollWidth: region.scrollWidth,
    };
  },
);
expect(new Set(headerMetrics.entryTops).size).toBe(1);
if (viewport.name === 'mobile') {
  expect(headerMetrics.scrollWidth).toBeGreaterThan(headerMetrics.clientWidth);
  const region = page.locator('.header-scroll-region');
  await region.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(page.getByRole('link', { name: '发布内容' })).toBeInViewport();
  await region.evaluate((element) => {
    element.scrollLeft = 0;
  });
  await page.getByRole('link', { name: '发布内容' }).focus();
  await expect(page.getByRole('link', { name: '发布内容' })).toBeInViewport();
}
```

- [ ] **Step 3: Run the unit Header test and verify RED**

```bash
npx vitest run tests/unit/app-layout.contract.test.ts
```

Expected: FAIL because the current shell still uses two rows and the brand has one full label.

- [ ] **Step 4: Give the brand explicit full and compact labels**

Replace the current brand text span in `components/brand/site-brand.tsx` with:

```tsx
<span className="site-brand-label-full">西大同学 CampusLink</span>
<span aria-hidden="true" className="site-brand-label-compact">
  CampusLink
</span>
```

The existing link `aria-label` remains the complete accessible name.

- [ ] **Step 5: Flatten `RootLayout` into one semantic track**

Replace the current Header body in `app/layout.tsx` with:

```tsx
<header className="site-header">
  <div className="header-scroll-region">
    <div className="header-navigation">
      <SiteBrand />
      <nav aria-label="全站导航" className="site-navigation">
        <Link href="/resources">学习资源</Link>
        <Link href="/marketplace">二手交易</Link>
        <Link href="/campus-work">校园工作</Link>
        <Link href="/forum">校园论坛</Link>
        <Link className="utility-navigation-link" href="/me/submissions">
          我的发布
        </Link>
        <Link className="utility-navigation-link" href="/me/favourites">
          我的收藏
        </Link>
        <Link className="header-action" href="/submit">
          发布内容
        </Link>
      </nav>
    </div>
  </div>
</header>
```

- [ ] **Step 6: Replace two-tier CSS with the single-line overflow contract**

Remove `.header-brand-row`, `.header-brand-inner`, `.header-navigation-row`, `.product-navigation`, and `.account-navigation` rules. Remove `.header-action` from the old combined `.header-action, .primary-link` declarations so only `.primary-link` retains those legacy rules. Use:

```css
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-top: 18px solid #171717;
  border-bottom: 1px solid rgba(7, 29, 61, 0.2);
  background: rgba(251, 250, 244, 0.98);
  backdrop-filter: blur(12px);
}
.header-scroll-region {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-color: var(--green) rgba(7, 29, 61, 0.12);
  scrollbar-width: thin;
  scroll-snap-type: x proximity;
}
.header-scroll-region::-webkit-scrollbar {
  height: 0.35rem;
}
.header-scroll-region::-webkit-scrollbar-thumb {
  background: var(--green);
}
.header-navigation {
  width: max-content;
  min-width: min(1180px, calc(100% - 3rem));
  min-height: 106px;
  margin: 0 auto;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: clamp(1rem, 2vw, 2rem);
}
.site-navigation {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0;
}
.site-navigation a {
  min-height: 4rem;
  padding: 0 0.85rem;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  color: var(--navy);
  font-size: 0.95rem;
  font-weight: 750;
  white-space: nowrap;
  scroll-snap-align: center;
}
.site-brand {
  flex: 0 0 auto;
  scroll-snap-align: start;
}
.site-brand-label-compact {
  display: none;
}
.utility-navigation-link {
  color: var(--muted) !important;
}
.site-navigation .header-action {
  min-height: 4.4rem;
  margin-left: 0.5rem;
  padding: 0 1.5rem;
  border: 1px solid var(--navy);
  background: var(--green);
  color: var(--navy);
  font-size: 1.05rem;
  font-weight: 800;
  box-shadow: 5px 5px 0 var(--navy);
  scroll-snap-align: end;
}
```

Replace the old Header declarations inside `@media (max-width: 900px)` with:

```css
.site-header {
  border-top-width: 10px;
}
.header-navigation {
  min-width: calc(100% - 1.5rem);
  min-height: 64px;
  margin: 0 0.75rem;
  gap: 0.8rem;
}
.site-brand {
  gap: 0.5rem;
  font-size: 1rem;
}
.site-brand-mark {
  width: 2.25rem;
  height: 2.25rem;
  flex-basis: 2.25rem;
}
.site-brand-label-full {
  display: none;
}
.site-brand-label-compact {
  display: inline;
}
.site-navigation a {
  min-height: 3.4rem;
  padding: 0 0.7rem;
  font-size: 0.82rem;
}
.site-navigation .header-action {
  min-height: 2.8rem;
  margin-left: 0.25rem;
  padding: 0 0.85rem;
  font-size: 0.85rem;
  box-shadow: 3px 3px 0 var(--navy);
}
```

- [ ] **Step 7: Run focused tests and commit**

```bash
npx vitest run tests/unit/app-layout.contract.test.ts
git add app/layout.tsx components/brand/site-brand.tsx app/globals.css tests/unit/app-layout.contract.test.ts tests/e2e/home-layout.spec.ts
git commit -m "feat: flatten global navigation into one row"
```

Expected: the unit contract passes; live geometry checks run in Task 7.

### Task 7: Full Verification, Visual QA, and Release Readiness

**Files:**
- Verify: all files changed in Tasks 1-6
- Generated evidence only: ignored `output/playwright/`

- [ ] **Step 1: Run formatting and static checks**

```bash
npm run format:check
npm run lint
npm run typecheck
git diff --check
```

Expected: every command exits 0. If Prettier reports only changed files, run `npx prettier --write` on those exact files, rerun all four commands, and commit the formatting with the owning task rather than a detached cleanup commit.

- [ ] **Step 2: Run all unit tests**

```bash
npm run test:unit
```

Expected: the complete unit suite passes with no skipped tests introduced by this change.

- [ ] **Step 3: Run the live integration suite**

With the repository's test PostgreSQL and object-storage environment loaded:

```bash
npm run test:integration
```

Expected: the complete integration suite passes, including executing the forum category migration twice in its isolated schema.

- [ ] **Step 4: Build the production bundle**

```bash
npm run build
```

Expected: Next.js completes a production build with no type, route, or prerender failures.

- [ ] **Step 5: Run the complete browser suite**

Provision the existing isolated E2E environment, then run:

```bash
npm run e2e:provision
npm run test:e2e
```

Expected: forum and tree-hole publishing traverse `/submit`; desktop and mobile Header geometry passes; marketplace, authentication, governance, and existing smoke flows remain green.

- [ ] **Step 6: Capture desktop and mobile visual evidence**

At `1440x900` and `390x844`, capture the homepage, `/marketplace`, `/forum`, and `/forum?view=tree-hole` under ignored `output/playwright/`. Verify:

- the Header remains one line at both widths;
- the mobile Header scrolls internally to “发布内容” without document-level horizontal overflow;
- the homepage brand and hero retain their prior horizontal positions;
- minimum and maximum prices remain side by side and use “元”;
- forum/tree-hole mastheads have no duplicate publish CTA;
- the category select contains the seven shared defaults.

- [ ] **Step 7: Verify migration and worktree state**

With the test migration environment loaded, run:

```bash
npm run db:migrate:deploy
git status --short
git log --oneline -8
```

Expected: migration deploy reports no pending failures, the worktree is clean, and the task commits appear in order. Do not deploy against production until these checks and the final code review pass.
