# Add a Category column to the Stock levels table (subject/grade category)

**Status:** Draft
**Date:** 2026-09-24
**Stage:** 01 - Frontend Foundation
**Related:** 2026-09-24-stock-levels-category-column-design (same table, same renderer: renderInventory -> inventoryBody; existing stockStatus rows do not yet carry category)

## Problem

The **Stock levels** table on the Inventory page (index.html:288-296) currently
shows four columns — **Title | In stock | Threshold | Status** — but gives no
way to tell **which subject/grade category** each title belongs to. A user
browsing low or out-of-stock rows cannot see at a glance whether the gap is in
KG 1, Class 1, Class 2, and so on.

## Current Behaviour

- The table header (index.html:292) is fixed 4 columns:
  `<thead><tr><th>Title</th><th>In stock</th><th>Threshold</th><th>Status</th></tr></thead>`
- Rows are rendered by `renderInventory` (js/app.js:374-396): the tbody
  `inventoryBody` (index.html:293) gets one `<tr>` per stock row from the
  `stockStatus` view-model.
- Each row template (app.js:387-391) writes four cells in header order:
  `subject` (bold title), `stockQty`, `lowStockThreshold`, `status` pill.
- The `stockStatus` view-model builder (js/view-models.js:60-79) maps each
  book into a row object carrying `bookId, subject, publisher, stockQty,
  lowStockThreshold, status` — it does **not** carry the book's `category`.
- Every book already has a `category` field (e.g. "KG 1", "Class 1"; for
  exercise books "A4"). It is derived neither from subject nor from publisher —
  it is its own first-class book field, already surfaced elsewhere in the app
  (see `CEC.viewModels.bookCategories` at view-models.js:101-109).

## Goal

Add a **Category** column to the Stock levels table that shows each title's
subject/grade category, sourced from the existing per-book `category` field.
Placement: **Title | Category | In stock | Threshold | Status** (Category right
after Title).

No backend or storage change: `category` already exists on every book record
and is already part of the book fixtures the app renders from.

## Solution

### 1. `stockStatus` view-model: carry `category` through

js/view-models.js:60-79 — the row builder at :63-70. Add a `category` key
sourced from the book's own field:

``js
return {
  bookId: b.bookId,
  subject: b.subject,
  category: b.category,      // NEW
  publisher: b.publisher,
  stockQty: b.stockQty,
  lowStockThreshold: b.lowStockThreshold,
  status
};
``

### 2. Header: add a Category `<th>`

index.html:292:

``html
<thead><tr><th>Title</th><th>Category</th><th>In stock</th><th>Threshold</th><th>Status</th></tr></thead>
``

### 3. Renderer: add the category `<td>`

js/app.js:387-391 — the `renderInventory` row template writes four cells in
header order; insert the category cell after the title cell so the `<td>`
order matches the new 5-column header:

``js
<tr>
  <td><b></b><small></small></td>
  <td></td>
  <td></td>
  <td><span class="pill "></span></td>
</tr>
``

### 4. Tests (this repo is TDD: failing test first)

Extend the existing `stockStatus` test (scripts/test.js:768-775) — it already
asserts OK/Low/Out statuses and counts on the shared `FIXTURE_BOOKS`. Give
the fixture books `category` values (matching the real per-book data already
in the app) and assert the new field flows through:

``js
test("viewModels.stockStatus flags OK / Low / Out with counts", () => {
  const inv = vm.stockStatus(FIXTURE_BOOKS);
  assert.equal(inv.totalTitles, 3);
  assert.equal(inv.okCount, 1);
  assert.equal(inv.lowCount, 1);
  assert.equal(inv.outCount, 1);
  assert.deepEqual(inv.rows.map(r => r.status), ["OK", "Low", "Out"]);
  // NEW: category carried through from the book
  assert.deepEqual(inv.rows.map(r => r.category), ["KG 1", "KG 1", "Class 1"]);
});
``

And update FIXTURE_BOOKS (test.js:684-688) to include `category` per book so
the new assertions run against real fixture data, not invented values:

``js
const FIXTURE_BOOKS = [
  { bookId: "B1", subject: "English", category: "KG 1", publisher: "A", stockQty: 20, lowStockThreshold: 5 },
  { bookId: "B2", subject: "Maths", category: "KG 1", publisher: "B", stockQty: 4, lowStockThreshold: 5 },
  { bookId: "B3", subject: "Science", category: "Class 1", publisher: "C", stockQty: 0, lowStockThreshold: 3 }
];
``

FIXTURE_BOOKS is used only by view-model tests (stockStatus at test.js:768 and
elsewhere) — adding `category` does not change any other assertion.

## Acceptance criteria

1. The **Stock levels** table has a **Category** column between Title and In
   stock, showing each title's subject/grade category.
2. `viewModels.stockStatus` rows carry `category` verbatim from each
   book's `category` field — no derivation or renaming.
3. All existing tests still pass except the intentionally-extended
   `stockStatus` test.
4. Zero backend, storage, or data-model changes.

## Verification

- `npm test` (runs scripts/test.js) stays green after the change.
- Manual: Inventory page -> Stock levels table shows the Category column.

## Open questions

- None. The column label "Category" matches the table's current vocabulary and
  reuses the existing per-book field, so no ambiguity with publisher or
  subject (both of which are already separate columns).