# Students outstanding fee basis - implementation plan

**Related spec:** 2026-09-24-students-outstanding-fee-basis-design
**Date:** 2026-09-24
**Note:** Plan docs stay untracked per house rule; only the spec is committed.

## Problem

`studentOutstanding` and `buildKpis` compute `booksTotal - booksPaid`. In the real
sheet, `books_total` is a book COUNT (8, 10), while `books_fee` is the billed fee
(1200, 1400). So balances compute to 0, the Students table renders the literal
text "Paid" in Outstanding, and the Dashboard metric is wrong.

## Design (from spec)

`outstanding = max(0, (booksFee || booksTotal || 0) - (booksPaid || 0))`

Status column keeps readiness words. No renderer/index.html changes.

## Tasks

1. **RED - view-models** (`scripts/test.js`): add
   - `vm.studentOutstanding({ booksFee: 1200, booksTotal: 8, booksPaid: 800 })` => 400
   - `vm.studentOutstanding({ booksFee: 1200, booksPaid: 1400 })` => 0
   - `vm.studentOutstanding({ booksFee: 0, booksTotal: 700, booksPaid: 500 })` => 200 (fallback)
2. **RED - derive** (`scripts/test.js`): add a buildKpis test over one
   `normalizeStudents` row `{ books_fee: "1200", books_paid: "800", books_total: "8" }`
   expecting outstandingCount 1 and outstandingAmount 400.
3. Run `npm test`: expect exactly 2 new FAILs (RED), 121 PASS unchanged.
4. **GREEN**:
   - `js/view-models.js:82-84` `studentOutstanding` -> booksFee-first basis.
   - `js/derive.js:117-124` `buildKpis` balance -> booksFee-first basis.
5. Run `npm test`: expect 123 PASS, exit 0.

## Gate

- `npm test` green before any commit.
- Commit spec first (`docs: ...`), then code (`feat: ...`).
- No push without explicit user instruction.