# Issue modal - ExBooks per-size copies with quantity logging

**Status:** Draft
**Date:** 2026-09-25
**Stage:** 01 - Frontend Foundation
**Related:** 2026-09-24-issue-books-availability-category-column-design (issue modal precedent), 2026-09-24-stock-textbook-exbooks-modes-design (exercise size categories), 2026-09-24-register-purchase-mode-design (Textbooks / ExBooks / Both modes)

## Problem

The **Issue books** modal (`#dlgIssue`, `index.html`) only lists **textbooks**:
`issueEligibleBooks` (`js/view-models.js:143-155`) explicitly drops exercise
books (`if (isExerciseBook(b)) return false;`) and issues are recorded as a flat
list of book ids (`write.issueBooks({ student_id, books: [id...] })`). The
**ExBooks** that a student is entitled to - per the copies-per-student size
columns the user added to the ClassFees sheet (e.g. Nursery 1: 5 A1 Small + 5 D1
Small + 5 C Small + 5 G Small = 20) - can never be issued from this modal.

We also need to know **who may receive ExBooks**: only students who registered for
them (the register dialog has Textbooks / ExBooks / Both modes
`2026-09-24-register-purchase-mode-design.md`). Registration was designed to post
an `exbooks` count, but today **no `exbooks` column exists on the live Students
sheet**, so `normalizeStudents` (`js/derive.js:45`) reads `num(undefined) = 0` for
everyone and the gate cannot work.

## Goal

Extend the Issue modal so that, for a selected student, it shows:

1. **Textbook lines** - the current behaviour (unchanged).
2. **ExBooks lines** - one line per exercise-book size the student's class is
   entitled to, showing the **required count** and current stock, e.g.
   `A1 Small - need 5, stock 40`. A line is tickable **only when
   stock >= required count**. Ticking the line issues the full required count.

Issues must record the **quantity** so re-reads can tell how many copies of a
size were already given (e.g. activity text `Books issued to X [B075x5,B076x5]`).

## Decisions (user-confirmed)

- **Copies per student**: the ClassFees size columns are copies per paid student
  (Nursery 1: 5 A1 Small + 5 D1 Small + 5 C Small + 5 G Small = 20). The per-size
  counts **sum to the `exbooks` total** on that row (verified on the live sheet:
  N/KG rows 5+5+5+5=20, BS rows single 15=15).
- **Eligibility gate**: ExBooks are issuable only when `student.exbooks > 0`
  (i.e. the student registered in ExBooks or Both mode). Textbook lines keep
  today's `booksPaid > 0` rule.
- **Presentation**: one tickable line per size showing required count and stock;
  stock must be >= required count to tick; the issue record logs quantity
  (e.g. `B075 x5`).
- **Students sheet**: add an **ExBooks column** next to `books_total`
  (column 9, between `books_total` and `status`) to store each student's
  expected exbooks count. `runStudent` (`api/_lib.js:246-249`) **already appends
  `String(payload.exbooks)` in that exact position**, so registration writes are
  already correct once the column exists. The header must be spelled exactly
  `exbooks` (lowercase) so `num(r.exbooks)` in `normalizeStudents` reads it.

## Current behavior

- `issueEligibleBooks(books, student, activity)` (view-models.js:143-155):
  filters `isExerciseBook(b) -> skip`, `classKey(b.category) === classKey(student.className)`,
  `price <= booksPaid`, `stockQty > 0`, `bookId` not in `issuedBookIds`.
- `issuedBookIds(activity, student)` (view-models.js:127-141): parses
  `^Books issued to (.+?)\s*\[([^\]]*)\]$`, splits on commas. Format:
  `Books issued to Abena Mensah [B001,B002]`.
- `renderIssueBooks(studentId)` (write.js:132-150): renders checkbox labels from
  `issueEligibleBooks`; submit (write.js:277-296) reads checked
  `[data-book-check]` values and posts `{ student_id, books: [ids] }`.
- `validateIssuePayload` (api/_lib.js:80-93): accepts either
  `{ student_id, book_id, qty }` OR `{ student_id, books: [id...] }` (the array
  form **dedupes ids and treats each as qty 1** - there is no per-id quantity).
- `runIssue` (api/_lib.js:256-291): for the array form sets `qty: 1` per id;
  decrements stock per resolved request; appends one activity row
  `Books issued to <name> [<ids joined by ,>]`; returns stock qty updates.
- Live ClassFees (fetched): header `class, fee, exbooks, A1 Small, D1 Small,
  C Small, G Small, A1 Big, D1 Big, Exercise Book, exbooks`. `normalizeClassFees`
  (derive.js:85-93) maps only `class/fee/exbooks` - the trailing duplicate
  `exbooks` header yields the same value as the leading one, both fine today.
- Live Books (fetched): exercise books are rows with `publisher = "Exercise Book"`
  and `category` = one of `A1 Small, D1 Small, C Small, G Small, A1 Big,
  D1 Big, Exercise Book` (ids 75-81, prices 2.5/3). These categories **exactly
  match** the ClassFees size column names. `normalizeBooks` (derive.js:73-83)
  maps `activity title -> exercise size`, period; see the Non-goals / issue column
  note above. Current stock for exercise rows is mostly 0/blank on the live sheet.

## Change

### 1. ClassFees: carry the per-size counts

`normalizeClassFees` (derive.js:85-93) keeps the base mapping and adds a
`sizes` map built from the size columns only when the value parses to a positive
integer:

`{ className, fee, exbooks, sizes: { "A1 Small": 5, "D1 Small": 5, "C Small": 5, "G Small": 5 } }`

The size columns are read from the raw row keys exactly as spelled on the sheet
(`A1 Small`, `D1 Small`, `C Small`, `G Small`, `A1 Big`, `D1 Big`,
`Exercise Book`); a column value that is empty, a dash (`-`) or non-numeric is
treated as absent so Creche's `-` rows produce `{}`. The duplicate `exbooks`
header keeps the current behaviour (both cells carry the same number).

### 2. New view-model: `issueEligibleExBooks(books, student, activity, classFees)`

Signature mirrors `issueEligibleBooks` with the fees param appended. Bare logic:

1. `if (!student || !(Number(student.exbooks) > 0)) return []` - the
   registration gate.
2. Resolve the student's class fee row via the existing tolerant
   `classKey(className)` match used by `classBookInfo` / `issueEligibleBooks`.
3. For each size in that row's `sizes` (e.g. `{ name: "A1 Small", qty: 5 }`) find
   the exercise book whose `classKey(category) === classKey(sizeName)` and
   `isExerciseBook(b)` is true.
4. Exclude sizes whose book id is already in `issuedBookIds(activity, student)`
   (a size issued once is fully given - the x5 record marks it done).
5. Return `[{ book, qty, stock }]` **only** when `Number(book.stockQty) >= qty`
   (stock-check gate; do not return tickable-but-partial lines).
6. Price is **not** a gating factor for ExBooks eligibility: the ExBooks
   entitlement is count-based per the ClassFees sheet, not limited by
   `booksPaid` (a student who registered ExBooks-only has zero fee/pay but is
   still entitled). This deliberately differs from the textbook branch.

### 3. Issue contract: quantity-aware logging + backward compatible

`validateIssuePayload` (api/_lib.js:80-93) extends the array form so each entry
may be either a plain id string (textbook, qty 1, as today) or an object
`{ book_id, qty }`:

```
[ "B001", { book_id: "B075", qty: 5 } ]
```

Rules: entries must be strings or objects; object entries require a non-empty
`book_id` and an integer `qty >= 1`; the payload keeps the existing id-list form
semantics and does NOT dedupe object entries (the same book may legitimately
appear once with its quantity; duplicate ids are rejected to prevent ambiguity -
compute per-id from the raw array). Textbooks posted as plain ids stay exactly
backward compatible.

`runIssue` (api/_lib.js:256-291) maps request entries:
- plain id -> `{ book_id: id, qty: 1 }` (current behaviour)
- object -> `{ book_id, qty }` as given
- stock check `qty > stockQty` already exists per request (line 273); keep it.
- activity description becomes `Books issued to <name> [B075x5,B076x5]` for
  qty > 1 and `[B001,B002]` (plain ids) when qty is 1, so old logs stay valid.
  Format: `id` when qty 1, `id x{qty}` when qty > 1. Parser cannot use a bare
  comma split for object entries since `x5` has no comma - the proposed format is
  `[B075x5,B076x5]` (single `x` separator, no spaces).

### 4. `issuedBookIds` parser understands the new log format

`issuedBookIds` (view-models.js:127-141) splits the bracket contents on commas
and keeps each token as a book id. Extend the splitter to also strip a trailing
`x\d+` quantity so `B075x5` resolves to `B075` (and keeps `B001` as `B001`).
Backward compatible with all existing logs (no `x` suffix -> unchanged). The
requirement that "issued once = fully given" is satisfied because a size line is
only returned when its id is absent from `issuedBookIds`.

### 5. Modal renders an ExBooks section

`renderIssueBooks` (write.js:132-150) renders two groups:

- **Textbooks** - existing lines, unchanged, under an existing heading only when
  non-empty (books within the paid amount that are in stock - current filter).
- **ExBooks** - new lines from `issueEligibleExBooks`, each a checkbox label
  `[data-exbook-check] value=<bookId> data-qty=<qty>` showing
  `A1 Small (Writing Lines) - need 5, stock 40` + `x5`.
- If both groups are empty, keep today's "No books available for X right now."

### 6. Submit posts quantities in one call

`write.js:277-296` builds the request as `{ student_id, books }` where the books
array mixes plain textbook ids (checked `[data-book-check]`) and exbooks objects
`{ book_id, qty }` (checked `[data-exbook-check]`, qty from `data-qty`). The
single POST /api/issue validates and issues in one round-trip; the activity row
records the x5 tokens.

### 7. Students sheet data step (user, out of code scope)

Add an `exbooks` header + values in the Students sheet column 9 (between
`books_total` and `status`). Registration already writes it; the sheet gate is
required for the feature to function with real data. `normalizeStudents`
needs no code change.

## Touch points

1. `js/derive.js` - `normalizeClassFees` adds `sizes` map (and skips non-numeric /
   dash values); no change to `normalizeStudents`.
2. `js/view-models.js` - new `issueEligibleExBooks` helper; extend the tail of
   `issuedBookIds` token parsing for `x<qty>`.
3. `api/_lib.js` - `validateIssuePayload` object entries; `runIssue` request map
   (object -> qty) + quantity-aware activity text.
4. `js/write.js` - `renderIssueBooks` two sections; submit builder mixes ids and
   `{ book_id, qty }` objects.
5. `index.html` - (likely) a heading/separator element for the ExBooks group; no
   structural change to `#dlgIssue`.
6. `scripts/test.js` - new tests (below); existing 123 stay green.

## Test plan

1. RED: add assertions for
   - `normalizeClassFees` reads size columns into `sizes` (and ignores dashes /
     blanks / non-numeric).
   - new `issueEligibleExBooks`: registered student (exbooks>0) returns lines
     with correct qty; unregistered (exbooks=0) returns []; stock < qty excluded;
     already-issued budget excluded; unknown class -> [].
   - `issuedBookIds` parses `[B075x5,B076x5]` into `["B075","B076"]`; backward
     compat with `[B001,B002]`.
   - `validateIssuePayload` accepts `[{ book_id, qty }]` entries; rejects bad
     qty / missing book_id / duplicate ids.
   - `runIssue` with object entries decrements stock by qty and logs
     `Books issued to X [B075x5]`.
   - `renderIssueBooks` DOM: textbook + exbooks groups rendered; stock < qty
     line absent.
   Run `npm test`; expect 123 pass + N new fail.
2. GREEN: apply derive / view-models / api / write changes.
3. Run `npm test`; expect 123 + N pass, exit 0.

## Out of scope

- Stock adjust / register dialogs (already shipped).
- Any Books-sheet schema change (exercise sizes already exist as rows).
- Price-based gating of ExBooks (count-based per user decision).
- Multi-page / "issue all" shortcuts; the modal remains line-by-line tick.
- The `exbooks` Students column itself is a **data-side** step for the user to
  add; the code already reads/writes it.