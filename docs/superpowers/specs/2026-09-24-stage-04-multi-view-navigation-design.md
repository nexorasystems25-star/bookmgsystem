# Stage 04 Design — Multi-View Navigation

**Date:** 2026-09-24
**Project:** CEC Book Management & Payment System (Chariot Educational Complex)
**Status:** Approved design (pre-implementation)

## 1. Goal

Turn the single-view dashboard into a multi-view SPA where every sidebar destination opens a real, data-backed page. Today the nav (`.nav-item` hash links: `#dashboard`, `#students`, `#payments`, `#books`, `#inventory`, `#issuing`, `#reports`, `#settings`) only flips the active class, updates the title, and shows a "module is ready for the next implementation stage" toast (`js/app.js:10-22`). Students/Payments/Books/Inventory/Issue Books/Reports/Settings have **no view at all**; `index.html` is the only page in the codebase and only the Dashboard view exists.

This stage makes every nav destination render a real view from the data already read live from Google Sheets (Stage 02 read path, unchanged) — no new backend, no new data sources. Writes (Stage 03 dialogs) stay fully wired and re-render the current view.

## 2. Architecture

### 2.1 Client-side SPA routing (no server involvement)

- **One `index.html`** stays the only page. Each destination gets a hidden `<section class="page">` block; exactly one is visible at a time.
- The **existing hash links** (`href="#students"`, …) become the router input — zero nav markup changes.
- A small router in `js/app.js` (the file that already owns all navigation wiring):
  - listens to `hashchange` (so browser back/forward and manual URL edits work) and nav clicks,
  - normalizes the hash to a known page id (unknown hash → dashboard),
  - hides all `.page` sections, shows the target, sets `.nav-item.active`, updates the breadcrumb `#pageTitle`,
  - calls the target page's render callback from the shared dataset,
  - on mobile, closes the sidebar (`sidebar.classList.remove("open")` — existing behavior kept).
- `location.hash` is the source of truth → views are **deep-linkable** (reload on `#payments` lands on Payments).
- Active page persists across a write (see §4): re-render stays on the current hash.
- The old "module is ready for the next implementation stage" toast for `.nav-item` clicks is **removed** — every destination is now real. The dashboard "View payments →" / "See all →" text buttons are rewired to navigate to `#payments` via the router instead of toasting.

### 2.2 Data: single shared load

- New `CEC.getAllData()` in `js/data-access.js` — same 5-tab parallel fetch as `getDashboardData()` (live via `tabUrl`/export endpoint, JSON fallback, timeout guards) but returns the **normalized raw datasets** instead of only the dashboard summary:
  ```
  { students, payments, activity, books, config, offline, lastSynced }
  ```
  (`offline = !anyTabLive()`, `lastSynced` from meta/config — same semantics as today.)
- The dataset is fetched **once per load/refresh** and cached in module scope; every view renders from it, so switching pages is instant (no refetch).
- `CEC.clearCache()` remains the invalidation primitive; after a write the dataset is refetched (§4).

## 3. Per-view layouts

All views are **static HTML shells + JS-rendered rows** (Approach 1): a `<section class="page">` in `index.html` holds the heading, action buttons, and table markup with an empty `<tbody>`; the view renderer fills rows from the dataset. Styling reuses existing classes (`.panel`, `.metric-card`, `.table-scroll`, `.pill`, `.method`, `.btn`, `.head-actions`).

| Page (`hash`) | Content |
|---|---|
| `#dashboard` | Unchanged (existing view, existing renderer). |
| `#students` | Full student table: ID, name, class, gender, fee paid / outstanding (computed), status pill. Live search box (name / class / ID, filters on input). |
| `#payments` | Full payments table: ID, student, class, amount, method, date, status. Method-summary chips above the table (Cash / MTN MoMo / Telecel totals + share %). |
| `#books` | Books table: ID, subject, publisher, category, price, stock qty, low-stock flag (⚠ when `stockQty ≤ lowStockThreshold`). |
| `#inventory` | Stock table: ID, subject, stock qty, low-stock threshold, status (`OK` / `Low` / `Out`). Summary cards (total titles, low count, out count). "Review →" button opens the existing **Adjust stock** dialog (via the existing `[data-action]` wiring). |
| `#issuing` | Issue-ready students list (status = `ready`) + per-book stock availability. Primary action = existing **Issue books** dialog. |
| `#reports` | Derived panels, all computed from the shared dataset (no new data): collections by method (7-day), collections by class, outstanding-balance list, stock summary (counts + low/out). |
| `#settings` | Config surface from `config.json`: active academic year, daily payment target, currency; plus offline / freshness status line. |

Rules shared by every page:
- **Empty state:** if a tab yields zero rows, the table body shows one row "No data yet." across all columns.
- **Header/actions:** each `.page-head` keeps its eyebrow + h1 + description and the relevant full-page action buttons (e.g. Students page gets `+ Register student`, Payments gets `+ Record payment`). These reuse the existing `[data-action]` dialog openers — no new dialog code.
- **Freshness/offline:** the existing `#offlinePill` and `#dataFreshness` lines are page-level (above the `.content` grid) and already global in the DOM — they keep working on every page with no change.

## 4. Write-back integration

- `js/write.js` `runAndRefresh()` currently does `CEC.clearCache()` + `CEC.renderDashboard()`. 
- **Change:** after `post()` succeeds it clears cache, then refetches the shared dataset and invokes the router's "render current page" path — so whichever view is visible repaints (Dashboard included). Implementation detail: `runAndRefresh` calls a `CEC.refreshAll()` that re-runs `getAllData()`, replaces the cached dataset, and calls the active view's renderer. Behavior for the dialogs (submit lock, toast on success, inline errors) is unchanged.

## 5. Error handling & empty states

- Per-tab fetch failure falls back to committed JSON (existing `fetchTab` semantics) — no change.
- `offline` + `lastSynced` render the existing pill/freshness line on all pages.
- Empty tables render the shared "No data yet." row.
- Unknown/empty hash → Dashboard (safe default).

## 6. Module placement & code shape

- **`js/data-access.js`** (edit): add `getAllData()` (returns normalized datasets + meta), export on `CEC`. Minimal, additive.
- **`js/view-models.js`** (new, loaded after `derive.js`): pure, dependency-free builder functions mirroring `derive.js`'s style, unit-testable in `scripts/test.js`:
  - `methodSummary(payments, currency)` → totals + share per method,
  - `classTotals(payments)` → collections by class,
  - `stockStatus(books)` → per-book `OK/Low/Out` + counts,
  - `outstandingList(students)` → students with balance > 0 sorted by balance,
  - `studentOutstanding(s)` helper used by the Students table.
  Loaded in `index.html` before `app.js`.
- **`js/app.js`** (edit): add the router (hash → page show/hide + title + active nav) and one small renderer per page (fills `<tbody>` from the dataset, using existing `esc()` / `CEC.derive.formatAmount`). `renderDashboard` stays exported; new `CEC.refreshAll` for post-write repaint.
- **`js/write.js`** (edit): `runAndRefresh` switches from `renderDashboard` to `refreshAll` (renders current hash view).
- **`index.html`** (edit): add seven `<section class="page">` blocks (Students, Payments, Books, Inventory, Issuing, Reports, Settings) with table shells + action buttons; adjust the script tags to include `view-models.js`. The Dashboard section is wrapped too (so the router can show/hide it) without content changes.
- **`css/app.css`** (edit): minimal additions — `.page[hidden]` handling, search input styling, method-summary chips, stock status pills. Everything else reuses existing classes.
- **`scripts/test.js`** (edit): unit tests for `view-models.js` pure functions.

## 7. Testing & verification

### 7.1 Unit (extend `scripts/test.js`, same TZ=Asia/Tokyo runner)
- `methodSummary`: correct totals/shares; empty payments → zeroed chips.
- `classTotals`: grouping correctness.
- `stockStatus`: OK/Low/Out classification at the threshold boundary; counts.
- `outstandingList`: only balances > 0, sorted.
- Router mapping helper (pure function `pageForHash(hash)` → canonical page id; unknown → `dashboard`) so the router logic is unit-testable.

### 7.2 Browser E2E (extend Stage 03 CDP harness pattern)
- Serve repo on `localhost:8123`; stub `fetch` to `/api/*` and `data/*.json` with the committed datasets; drive:
  - nav click switches the visible section and sets the active class + title,
  - `location.hash` deep-link opens the target page on fresh load,
  - each page's `<tbody>` renders rows from the stub dataset,
  - search box filters the Students table,
  - Reports panels populate,
  - after a stub write, the active view repaints (via `refreshAll`).
- **Regression gate:** existing unit suite + Stage 03 browser checks still pass.

### 7.3 Deploy smoke (manual)
- Push → Vercel auto-deploy → confirm each nav destination loads live data on the deployed URL, deep-links work, and a real payment write repaints the current view.

## 8. Out of scope (future stages)

- Authentication / admin roles (open POSTs remain from Stage 03; highest-priority next).
- Pagination / virtualization for large tables (demo-class dataset is small).
- A dedicated returned-books / issue-history workflow beyond the existing Issue dialog.
- Real-time push updates.
- Multi-workspace / academic-year switching (the `workspace-select` stays a visual stub for now; hash-based single-workspace views only).