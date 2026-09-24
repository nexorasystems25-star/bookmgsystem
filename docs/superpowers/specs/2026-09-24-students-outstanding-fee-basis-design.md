# Students fee table - outstanding balance computed from the billed books fee (booksFee, fallback booksTotal)

**Status:** Draft
**Date:** 2026-09-24
**Stage:** 01 - Frontend Foundation

## Problem

The **Students** page fee table ("Books fee, payments and entitlement status",
`index.html` `studentsBody`) shows a wrong/placeholder **Outstanding** column for
real students: rows that clearly owe money render the literal word "Paid" in the
Outstanding cell, and the Status cell shows the readiness word "waiting".

Reproduction (real sheet row shape, `scripts/test.js:451`):
`["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]`
-- i.e. `books_fee = 1200` (the billed fee in GHS), `books_paid = 800`,
`books_total = 8` (a BOOK COUNT, not cedar!).

The defect is in the shared outstanding calculation:

- `js/view-models.js:82-84` -- `studentOutstanding` returns
  `Math.max(0, (student.booksTotal || 0) - (student.booksPaid || 0))`.
  With `booksTotal = 8` (a count) and `booksPaid = 800`, this is `8 - 800 <= 0`
  -> `0`, so `renderStudents` (`js/app.js:325`) falls into the
  `balance > 0 ? amount : '<span class="positive">Paid</span>'` branch and prints
  the word **"Paid"** even though the student still owes `1200 - 800 = 400`.
- `js/derive.js:117-124` -- the Dashboard KPI `buildKpis` computes
  `const bal = s.booksTotal - s.booksPaid;` with the same broken basis, so the
  Dashboard **Outstanding** metric (`metricOutstanding`) is wrong/zeroed too.

Same broken math also feeds the Reports top-10 list (`app.js:445-446` via
`viewModels.outstandingList`, which delegates to `studentOutstanding`), so all
three outstanding consumers share one fix.

## Change

Compute the outstanding balance from the **billed books fee** (`booksFee`) rather
than `booksTotal`, falling back to `booksTotal` when `booksFee` is absent so that
existing fixtures/registrations that only set `booksTotal` keep their behaviour.

`outstanding = max(0, (booksFee || booksTotal || 0) - (booksPaid || 0))`

- `S001`: `max(0, 1200 - 800) = 400` -> Outstanding cell renders **GHS 400**.
- Fully paid student: `max(0, 1200 - 1200) = 0` -> Outstanding cell still renders
  **"Paid"** (positive style), which is the correct settled state.
- Status column is **unchanged**: keeps the readiness words (ready / waiting /
  not covered) exactly as today.

### Touch points

1. **js/view-models.js** -- `studentOutstanding` (line 82): replace the
   `booksTotal`-only expression with the `booksFee`-first basis.
2. **js/derive.js** -- `buildKpis` outstanding reduce (lines 117-124): use the
   same `booksFee`-first basis so the Dashboard metric agrees with the Students
   table and Reports.
3. **scripts/test.js** -- new RED assertions that prove the real sheet shape:
   - `studentOutstanding({ booksFee: 1200, booksTotal: 8, booksPaid: 800 })` => 400
   - `buildKpis` over a `normalizeStudents` row with `books_fee: "1200",
     books_paid: "800", books_total: "8"` => outstandingCount 1, amount 400
   - existing tests unchanged (fixtures carry `booksTotal` only, so the fallback
     keeps them green).

### Non-goals

- No change to the Status column / `statusPillClass` / `buildReadiness`
  (user decision: keep readiness words).
- No change to `normalizeStudents`; the raw sheet columns stay as-is.
- No index.html / renderer changes; `renderStudents` already delegates to the
  view-model this spec fixes.

## Test plan

1. RED: add the two new assertions; run `npm test`; expect 121 pass + 2 fail
   (new tests fail, nothing else).
2. GREEN: apply the two one-line basis changes.
3. Run `npm test`; expect 123 pass, exit 0.