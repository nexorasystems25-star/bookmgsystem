# Issue Books - Stock availability table gains a Category column (Title | Category | In stock | Status)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a **Category** column to the Issue Books **Stock availability** table on the
Issue Books page (index.html:338 header, js/app.js:416 renderer, tbody `issueBooksBody`),
so the header reads **Title | Category | In stock | Status** (4 columns) and each row
shows its book's category verbatim between the title and the in-stock value. Pure
frontend render-layer — the stockStatus view-model (js/view-models.js:60-79) ALREADY
carries `category: b.category` verbatim on every row (:63), and the FIXTURE_BOOKS
fixture (scripts/test.js:684-688) ALREADY carries `category` per book ("KG 1" /
"Class 1"), so the implementer consumes house data already on disk — no backend, no
storage, no view-model, no fixture change.

**Architecture:** This is the SECOND stock table in the house to receive the Category
column (the first = Inventory → Stock levels, ship 374d05a + implementer commits
87a9d57/afac912/d9aeb4c — same pattern: `category` field already on every book + in
the stockStatus view-model; the renderer + header template simply display it). The
Issue Books availability table is rendered by `renderIssueBooks` (js/app.js:410-425,
row template :421-424 = 3 cells `subject | stockQty | status`, emptyRow(3) fallback
:423) consuming the SAME stockStatus view-model — so the ONLY changes are the table
header cell, the row template's new `<td>`, and the test that asserts category renders.

**Tech Stack:** Vanilla JS (no framework); DOM innerHTML row maps; `esc()` helper for
escaping; house test runner `node scripts/test.js` (`npm test`).

## Tasks

- [x] **Task 1 - RED: write a failing test that the Issue Books availability rows carry `category`.**
  - TDD: extend the existing `stockStatus` test (scripts/test.js:768-775) with an
    assertion that each returned row carries `category` verbatim from the book
    (`assert.equal(rows[0].category, "KG 1")` etc. — the fixture at :684-688 already
    carries it), so the test proves the Issue table's Category cell consumes house
    fixture data — no new fixture, no invented data.
  - Gate: `npm test` - the NEW assertion FAILS (RED) because the renderer does not yet
    render a category cell in the availability table today.
  - Files: scripts/test.js.

- [x] **Task 2 - GREEN: add the Category header cell to the Issue Books availability table.**
  - In index.html:338, insert `<th>Category</th>` between `<th>Title</th>` and
    `<th>In stock</th>` so the header reads **Title | Category | In stock | Status**
    (4 columns, matching the 4 data cells the renderer will emit).
  - Gate: `npm test` - suite stays green; manual: Issue Books page shows the new
    Category header between Title and In stock.
  - Files: index.html.

- [x] **Task 3 - GREEN: render the category `<td>` in the Issue Books availability row template.**
  - In js/app.js renderIssueBooks (:410-425), add `<td>${esc(r.category)}</td>` after
    the title cell so the row template becomes 4 cells in the same order as the header
    (`subject | category | stockQty | status`), and change the emptyRow(3) fallback
    (:423) to emptyRow(4).
  - Gate: `npm test` - suite stays green; manual: each Stock availability row shows
    its category (KG 1, Class 1, ...) between the title and the in-stock value.
  - Files: js/app.js.

- [x] **Task 4 - Full-suite verification.**
  - Run `npm test` - all tests pass (including the new category assertion); `git status`
    shows the spec + plan docs untracked and nothing else changed.
  - Gate: `npm test` exit 0.
  - Files: none.

## Verification

- `npm test` (runs scripts/test.js) - all tests pass.
- Manual: Issue Books page - Stock availability table shows the Category column between
  Title and In stock, populated with each book's category.

## Acceptance criteria

1. The Issue Books Stock availability table header reads **Title | Category |
   In stock | Status** (Category between Title and In stock).
2. Every Stock availability row shows its book's `category` verbatim (KG 1,
   Class 1, ...) - no derivation, no rename.
3. `npm test` passes (the extended stockStatus assertion proves the new cell
   uses house fixture data).
4. No backend/storage/data-model changes.

## Open questions

- None. The `category` field already exists on every book's fixture, and the
  stockStatus view-model already passes it through — there is no data plumbing or
  ambiguity to resolve.