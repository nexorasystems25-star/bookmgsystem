# CEC Book Management & Payment System — Stage 01

## Stage
**Frontend Foundation & Dashboard UI**

## Technology
- HTML5
- CSS3
- Vanilla JavaScript
- No frontend framework
- No hardcoded database integration yet

## What is implemented
- Responsive application shell
- CEC visual identity
- Dark navigation sidebar
- Academic-year workspace selector
- Admin dashboard
- KPI cards
- Collection overview chart
- Book readiness visualization
- Recent payments table
- Activity feed
- Mobile navigation
- Initial interaction/toast system

## Deliberately not implemented yet
- Google Sheets API
- Authentication
- Real student records
- Payment writes
- Inventory writes
- Book issuing
- Production API
- Vercel deployment configuration

Those belong to later stages so each layer can be implemented and tested independently.

## Run locally
Open `index.html` in a modern browser.

For development, a local static server is preferable, e.g. VS Code Live Server.

## Next stage
Stage 02 should establish the Google Spreadsheet schema and the API/data-access layer before wiring live data into the dashboard.

## Stage 02 — Live data (Google Sheets + JSON fallback)

1. Create the spreadsheet (tabs: Students, Payments, Activity, Books, Config) and share it to "Anyone with the link → Viewer".
2. Copy the spreadsheet ID into `.env` (see `.env.example`) and as a `SPREADSHEET_ID` env var in Vercel project settings.
3. Regenerate the offline JSON locally: `npm run sync`
4. Test: `npm test`
5. Deploy to Vercel — `npm run build` runs `node scripts/sync.js` automatically, rebuilding data/*.json on every deploy. The browser reads Google Sheets live and falls back to data/*.json when offline.
6. Local offline testing: open DevTools, set `CEC.forceOffline = true`, then reload (the flag now survives reloads).

## Stage 03 — Write-back

The dashboard now writes back to Google Sheets through four Vercel serverless functions:

- `POST /api/payment` — record a student payment
- `POST /api/student` — register a student
- `POST /api/issue` — issue books
- `POST /api/stock` — adjust book stock

All four share one client (`api/_lib.js`) that reads the environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` and `SPREADSHEET_ID`, refreshes the OAuth access token automatically, and mutates the matching tabs (Students, Payments, Activity, Books, Config).

Browser side: the *Record payment* / *Register student* / *Issue books* / *Adjust stock* modal flows live in `js/write.js` and call `CEC.write.*`. After every write attempt the page clears its cache (`CEC.clearCache()`) and repaints (`CEC.renderDashboard()`) so the dashboard stays in sync — and validation errors are shown inline in the modal.

Test locally: `npm test` (unit + API layer) and `node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs` (browser write-flow E2E, throwaway harness).

> **Security note:** authentication for the write endpoints is intentionally deferred — the POST endpoints are open. Restrict access before exposing them publicly. See `docs/superpowers/specs/2026-09-23-stage-03-write-back-google-sheets-design.md`.

## Stage 04 — Multi-view navigation

The single-view dashboard is now a hash-routed single-page app: every sidebar destination opens a real, data-backed view. `location.hash` is the single source of truth, so every view is deep-linkable, browser back/forward works, and an unknown hash falls back to the Dashboard.

Routes:

| Hash | View |
|---|---|
| `/#dashboard` | KPIs, collection donut, readiness, recent payments, activity |
| `/#students` | Full student table with live search (name / class / ID) |
| `/#payments` | Full payments table + Cash / MTN MoMo / Telecel method-summary chips |
| `/#books` | Books table with price and low-stock flag |
| `/#inventory` | Stock table with OK / Low / Out pills + summary cards |
| `/#issuing` | Issue-ready students + per-book stock availability |
| `/#reports` | Collections by method, by class, outstanding balances, stock summary |
| `/#settings` | Config surface (year, daily target, currency) + offline / freshness status |

Architecture:

- **`js/view-models.js`** (new, pure) — derived-data builders shared by the view renderers: `methodSummary`, `classTotals`, `stockStatus`, `outstandingList`, `studentOutstanding`, plus the pure `pageForHash` router mapper. No DOM, no fetch — unit-tested in `scripts/test.js`.
- **`CEC.getAllData()`** (`js/data-access.js`) — the 5-tab dataset (Students, Payments, Activity, Books, Config) is now fetched **once per load/refresh** and cached; every view renders from that single shared load, so switching pages is instant with no refetch. `getDashboardData()` keeps its exact previous shape for the Stage 02 renderer, and `clearCache()` drops the shared dataset too.
- **`js/app.js`** — a small hash router (`hashchange` → show/hide the target `<section class="page">`, set `.nav-item.active`, update the breadcrumb `#pageTitle`, close the mobile sidebar) plus one renderer per page. The old "module is ready for the next implementation stage" toast is gone, and the Dashboard's "View payments →" / "See all →" buttons navigate to `#payments`.
- **`js/write.js`** — after a successful write it now calls `CEC.refreshAll()` (clear cache → refetch dataset → re-render the **currently active** view), so whichever page you're on repaints after a payment, registration, issue or stock adjustment.

Test locally: `npm test` (unit), plus the throwaway browser harnesses in Temp: `node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-browser-e2e.cjs` (dashboard + offline), `node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs` (write flows), and `node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-nav-e2e.cjs` (navigation + deep links + repaint-after-write). See `docs/superpowers/plans/2026-09-24-stage-04-multi-view-navigation.md` and `docs/superpowers/specs/2026-09-24-stage-04-multi-view-navigation-design.md`.
