# CampusLink Home Announcement Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the oversized home Hero slogan with one announcement card and remove the separate bottom announcement band.

**Architecture:** Keep `getHomeAnnouncement` and the announcement center unchanged. Move the existing announcement states into `.hero-copy`, give them a dedicated card class, and remove the grid-row announcement band styles at every breakpoint.

**Tech Stack:** Next.js 16 App Router, React 19, CSS, Vitest contract tests, Playwright visual verification.

---

### Task 1: Move The Announcement Into The Hero Copy

**Files:**
- Modify: `tests/unit/announcement-ui.contract.test.ts`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Write the failing layout contract**

Require the new card to replace the heading and prohibit the old band:

```ts
expect(home).toContain('className="hero-announcement-card"');
expect(home).not.toContain('让知识、物品与互助');
expect(home).not.toContain('className="hero-announcement"');
expect(styles).toContain('.hero-announcement-card');
expect(styles).not.toMatch(/\.hero-announcement\s*\{/);
```

- [ ] **Step 2: Run the contract and verify RED**

Run: `npm run test:unit -- tests/unit/announcement-ui.contract.test.ts`

Expected: FAIL because the existing page still contains the large heading and bottom `.hero-announcement` band.

- [ ] **Step 3: Implement the approved card**

Inside `.hero-copy`, render the existing announcement state immediately after the eyebrow. Use a linked card for a real announcement and a non-linked card with an announcement-center action for the empty state. Keep the supporting paragraph and `.hero-actions` after the card. Remove the old announcement block after the Hero aside.

Style `.hero-announcement-card` as a stable, bordered paper card with a green status label, a serif title, a navy action line, and responsive grid behavior. Remove all `.hero-announcement` desktop, tablet, and mobile rules.

- [ ] **Step 4: Verify GREEN and regressions**

Run: `npm run test:unit -- tests/unit/announcement-ui.contract.test.ts tests/unit/app-layout.contract.test.ts`

Expected: both files pass with zero failures.

Run: `npm run format:check && npm run typecheck && npm run build`

Expected: every command exits 0 and the production build generates all routes.

- [ ] **Step 5: Verify the rendered page**

Capture `http://127.0.0.1:3113/` at 1440x900 and 390x844. Confirm the card replaces the slogan, the old dark announcement band is absent, the category strip follows the Hero, and no element overflows or overlaps.

- [ ] **Step 6: Commit and push**

```powershell
git add app/page.tsx app/globals.css tests/unit/announcement-ui.contract.test.ts docs/superpowers
git commit -m "feat: move home announcement into hero card"
git push origin codex/community-expansion
```

