# Design: "Adjust stock" split into Textbook and ExBooks modes

Date: 2026-09-24
Status: Approved (design)

## Overview

The Inventory toolbar currently has one button, `+ Adjust stock`, which opens a
dialog for adjusting textbook stock by class. This change splits it into two
entry points sharing one dialog:

- `+Stock Textbook` — behaves exactly as today (class dropdown of textbook
  categories, per-book qty rows, batch POST).
- `+Stock ExBooks` — same dialog, but the dropdown lists exercise-book sizes
  (e.g. A1 Small, A1, A4) and only exercise books render, so stock can be
  adjusted for exercise books only.

Both flows post the same `stock_adjustments` batch to `POST api/stock`; the
backend already accepts any Book ID and requires no changes.

## Current behavior

- `index.html:279` — `<button class="btn btn-primary" data-action="stock">+ Adjust stock</button>` opens `#dlgStock` (index.html:482-495).
- `js/write.js` `openDialog(name)` maps `data-action` → dialog and calls `populate(name)`.
- `populate("stock")` fills `[data-class]` from `root.viewModels.bookCategories(opts.books)` and calls `renderStockBooks("")`.
- `renderStockBooks(className)` renders `stockOpts.books.filter(b => b.category === className)` as `.book-option` rows with a `[data-qty]` input; empty class shows `Select a class to see its books.`
- `root.viewModels.isExerciseBook(b)` is true when `publisher === "Exercise Book"` (view-models.js:97-99).
- `bookCategories` excludes exercise books (view-models.js:101-109).
- Submit handler (write.js:249-270) collects non-zero integer `[data-qty]` values and posts `{ stock_adjustments: [{ book_id, stock_delta }] }`.

## Requirements

### R1. Inventory toolbar buttons

- Rename the `+ Adjust stock` button to display `+Stock Textbook`. Keep `data-action="stock"`.
- Add a button immediately after it (same `btn btn-primary` style) displaying `+Stock ExBooks` with `data-action="stock-ex"`.

### R2. Modes

- The dialog `#dlgStock` is shared. A mode flag determines content:
  - `"textbook"` (default) — current behavior unchanged.
  - `"exbooks"` — the dropdown lists exercise-book sizes only.
- Mode is set by which button opened the dialog and resets to `"textbook"` after the dialog closes.

### R3. Dropdown contents

- Textbook mode: `root.viewModels.bookCategories(opts.books)` (unchanged).
- ExBooks mode: a new view-model `root.viewModels.exerciseBookCategories(books)` returning sorted distinct categories of books where `isExerciseBook(b)` is true (e.g. A1 Small, A1, A4); empty input → `[]`.

### R4. Rendered rows

- `renderStockBooks(className)` logic is unchanged and reused for both modes: filter `stockOpts.books` by `category === className`. In ExBooks mode the selected category is an exercise-book size, so only exercise books render.
- Empty state prompts:
  - Textbook mode: `Select a class to see its books.` (unchanged)
  - ExBooks mode: `Select an exercise size to see its books.`

### R5. Dialog heading

- Title in `#dlgStock .modal-head h3` switches by mode:
  - Textbook mode: `Adjust stock — Books`
  - ExBooks mode: `Adjust stock — ExBooks`

### R6. Wire contract (unchanged)

- Submit posts `{ stock_adjustments: [{ book_id, stock_delta }] }`; helper copy `Positive adds stock, negative removes. Leave blank or 0 to skip a book.` stays.

## Components

| Component | Change |
|---|---|
| `index.html` | R1 button rename + new button. No dialog markup change needed beyond the mutable heading (resolve at runtime). |
| `js/view-models.js` | Add `exerciseBookCategories(books)` alongside `bookCategories`; export it. |
| `js/write.js` | Mode flag; `populate("stock")` branches on mode for the dropdown + empty-note; heading text set per mode; reset mode on close. Reuses `renderStockBooks` and the submit handler unchanged. |
| `css/app.css` | No change expected (buttons reuse `.btn btn-primary`). |
| `api/_lib.js`, `api/stock.js`, `js/data-access.js`, `js/derive.js` | No change. |

## Error handling

- Submission validation is unchanged: empty/0/fractional/NaN qty values are skipped; empty selection shows `Enter a quantity for at least one book.`; API errors surface via `showError`. In ExBooks mode these behave identically.

## Testing

- `scripts/test.js`: unit tests for `exerciseBookCategories` mirroring `bookCategories` fixtures/tests (sorted distinct exercise categories; empty/null → `[]`; exercise books with no/blank category excluded).
- Scratch E2E harness (`C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs`): two new expected PASS records —
  - `stock-ex: size dropdown lists exercise sizes only` (dropdown options are exercise sizes, not class names)
  - `stock-ex: selecting a size renders those exbooks, posts batch` (rows render, batch post carries rendered book IDs with entered deltas)
  - existing 13 records must still PASS (total 15).
- Gate: `node --check` on edited files; `node scripts/test.js` exit 0 (114 existing + new); E2E 15 passed / 0 failed.

## Out of scope

- No backend/API changes.
- No changes to issue/register flows.
- No price display in the stock rows (matches textbook mode).