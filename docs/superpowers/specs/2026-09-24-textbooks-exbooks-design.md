# Textbooks vs ExBooks Split Design

Date: 2026-09-24
Status: Approved

## Problem

The Register student dialog shows a class dropdown whose book counts and totals
mix textbooks and exercise books. In the live Books sheet the `category` column
holds both class names (`Creche`..`BS 6`) and exercise-book types (`A1 Small`,
`D1 Small`, `C Small`, `G Small`, `A1 Big`, `D1 Big`). The current dropdown built
from `bookCategories()` therefore lists exercise-book types and counts them in
the total, producing labels like `BS 4 — 8 books` where 8 wrongly includes A1/D1/C/G.

Required behavior:

- Class dropdown shows only classes, with textbook count (and fee) inline, e.g.
  `BS 4 — 8 textbooks — 440 GHS`.
- A new per-class exercise-book count appears on the form as an ExBooks field,
  auto-filled when a class is selected.
- `books_total` in the Students sheet represents textbooks only.
- A new `ExBooks` column in the Students sheet stores the student's exercise-book
  count.

## Data model

### Books sheet (unchanged)

Textbook vs exercise book is derived, not stored: a book is an exercise book iff
`publisher === "Exercise Book"`. Backward compatible; no spreadsheet change.

### ClassFees sheet (change)

Add an `exbooks` column next to `fee`. One row per class via the existing
`class | fee | exbooks` layout.

| class | fee | exbooks |
|---|---|---|
| Creche | 380 | 0 |
| Nursery 1 | 390 | 20 |
| Nursery 2 | 395 | 20 |
| KG 1 | 400 | 20 |
| KG 2 | 410 | 20 |
| BS 1 | 420 | 15 |
| BS 2 | 430 | 15 |
| BS 3 | 440 | 15 |
| BS 4 | 450 | 15 |
| BS 5 | 460 | 15 |
| BS 6 | 470 | 15 |

Committed snapshot `data/class-fees.json` updated to include `exbooks`.

### Students sheet (change)

Add `ExBooks` column placed immediately after `books_total`. `books_total`
retains its meaning: textbook count. `ExBooks` is the student's exercise-book count.

## Derived logic (js/view-models.js)

- `isExerciseBook(book)` returns true when `book.publisher === "Exercise Book"`.
- `bookCategories(books)` returns only classes — exercise-book category values
  (e.g. `A1 Small`) are excluded.
- `bookCountForClass` and `classBookInfo` count textbooks only.
- `classBookInfo` also exposes the class's `exbooks` value read from the ClassFees map.

## Form (index.html + js/write.js)

- Add an ExBooks field adjacent to Books total.
- Dropdown option label: `<class> — <n> textbook(s) — <fee> GHS`.
- Selecting a class auto-fills: books fee, Books total (textbook count), ExBooks.
- Clearing the selection resets all three fields.
- Register submission stores `books_total` (textbooks) and `exbooks`.

## Pipeline & tests

- `scripts/sync.js` / `js/derive.js`: `normalizeClassFees` reads the `exbooks`
  column in addition to `class`/`fee`.
- `js/data-access.js`: pass classFees through in both `getAllData` and `fetchOptions`
  (includes exbooks).
- Students write path includes `exbooks`.
- Unit tests:
  - `isExerciseBook` classification.
  - `bookCategories` excludes exercise-book categories.
  - `classBookInfo` returns textbook count + fee + exbooks.
  - `normalizeClassFees` reads exbooks.
- E2E harness: assert `BS 4` yields `8 textbooks — 440 GHS` label, total 8,
  fee 440, exbooks 15.

## Deployment

Commit, push to origin; Vercel auto-rebuilds. Requires spreadsheet edits:
`ExBooks` column on Students and `exbooks` column (+ values) on ClassFees.