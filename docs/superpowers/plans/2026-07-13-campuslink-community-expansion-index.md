# CampusLink Community Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved CampusLink community expansion through independently testable and reversible phases.

**Architecture:** Keep one Next.js App Router application, PostgreSQL/Prisma database, and private S3-compatible storage. Add bounded domain services for announcements, tags, campus work, forums, anonymous identity, blocked words, AI moderation, and user governance; route handlers remain thin authorization and request-boundary adapters.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma 7, PostgreSQL 16, Zod 4, S3-compatible storage, Vitest, Playwright, OpenAI-compatible moderation API.

---

## Plan Set And Order

Execute these plans in order. Each phase must pass its own checks and be pushed before the next phase starts.

1. `2026-07-13-campuslink-foundation-brand-auth.md`
2. `2026-07-13-campuslink-announcements-user-admin.md`
3. `2026-07-13-campuslink-publishing-tags-campus-work.md`
4. `2026-07-13-campuslink-forum-treehole.md`
5. `2026-07-13-campuslink-ai-moderation-release.md`

## Specification Coverage

| Approved design area | Owning plan |
| --- | --- |
| Open email registration, verified-email gates, non-official branding, Image2 logo, home shell | Phase 1 |
| Admin-only announcements, Hero banner, history drawer, permanent cover deletion, user governance | Phase 2 |
| Unified tags, course-code retirement, campus work, protected contact reveal, no in-app chat | Phase 3 |
| Public one-level forum, verified-only anonymous tree hole, report-gated author reveal | Phase 4 |
| Blocked words, configurable OpenAI-compatible assessment, Chinese feedback, fail-open alerting | Phase 5 |
| Contract migrations, security regression, Chinese deployment guide, backup and rollback | Phase 5 |

## Branch And Rollback Discipline

- Baseline remote: `https://github.com/xndxyy/campuslink`
- Protected baseline tag: `pre-community-expansion-2026-07-13`
- Implementation branch: `codex/community-expansion`
- Create the implementation worktree with `superpowers:using-git-worktrees`; do not implement directly on `master`.
- Push after every task commit. At each phase boundary, create and push an annotated tag named `community-expansion-phase-1` through `community-expansion-phase-5`.
- Never rewrite or delete the baseline tag.
- Use expand/contract migrations. No task may drop `JobPost`, `courseCode`, or `allowedEmailDomain` until all new readers and writers are deployed and the final migration contract tests pass.

## Global Verification Cadence

Run the focused test named in each task first. At each phase boundary run:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Expected: every command exits `0`. Phases that change database behavior also run `npm run test:integration`; phases that change user workflows run `npm run test:e2e` against provisioned E2E services.

## Completion Rule

The expansion is not complete until the Phase 5 release verifier passes, the Chinese delivery guide reflects the new environment variables and workflows, the remote implementation branch contains every task commit, and the production deployment owner has configured the required Image2, SMTP, storage, anonymous-identity, and AI-encryption secrets outside Git.
