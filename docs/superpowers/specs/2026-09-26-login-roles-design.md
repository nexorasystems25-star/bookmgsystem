# Login, Roles & Panel Gating — Design

Date: 2026-09-26 · Stage: authentication

## Problem

The app has no authentication. Anyone can open `index.html`, and the four write endpoints
(`/api/payment`, `/api/student`, `/api/issue`, `/api/stock`) accept unauthenticated calls.
The admin needs to log in, and three job roles must reach their own panels.

## Goals

- Admin can log in and reach the full system.
- Teacher logs in to a read-only Students view: which books each student has obtained and
  what is left to be given (balance).
- Store Keeper logs in to the operational surface (Dashboard, Payments, Inventory, Issuing)
  and can confirm which students have their books after payment and what is left to issue.
- All write endpoints require a valid session token. Unauthorized roles get 401/403.
- Zero new runtime dependencies.

## Roles & panel mapping

| Page | Admin | Teacher | Store Keeper |
|---|---|---|---|
| Dashboard | ✓ | — | ✓ |
| Students | ✓ | ✓ (read-only) | — |
| Payments | ✓ | — | ✓ |
| Books | ✓ | — | — |
| Inventory | ✓ | — | ✓ |
| Issuing | ✓ | — | ✓ |
| Reports | ✓ | — | — |
| Settings | ✓ | — | — |

`ROLES = { admin, teacher, storekeeper }`. Sidebar nav is filtered by role; unauthorized
hashes redirect to the role's default page (admin/storekeeper → `#dashboard`, teacher →
`#students`). Teacher sees the Students page but every write control (register / record /
adjust) is hidden.

> **Security posture:** client-side role gating is cosmetic — it only controls what the UI
> renders. The server token is the sole authority for writes. A hand-edited
> `localStorage.cecSession.role` buys nothing because (a) reads are public anyway and
> (b) every write endpoint validates the signed token's role server-side.

## Write-endpoint permissions

| Endpoint | Allowed roles |
|---|---|
| `POST /api/payment` | admin, storekeeper |
| `POST /api/issue` | admin, storekeeper |
| `POST /api/student` | admin |
| `POST /api/stock` | admin |
| `POST /api/config` | admin |

## Issued-books ledger (new tab)

"Books obtained and what is left" has no data source today: `runIssue` decrements Books
stock and appends an Activity row but never records which student received which book.
Per the approved objection disposition we add an **Issued** tab to the spreadsheet:
`issue_id | student_id | book_id | qty | date`.

- `scripts/sync.js` `TABS` gains `Issued: "issued.json"`.
- `js/data-access.js` fetches `fetchTab("Issued", "issued.json")`; dataset gains `issued`.
- `js/derive.js` gains `normalizeIssued(rows)` → `{ issueId, studentId, bookId, qty, date }`
  and a pure helper `issuedSummary(issued)` → `{ byStudent: { studentId: { books: count,
  qty: total } }, byBook: { bookId: total } }`.
- Teacher Students view shows per-student: books issued so far (from `byStudent.qty`) vs
  `books_total` — "obtained / what is left".
- Store Keeper Issuing view adds a per-book "already issued this session" readout from
  `byBook` next to stock availability.
- `api/_lib.js` `runIssue` gains the Issued writes: after decrementing stock it appends one
  row per resolved issue to the Issued tab (same pattern as its Activity append).

## Architecture

### Credentials store — `Users` tab in a SEPARATE, PRIVATE spreadsheet

Credentials never live in the public spreadsheet. The public sheet's
spreadsheet_id is committed in `data/meta.json`, and any tab gid URL is world-readable —
putting users there would leak username + salt + hash to the internet.

Instead: a **second Google spreadsheet**, never shared with anyone, referenced by new env
var `AUTH_USERS_SPREADSHEET_ID`. Only `api/login.js`, `api/check.js` and
`scripts/create-user.js` touch it, and always through the existing OAuth client
(`createClient`), never through public export URLs.

Columns: `username | credentials | role | created_at | updated_at` where `credentials`
encodes the full SCrypt parameters so future cost bumps still verify:

`credentials = "N:r:p:salt:hash"` — e.g. `"16384:8:1:ab12cd...:ef34ab..."`
(salt = 16 random bytes hex, hash = 64-byte SCrypt key hex).

**The Users tab is never shipped to the browser in any form.**

### Password hashing (no deps)

`node:crypto` SCrypt:
- `hashPassword(password)` → `{ credentials }` with `N=16384, r=8, p=1`, salt 16 bytes,
  key 64 bytes, all hex; formatted `N:r:p:salt:hash`.
- `verifyPassword(password, credentials, timingSafeCompare)` — parses params from the
  credentials string, derives with those params, compares via `crypto.timingSafeEqual`.
- **Async `crypto.scrypt` in serverless handlers** (login) so the event loop is not blocked;
  sync `scryptSync` is acceptable only in the CLI seed script.

### Session tokens (stateless)

Stateless HMAC-SHA256 token: `base64url(payload) + "." + base64url(signature)` where
`payload = {"sub": username, "role": role, "exp": epochSec}`. Signed with a server secret
(env `AUTH_SESSION_SECRET`). No token store needed; any serverless instance verifies it.
TTL = 12 hours.

- `signToken({username, role}, ttlSeconds, secret)` → string.
- `verifyToken(token, secret)` → payload or `null` (signature mismatch, malformed, or
  expired returns null).

### `api/_lib.js` additions

`hashPassword`, `verifyPassword`, `signToken`, `verifyToken`,
`requireAuth(req, res, allowedRoles)` — reads `Authorization: Bearer <token>`, verifies,
checks role; on failure returns 401 (missing/invalid token) or 403 (role not allowed).
`runIssue` gains its Issued-tab appends.

### `api/login.js` (new)

Vercel serverless handler:
1. Parse `{ username, password }` (string checks).
2. `createClient` (existing Google OAuth client from `_lib.js`).
3. `sheetsGet(process.env.AUTH_USERS_SPREADSHEET_ID, "Users!A:E")`, find row by `username`.
4. `verifyPassword(password, row.credentials)` (async).
5. On success → `signToken({username, role})`; return 200
   `{ ok: true, token, username, role, exp }`.
6. Bad user / bad password → 401 `{ ok: false, error: "Invalid username or password." }`
   (identical message for both — no user enumeration).
7. Sheets/client errors → 500.

### `api/check.js` (new)

Reads bearer token, returns 200 `{ ok: true, username, role, exp }` or 401
`{ ok: false, error }`. Used by the frontend on load to validate a stored session.

### Existing endpoint gating

`api/payment.js`, `api/student.js`, `api/issue.js`, `api/stock.js` (and the in-progress
`api/config.js`) each call `lib.requireAuth(req, res, allowedRoles)` as the first step —
**before** any `createClient`, so an unauthorized call never triggers a doomed Sheets
round-trip.

### `scripts/create-user.js` (new)

CLI that seeds a user into the private Users sheet:
`node scripts/create-user.js --users-sheet <id|env> --username admin --password <pw> --role admin`
- `--init` flag: creates the Users tab (and header row) in the private spreadsheet via the
  Sheets API, safely idempotent (skips if the tab already exists).
- Reads `.env` / env for Google creds + `AUTH_USERS_SPREADSHEET_ID`; hashes the password
  locally; verifies the header row before every append; fails loudly if the header is wrong.
- Refuses roles outside `{admin, teacher, storekeeper}`.

### Offline / network-failure auth policy

- Login is mandatory whenever `/api/check` is reachable.
- If the app holds a stored token and `/api/check` fails with a **network error** (not a
  401), it enters **read-only offline snapshot view**: data renders from `data/*.json`,
  every write control is hidden, a banner shows "Offline — read only", and logout remains
  available. This preserves the Stage-02 offline/dev workflow without opening any security
  hole (no writes can occur in a dead-network state).
- A 401 (invalid/expired token) always clears the session and redirects to `login.html`.

### Frontend

- **`login.html`** (new static page): CEC-styled centered login card, username + password
  fields, inline error area, submit → `fetch("/api/login")` POST JSON. On success stores
  `{"token", "username", "role", "exp"}` under `localStorage["cecSession"]`, then redirects
  to the role's default page (`#dashboard` for admin/storekeeper, `#students` for teacher).
  Fully styled with the existing palette (reuses styles.css classes).
- **`js/session.js`** (new): `CEC.session` object
  - `load()` — read `cecSession` from localStorage.
  - `user`, `role`, `token`, `exp` getters (role always from the signed token payload).
  - `guard()` — no token → `login.html`; token + `/api/check` → valid, or 401 → clear +
    `login.html`, or network error → offline read-only mode.
  - `logout()` — clear localStorage session, return to `login.html`.
- **`js/app.js`**: `boot()` calls `CEC.session.guard()` before any render; sidebar
  `nav-item` visibility filtered by `CEC.session.role`; router `pageForHash` consults role →
  unauthorized hash lands on the role's default page.
- **Teacher read-only hardening**: write controls (Register / Record / Adjust buttons and
  their modal triggers) are hidden in the renderers when role is `teacher` — not just
  the nav.
- **`index.html`**: add logout control to sidebar; role-based nav visibility is
  render-time (no new static page markup beyond login.html + logout button).
- **Teacher/StoreKeeper issued views** read `dataset.issued` via `issuedSummary` (pure
  helper) so the renderers add the "obtained / left" columns/readouts.

### Read path stays public (documented trade-off)

`js/data-access.js` reads via Google's public gviz/export URLs plus `data/*.json`. That is
inherent to the Stage-02 share-as-viewer design. **Auth gates the write/admin surface**,
which is the actual risk. Private reads would require routing reads through a serverless
endpoint — explicit non-goal of this stage.

> Brute-force rate limiting on `/api/login` is an explicit non-goal (needs Vercel Level-0 /
> WAF protection). Constant-time compare + the generic 401 message already mitigate the
> cheap attacks. Stolen tokens live at most 12h (stateless, no revocation) — documented.

## Env & config

- New env vars: `AUTH_SESSION_SECRET`, `AUTH_USERS_SPREADSHEET_ID` (added to `.env.example`
  and README).
- Issued tab gid auto-recorded in `data/meta.json` by `npm run sync` after the tab exists.
- README: write-endpoint auth note updated from "intentionally deferred" to "token required".

## Testing

`scripts/test.js` additions (~35):
- `hashPassword`/`verifyPassword`: correct hash verifies, wrong password fails, different
  salts differ, credential strings carry `N:r:p`, verify works after reading back a
  fixture's literal credential string.
- `signToken`/`verifyToken`: valid round-trip; tampered signature → null; expired → null;
  malformed → null.
- `requireAuth`: missing header → 401; bad token → 401; valid wrong role → 403; valid
  allowed role → next(). Called-before-createClient asserted.
- Login flow with fake Sheets client: valid creds → 200 + token; wrong password → 401;
  unknown user → 401; identical error message for both failure modes.
- Role gating per endpoint module: payment/issue accept storekeeper+admin; student/stock/
  config admin-only (missing token → 401 without error).
- `runIssue` Issued-ledger writes: per-book rows appended to Issued after stock decrement.
- `issuedSummary`: byStudent/byBook aggregation.
- `pageForHash` role mapping: admin sees all pages, teacher only `#students`,
  storekeeper the operations set.

Run: `node scripts/test.js` (current baseline 155 passing; expect ~190 after).

## Deployment

Existing Vercel layout unchanged: `api/*.js` auto-deployed; `login.html`, `js/session.js`
shipped as static assets. Add `AUTH_SESSION_SECRET` + `AUTH_USERS_SPREADSHEET_ID` to Vercel
project settings. The private users sheet is created/owned by the OAuth-authorized Google
account; the public sheet is untouched except for the new Issued tab.

## Non-goals

- Private (authenticated) read path — future stage.
- User management UI (create/disable users from the browser) — future stage; accounts are
  seeded via `scripts/create-user.js`.
- Token revocation / refresh rotation — stateless tokens expire in 12h.
- Rate limiting / account lockout on `/api/login`.

## Acceptance criteria

1. Logging in with a seeded admin/teacher/storekeeper credential returns a token and opens
   the correct panel (`#dashboard` / `#dashboard` / `#students`).
2. Bad password / unknown username shows an identical inline error and nothing is stored.
3. A stored but expired/invalid session bounces to `login.html`.
4. Logged-out users cannot reach any panel.
5. Teacher sees only the Students page, read-only (no write controls anywhere), with
   per-student "books obtained / what is left" from the Issued ledger.
6. Store Keeper sees Dashboard/Payments/Inventory/Issuing; can record payments and issue
   books; sees the Issued-ledger "already issued" readout; cannot call `/api/student`,
   `/api/stock`, or `/api/config`.
7. All five write endpoints return 401 without a valid token; an unauthorized role gets 403.
8. `/api/payment` and `/api/issue` accept admin+storekeeper tokens; the rest admin only.
9. Offline network failure → read-only snapshot view with writes hidden and a banner; 401
   during check → login.html.
10. `node scripts/test.js` passes with zero failures.