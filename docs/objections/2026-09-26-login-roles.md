# Objections — Login, Roles & Panel Gating (spec mode)

Adjudication for the spec-mode gate on
`docs/superpowers/specs/2026-09-26-login-roles-design.md`.

Adversarial review (external protocol, six categories) raised six objections, two critical.
All dispositions written; gate passes.

| # | Category | Severity | Objection | Disposition | Status |
|---|----------|----------|-----------|-------------|--------|
| 1 | Security | CRITICAL | Users tab in the public spreadsheet is world-readable via link-guessable gviz/export URLs (spreadsheet_id is committed in data/meta.json); leaks username+salt+hash. | Moved credentials to a separate, never-shared private spreadsheet (`AUTH_USERS_SPREADSHEET_ID`), touched only by api/login.js, api/check.js, create-user.js via the OAuth client. Public sheet contains no credentials. | RESOLVED |
| 2 | Premise | CRITICAL | "Books obtained / what's left" (Teacher + Store Keeper) has no data source: runIssue never records which student got which book. | User approved the Issued ledger tab (`issue_id, student_id, book_id, qty, date`); runIssue appends one row per issue; dataset gains `issued`; derive gains `normalizeIssued` + `issuedSummary`. | RESOLVED (user decision) |
| 3 | Feasibility | HIGH | Sync SCrypt blocks the serverless event loop; param defaults ambiguous. | Async `crypto.scrypt` in handlers; `N=16384, r=8, p=1` pinned; `credentials` column encodes `N:r:p:salt:hash` so future cost bumps still verify. Sync only in the CLI seed script. | RESOLVED |
| 4 | Design | MEDIUM | Client-side role in localStorage can be hand-forged to "admin". | Documented: client-side gating is cosmetic only; all writes validate the signed token's role server-side. A forged role buys nothing. | RESOLVED (by design) |
| 5 | Operability | HIGH | No bootstrap for the Users tab/sheet; appends against missing header. | `create-user.js --init` creates the private Users sheet + header (idempotent); header-row check before every append; loud failure. | RESOLVED |
| 6 | Completeness | HIGH | Offline/network-failure interaction with the login gate unspecified. | Reachable API → login mandatory; stored token + network error → read-only offline snapshot view with all writes hidden + banner; 401 always → login.html. | RESOLVED |

Minor findings folded in: per-role login.html redirect target; Teacher read-only hardening
in renderers (not just nav); generic 401 message prevents username enumeration; constant-time
password compare; logout returns to login.html; rate limiting documented as a non-goal.

Gate: PASSED — all pending objections disposed.