# Stage 02 Design — Live Google Sheets + Offline JSON Fallback

**Date:** 2026-09-22
**Project:** CEC Book Management & Payment System (Chariot Educational Complex)
**Status:** Approved design (pre-implementation)

## 1. Goal

Turn the Stage 01 static demo dashboard into a live dashboard backed by a Google Spreadsheet, deployable on Vercel, that reads data live from Google and falls back to committed JSON when offline. No server-side backend is introduced — Vercel serves static files only.

## 2. Architecture

```
Google Spreadsheet (single source of truth, "anyone with link can view")
        │  live read (browser) via GVIZ CSV endpoint
        ▼
js/app.js ── js/data-access.js ──► dashboard widgets
   │                 │
   │  network fails  │  fallback
   ▼                 ▼
data/*.json  ◄── scripts/sync.js (runs on every Vercel build)
```

- **Live read:** browser fetches `https://docs.google.com/spreadsheets/d/{ID}/gviz/tq?tqx=out:csv&sheet={Tab}` directly. No server needed.
- **Data-access layer:** `js/data-access.js` exposes `window.CEC` with one fetch per tab (students, payments, activity, books, config), normalizing rows to typed objects.
- **Network-first, then JSON:** every load tries the live sheet with a timeout; on failure or offline it reads `data/{tab}.json` (the build-time snapshot). A freshness label from `Config.last_synced` shows data age.
- **Sync script:** `scripts/sync.js` runs automatically on every Vercel build via the build command `node scripts/sync.js && <static build step>`. It pulls each tab → `data/*.json`. Committed JSON is kept as a last-resort fallback for builds where the network is unavailable. Manual runs (`node scripts/sync.js`) are also supported.

## 3. Spreadsheet schema

One spreadsheet, five tabs. Header row = column names. Read-only for this stage.

### Students
One row per student.
```
student_id, name, class, gender, academic_year, books_fee, books_paid, books_total, status
```
- `status`: `ready` | `waiting` | `not covered` — drives the Book readiness donut, "Ready to issue" and "waiting" KPIs.
- `academic_year`: filterable to `2026/2027`.

### Payments
One row per transaction.
```
payment_id, student_id, student_name, class, amount, method, date, status
```
- `method`: `Cash` | `MTN MoMo` | `Telecel` — drives legend + Recent payments table.
- `date`: ISO — drives "Payments today" KPI and the 7-day chart (grouped by day).

### Activity
Recent system events.
```
activity_id, type, description, amount, created_at
```
- `type`: `payment` | `issue` | `stock` | `student` — drives the Activity feed icons.

### Books
Book items used for readiness/low-stock reporting.
```
book_id, publisher, subject, category, price, stock_qty, low_stock_threshold
```
- Column is `publisher` only (no combined title).

### Config
Single-row settings.
```
academic_year, daily_payment_target, currency, last_synced, sheet_version
```
- `daily_payment_target`: drives the "64% of daily target" KPI footer.
- `last_synced`: shows data freshness to the user.

## 4. Data-access layer (`js/data-access.js`)

Exposes `window.CEC`:

```
CEC.fetchStudents()
CEC.fetchPayments()
CEC.fetchActivity()
CEC.fetchBooks()
CEC.fetchConfig()
CEC.getDashboardData()   // aggregates all five into widget-ready shape
```

- **Live read:** for each tab, fetch the GVIZ CSV URL, parse CSV (header row = keys), cast amounts to numbers, normalize column names.
- **Network-first with JSON fallback:** each fetch tries the live sheet with a ~5s timeout; on failure or offline it reads `data/{tab}.json`. Responses cached in `sessionStorage` per load so the aggregate does not re-fetch the same tab repeatedly.
- **Derivations** (computed here, not stored):
  - Collection chart: `Payments` grouped by day × method.
  - Book readiness thirds: `Students.status` counts.
  - Outstanding: count + sum of `books_total − books_paid` where positive.
  - Payments today: sum of today's `Payments.amount`.
- **Consumption points wired in `js/app.js`:** KPI cards, 7-day collection chart, readiness donut, recent payments table, activity feed, data-freshness label.

## 5. Sync script (`scripts/sync.js`)

Node script, no dependencies beyond the platform runtime.

- Runs on every Vercel build: build command `node scripts/sync.js && <static build step>`.
- Reads spreadsheet ID from a local `.env` (not committed).
- Pulls each tab via the GVIZ CSV endpoint → writes pretty-printed JSON to `data/students.json`, `data/payments.json`, `data/activity.json`, `data/books.json`, `data/config.json`.
- Updates `Config.last_synced` on successful regeneration.
- **Both modes in one script:**
  - Online build: network available → regenerates fresh JSON, updates `last_synced`.
  - Offline build: network unreachable → skips regeneration, keeps existing committed JSON, build still succeeds.
- Manual run: `node scripts/sync.js`.
- Writes to a temp file and renames on success so a failure never leaves partial/corrupt JSON.
- Uses the same CSV→normalized-JSON parsing as the data-access layer so live and offline shapes match exactly.

## 6. Error handling

- Any load where Google is unreachable shows a subtle `Offline mode — data from <date>` pill (only when a JSON file exists); without a JSON file it shows a plain "connection error" toast.
- A single bad tab never breaks the dashboard — each tab fetch fails independently.
- CSV parse errors are treated as unreachable → fall through to JSON.
- Amounts are guaranteed numeric (`parseFloat`, defaults to 0); invalid dates are dropped from charts.

## 7. Testing

- **Sync script:** run `node scripts/sync.js`; diff generated JSON against the sheet; confirm `Config.last_synced` updates.
- **Local offline test:** set dev-only flag `CEC.forceOffline = true`; confirm every widget renders from JSON.
- **Live test:** open the Vercel preview URL; confirm data loads from Google and the freshness label reflects `Config.last_synced`.

## 8. Out of scope (future stages)

- Write-back to Google Sheets (recording payments from the UI).
- Authentication / admin roles.
- Real-time push updates.