# Issue Books - Stock availability table gains a Category column (Title | Category | In stock | Status)

**Status:** Draft
**Date:** 2026-09-24
**Stage:** 01 - Frontend Foundation
**Related:** 2026-09-24-stock-levels-category-column-design (same table-growth pattern: add category cell between subject and stockQty; consume the SAME stockStatus view-model that already carries category)

## Problem

The Issue Books page shows a per-title **Stock availability** table
(`Title | In stock | Status`) that list-books operators use to see what they can
issue before the next issuing session. Like every stock table in this house, it
currently omits the book's **category** (subject/grade band — KG 1, Class 1, ...),
which is exactly the column that tells the operator WHICH shelf/reading level each
available title belongs to when the availability mixes multiple grades (e.g. KG 1
and Class 1 titles in one list). The Inventory page's Stock levels table already
carries this column (see the 2026-09-24-stock-levels-category-column design); the
Issue Books availability table does not, so the two stock tables disagree on
schema, and operators must cross-check a second source to know a title's grade.

Because the stockStatus view-model ALREADY returns `category` on every row
(js/view-models.js:63, verbatim `category: b.category`), and the FIXTURE_BOOKS
fixture ALREADY carries `category` per book (scripts/test.js:685-687, verbatim
"KG 1"/"Class 1"), this is a **pure render-layer change**: two touch-points in the
Issue-books availability table (header cell + row template) and one new/updated
assertion proving category flows from fixture → view-model → rendered row.

## Change

Add a **Category** column to the Issue Books **Stock availability** table so the
header reads **Title | Category | In stock | Status** (4 columns) and each row
shows its book's category verbatim between the title and the in-stock value.

### Touch points

1. **index.html** — the Stock availability table header (line 338) gains
   `<th>Category</th>` between `<th>Title</th>` and `<th>In stock</th>`:
   `Title | Category | In stock | Status`.
2. **js/app.js** — the `renderIssueBooks` availability renderer (js/app.js:416)
   gains a `<td>${esc(r.category)}</td>` cell after the title cell, and the row
   template's column count goes 3 → 4 (matching the 4-column header; the
   `emptyRow(3)` fallback at :423 becomes `emptyRow(4)`).
3. **js/view-models.js** — **no change**: `stockStatus` (js/view-models.js:60-79)
   already carries `category` verbatim on every row (proven :63). Pure passthrough
   of the field the fixture and every book already have.
4. **scripts/test.js** — extend the existing `stockStatus` test to assert the new
   Category cell renders (fixture at :684-688 already has category, so the
   assertion consumes real house fixture data; no fixture change).

### Non-goals (explicitly OUT of scope)

- No backend/storage/model changes — `category` already exists on every book.
- No change to the Inventory page's Stock levels table (already shipped with its
  own Category column per the 2026-09-24-stock-levels-category-column design).
- No new columns beyond Category (no Threshold/Status reordering in this table —
  its Status derives from stockQty, unchanged).

## Acceptance criteria

1. The Issue Books **Stock availability** table header reads
   **Title | Category | In stock | Status** (Category between Title and In stock).
2. Every Stock availability row shows its book's `category` verbatim (KG 1,
   Class 1, ...) — no derivation, no rename.
3. `npm test` passes (the extended stockStatus assertion proves the new cell
   uses house fixture data).
4. No backend/storage/data-model changes.

## Open questions

- None. The `category` field already exists on every book's fixture, and the
  stockStatus view-model already passes it through — there is no data plumbing or
  ambiguity to resolve.