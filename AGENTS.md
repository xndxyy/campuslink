# CampusLink Agent Rules

## Start here

- Work from the current feature branch: codex/single-row-navigation-forum-marketplace.
- Read docs/CAMPUSLINK_HANDOFF.md before changing code.
- Read docs/security.md and docs/operations.md before touching authentication, uploads, moderation, keys, or deployment.
- Treat docs/superpowers/ as dated design and implementation records; verify the current code before reusing a plan.

## Hard boundaries

- Do not connect to, modify, or deploy production unless the user explicitly authorizes the exact change after a risk review.
- Production deployment is paused while compliance, verification mail, moderation operations, scanner Worker, and live release evidence are incomplete.
- Never place passwords, API keys, database URLs with credentials, certificates, SSH keys, or production environment files in Git, logs, screenshots, or client code.
- Do not run seeds or destructive E2E commands against a production database. Destructive E2E requires an isolated database ending in _test or _e2e and explicit ALLOW_DESTRUCTIVE_E2E=true.
- Preserve campus scoping, server-side authorization, audit events, anonymous identity protections, and private object storage invariants.

## Development and verification

Use Node.js >=22.12.0 and npm ci for a clean install. After code changes run the relevant checks:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

Run integration/E2E only with isolated live services and fixtures. Missing services or skip flags are UNKNOWN, not release approval. Keep changes scoped, inspect git status before staging, and update the relevant docs when behavior or operational contracts change.
