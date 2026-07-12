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

## Upload lifecycle

1. A verified user obtains a five-minute constrained PUT URL.
2. Completion checks the exact key, byte length, and normalized content type.
3. Images become storage-ready with scanning not required. Documents become
   storage-ready but scan-pending.
4. Only an authenticated scanner callback can record the SHA-256 verdict.
5. Production resource binding, resubmission, publication, and signed download
   all require a clean document. Infected assets are rejected before deletion.

## Reporting vulnerabilities

Provide the affected route, minimal reproduction, impact, and any relevant
request or audit identifiers through the project's private security channel.
Do not include passwords, session cookies, API keys, or private uploaded files
in a public issue.
