# CampusLink security model

CampusLink uses database-backed opaque sessions, exact-origin checks for
mutations, campus-scoped authorization, bounded JSON requests, private object
storage, short-lived signed reads, and immutable moderation/audit events.

## Trust boundaries

- Browsers are untrusted. Every mutation re-resolves the server session and
  validates role, campus, ownership, current state, and input schema.
- Reverse-proxy headers are ignored unless `TRUST_PROXY=true`; the trusted edge
  must overwrite them.
- Uploaded bytes are untrusted even after MIME and length checks. Storage
  readiness and malware verdict are independent states.
- Scanner and cleanup callbacks use different bearer secrets and timing-safe
  comparison. They are never browser-accessible credentials.
- AI credentials are encrypted with `AI_CONFIG_ENCRYPTION_KEY_V1`. Outbound
  requests require an exact `AI_ALLOWED_HOSTS` match, public DNS answers, HTTPS,
  and redirect revalidation; contacts and anonymous identity never enter the
  model payload.
- Tree-hole identity uses `ANONYMOUS_IDENTITY_KEY_V1` for authenticated
  encryption and a distinct `ANONYMOUS_FINGERPRINT_KEY` for owner matching.

## Upload lifecycle

1. A verified user obtains a five-minute constrained PUT URL.
2. Completion checks the exact key, byte length, and normalized content type.
3. Images become storage-ready with scanning not required. Documents become
   storage-ready but scan-pending.
4. Only an authenticated scanner callback can record the SHA-256 verdict.
5. Production resource binding, resubmission, publication, and signed download
   all require a clean document. Infected assets are rejected before deletion.

## Moderation and identity

The deterministic blocked-word gate runs before AI. PASS publishes, REVIEW
queues staff review, provider BLOCK persists a rejected record and returns
bounded Chinese feedback, and provider failure publishes with an immutable
`AI_CHECK_SKIPPED` audit event. Admin-only model signals never reach authors or
moderators. Custom-tag assessments are associated with their parent content and
the strictest current outcome is shown.

Anonymous tree-hole posts expose no author field. Only an administrator may
reveal one author for an open or triaged report; the action records
`TREE_HOLE_AUTHOR_REVEALED`. Tree holes allow posts, likes, and reports only,
with no comment path.

## Key rotation

Key rotation is expand/migrate/contract: deploy readers for a new numbered key,
re-encrypt in an audited batch, switch writers, verify, then remove the old
reader. Never overwrite `AI_CONFIG_ENCRYPTION_KEY_V1` or
`ANONYMOUS_IDENTITY_KEY_V1` while records still reference version 1. Never
replace `ANONYMOUS_FINGERPRINT_KEY` without migrating every stored fingerprint.

## Reporting vulnerabilities

Provide the affected route, minimal reproduction, impact, and any relevant
request or audit identifiers through the project's private security channel.
Do not include passwords, session cookies, API keys, or private uploaded files
in a public issue.
