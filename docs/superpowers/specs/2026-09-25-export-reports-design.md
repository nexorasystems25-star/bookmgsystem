# Export reports — design

**Date:** 2026-09-25
**Status:** Approved

Fix the non-functional "Export report" buttons and add per-page exports in both
CSV and Excel (.xlsx) formats.

## Problem

Three "Export report" buttons exist (Dashboard, Payments, Reports) but are wired
to a placeholder toast (`js/app.js:69`): "This control is wired in the Controls
stage (export, menus, profile)." The Students, Issuing and Inventory pages have
no export button at all. Users cannot download their own data.

## Scope

- Make every "Export report" button functional.
- Provide CSV and Excel (.xlsx) downloads from one button via a small format menu.
- Add export buttons to Students (paid amounts), Issuing (books issued) and
  Inventory (stock levels).
- Keep the app fully offline-capable: no CDN or external library.

## Design

### Format chooser

Each "Export report" button opens the existing menu panel (reuses `openMenu` /
`menu-item`) with two items:

1. `CSV (.csv)`
2. `Excel (.xlsx)`

Choosing an item serializes the page's rows and triggers a browser download via
a temporary `<a download>` element and a `Blob`. Both formats are generated from
the same `array-of-arrays` row data, so one row builder feeds both.

### New module: `js/xlsx.js`

UMD module (mirrors `js/csv.js` / `js/derive.js` UMD wrapper so it works in the
browser as `CEC.xlsx` and in Node via `module.exports`).

- `toCSV(rows)` — serialize `array-of-arrays` to CSV text with correct quoting
  (RFC 4180: quote fields containing commas, quotes or newlines; double inner
  quotes). Single trailing newline.
- `toXLSX(rows)` — write a real `.xlsx` file as a `Uint8Array`:
  - sheet1 XML (`xl/worksheets/sheet1.xml`) with inline strings
    (`t="inlineStr"` — no `sharedStrings.xml` needed).
  - `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`,
    `[Content_Types].xml`, `_rels/.rels`.
  - ZIP container with **stored** (uncompressed) entries: local file headers +
    central directory + end-of-central-directory, each entry CRC-32 computed
    over its bytes. No deflate required.
  - Minimal required parts only; numbers written as plain values, everything
    else as inline strings.

### View-model row builders (pure, in `js/view-models.js`)

Each returns `{ headers: [...], rows: [[...], ...] }` (array-of-arrays).

| Page | Builder | Columns |
|---|---|---|
| Dashboard | `exportCollectionOverview(payments)` | Day, Cash, Mobile Money, Telecel, Total |
| Payments | `exportPayments(payments)` | Ref, Student, Class, Amount, Method, Date, Status |
| Students | `exportStudents(students)` | ID, Name, Class, Gender, Fee, Paid, Outstanding, Status |
| Issuing | `exportIssued(students, books, classFees, activity)` | Student ID, Name, Class, Mode, Book ID, Subject, Category, Qty, Kind |
| Inventory | `exportStock(books)` | Book ID, Title, Publisher, Category, Price, In Stock, Threshold, Status |
| Reports | `exportReports(payments, students)` | Three sections: method summary, class totals, outstanding list |

Details:

- `exportCollectionOverview` builds its own 7-day buckets (local helper, since
  `view-models.js` has no dependency on `derive.js`; the codebase already
  duplicates `classifyMethod` across both modules, so a small local date-bucket
  helper matches the existing pattern). Each day emits Day, Cash, Mobile Money,
  Telecel, Total; method labels use the project's canonical labels (Cash,
  MTN MoMo, Telecel). Chart values on the dashboard must match row totals by
  construction (same bucketing rules as `derive.buildChart7Days`).
- `exportPayments`: Method cell uses the canonical `methodLabel` (reuses the
  `Mtn`-classification fix). Amounts are plain numbers, not formatted strings.
- `exportStudents`: `Outstanding` = `studentOutstanding(student)`.
- `exportIssued`: expands `issuedBooks` quantities per student; `Mode` from
  `registrationMode`; `Kind` = `textbook` or `exbook`.
- `exportStock`: derived from `stockStatus` rows; `Status` = Out / Low / OK.
- `exportReports`: emits a single sheet with a blank row between sections; each
  section starts with a header row so it is self-describing. Sections:
  1. Method summary (Method, Amount) — from `methodSummary`.
  2. Class totals (Class, Amount) — from `classTotals`.
  3. Outstanding list (Student, Class, Balance) — from `outstandingList`.

Numeric columns are raw numbers (Excel/Sheets can sum them); no currency
formatting inside the file.

### App wiring (`js/app.js` + `index.html` + `js/write.js`)

- Each existing export button gets `data-export="<page>"`:
  - Dashboard button (currently `index.html:104`)
  - Payments button (`index.html:234`)
  - Reports button (`index.html:354`)
- New "Export report" buttons (`.btn.btn-light`, `data-export="…"`) added to:
  - Students page head-actions (next to the three existing buttons).
  - Issuing page head-actions.
  - Inventory page head-actions.
- `app.js` binds all `[data-export]` buttons: click opens the format menu
  (CSV / Excel). Selecting an item builds rows from `CEC.viewModels`, serializes
  via `CEC.xlsx.toCSV` / `toXLSX`, then downloads:
  - CSV `Blob` type `text/csv;charset=utf-8`.
  - XLSX `Blob` type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
  - Filenames: `cec-<page>-<yyyy-mm-dd>.<ext>`.
- `js/app.js:69` placeholder selector: narrowed to exclude `[data-export]`
  buttons (`.more-btn, .btn.btn-light:not([data-close]):not([data-export])`).
  This also stops the stray placeholder toast on the Students "+ Textbooks" /
  "+ ExBooks" `.btn.btn-light` buttons (out-of-scope side effect of the current
  selector, fixed in the same line).

### Loading

- `index.html` adds `<script src="js/xlsx.js">` before `js/data-access.js`
  (xlsx is consumed by `app.js`; ordering matches the existing script block).

## Error handling

- Rows are always built from already-loaded in-memory data (`viewData()`); the
  export menu should never be reachable before data loads. If `currentData` is
  null, show the existing toast "Data not loaded yet." and abort.
- A try/catch around serialization + download shows a toast on failure; console
  retains the error for debugging.
- Empty datasets still export — the CSV/XLSX contains the header row (and, for
  Reports, its section headers).

## Testing (TDD, `scripts/test.js` — sync-only runner)

1. `CEC.xlsx.toCSV`: basic rows, quoting (commas, quotes, newlines), empty cells,
   trailing newline.
2. `CEC.xlsx.toXLSX`: ZIP magic (`PK\x03\x04`), contains
   `[Content_Types].xml` + `workbook.xml` + `sheet1.xml` (part names present in
   the byte buffer), and expected cell values appear in the buffer.
3. Each view-model builder: headers match spec; row counts; spot-check specific
   row values (e.g. method canonical labels, outstanding math, issued qty
   expansion).

## Out of scope

- No per-sheet multi-tab workbooks (single sheet per export).
- No styling/formatting inside XLSX (no column widths, no currency cells).
- No export buttons on Books/Settings pages.
- No server-side export.

## Architecture notes

- Row builders live in `view-models.js` (pure, DOM-free, Node-testable) — the
  established pattern in this project.
- Serialization lives in new `xlsx.js` (pure, DOM-free, Node-testable) so both
  formats share one row contract (`array-of-arrays`).
- `app.js` owns browser-only concerns: menu, Blob, download, toast.