# Stock levels - add a Category column (Title | Category | In stock | Threshold | Status)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a **Category** column to the **Stock levels** table on the Inventory
tab (index.html:288-296), showing each title's subject/grade category (KG 1,
Class 1, Class 2, ExBook, ...) verbatim from the existing per-book `category`
field - placed between Title and In stock, so the header reads
**Title | Category | In stock | Threshold | Status**. Pure frontend; the
`category` field already exists on every book row in view-models.js `stockStatus`
input and there is no backend or storage change.

**Architecture:** Pure frontend. The `stockStatus` view-model (js/view-models.js:60-79)
adds `category: b.category` to each row object it returns (line 63-70, the row
builder). The Stock levels table header (index.html:292) gains a `<th>Category</th>`
after the Title `<th>`, and the row template in js/app.js `renderInventory`
(:387-391) gains a matching `<td>${esc(r.category)}</td>` after the title cell, so
the header and the first data row both have 5 cells in the same order. The cell
text is escaped with the existing `esc` helper exactly like every other cell.
No dispatch/routing, no openDialog signature, no state, no backend change.

## Tasks

- [x] **Task 1 - RED: write a failing test that stockStatus rows carry `category`.**
  - TDD: add to scripts/test.js (the `stockStatus` test at :768-775) an assertion
    that each returned row carries `category` verbatim from the book, using the
    FIXTURE_BOOKS fixture (:684-688) - add a `category` value per fixture book
    (e.g. "KG 1", "Class 1", "Class 2") and assert
    `inv.rows.map(r => r.category)` equals the fixture categories in order.
  - Gate: `npm test` - the new assertion FAILS (RED) because stockStatus rows
    don't carry category today.
  - Files: scripts/test.js.

- [x] **Task 2 - GREEN: add `category` to the stockStatus row object.**
  - TDD: in js/view-models.js `stockStatus` (:60-79), the row builder at :63-70
    gains `category: b.category` (mirroring how subject/publisher/stockQty are
    already copied from the book).
  - Gate: `npm test` - the new assertion PASSES (GREEN); all other tests stay
    green.
  - Files: js/view-models.js.

- [x] **Task 3 - GREEN: add the Category `<th>` to the Stock levels header.**
  - In index.html:292 the header row gains `<th>Category</th>` after
    `<th>Title</th>`, making the header **Title | Category | In stock |
    Threshold | Status** (5 columns matching the 5 data cells).
  - Gate: `npm test` stays green; manual: Inventory tab shows the new header
    column.
  - Files: index.html.

- [x] **Task 4 - GREEN: render the category `<td>` in the stock row template.**
  - In js/app.js `renderInventory` (:387-391) add
    `<td>${esc(r.category)}</td>` after the title cell so the data row order
    matches the 5-column header.
  - Gate: `npm test` stays green; manual: each Stock levels row shows its
    category (KG 1, Class 1, ...) under the Title.
  - Files: js/app.js.

- [x] **Task 5 - Full-suite verification.**
  - Run `npm test` - all tests pass (including the new category assertions);
    `git status` shows only the plan doc + design doc untracked; no other change.
  - Gate: `npm test` exit 0.
  - Files: none.

## Verification

- `npm test` (runs scripts/test.js) - all tests pass.
- Manual: Inventory tab > Stock levels table shows the Category column between
  Title and In stock, populated with each book's category.

## Acceptance criteria

1. The Stock levels table header reads **Title | Category | In stock |
   Threshold | Status** (Category between Title and In stock).
2. Every Stock levels row shows its book's `category` verbatim (KG 1,
   Class 1, Class 2, ...) - no derivation, no rename.
3. All existing tests still pass; the intentionally-extended `stockStatus` test
   proves the new field flows from book -> view-model row.
4. Zero backend/storage/data-model changes.

## Open questions

- None. The `category` field already exists on every book, so there is no data
  plumbing or ambiguity to resolve.