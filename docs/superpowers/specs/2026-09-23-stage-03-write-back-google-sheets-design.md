# Stage 03 Design — Write-Back to Google Sheets

**Date:** 2026-09-23
**Project:** CEC Book Management & Payment System (Chariot Educational Complex)
**Status:** Approved design (pre-implementation)

## 1. Goal

Give the Stage 02 read-only dashboard the ability to write back to the Google Spreadsheet — recording payments, registering students, issuing books, and adjusting stock — directly from the dashboard UI. No authentication this stage (auth/admin roles deferred). The spreadsheet remains the single source of truth; the Stage 02 read path (live GVIZ + JSON fallback) is unchanged.

Write operations, scoped by the user:
- Record a payment
- Register a student
- Issue a book
- Adjust stock

## 2. Architecture

```
Browser modal forms → js/write.js (CEC.write.*) → POST /api/<op>
                                                        │
Vercel serverless functions          api/_lib.js (shared)
├─ api/payment.js  ────┐            ├─ OAuth token refresh + cached access token
├─ api/student.js  ────┤            ├─ sheetsAppend(range, rows)   (Sheets API v4 :append)
├─ api/issue.js    ────┼───────────►├─ sheetsUpdate(range, values)(Sheets API v4 :values PUT)
└─ api/stock.js    ────┘            └─ pure logic: nextId / recomputeStatus / validators
```

- **One endpoint per write operation** (Approach A). Each endpoint file is a thin Vercel handler: reads `req.body`, validates, delegates to `_lib`, returns `{ ok, row(s) }` or `{ ok:false, error }`.
- **No new credentials:** the write path reuses the existing Google OAuth Desktop client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) plus the refresh token (`GOOGLE_REFRESH_TOKEN`) minted in Stage 02 — the owner account already has edit rights to the sheet. These three live as Vercel env vars; nothing touches the browser.
- **Reads unchanged:** the dashboard still reads live via the GVIZ CSV endpoint with the committed JSON fallback. `Config.last_synced` semantics are unchanged (build-sync freshness, not per-write).
- **Template / stack:** no framework, no Google SDK. Plain Node `fetch` (global in Node 24 / Vercel runtimes). The existing Vercel static deployment serves `api/*` functions automatically; `vercel.json` needs no change for functions to be picked up (verify at deploy).

## 3. Operation semantics

Each operation is one function invocation issuing a small sequence of Sheets calls (read-modify-write on a single row, plus appends). Sheets has no transactions; at single-office scale the only race window is two simultaneous writes to the *same* student/book, which is not expected in practice. Acceptable for this stage — noted in §8.

### 3.1 `api/payment.js` — Record a payment

**Input:** `{ student_id, amount, method, date? }` (date defaults to today)

**Effects:**
1. Append to **Payments**: `payment_id: P<next>`, `student_name` + `class` pulled from the Students row, `amount`, `method`, `date`, `status: "confirmed"`.
2. Update the **Students** row: `books_paid += amount`, then recompute `status` via `recomputeStatus`.
3. Append to **Activity**: `activity_id: A<next>`, `type: "payment"`, `description: "Payment received from <name>"` — or `"Partial payment from <name>"` when `books_paid < books_fee` (matches the existing A001/A006 pattern), `amount`, `created_at`.

**Validation:** amount > 0; method ∈ {Cash, MTN MoMo, Telecel}; student exists.

### 3.2 `api/student.js` — Register a student

**Input:** `{ name, class, gender, books_fee, books_total, academic_year? }` (defaults `2026/2027`)

**Effects:**
1. Append to **Students**: `student_id: S<next>`, `books_paid: 0`, `status: "not covered"`.
2. Append to **Activity**: type `student`, description `"New student record created for <name>"` (matches A005), `amount: 0`.

**Validation:** name/class non-empty; gender ∈ {male, female}; books_fee, books_total ≥ 0.

### 3.3 `api/issue.js` — Issue a book

**Input:** `{ student_id, book_id, qty }`

**Effects:**
1. Update the **Books** row: `stock_qty -= qty` — **reject if stock would go negative**.
2. Append to **Activity**: type `issue`, description `"Books issued to <name>"` (matches A002), `amount: 0`.

**Validation:** student + book exist; qty ≥ 1; stock_qty ≥ qty.

### 3.4 `api/stock.js` — Adjust stock

**Input:** `{ book_id, stock_delta }` (signed: `+` restock, `−` correction)

**Effects:**
1. Update the **Books** row: `stock_qty += stock_delta` — reject if result < 0.
2. Append to **Activity**: type `stock`, description `"New stock added for <subject>"` / `"Stock corrected for <subject>"` (matches A004), `amount: 0`.

**Validation:** book exists; stock_delta ≠ 0.

## 4. Shared `api/_lib.js`

Pure Node module exporting:

- `getAccessToken()` — exchanges `GOOGLE_REFRESH_TOKEN` at `https://oauth2.googleapis.com/token` with the client env vars; caches the access token in module scope (reused across concurrent requests, refreshed when expired). Reads `process.env`.
- `sheetsAppend(range, rows)` — `POST .../values/{range}:append?valueInputOption=RAW`. Range uses `SheetName!A1:J1` cell notation. Throws structured error on non-2xx.
- `sheetsUpdate(range, values)` — `PUT .../values/{range}?valueInputOption=RAW` for row updates (student `books_paid`, book `stock_qty`).
- `nextId(rows, prefix)` — scans existing numeric suffixes, returns `prefix + (max + 1)` zero-padded to 3 (`P009`, `S010`, `A007`); empty tab → `P001`. Pure, unit-testable.
- `recomputeStatus(books_paid, books_fee)` → `ready | not covered | waiting`. Pure, unit-testable.
- `validatePaymentPayload` / `validateStudentPayload` / `validateIssuePayload` / `validateStockPayload` — return `{ ok:true, payload }` or `{ ok:false, error }`. Pure, unit-testable.

`SPREADSHEET_ID` is read from env (string, not hard-coded) so integration tests can point at a scratch spreadsheet.

## 5. Environment / secrets

| Var | Where | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Vercel env | Same Desktop client as Stage 02 |
| `GOOGLE_CLIENT_SECRET` | Vercel env | |
| `GOOGLE_REFRESH_TOKEN` | Vercel env | Minter in Stage 02 loopback flow |
| `SPREADSHEET_ID` | Vercel env | Production sheet |

- Repo `.env` stays gitignored; it only seeds (`for local `_lib` test runs and the scratch-sheet integration runner.
- **Caveat:** the OAuth client is in Google testing mode, so refresh tokens expire in ~7 days. For a long-lived production deploy the consent screen must eventually be published (or tokens re-issued). Flagged as ops risk in §8.

## 6. Frontend

### 6.1 `js/write.js` (new, loaded after `app.js`)

Exposes `CEC.write.*`:
- `recordPayment({ studentId, amount, method })`
- `registerStudent({ name, className, gender, booksFee, booksTotal })`
- `issueBooks({ studentId, bookId, qty })`
- `adjustStock({ bookId, stockDelta })`

Each is a thin `fetch("api/<op>", { method: "POST", body: JSON.stringify(...) })` wrapper. On `{ ok:false }` it surfaces the API error in the dialog. On success it calls `CEC.clearCache()` then `CEC.renderDashboard()` — the dashboard repaints in place from the now-fresh read path; **no page reload**.

### 6.2 Cache/paint plumbing (two additive changes to existing files)

- `js/data-access.js`: expose `CEC.clearCache()` — resets the module-private `sessionCache` so the next `getDashboardData()` refetches live/JSON. No other behavior changes.
- `js/app.js`: expose `renderDashboard` as `CEC.renderDashboard` so `write.js` can repaint after a write without duplicating the widget code.

### 6.3 Modal UI (`index.html` + `css/app.css`)

- The **action bar** is the existing `.head-actions` block. The Stage 01 stub `+ Record payment` button is re-wired; three new buttons added: *+ Register student*, *Issue books*, *Adjust stock*.
- One reusable native `<dialog>` per action, styled to match the existing panels (white card, navy headings, existing button classes `btn btn-primary` / `btn-light`). All other dashboard surface is untouched.
- **Field sets:**
  - Payment → student `<select>` (fresh from `CEC.getDashboardData()`), amount, method (`Cash` / `MTN MoMo` / `Telecel`).
  - Student → name, class, gender, booksFee, booksTotal.
  - Issue → student select, book select (subject, publisher, current stock shown), qty.
  - Stock → book select, signed delta.
- **Client-side validation mirrors the server rules** so the sheet never receives garbage; errors render inline in the dialog, not as a toast.
- Dropdown data is re-fetched on dialog open so options are current after prior writes.

## 7. Testing & verification

### 7.1 Unit (extend `scripts/test.js`, same TZ=Asia/Tokyo runner)
- `nextId`: rolls after existing maxes; empty tab → `P001`.
- `recomputeStatus`: 0 → not covered; paid ≥ fee → ready; partial → waiting.
- Each validator: happy path + rejections (amount ≤ 0, bad method, qty > stock, delta == 0, missing student/book).

### 7.2 Integration (throwaway runner, scratch spreadsheet)
- `Temp\opencode\cec-write-test.cjs` runs the four endpoints as plain Node handlers against a scratch spreadsheet created by the same OAuth account (production sheet untouched).
- Each op posts a representative payload, then **re-reads via the same GVIZ CSV** and asserts: row appended, student `books_paid`/`status` recomputed, stock decremented/added, activity entries created; rejection cases return `ok:false` and write nothing.

### 7.3 Browser E2E (extend the Stage 02 CDP harness)
- Serve repo on `localhost:8123`; stub `fetch` to `/api/*` with canned responses; drive: dialogs open, dropdowns populate, client validation blocks bad input, successful submit triggers `clearCache()` + widget repaint.
- **Regression gate:** the Stage 02 suite (7/7 browser checks, 21/21 unit tests) must still pass — `app.js`/`data-access.js` changes are additive exports only.

### 7.4 Deploy smoke (manual)
- After Vercel deploy with the 3 Google env vars set, one manual payment on the live preview to confirm the refresh token path works server-side — also surfaces the testing-mode token caveat early.

## 8. Out of scope (future stages)

- **Authentication / admin roles** — HIGHEST PRIORITY for the next stage. The four `POST` endpoints are deliberately open this stage (anyone with the deployed URL can append rows); the sheet is demo/sample data today, which makes this acceptable for now.
- Real-time push updates.
- A dedicated Issues tab with return workflow.
- Changing `Config.last_synced` semantics (build-sync freshness stays as-is).
- OAuth app publishing / refresh-token lifetime hardening (ops work, not feature work).