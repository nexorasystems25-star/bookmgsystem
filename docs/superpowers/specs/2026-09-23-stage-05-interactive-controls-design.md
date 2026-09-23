# Stage 05 Design — Interactive Controls

**Date:** 2026-09-23
**Project:** CEC Book Management & Payment System (Chariot Educational Complex)
**Status:** Approved design (pre-implementation)

## 1. Goal

Wire the five remaining stub controls so every control in the app is real and data-backed. Today these are bound in a blanket `js/app.js:27-30` toast handler that shows "This control will be wired during the corresponding implementation stage.":

- **Workspace selector** (`index.html:23`) — hardcoded "2026 / 2027" button. Becomes an academic-year switch that **filters all views** by the selected year.
- **Notifications bell** (`index.html:87`, with dot at `css:22`) — opens a dropdown of **derived alerts** (low stock, waiting students, daily-target progress, recent activity).
- **Search icon** (`index.html:86`) — opens a **global search** dropdown across students, books, and payments, with results deep-linking to their view.
- **Export report** buttons (Dashboard `:104`, Payments `:232`, Reports `:351`) — download a **per-view CSV** of the current (year-filtered) data.
- **More-menu** (discs) on the Book readiness panel (`:161`) and Activity panel (`:190`) — open **context action menus** (go to view, export slice, refresh).
- **Profile menu** (`index.html:73`) — opens a profile card with **workspace / settings / log-out** actions.

No new backend, no new data sources. The existing read path (Stage 02), write dialogs (Stage 03), and multi-view router (Stage 04) stay untouched except where listed below.

## 2. Architecture decisions

### 2.1 Year filter: pure filter + in-memory state (Approach A, approved)

- Keep the single shared dataset (`CEC.getAllData()` cache) and hash routing unchanged.
- Year list = unique `students.academicYear` values, with `config.activeYear` guaranteed present and sorted (active year first, then the rest).
- Active year is an in-memory variable owned by `app.js`. Sidebar/breadcrumb brand label (`.workspace-select b`) always shows the selected year.
- All renderers run against `filterYear(dataset.snapshot, activeYear)` — a view-only copy — so switches are instant (no refetch); switching year repaints the current page.

**No year in URL/hash** (approach rejected for this stage): keeps routing trivial; deep-link of year selection is not required. If a later stage requires shareable year links, promote the active year into the hash then.

### 2.2 Payment/activity year attribution: derive from student (approved)

`normalizePayments` / `normalizeActivity` outputs get an `academicYear` field resolved lazily **during filtering**, not at normalization time (the dataset is shared across years):

- Join on `studentId` → `students` map. Unmatched payment/activity rows inherit `config.activeYear` (treat as current-year records). This is a documented assumption, not a correctness guarantee — future synced sheets should carry an explicit year.

### 2.3 Dropdowns: one reusable component

A single `CEC.menu`-style helper (module in `js/app.js` or small `js/ui.js`): `openMenu(anchor, panel)` / `closeMenu()`. Behavior:

- Click toggles; clicking anywhere outside, pressing `Esc`, or re-clicking the anchor closes.
- `aria-expanded` toggled on the anchor; panel is `role="menu"` with `role="menuitem"` items.
- Only one dropdown open at a time.
- Positioning: `position: fixed` panel aligned to the anchor's bounding rect (top-left), clamped to the viewport; simple, no library.

This is used by: workspace selector, notifications, search, more-menus, profile.

## 3. Behavior spec (per control)

### 3.1 Workspace selector (academic year)

- Click `.workspace-select` → dropdown listing available years. Active year shows a check mark; others show a hint ("Select").
- Selecting a year: sets active year, closes dropdown, repaints current view via `refreshAll`, shows toast "Switched to 2026/2027".
- `.workspace-select b` label updates to the selected year; subtitles ("Academic year", dot, chevron) unchanged.
- Single-year data today: list shows one entry; switch is a visible no-op but the plumbing is real and unit-tested with multi-year fixtures.

**Filtering rules (`filterYear(dataset, year)` in `view-models.js`):**
- `students`: `academicYear === year`
- `payments`: year from the student join (unmatched → config year)
- `activity`: same join rule
- `books`, `config`: unchanged (independent of year)
- All derived renderers (KPIs `buildDashboard`, `methodSummary`, `classTotals`, `stockStatus`, `outstandingList`, `renderReports`, `renderSettings`) operate on the filtered snapshot — no renderer changes needed beyond sourcing from `filterYear(...)`.

### 3.2 Notifications bell (`CEC.viewModels.notifications(data)`)

Pure builder (unit-testable) returning an array of alert objects `{ id, icon, color, title, desc, href, kind }` computed from the filtered view:

1. **Low stock** — books with `stockQty <= lowStockThreshold` → `href="#inventory"` (item: "3 titles low on stock").
2. **Waiting students** — students with `status === "waiting"` → `href="#issuing"`.
3. **Daily target** — filtered view's `paymentsToday` vs `config.dailyTarget` → `href="#payments"` ("Daily target 45% reached" / "reached").
4. **Recent activity** — latest activity item → `href="#payments"` (its `description` + time label).
5. **Book readiness recap** — `ready` count → `href="#issuing"` ("N students ready to issue").

- Bell badge dot (existing `.notification i`) shows when `notifications.length > 0`.
- Dropdown lists alerts; clicking navigates and closes. Empty state: "All clear — no alerts today."

**Notification state:** unread-state persistence is **out of scope** (no storage layer wanted this stage); the bell always reflects the live derived set.

### 3.3 Global search

- Click search icon → dropdown with a text input (autofocused) + grouped live results.
- Debounced (≈150ms) query against the filtered dataset:
  - **Students** (name / id / class prefix/substring, case-insensitive), cap 6 → result deep-links `#students` **and pre-fills** the page's `#studentSearch` input (existing student-view filter already reads it on `input`; the router must dispatch to students view, then set the input value and re-run `renderStudents` filter).
  - **Books** (subject / publisher / category), cap 6 → `#books`.
  - **Payments** (studentName / paymentId), cap 6 → `#payments`.
- Group headers shown only when a group has ≥1 hit. Empty query → "Type to search students, books, and payments." No hits → "No results for '<query>'."
- `Esc` / outside-click closes and restores focus behavior.

### 3.4 Export report (`CEC.export` module in `js/csv.js` or new `js/export.js`)

A minimal CSV writer (`encodeCell` handling quotes/commas/newlines; joins with CRLF). Reuses the view infrastructure:

| Button | File name | CSV content |
|---|---|---|
| Dashboard `:104` | `cec-dashboard-<year>-<yyyy-mm-dd>.csv` | Summary rows: date, academic year, total students, payments today, daily target, target %, ready to issue, outstanding count/amount, low-stock count; then "Recent payments" block (top 5 by date). |
| Payments `:232` | `cec-payments-<year>-<yyyy-mm-dd>.csv` | Header + all year-filtered payments (payment id, student id, student name, class, amount, method, date, status). |
| Reports `:351` | `cec-reports-<year>-<yyyy-mm-dd>.csv` | Collections by method (Method, Total, Share %), Collections by class (Class, Total), Outstanding list (Name, ID, Class, Balance). |

- Download via `Blob` + object URL; toast "Export downloaded." Filename year is the active year (sanitized slashes `2026/2027` → `2026-2027`).
- In-memory dataset only — no server call.

### 3.5 Panel more-menus

- **Book readiness panel** (`:161`): "Go to issuing" → `#issuing`; "Export readiness" → readiness CSV (ready/waiting/uncovered counts + student rows); "Refresh data" → `CEC.refreshAll()`.
- **Activity panel** (`:190`): "Go to payments" → `#payments`; "Export activity" → activity CSV (id, type, description, amount, created_at); "Refresh data" → `CEC.refreshAll()`.

### 3.6 Profile menu

- Click `.profile-mini` → dropdown card: avatar, "CEC Admin" (name), "Administrator" (role), active workspace line ("Workspace · 2026/2027"), then actions:
  - "Switch workspace" — opens the academic-year selector dropdown (and closes the profile menu).
  - "Settings" → `#settings`.
  - "Log out" → toast "Authentication arrives in a later stage." (stage: auth is out of scope — README keeps it listed as deliberately unimplemented).

## 4. Stub-toast unwiring

- Remove the blanket binding at `js/app.js:27-30`.
- Each control gets an explicit handler (or `data-action`).
- `.text-btn` (`View payments` / `See all`) already navigates via `[data-go]` (`:23-25`) — remains untouched and becomes the pattern for menu "go to" items.
- Verify nothing else relied on the blanket toast (inventory "Review →" button already uses `data-go="inventory"` and is excluded — confirm still excluded).

## 5. Module placement & code shape

- **`js/view-models.js`** (edit, pure additions): `availableYears(students, config)`, `filterYear(dataset, year, { activeYear })` returning a filtered snapshot, `notifications(dataset)`. All pure / unit-testable; no DOM.
- **`js/export.js`** (new, loaded after `view-models.js` before `app.js`): `CEC.export.csvFilename(view, year)`, `CEC.export.download(fileName, csvText)`, `CEC.export.dashboard(data)`, `payments(data)`, `reports(data)`, `readiness(data)`, `activity(data)` — each returns CSV text (pure, testable) + the DOM `download` trigger apart.
- **`js/app.js`** (edit): dropdown menu helper; year-state management; bell/search handlers; per-view export handlers; more-menu & profile handlers; deep-link-with-prefill for search results; unwire the blanket toast.
- **`css/app.css`** (edit): dropdown panel + menu item styles, notification/search panels, results list, badges — new classes only, reuse existing tokens.
- **`index.html`** (edit): add `<div id="menuRoot">` mount point + include `export.js`; no markup changes to the five controls themselves (they already exist).

## 6. Testing & verification

### 6.1 Unit (extend `scripts/test.js`, `TZ=Asia/Tokyo`)

- `availableYears`: dedupe, active-year-first ordering, empty input → `[]`.
- `filterYear`: student filter; payment/activity join via student map; unmatched rows → active year; books/config passthrough.
- `notifications`: low-stock detection; waiting count; target reached/missed; empty dataset → `[]`; `notifications.length` badge semantics.
- `export.*`: CSV escaping (commas, quotes, newlines); dashboard/payments/reports row counts; filename sanitization of `2026/2027`.
- Multi-year synthetic fixtures prove filtering is not a no-op.

### 6.2 Browser E2E (`cec-controls-e2e.cjs`, CDP, local `localhost:8123`)

- Workspace selector opens; switching year changes `.workspace-select b`, `#pageTitle`, KPI values (multi-year stub fixtures).
- Bell shows dot + alert count; dropdown lists derived alerts; click navigates to the right view.
- Search finds "Abena" (student) and a payment/ref; result click lands on `#students` with the search box pre-filled and filtered.
- Export button triggers a `Blob` download (stub `URL.createObjectURL`), filename matches pattern.
- More-menus open/close, each item navigates/refreshes/toasts.
- Profile menu opens; Switch workspace opens the year selector; Log out toasts.
- Closing dropdowns via outside-click and `Esc`.
- Regression: Stage 04's browser checks still pass (router, deep-links, dialogs).

### 6.3 Deploy smoke (manual, Vercel)

- Push → confirm all five controls work on the deployed URL against live data; export downloads; bell/search/menus behave; no console errors.

## 7. Out of scope (future stages)

- Authentication / roles (profile "Log out" is a toast; POSTs stay open as in Stage 03). **Highest-priority next stage.**
- Unread-notification persistence / real push.
- Year in URL/hash (deep-linkable year selection) — revisit if needed.
- Editing `Payments`/`Activity` sheet schemas to carry an explicit `academic_year` (derive-from-student assumption holds meanwhile; documented at §2.2).
- Pagination / virtualization; returned-books history beyond the existing Issue dialog.