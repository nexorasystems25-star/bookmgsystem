# New-student payment design

**Date:** 2026-09-28

## Problem

A new student (no existing row in the Students ledger) cannot have their first books
payment recorded because the Record payment dialog requires an existing `student_id`.
Operators must register the student first, then pay — two separate writes, a second
dialog trip, and a two-step flow that can be interrupted.

## Approach (approved: A)

Extend `/api/payment` into a single combined write that registers the student **and**
records the payment in one request. The client signals this by sending
`student_id: "NEW"` plus a `new_student` object carrying the registration fields.

## Wire contract

```
POST /api/payment
{
  student_id: "NEW",
  amount: 100,
  method: "Cash",
  new_student: {
    name: "Kojo Amoah",
    class: "KG 1",            // raw key the client posts; server canonicalizes to className
    gender: "male",
    books_fee: 200,
    books_total: 6,
    exbooks: 20
    // academic_year is optional and server-defaulted, so the client omits it
  }
}
```

Without `new_student` the payload is exactly today's payment contract, unchanged.
Note the client sends `class`, not `className` — the server's `validateStudentPayload`
reads `p.class` and re-emits the canonical result as `className`.

## Server behaviour (`api/_lib.js`)

1. `validatePaymentPayload`:
   - If `new_student` is present: require `student_id === "NEW"`; validate the nested
     object with the same rules as `validateStudentPayload` (name/class required,
     gender in `GENDERS`, fee/total/exbooks non-negative); return a canonical
     `newStudent` object.
   - Reject `student_id === "NEW"` when `new_student` is absent.
   - Existing fields (amount, method, date) validated as today.
2. `runPayment` new branch:
   - Allocate the next `S` id with `nextId(students, "S")`.
   - `newPaid = amount`, `status = recomputeStatus(newPaid, fee)`.
   - Append one **Students** row: `[id, name, className, gender, academicYear,
     fee, amount, total, exbooks, status]` (paid column = this amount).
   - Run the **same** shared Payments + Activity appends as the existing path
     (payments row carries the new id + name; activity wording `Payment received
     from <name>` etc.). No `Students!F/G` update is needed — the row was just written.
   - Returns `{ ok, row: { payment_id, student_id (the real new id), amount, status } }`.

## Client behaviour

1. `dlgPayment` gains a hidden **New student** section: Full name, Class, Gender, plus
   hidden `books_fee`/`books_total`/`exbooks` inputs auto-filled (read-only) from the
   chosen class via `classBookInfo` — the amount entered is the `books_paid`.
2. Payment-dialog combobox (only) renders a `＋ Add new student` option whenever the
   query matches nothing (Issue dialog keeps `No students match.`). Selecting it:
   - sets the hidden student select to `NEW`,
   - reveals and focuses the New student section,
   - auto-fills the class/fee/total/exbooks defaults.
3. Payment submit, when `student_id === "NEW"`:
   - validates name/class/gender inline (mirrors the Register dialog rules),
   - normalises fee/total/exbooks through the existing `purchasePayload("both", …)`,
   - sends the combined payload and toasts `Student registered and payment recorded.`
4. The section and hidden select are reset whenever the payment dialog opens or closes.

## Acceptance criteria

- [ ] A new student can be paid in one dialog interaction and one POST.
- [ ] Existing student payment behaviour, payload, and tests are unchanged.
- [ ] Issue dialog combobox behaviour is unchanged.
- [ ] Server validates `new_student` with the same rules as student registration.
- [ ] `NEW` with no `new_student` is rejected; `new_student` against an existing id is rejected.
- [ ] Full suite green (`node scripts/test.js`).