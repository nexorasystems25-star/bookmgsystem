# Payment new-student registration mode design

**Date:** 2026-09-28
**Extends:** `docs/superpowers/specs/2026-09-28-new-student-payment-design.md`

## Problem

The Record payment dialog's *New student* section always shows Books fee, Books total
and Exercise books together and posts all three. Not every new student buys both
textbook and exercise books — some buy only textbooks and some only exercise books.
Without a mode hint, the storekeeper could leave a quantity at its auto-filled value
and the student ends up registered for a package they did not buy.

## Decision (approved: A — chip-row, mirroring Register student)

Reuse the same Textbooks / ExBooks / Both chip-row that the **Register student**
dialog already has (`applyStudentMode`, `js/write.js`) inside the payment dialog's
*New student* section. Choosing a mode shows only the relevant fields; quantities that
do not apply are posted as `0`.

## Scope

- The chip-row exists **only** inside `[data-new-section]`, which is visible only
  while the hidden student select is `NEW`.
- Payments for existing students are unchanged: amount + method only. Their
  registration quantities are already on file and must not be altered by a payment.

## UI (`index.html`)

Inside `[data-new-section]`, above "Full name":

- A chip-row `data-new-modes` with three buttons:
  `<button type="button" data-mode="textbook">Textbooks</button>`,
  `<button type="button" data-mode="exbooks">ExBooks</button>`,
  `<button type="button" data-mode="both">Both</button>`.
- Default mode is **Both** (matches Register student).
- Field labels reuse the existing mode-toggle convention:
  - "Books fee" and "Books total" labels get `data-new-mode-show="both,textbook"`.
  - "Exercise books" label gets `data-new-mode-show="both,exbooks"`.
- No `required` attributes on the new-student fields (inline errors remain the
  feedback path).

## Behaviour (`js/write.js`)

- New independent state `newStudentMode`, default `"both"`. It is independent of
  `studentMode` (which belongs to `dlgStudent`). Reset to `"both"` whenever the
  new-student section is reset: `resetNewStudent` on `populate("payment")`, on
  `dlgPayment` close, and when "＋ Add new student" is committed.
- `applyNewStudentMode(dlg)` mirrors `applyStudentMode` (js/write.js:307):
  - Hides/shows each `[data-new-mode-show]` label and **clears** the value of a
    hidden field so the UI never shows stale quantities.
  - Swaps the class select's option source: `bookCategories` for Textbook / Both,
    `exerciseBookCategories` for ExBooks (so the storekeeper picks an exercise-book
    size, not a textbook class).
  - Toggles chip active styling (`btn-primary` / `btn-light`).
  - Updates the section header to read `New student — Textbooks` / `— ExBooks` /
    plain `New student` for parity with Register student.
- Autofill (`refreshNewStudentTotals`) fills only the visible fields.
- On submit, the three quantities pass through the existing
  `root.viewModels.purchasePayload(mode, { fee, total, exbooks })`
  (js/view-models.js:393) so a hidden quantity is posted as **0**:
  - Textbooks → `exbooks: 0`
  - ExBooks → `books_fee: 0, books_total: 0`
  - Both → all three as filled/auto-filled.
- Validation is unchanged: name/class required, gender in `GENDERS`, quantities
  non-negative.

## Server

No change. `validateStudentPayload` already accepts zero quantities. The Book
collection panel's Mode column is derived at render time from the stored
`books_total` / `exbooks` (`registrationMode`, js/view-models.js:301), so a
Textbooks-only student correctly shows Mode **Textbooks** with no extra data.

## Testing

- Existing tests stay green, including the "both" combined-payload submit test (the
  default mode posts all three auto-filled quantities unchanged).
- New tests:
  1. Submitting the payment with mode **Textbooks** and a visible class/quantity
     posts `new_student.exbooks === 0`.
  2. Submitting with mode **ExBooks** posts `new_student.books_fee === 0` and
     `new_student.books_total === 0`.
  3. `index.html` ships the `data-new-modes` chip-row with `data-mode` chips and
     `data-new-mode-show` toggles in `dlgPayment`, with no `required` on the
     new-student fields.

## Out of scope

- No change to the Register student dialog (`dlgStudent`).
- No server-side contract change.