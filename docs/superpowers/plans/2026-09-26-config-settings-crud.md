# Editable System Settings (Administrator CRUD) — Implementation Plan

Spec: `docs/superpowers/specs/2026-09-26-config-settings-crud-design.md` (approved, dispositions written)
Objections: `docs/objections/config-settings-crud.md` (O1–O7, all dispositioned 2026-09-27)
Date: 2026-09-27 · Baseline suite: **192 PASS, exit 0** (verify with `node scripts/test.js`)

Conventions (mirror the login-roles stage): TDD-first, per-task commits, suite green at each
commit, task coliving by `task_id`, `node --check` on every touched JS file. All behaviors
below reference spec sections by number — do not re-derive them.

---

## Task 1 — `api/_lib.js`: validator + write-back (lib-first)

**TDD tests to add (`scripts/test.js`, fake-client pattern already used for `runPayment`):**
1. `validateConfigPayload` — ok: `{academic_year:"2025/2026", daily_payment_target:60, currency:"GH₵"}` → `{ok:true}`.
2. Shape rejects: `2025`, `2025/6`, `2025/2026/27`, empty year; target `-1`, `"abc"`, `NaN`; currency `""`, 11 chars. Each → `{ok:false, error}` (spec §1, O2 server-shape only).
3. `runConfig` happy path: fake client records `sheetsUpdate`, range exactly `"Config!A2:D2"`, row is the **merged** full row (unchanged columns preserved from the read — the `daily_payment_target` and `currency` untouched when only year posted).
4. `runConfig` header guard (O3): fake client returns a Config read whose header row ≠ `academic_year|daily_payment_target|currency|last_synced` (and a no-rows case) → `{ok:false, error:"Config tab missing or header mismatch."}` and **`sheetsUpdate` is never called**.

**Code:** `validateConfigPayload(raw)` (shape-only regex `^\d{4}\s*\/\s*\d{2,4}$` for year; target Number ≥ 0; currency ≤ 10 chars) + `runConfig(client, spreadsheetId, payload)` (read `Config!A:D`, guard header, merge provided fields over current row, `sheetsUpdate(…, "Config!A2:D2", [row])`, return `{ok:true}`). Export both from `api/_lib.js`.

**Verify:** `node scripts/test.js` green (192 + 4 new); `node --check api/_lib.js`.
**Commit:** `feat(config): validate + single-row merge write-back in _lib`

## Task 2 — `api/config.js`: admin-only handler

**TDD tests:**
1. No/invalid token → 401 (via `requireAuth` stub).
2. `teacher` / `storekeeper` role token → 403.
3. Invalid payload → 400 with `{ok:false, error}` body.
4. Valid admin token: createClient receives the four env vars; `runConfig` called, `200 {ok:true}`; **assert `requireAuth` runs before `createClient`** (order-flag stub — mirrors `api/student.js`).
5. `runConfig` returns `{ok:false}` → 400 (header-guard path surfaces as a 400, not 500).

**Code:** `api/config.js` — `const auth = lib.requireAuth(req, res, ["admin"]); if (!auth) return;` first, then validate → createClient → runConfig → 200/400/500 (copy `api/payment.js` skeleton, swap gate + validator + runner).

**Verify:** green (192 + 5); `node --check api/config.js`.
**Commit:** `feat(config): POST /api/config admin-only endpoint`

## Task 3 — `js/data-access.js`: offline-store upgrade + migration

**TDD tests (Node has no localStorage; shim it in `scripts/test.js` where needed, keep in-memory flag behavior):**
1. `CEC.forceOffline = true/false` still works with **no storage present** (pure in-memory, as today) — guards the harness promise (spec §5).
2. With a `localStorage` shim: setting `true` persists `cecForceOffline === "true"` in **localStorage**; setting `false` removes it.
3. O6 migration: shim has empty `localStorage` but legacy `sessionStorage` `cecForceOffline === "true"` → on data-access init, `localStorage.cecForceOffline === "true"` after load.
4. Legacy key not present → no write-through.

**Code:** swap the `setForceOffline` storage calls `sessionStorage`→`localStorage` (keep key `cecForceOffline`, keep the synchronous property `get`/`set` and the in-memory `forceOfflineFlag` path, keep the try/catch). Add the init-time migration read after the initial flag load (`data-access.js:158-163` region).

**Verify:** green (192 + 4); `node --check js/data-access.js`.
**Commit:** `feat(config): persist forceOffline in localStorage with legacy migration`

## Task 4 — Settings UI: Edit buttons + `#dlgConfig` + write.js wiring

**TDD tests (unit-test the newly exposed seams in `js/write.js`):**
1. `root.write.updateConfig` targets op `"config"` with the payload passed through (assert the POST contract used by `runAndRefresh`).
2. Client-side pre-validation (O2, spec AC6): picker myopia helper — year shape valid **but not in** `availableYears(data)` → rejected before POST with inline error; year **in** the set → allowed.
3. Data-source ordering (O7): on failure of the config POST, `setForceOffline` is **not** called; on success it is called with `source === "offline"`. Extract tiny seam if needed (e.g. `applyConfigResult(payload, source)` returning `{applySource:boolean}`) so the order is testable without DOM.
4. `dialogs.config` exists and wires `open/prefill/submit/close` handlers (structural, hole-free).

**Code:**
- `index.html`: add `Edit` button (`class="btn btn-light"`, `data-edit-config`) to each of the four Settings panels (~408-425); new `<dialog id="dlgConfig">` after `dlgStock` mirroring `dlgPayment` — modal-head (`System settings`, `[data-close]`), modal-body (`[data-year]`, `[data-target]`, `[data-currency]` placeholder `GH₵`, `[data-source]` select `live/offline`), `[data-submit]`, `[data-error]`.
- `js/write.js`: `updateConfig: p => runAndRefresh("config", p)` in `root.write`; `dialogs.config` open→prefill from `viewData().config` (`activeYear`, `dailyPaymentTarget`, `currency`) + current `CEC.forceOffline`; submit → client pre-validation vs `availableYears`, `updateConfig`, `showToast("Settings updated.")`, close; on failure inline `[data-error]` (O7: nothing persisted locally, snapshot still repaints via `runAndRefresh` finally). On successful save only, apply `setForceOffline(source === "offline")` (spec §4 bullet order).
- **No year re-keying** (O1): `activeYear` picker state is untouched by the save; the config year only becomes the new default when nothing is selected.

**Verify:** green (192 + 4); `node --check js/write.js`; no test touches DOM (structural holes only).
**Commit:** `feat(config): editable settings dialog with admin gating`

## Task 5 — README + snapshots + deployment notes

**TDD:** none code; verify docs rendering + `node --check` untouched.

**Code:**
- README: Assets/Config section — Config tab provisioning bullet (header exactly `academic_year | daily_payment_target | currency | last_synced`, single data row at A2:D2) and the `/api/config` admin-only note; Settings write-back paragraph.
- **Verify the Config offline snapshot:** `scripts/sync.js` `TABS` — if `Config` is not already synced to `data/config.json`, add it (mirror the login-roles Issued handling, including the same payload-guard pattern so a missing head doesn't corrupt the snapshot).
- `.env.example`: unchanged (no new env vars — `/api/config` reuses the four existing).

**Commit:** `docs(config): Config tab provisioning + offline snapshot`

---

## Acceptance mapping (spec AC1–AC9)

| AC | Covered by |
|----|-----------|
| 1 prefill modal | Task 4 |
| 2 Config update + repaint | Tasks 1, 4 (refreshAll path) |
| 3 year = default only | Task 4 (no picker mutation) + contract test |
| 4 header guard + README | Tasks 1, 5 |
| 5 toggle persists + migration | Task 3 |
| 6 invalid input rejected inline | Tasks 1 (server), 4 (client) |
| 7 no partial save + repaint on failure | Task 4 tests 3–4 |
| 8 no regression (192+green) | all tasks |
| 9 no network calls in static render | Task 4 (dialog/buttons only; scripts order unchanged) |

## Verification checklist

- `node scripts/test.js` → **192 + (4+5+4+4) = 209 PASS**, `SUITE_EXIT=0` (counts may drift if a task lands fewer/more asserts — the authority is the run output, not this arithmetic; every commit must leave the suite green).
- `node --check` on all touched JS.
- `git log` shows 5 task commits; tracked plan + spec + objections this stage.
- Backlog follow-ups from the phone stage (unchanged): advocatus/spec-writer subagents are unavauilable in this environment (model `Big Pickle/.` resolution error) — inline fallback used; `.gitattributes` CRLF hygiene.