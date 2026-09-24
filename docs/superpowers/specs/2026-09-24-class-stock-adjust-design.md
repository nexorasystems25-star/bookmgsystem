# Class-Based Adjust Stock Design

Date: 2026-09-24
Status: Approved

## Problem

The Adjust stock dialog currently lists every book in a single dropdown and takes
one signed adjustment number per submit. With ~80 books this is unusable: the
operator cannot see stock levels by class, cannot adjust several books at once,
and must remember exact counts. Required behavior:

- A Class field leads the form.
- Selecting a class shows that class's textbooks, each with a quantity box.
- Positive quantity adds stock; negative removes it; empty/0 means no change.
- One submit applies every non-zero quantity as a single batch write.

## Data model

No spreadsheet change. Stock remains the `stock_qty` column on the Books sheet
(column F, the value already read/written by the Issue and single-stock paths).

## Derived logic (js/view-models.js)

Reuse existing helpers, no new view-model needs:

- `bookCategories(books)` for the class dropdown (textbook categories only;
  exercise-book categories like `A1 Small` are excluded, matching Register).
- `isExerciseBook(book)` continues to classify by publisher.

## Dialog (index.html + css/app.css)

`dlgStock` form restructured:

- `<label>Class<select data-class required></select></label>` first.
- The former Book select and Adjustment input are replaced by a
  `[data-stock-list]` container. Each rendered book row shows subject,
  publisher, current stock, plus `<input type="number" step="1" data-qty>`.
- Empty states: "Select a class to see its books." when no class chosen;
  "No books for &lt;class&gt; right now." when the class has no textbooks.
- CSS reuses `.book-list`/`.book-option` row layout and adds a compact
  numeric `.qty` input style.

## Client (js/write.js)

- `populate("stock")` fills the class select from `bookCategories(opts.books)`;
  a change listener re-renders `[data-stock-list]` for the selected class.
- Submit builds `stock_adjustments: [{ book_id, stock_delta }, ...]` from every
  row whose qty is a non-zero integer. Empty row = skipped.
- Validation: class covered by native `required`; a submit with no non-zero
  quantity shows the styled error "Enter a quantity for at least one book."
- Success: `CEC.write.adjustStock({ stock_adjustments })`, dialog closes,
  toast "Stock adjusted."; errors surface via `showError`.
- `adjustStock` and the `api/stock` endpoint are unchanged; only the payload
  shape grows a batch form alongside the legacy single-book form.

## API (api/_lib.js)

### validateStockPayload

- If `Array.isArray(p.stock_adjustments)`:
  - must be non-empty;
  - each entry: string `book_id` and integer non-zero `stock_delta`;
  - no duplicate `book_id` in the batch;
  - returns `{ ok: true, payload: { stock_adjustments } }`.
- Else the single `book_id`/`stock_delta` path is unchanged.

### runStock

- If `payload.stock_adjustments` is present, batch mode:
  - read `Books!A:I` once;
  - resolve every entry first: unknown `book_id` or a result below zero aborts
    the whole batch with `{ ok: false, error }` and writes nothing;
  - then apply every stock update (column F), one `sheetsUpdate` per entry;
  - append one Activity row per adjusted book ("New stock added for &lt;subject&gt;"
    for positive, "Stock corrected for &lt;subject&gt;" for negative) using
    sequential activity ids;
  - returns `{ ok: true, rows: [{ book_id, stock_qty }, ...] }`.
- Single-book path unchanged, returns `{ ok: true, row }`.

## Pipeline & tests

- `scripts/test.js` additions (all inside the existing suite, expect total
  grows):
  - `validateStockPayload` batch: valid, empty array rejected, entry missing
    `book_id`, zero delta rejected, non-integer rejected, duplicate `book_id`
    rejected, legacy single shape still valid.
  - `runStock` batch: success (correct stock cells + one Activity row per book +
    rows returned), below-zero abort writes nothing, unknown `book_id` abort
    writes nothing, legacy single shape still works.
- E2E harness extension (`cec-register-fill-e2e.cjs`):
  - class dropdown in dlgStock lists textbook categories;
  - picking a class renders only that class's books, each with a qty box and
    current stock;
  - submit with all qty empty shows the styled error and posts nothing;
  - mixed +/- qty posts the full `stock_adjustments` array, dialog closes,
    toast "Stock adjusted.";
  - zero console errors.

## Deployment

Commit and push to origin; Vercel auto-rebuilds. No spreadsheet or env changes.