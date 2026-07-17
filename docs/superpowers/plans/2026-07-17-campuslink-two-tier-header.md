# CampusLink Two-Tier Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared single-row Header with the approved two-tier brand/action row and navigation row without changing any route or business behavior.

**Architecture:** Keep `RootLayout` as the shared shell and reuse `SiteBrand`. Add two semantic layout wrappers inside the existing `<header>`, then replace the current single-row flex CSS and responsive grid rules with a shared-width two-tier layout whose mobile navigation remains one horizontally scrollable row.

**Tech Stack:** Next.js 16 App Router, React 19, CSS, Vitest contract tests, Playwright/browser visual verification.

---

### Task 1: Lock the approved Header contract

**Files:**
- Modify: `tests/unit/app-layout.contract.test.ts`
- Test: `tests/unit/app-layout.contract.test.ts`

- [ ] **Step 1: Write the failing structural contract**

Add a test that proves the brand/action row comes before the navigation row and that the action remains in the first row:

```ts
it('renders the approved two-tier shared header', () => {
  const brandRow = layout.indexOf('className="header-brand-row"');
  const navigationRow = layout.indexOf('className="header-navigation-row"');
  const action = layout.indexOf('className="header-action"');

  expect(brandRow).toBeGreaterThan(-1);
  expect(navigationRow).toBeGreaterThan(brandRow);
  expect(action).toBeGreaterThan(brandRow);
  expect(action).toBeLessThan(navigationRow);
  expect(globalStyles).toMatch(
    /\.site-header\s*\{[^}]*border-top:\s*18px solid #171717;/,
  );
  expect(globalStyles).toMatch(
    /\.header-brand-inner,[\s\S]*?\.header-navigation\s*\{[^}]*width:\s*min\(1180px, calc\(100% - 3rem\)\);/,
  );
});
```

Delete the obsolete `tabletHeaderStyles` slice, then replace both current responsive Header tests with the approved single-row scroll contract:

```ts
it('keeps all navigation links in one scrollable mobile row', () => {
  expect(layout).toContain('href="/me/submissions">我的发布</Link>');
  expect(layout).toContain('href="/me/favourites">我的收藏</Link>');
  expect(globalStyles).not.toMatch(
    /\.account-navigation\s*\{[^}]*display:\s*none;/,
  );
  expect(mobileHeaderStyles).toMatch(
    /\.header-navigation-row\s*\{[^}]*overflow-x:\s*auto;/,
  );
  expect(mobileHeaderStyles).toMatch(
    /\.header-navigation\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/,
  );
  expect(mobileHeaderStyles).not.toContain('display: none');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run tests/unit/app-layout.contract.test.ts
```

Expected: FAIL because `header-brand-row` and `header-navigation-row` do not exist and the current mobile CSS uses grid rows.

### Task 2: Implement the two-tier shared Header

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/app-layout.contract.test.ts`

- [ ] **Step 1: Split the Header markup into two rows**

Replace the current direct Header children with this structure while preserving every existing link and ARIA label:

```tsx
<header className="site-header">
  <div className="header-brand-row">
    <div className="header-brand-inner">
      <SiteBrand />
      <Link className="header-action" href="/submit">
        发布内容
      </Link>
    </div>
  </div>
  <div className="header-navigation-row">
    <div className="header-navigation">
      <nav aria-label="内容导航" className="product-navigation">
        <Link href="/resources">学习资源</Link>
        <Link href="/marketplace">二手交易</Link>
        <Link href="/campus-work">校园工作</Link>
        <Link href="/forum">校园论坛</Link>
      </nav>
      <nav aria-label="个人中心" className="account-navigation">
        <Link href="/me/submissions">我的发布</Link>
        <Link href="/me/favourites">我的收藏</Link>
      </nav>
    </div>
  </div>
</header>
```

- [ ] **Step 2: Replace the base Header CSS**

Use a sticky outer shell, shared 1180px content width, 106px brand row, and 76px navigation row:

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
.header-brand-row {
  background: var(--paper);
}
.header-brand-inner,
.header-navigation {
  width: min(1180px, calc(100% - 3rem));
  margin: 0 auto;
}
.header-brand-inner {
  min-height: 106px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}
.header-navigation-row {
  border-top: 1px solid rgba(7, 29, 61, 0.18);
}
.header-navigation {
  min-height: 76px;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 1.5rem;
}
.site-header nav {
  display: flex;
  align-items: stretch;
  gap: 0;
  font-size: 1.05rem;
  font-weight: 750;
}
.site-header nav a {
  min-height: 76px;
  padding: 0 1rem;
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
}
.product-navigation a:first-child {
  padding-left: 0;
}
.account-navigation {
  padding-left: 0;
  border-left: 1px solid var(--line);
  color: var(--muted);
}
```

Increase the desktop brand and action sizes to match the approved preview:

```css
.site-brand {
  gap: 1rem;
  font-size: 1.65rem;
}
.site-brand-mark {
  width: 3.5rem;
  height: 3.5rem;
  flex-basis: 3.5rem;
}
.header-action {
  min-height: 4.4rem;
  padding: 0 1.75rem;
  display: inline-flex;
  align-items: center;
  font-size: 1.2rem;
  box-shadow: 5px 5px 0 var(--navy);
}
```

- [ ] **Step 3: Replace the old responsive Header grid rules**

At `max-width: 900px`, keep the first row compact and make the second row horizontally scrollable:

```css
@media (max-width: 900px) {
  .site-header {
    border-top-width: 10px;
  }
  .header-brand-inner {
    width: min(100% - 1.5rem, 1180px);
    min-height: 76px;
    gap: 0.75rem;
  }
  .site-brand {
    gap: 0.55rem;
    font-size: 1rem;
  }
  .site-brand-mark {
    width: 2.25rem;
    height: 2.25rem;
    flex-basis: 2.25rem;
  }
  .header-action {
    min-height: 2.8rem;
    padding: 0 0.8rem;
    font-size: 0.85rem;
    box-shadow: 3px 3px 0 var(--navy);
  }
  .header-navigation-row {
    overflow-x: auto;
  }
  .header-navigation {
    width: max-content;
    min-width: 100%;
    min-height: 58px;
    margin: 0;
    gap: 0;
  }
  .site-header nav a {
    min-height: 58px;
    padding: 0 0.75rem;
    font-size: 0.82rem;
  }
  .product-navigation a:first-child {
    padding-left: 0.75rem;
  }
}
```

Remove the obsolete `max-width: 1080px` Header wrapping rules and the `max-width: 900px` product/account grid declarations.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx vitest run tests/unit/app-layout.contract.test.ts
```

Expected: the complete file passes.

- [ ] **Step 5: Commit the Header implementation**

```bash
git add app/layout.tsx app/globals.css tests/unit/app-layout.contract.test.ts
git commit -m "feat: restore two-tier site header"
```

### Task 3: Verify desktop and mobile rendering

**Files:**
- Verify: `app/layout.tsx`
- Verify: `app/globals.css`

- [ ] **Step 1: Run all code quality gates**

Run:

```bash
npm run test:unit
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

Expected: every command exits 0 with no failed tests or formatting errors.

- [ ] **Step 2: Inspect the live desktop Header**

Open `http://127.0.0.1:3000/` at 1440x900 and verify:

- the dark top rule, brand/action row, and navigation row are distinct;
- the two rows share the same horizontal boundary;
- all six navigation links are visible;
- no Header element overlaps the homepage.

- [ ] **Step 3: Inspect the live mobile Header**

Open the same page at 390x844 and verify:

- brand and publish button fit in the first row;
- the second row remains one line and scrolls horizontally;
- no text is clipped and the document has no unintended page-level horizontal overflow.

- [ ] **Step 4: Record final evidence**

Capture desktop and mobile screenshots under ignored `output/playwright/`, confirm `git status` contains no generated tracked changes, and report the preview URL.
