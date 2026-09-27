# Editable System Settings (Administrator CRUD) — Design

Date: 2026-09-26 · Stage: config/settings write-back

## Problem

The Settings page (`#page-settings`) shows four read-only panels — Default academic year,
Daily payment target, Currency, Data source. The admin cannot change any of them, and there
is no configuration write path anywhere in the system.

## Goals

- Admin can edit Default academic year, Daily payment target, Currency, and the Live/Offline
  data-source toggle from the Settings page.
- Edits to the three config values persist to the Google Sheets **Config** tab (single
  row: `academic_year | daily_payment_target | currency | last_synced`), consistent with
  the existing payment/student/issue/stock write-backs.
- The Live/Offline toggle is client-local by necessity (it decides whether this browser
  calls Google at all) and becomes a proper admin setting persisted in the browser.

## Non-goals / scope

- `last_synced` is metadata written by the sync process — **not** editable.
- Auth: `POST /api/config` is **admin-only** (`requireAuth` with role `admin`), consistent
  with `api/student` / `api/stock`, and reached only from the role-gated Settings page.
- No multi-row config CRUD: the Config tab is a single-row singleton; "Create/Delete a
  config row" does not meaningfully apply (rejected on YAGNI).
- **Accepted limitation (O4):** single-row writes are last-writer-wins. Two admins editing
  concurrently can clobber each other's field; a CAS on `last_synced` is deliberately
  avoided because sync itself owns that column.

## Year semantics (O1 — decided: "default year only")

`filterYear` (`js/view-models.js:436`) re-keys data at app-time against the **year picker**
(`activeYear`, `app.js:150`), seeded from `config.activeYear` only when nothing is selected;
`availableYears` (`js/view-models.js:422`) is derived from students' `academicYear` cells.
Therefore editing the config year **changes the menu default only** — it does **not**
re-key students/payments, and a manually-selected year is preserved across the edit. New
years not present in the data become selectable-but-empty. This is the intended contract.

## Architecture

- **Persistence:** Google Sheets Config tab is the source of truth for year / target /
  currency. The Live/Offline toggle is persisted via the existing `CEC.forceOffline`
  mechanism, whose backing store is upgraded from `sessionStorage` (`cecForceOffline`) to
  `localStorage`. The public getter/setter API is unchanged, so `data-access.js` and any
  test/harness using `CEC.forceOffline = true` keep working unchanged.
- **New serverless function:** `POST /api/config`, guarded by an admin-only `requireAuth`
  call placed before `createClient` (mirrors `api/student.js`).
- **Frontend:** an Edit button on each of the four Settings panels opens one modal
  (`#dlgConfig`) reusing the existing `dialog` conventions from `js/write.js`.

## Changes

### 1. `api/_lib.js`

- `validateConfigPayload(raw)` — **server shape only (O2):** `academic_year` non-empty
  matching `^\d{4}\s*\/\s*\d{2,4}$`, `daily_payment_target` (Number ≥ 0), `currency`
  (non-empty, ≤ 10 chars). Returns `{ ok:false, error }` on failure, matching existing
  validators.
- `runConfig(client, spreadsheetId, payload)` — reads `Config!A:D`; **guards the header
  (O3):** if the first row's first four cells do not match
  `academic_year, daily_payment_target, currency, last_synced` (or the tab is absent),
  returns `{ ok:false, error:"Config tab missing or header mismatch." }` without writing.
  Otherwise merges provided fields over the current row (never blanks unedited columns),
  writes the full row back with `sheetsUpdate(spreadsheetId, "Config!A2:D2", [row])`.
  Returns `{ ok:true }`.
- Export both.

### 2. `api/config.js` (new)

Serverless handler mirroring `api/payment.js`, gated admin-only: `requireAuth` (role
`admin`) → validate → createClient → runConfig → `res.status(200).json(result)` /
`401` / `403` / `400` / `500`. Same env vars (`GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `SPREADSHEET_ID`).

### 3. `index.html`

- Each Settings panel (lines 408-425) gains an `Edit` button (`class="btn btn-light"`,
  `data-edit-config`).
- New `<dialog id="dlgConfig">` after `dlgStock`, following `dlgPayment` structure:
  - modal-head: `<h3>System settings</h3>` + `[data-close]`
  - modal-body: `[data-year]` text input, `[data-target]` number input,
    `[data-currency]` text input (placeholder `GH₵`), `[data-source]` select
    (`live` / `offline`)
  - `[data-submit]`, `[data-error]`

### 4. `js/write.js`

- `root.write.updateConfig(payload)` via `runAndRefresh("config", payload)`.
- `dialogs.config` wiring: open → prefill from `viewData().config` +
  current `CEC.forceOffline`; submit → validate, `updateConfig`, `showToast("Settings
  updated.")`, close; on failure inline error.
- `runAndRefresh` repaints the Settings cards from the refreshed snapshot after a
  successful save (AC2). Its `finally` clause (**O7**) re-reads/repaints even on POST
  failure — keep this contract; do not early-return before the refresh.
- Data-source change after successful save also calls `setForceOffline(source === "offline")`
  (the write itself always POSTs regardless of mode; an unreachable API surfaces the modal
  error and the local data-source state is **not** flipped — no silent partial save).
- If the config POST fails, the modal shows the error and nothing is persisted locally:
  `updateConfig` throws before `setForceOffline` runs.

### 5. `js/data-access.js`

- `setForceOffline` backing store changes `sessionStorage` → `localStorage`, keeping the
  key `cecForceOffline` and returning the same synchronous property `get`/`set` API
  (`data-access.js:158-180`). Any harness using `CEC.forceOffline = true` keeps working
  unchanged.
- **Migration (O6):** on first load, if `localStorage` has no `cecForceOffline` but the
  legacy `sessionStorage` key is `"true"`, persist it to `localStorage` (avoids a silent
  offline→online flip for a returning admin).

### 6. `scripts/test.js`

- Unit tests: `validateConfigPayload` ok/bad cases; `runConfig` writes `Config!A2:D2` and
  preserves unedited columns (fake-client assertion pattern already used for `runPayment`).

## Error handling

- Client-side validation before POST → inline `[data-error]`.
- HTTP/API failure → inline error in modal.
- Offline toggle affects reads only; writes always attempt the API and surface failures.

## Testing

- Extend `scripts/test.js` (existing architecture test suite, currently 192 passing).
- Run: `node scripts/test.js`.

## Acceptance criteria

1. Settings page shows an Edit control on each panel; opening the modal pre-fills current
   values (config row + current `CEC.forceOffline`).
2. Saving year/target/currency through `POST /api/config` updates the Config tab and the
   Settings cards repaint.
3. Saving the config year changes the **menu default only** (O1): a manually-selected year
   in the picker is preserved; the true data keys do not change.
4. `runConfig` refuses to write when the Config tab is missing or its header mismatches
   (O3), returning a 400 with a clear error; README documents the Config tab provisioning.
5. Saving the Data source toggle switches live/offline and survives reload (`localStorage`);
   a returning pre-migration admin does not silently flip back online (O6).
6. Invalid input (bad year shape, negative target, empty currency, year not in
   `availableYears` client-side) is rejected inline.
7. A failed config POST leaves the modal error visible and flips nothing locally (no
   partial save); the snapshot still repaints (O7).
8. All unit tests pass; no regression in the existing 192.
9. No network calls added to any code that runs during static rendering/export.