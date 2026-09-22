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
