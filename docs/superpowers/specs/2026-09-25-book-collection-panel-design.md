# 2026-09-25 — Book Collection Panel Design

## Goal

Replace the "Ready students" table on the **Issue Books** page (index.html:326-333,
rendered by `renderIssuing` in js/app.js:405-413) with a **Book collection** panel
that, per student who has collected books, shows:

- what they have collected (all book types + quantities), and
- what is left to be added, based on the amount paid and the mode of registration.

The current panel only lists `status === "ready"` students in a Student / Class /
Status table.

## Decisions (confirmed with user)

1. **Registration mode is derived from the Students columns** (`books_total`, `exbooks`):
   - `books_total > 0` and `exbooks == 0` → **Textbooks** only
   - `books_total == 0` and `exbooks > 0` → **ExBooks** only
   - both `> 0` → **Both**
2. **Textbook gate is the class package, not the paid check**: eligible class
    textbooks are those with `price > 0`, in the student's class, not yet collected.
    The paid check does not gate the owed list. Stock and `books_total` are ignored
    as caps.
 3. **Remaining is the class package minus issued** (resolved 2026-09-28, superseding
    the 2026-09-27 paid-budget model): what a student still gets is `class package −
    issued`, regardless of what they paid. The school issues first and collects
    payment later, so a student issued more than they paid (budget would go negative,
    e.g. S009/S019 on the real BS 1 sheet) must still see every missing textbook.
    - Exercise-book types are owed in class-fee column order and are simply
      `class-size qty − collected qty` (dropped when `<= 0`); no "full cost fits
      budget" check. Stock does not make a type stop being owed: a shortage flags it
      `stockShort` (rendered "out of stock") instead of hiding it.
    - Mode still derives from `books_total`/`exbooks` (Both / Textbooks / ExBooks).
    - The paid/budget gate is NOT applied on the panel. Issuing is gated only by
      "has the student paid anything in any form" (`booksPaid > 0`) plus stock
      (resolved 2026-09-28, superseding the "keep the budget gate on issuing" note):
      `issueEligibleExBooks` additionally hides sizes with no stock, and `runIssue`
      enforces the paid-something check server-side ("has not paid for books yet —
      record a payment before issuing"). The old affordability gates (`price <= paid`
      in `issueEligibleBooks`, whole-type `cost > budget` in `issueEligibleExBooks`
      and `runIssue`) are gone — a student who paid 8 can be issued a 12.5 exercise
      book once stock exists.
 4. **Panel scope**: only students with at least one collected book are listed.
 5. Owed items are **never hidden by stock or by paid** (resolved 2026-09-28,
    superseding the paid-budget rule and the 2026-09-27 "omit out-of-stock" rule):
    every class item not yet issued is listed as "Left to add"; a stock shortage
    only flags it `stockShort` (rendered "out of stock"). A student is "All
    collected" only when the package minus issued is truly empty. S019 on the real
    BS 1 sheet is a genuine "All collected" (all 8 textbooks + 15 exbooks issued,
    paid 550).

## Data layer (js/view-models.js)

Both functions are pure and exported from `CEC.viewModels`.

### `issuedBooks(activity, student)`

Returns `{ [bookId]: qty }` — a summed map of every book issued to the student.

- Reuses the activity parsing of `issuedBookIds` (view-models.js:131-145):
  `type === "issue"`, description matches `^Books issued to <name> \[([^\]]*)\]$`,
  name compared case-insensitively.
- Improves on it: the `xN` token suffix is preserved so `B075x5` counts **5**, not 1.
- Multiple activity entries for the same student/ book accumulate quantities.
- A plain id (no `xN`) counts as qty 1.

### `studentCollection(student, books, classFees, activity)`

Returns `{ mode, collected, remaining }`:

- `mode`: `"Textbooks"` | `"ExBooks"` | `"Both"` (per decision 1).
- `collected`: `[{ book, qty, kind }]` — every `{bookId: qty}` from `issuedBooks`
  resolved against the books catalog; `kind` = `"textbook"` | `"exbook"` via
  `isExerciseBook` (view-models.js:99-101). Books not found in the catalog are
  skipped.
- `remaining`:
  - **Textbooks** (`{ book, qty: 1, kind: "textbook" }`): same class, `price > 0`,
    not yet collected. There is no `price <= budget` gate — the paid check does not
    apply to owing (decision 3). The `stockQty > 0` gate from `issueEligibleBooks`
    is intentionally NOT applied — shortage flags, never hides. If the student's
    mode excludes textbooks, this array is empty.
  - **ExBooks** (`{ book, qty, kind: "exbook" }`): for each class-fee size line in the
    fees row for the student's class, `qty = sizeQty - collectedQty(for that book)`.
    Lines with `qty <= 0` are dropped. A size line is always owed when its remaining
    qty is positive, regardless of stock and regardless of the paid budget.
    Only included when mode includes ExBooks.
  - Items whose stock cannot cover the remaining qty carry `stockShort: true` so the
    UI can tag them `(out of stock)`. `stockShort` does not remove the item.

## UI

### index.html (page-issuing)

Replace the "Ready students" panel with a "Book collection" panel:

```html
<section class="panel">
  <div class="panel-head"><div><h2>Book collection</h2><p>What students have collected, and what is still owed.</p></div></div>
  <div class="table-scroll">
    <table>
      <thead><tr><th>Student</th><th>Mode</th><th>Collected</th><th>Left to add</th></tr></thead>
      <tbody id="collectionBody"></tbody>
    </table>
  </div>
</section>
```

### js/app.js (`renderIssuing`)

- Build rows from `CEC.viewModels.studentCollection(...)` for students with a
  non-empty `collected` array.
- `Student` cell keeps the existing name + studentId sub-line.
- `Mode` cell: the mode label.
- `Collected` / `Left to add` cells: render type groups —
  `Textbooks: Subject ×qty, …` and `ExBooks: Category ×qty, …`. Multiple items of the
  same type are comma-separated; groups separated by ` · `.
- When `remaining` is empty (the student has collected everything owed for their
  mode), show a green pill **All collected** in the Left to add cell.
- Otherwise list items normally; items with `stockShort` get an `(out of stock)` tag.
- No rows → `emptyRow(4, "No books collected yet.")`.
- Metric cards and the Stock availability panel are unchanged.

## Edge cases

- Student with collected books whose mode is Textbooks only → exbooks never shown.
- Student issued a book id no longer in the catalog → ignored in collected.
- Class fee size book missing from catalog → that size line not listed.
- quantities across multiple issue entries accumulate.

## Error handling / robustness

- `(books || [])`, `(classFees || [])`, `(activity || [])` defensively.
- Name matching is lower-cased + trimmed, matching `issuedBookIds`.
- No async I/O; pure functions feed the existing render path.

## Testing (TDD, scripts/test.js)

New suite additions (suite count 134+):

1. `viewModels.issuedBooks sums xN quantities across issue entries`.
2. `viewModels.issuedBooks matches student name case-insensitively`.
3. `viewModels.studentCollection derives Textbooks / ExBooks / Both modes`.
4. `viewModels.studentCollection collected resolves textbook and exbook items with qty`.
5. `viewModels.studentCollection remaining keeps paid-gated class textbooks not yet collected`.
6. `viewModels.studentCollection remaining subtracts collected exbook quantities per size`.
7. `viewModels.studentCollection marks stock-short remaining with stockShort true`.
8. Fake activity/books/fees fixtures shared with existing issue tests.

## Out of scope

- Changing the issue modal / eligibility rules (separate, stopped discussion).
- Re-stocking flows.
- Reports page changes.
- Adding explicit `mode` column to Students (decision 1 = derive only).