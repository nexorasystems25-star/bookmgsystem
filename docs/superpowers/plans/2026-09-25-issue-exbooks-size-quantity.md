# Issue ExBooks per-Size Quantity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Issue books modal so a student registered for ExBooks can tick one line per exercise-book size (required count per student from ClassFees `sizes`), issue the full count, and record the quantity in the activity log (`[B075x5]`).

**Architecture:** Bottom-up TDD across three layers. `derive.js` exposes per-size counts (`normalizeClassFees` gains a `sizes` map). `view-models.js` gains `issueEligibleExBooks(books, student, activity, classFees)` (gated on `student.exbooks > 0`, class-fees size values, matching exercise-book category by tolerant `classKey`, stock >= required count, and not already issued) and `issuedBookIds` strips the new `x<qty>` log suffix. The API extends `validateIssuePayload` to accept a mixed `books` array (plain ids + `{book_id, qty}` objects) normalized to canonical `{book_id, qty}` objects and rejects duplicate ids; `runIssue` logs `id` (qty 1) or `id x<qty>` (qty > 1). `write.js` renders the two group sections (Textbooks / ExBooks) and submits one mixed payload.

**Tech Stack:** Vanilla JS (browser + Node), Google Sheets API via `api/_lib.js`, Node assert-based test runner (`npm test` = `node scripts/test.js`).

**Base state:** 123 tests passing (commit `7686e3e`). Every commit after a task keeps the full suite green.

**Contract change to remember across files:**
- Issue `books` payload entries are either plain book-id strings (`"B001"`, qty 1) or `{ book_id, qty }` objects (qty validated as integer >= 1).
- Canonical normalized array: `[{ book_id, qty }, ...]`.
- Activity log token: `B001` (qty 1) or `B075x5` (qty > 1), comma-joined inside `[ ]`.
- `issuedBookIds` strips a trailing `x\d+` from each token.

---

### Task 1: `normalizeClassFees` gains a `sizes` map (derive.js)

**Files:**
- Modify: `js/derive.js:85-93`
- Test: `scripts/test.js:914-953`

Goal: each normalized ClassFees row carries `sizes: { "A1 Small": 5, "D1 Small": 5, ... }` built from the seven size columns, in fixed column order, only for positive values.

- [ ] **Step 1: Update the four existing `normalizeClassFees` tests to include `sizes: {}` and add a sizes-reading test**

Replace the whole block at `scripts/test.js:914-953` (four `test("derive.normalizeClassFees ...")` calls) with:

```js
test("derive.normalizeClassFees reads class/fee/exbooks columns", () => {
  const rows = [
    { class: "KG 1", fee: "400", exbooks: "20" },
    { class: "BS 2", fee: "430", exbooks: "15" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} },
    { className: "BS 2", fee: 430, exbooks: 15, sizes: {} }
  ]);
});

test("derive.normalizeClassFees defaults exbooks to zero", () => {
  const rows = [
    { class: "KG 1", fee: "400" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 0, sizes: {} }
  ]);
});

test("derive.normalizeClassFees drops rows with empty fee", () => {
  const rows = [
    { class: "Nursery 1", fee: "" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} }
  ]);
});

test("derive.normalizeClassFees rejects foreign rows (e.g. student sheet)", () => {
  const rows = [
    { class: "N2", fee: "300", student_id: "S001", name: "Richmond" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} }
  ]);
});

test("derive.normalizeClassFees reads per-size exercise counts into sizes", () => {
  const rows = [
    { class: "Nursery 1", fee: "300", exbooks: "10", "A1 Small": "5", "D1 Small": "5" },
    { class: "BS 1", fee: "450", exbooks: "15", "Exercise Book": "15" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5, "D1 Small": 5 } },
    { className: "BS 1", fee: 450, exbooks: 15, sizes: { "Exercise Book": 15 } }
  ]);
});

test("derive.normalizeClassFees ignores non-positive size cells", () => {
  const rows = [
    { class: "Nursery 1", fee: "300", exbooks: "10", "A1 Small": "0", "D1 Small": "-2", "C Small": "3" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "C Small": 3 } }
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the four updated tests show `sizes` missing / shape mismatch on the deep-equal assertions; the two new tests fail against the current implementation. Other tests still pass.

- [ ] **Step 3: Implement the `sizes` map in `js/derive.js`**

Add the size-column constant directly above `normalizeClassFees` (insert after line 83):

```js
  var CLASS_FEE_SIZE_COLUMNS = ["A1 Small", "D1 Small", "C Small", "G Small", "A1 Big", "D1 Big", "Exercise Book"];
```

Replace the whole `normalizeClassFees` function (currently lines 85-93) with:

```js
  function normalizeClassFees(rows) {
    return (rows || [])
      .filter(r => r && !r.student_id && !r.name && (r.class || r.className) && (r.fee || r.books_fee))
      .map(r => {
        const sizes = {};
        CLASS_FEE_SIZE_COLUMNS.forEach(col => {
          const v = num(r[col]);
          if (v > 0) sizes[col] = v;
        });
        return {
          className: String(r.class || r.className || "").trim(),
          fee: num(r.fee || r.books_fee),
          exbooks: num(r.exbooks),
          sizes: sizes
        };
      });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — **124 tests** (123 + the new sizes test).

- [ ] **Step 5: Commit**

```bash
git add js/derive.js scripts/test.js
git commit -m "feat: class fees - expose per-size exercise counts on normalizeClassFees"
```

---

### Task 2: `issuedBookIds` strips quantity suffixes; `issueEligibleExBooks` in view-models.js

**Files:**
- Modify: `js/view-models.js:127-155`, `js/view-models.js:306-328`
- Test: `scripts/test.js` (after line 732, near the `issueEligibleBooks` tests)

Goal: parse the new `x<qty>` activity tokens back to plain ids, and add the ExBooks eligibility model gating on `exbooks > 0`.

- [ ] **Step 1: Write the failing tests**

Insert these three tests immediately after the `viewModels.issueEligibleBooks returns empty for missing class or zero paid` test (which ends at `scripts/test.js:732`):

```js
test("viewModels.issuedBookIds strips quantity suffixes from tokens", () => {
  const activity = [
    { type: "issue", description: "Books issued to Abena Mensah [B001,B075x5,B076x3]" },
    { type: "issue", description: "Books issued to Abena Mensah [B077x2]" },
    { type: "payment", description: "Books issued to Abena Mensah [B999]" },
    { type: "issue", description: "Books issued to Kwabena Yaw [B003x4]" }
  ];
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Abena Mensah" }), ["B001", "B075", "B076", "B077"]);
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Kwabena Yaw" }), ["B003"]);
});

test("viewModels.issueEligibleExBooks returns per-size issues with qty and stock", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5, "D1 Small": 5 } }];
  const student = { studentId: "S1", name: "Ama", className: "Nursery 1", exbooks: 10 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 4, price: 2.5 },
    { bookId: "B001", subject: "Math", category: "Nursery 1", publisher: "GES", stockQty: 20, price: 300 }
  ];
  const got = vm.issueEligibleExBooks(books, student, [], classFees);
  assert.deepEqual(got.map(x => ({ id: x.book.bookId, qty: x.qty, stock: x.stock })), [{ id: "B075", qty: 5, stock: 12 }]);
});

test("viewModels.issueEligibleExBooks requires exbooks>0, class match, and hides issued books", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5 } }];
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book", category: "A1 Small", publisher: "Exercise Book", stockQty: 12 },
    { bookId: "B076", subject: "Writing Exercise Book", category: "D1 Small", publisher: "Exercise Book", stockQty: 12 }
  ];
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "Nursery 1", exbooks: 0 }, [], classFees), []);
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "BS 2", exbooks: 10 }, [], classFees), []);
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "Nursery 1", exbooks: 10 }, [], []), []);
  const activity = [{ type: "issue", description: "Books issued to Ama [B075x5]" }];
  assert.deepEqual(vm.issueEligibleExBooks(books, { name: "Ama", className: "Nursery 1", exbooks: 10 }, activity, classFees), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `vm.issuedBookIds` returns the literal `"B075x5"` tokens instead of stripped ids, and `vm.issueEligibleExBooks` is undefined (`TypeError`). Existing tests still pass.

- [ ] **Step 3: Implement the token strip and `issueEligibleExBooks`**

In `js/view-models.js`, change the token split loop inside `issuedBookIds` (lines 135-138) from:

```js
      String(m[2]).split(",").forEach(part => {
        const id = part.trim();
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
```

to:

```js
      String(m[2]).split(",").forEach(part => {
        const id = part.trim().replace(/x\d+$/, "");
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
```

Insert the new function directly after `issueEligibleBooks` (after line 155):

```js
  function issueEligibleExBooks(books, student, activity, classFees) {
    if (!student || !(Number(student.exbooks) > 0)) return [];
    const target = classKey(student.className);
    if (!target) return [];
    const feesRow = (classFees || []).find(f => classKey(f.className) === target);
    if (!feesRow || !feesRow.sizes) return [];
    const issued = issuedBookIds(activity, student);
    const out = [];
    Object.keys(feesRow.sizes).forEach(sizeName => {
      const qty = feesRow.sizes[sizeName];
      if (!(qty > 0)) return;
      const book = (books || []).find(b => isExerciseBook(b) && classKey(b.category) === classKey(sizeName));
      if (!book) return;
      if (issued.indexOf(book.bookId) !== -1) return;
      const stock = Number(book.stockQty) || 0;
      if (stock < qty) return;
      out.push({ book: book, qty: qty, stock: stock });
    });
    return out;
  }
```

Add `issueEligibleExBooks` to the module exports (between `issueEligibleBooks` and `purchasePayload` — currently lines 326-327):

```js
    issuedBookIds,
    issueEligibleBooks,
    issueEligibleExBooks,
    purchasePayload
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — **127 tests** (124 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: issue exbooks per-size eligibility model and quantity-aware log parsing"
```

---

### Task 3: `validateIssuePayload` accepts mixed `books` arrays with per-item quantities

**Files:**
- Modify: `api/_lib.js:80-93`
- Test: `scripts/test.js:274-280`, `scripts/test.js` (new tests after line 280)

Goal: the array branch accepts plain id strings and `{book_id, qty}` objects, normalizes to canonical `{book_id, qty}` objects, skips blanks, rejects duplicates (both forms), and rejects bad quantities.

- [ ] **Step 1: Update the existing array test and add failing tests for the new contract**

Replace the existing `test("validateIssuePayload accepts a books array and rejects empty/bad ones", ...)` block (lines 274-280) with:

```js
test("validateIssuePayload accepts a books array and rejects empty/bad ones", () => {
  assert.deepEqual(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "B002"] }).payload, { student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B002", qty: 1 }] });
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: "B001" }).ok, false);
  assert.equal(lib.validateIssuePayload({ books: ["B001"] }).ok, false);
});

test("validateIssuePayload accepts mixed books arrays with per-item quantities", () => {
  assert.deepEqual(
    lib.validateIssuePayload({ student_id: "S001", books: ["B001", { book_id: "B075", qty: 5 }] }).payload,
    { student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B075", qty: 5 }] }
  );
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: 0 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: 1.5 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: -3 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ qty: 5 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["  ", "B001"] }).payload.books[0].book_id, "B001");
});

test("validateIssuePayload rejects duplicate book ids in a books array", () => {
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "B001"] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["B001", { book_id: "B001", qty: 2 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B001", qty: 2 }] }).ok, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — the updated first test deep-equality mismatches (payload still `["B001","B002"]`); the new mixed/duplicate tests fail against the current array branch. Single-form tests (`book_id`/`qty`) still pass.

- [ ] **Step 3: Implement the mixed-array branch in `api/_lib.js`**

Replace the current array branch inside `validateIssuePayload` (lines 83-88):

```js
  if (Array.isArray(p.books)) {
    const books = p.books.map(String).map(s => s.trim()).filter(Boolean);
    if (!books.length) return { ok: false, error: "books must contain at least one book_id" };
    const uniq = books.filter((b, i) => books.indexOf(b) === i);
    return { ok: true, payload: { student_id: p.student_id, books: uniq } };
  }
```

with:

```js
  if (Array.isArray(p.books)) {
    const books = [];
    const seen = {};
    for (const it of p.books) {
      if (it != null && typeof it === "object") {
        const bookId = String(it.book_id || "").trim();
        const qty = it.qty;
        if (!bookId) return { ok: false, error: "book_id is required in books" };
        if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "qty must be a positive integer for " + bookId };
        if (seen[bookId]) return { ok: false, error: "duplicate book_id: " + bookId };
        seen[bookId] = true;
        books.push({ book_id: bookId, qty: qty });
      } else {
        const bookId = String(it || "").trim();
        if (!bookId) continue;
        if (seen[bookId]) return { ok: false, error: "duplicate book_id: " + bookId };
        seen[bookId] = true;
        books.push({ book_id: bookId, qty: 1 });
      }
    }
    if (!books.length) return { ok: false, error: "books must contain at least one book_id" };
    return { ok: true, payload: { student_id: p.student_id, books: books } };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — **129 tests** (127 + 2 new). Confirm the single-form branch tests (`validateIssuePayload accepts valid input...`, test.js:267-272, and the snake_case contract test at test.js:311) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: issue api - accept per-item quantities in books array"
```

---

### Task 4: `runIssue` logs and returns per-item quantities

**Files:**
- Modify: `api/_lib.js:262-264`, `api/_lib.js:279`
- Test: `scripts/test.js` (new test after line 529)

Goal: `runIssue` uses the canonical `{book_id, qty}` objects directly, validates each quantity against stock, and writes the activity token as `id` (qty 1) or `idx<qty>` (qty > 1).

- [ ] **Step 1: Write the failing test**

Insert after the `runIssue rejects when stock would go negative` test (ends at `scripts/test.js:539`):

```js
test("runIssue applies per-item quantities from a mixed books array", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","40","10"],
      ["B075","Exercise Book","A1 Small","A1 Small","2.5","12","5"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001", { book_id: "B075", qty: 5 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [{ book_id: "B001", stock_qty: 39 }, { book_id: "B075", stock_qty: 7 }]);
  const activityRow = client.calls[client.calls.length - 1].rows[0];
  assert.match(activityRow[2], /Books issued to Abena Mensah \[B001,B075x5\]/);
});

test("runIssue rejects per-item quantity when stock is insufficient (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B075","Exercise Book","A1 Small","A1 Small","2.5","3","5"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: [{ book_id: "B075", qty: 5 }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient stock for A1 Small/);
  assert.equal(client.calls.length, 0, "no writes happened");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — with the current `requests` mapping (`payload.books.map(bookId => ({book_id: bookId, qty: 1}))`), the object entry becomes `{ book_id: {book_id:"B075",qty:5}, qty: 1 }`, causing `findRowIndex` for the object id to miss and return `book_id not found: [object Object]`; the activity token is still `[B001,B075]` without `x5`.

- [ ] **Step 3: Implement the quantity-aware `runIssue`**

In `api/_lib.js`, replace the `requests` construction (lines 262-264):

```js
  const requests = payload.books
    ? payload.books.map(bookId => ({ book_id: bookId, qty: 1 }))
    : [{ book_id: payload.book_id, qty: payload.qty }];
```

with:

```js
  const requests = payload.books
    ? payload.books
    : [{ book_id: payload.book_id, qty: payload.qty }];
```

Replace the `issuedIds` construction (line 279):

```js
  const issuedIds = resolved.map(x => x.bookRow[0]).join(",");
```

with:

```js
  const issuedIds = resolved.map(x => (x.qty > 1 ? x.bookRow[0] + "x" + x.qty : x.bookRow[0])).join(",");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — **131 tests** (129 + 2). The existing `runIssue` tests (lines 515-529, 531-539, 655-670) still pass: single `{book_id, qty}` form produces token `B003x2` (only the `/Books issued to Abena Mensah/` match is asserted), and the plain-array form still maps to qty 1.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: issue api - apply per-item quantities and log xN activity tokens"
```

---

### Task 5: CSS for the two group headings

**Files:**
- Modify: `css/app.css:96` (insert after the `.book-list input.qty` rule)

Goal: style the "Textbooks" / "ExBooks" group headings inside the issue book list.

- [ ] **Step 1: Add the style rule**

Insert after line 96 (the `.book-list input.qty { ... }` rule); the list already ends with `border-bottom` on `.book-list label.book-option:last-child`, which a following `<h4>` would inherit, so the heading is set to `border-bottom: 0`:

```css
.book-list .book-group-head { margin: 10px 0 2px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #33475e; border-bottom: 0; }
```

- [ ] **Step 2: Verify**

Run: `node --check js/write.js` (confirms write.js still parses; CSS has no lint step in this repo). Visually confirm the rule sits inside the `.book-list` block group after line 96.

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "feat: issue modal - style ExBooks group headings"
```

---

### Task 6: `renderIssueBooks` two-group render + mixed submit payload (write.js)

**Files:**
- Modify: `js/write.js:132-150` (`renderIssueBooks`)
- Modify: `js/write.js:281-284` (submit book collection)
- Modify: `js/write.js:288` (submit payload)

Goal: the issue modal lists Textbooks (existing `data-book-check` checkboxes) and ExBooks (new `data-exbook-check` checkboxes carrying `data-qty`), and the submit handler sends one mixed `books` payload of strings + `{book_id, qty}` objects.

Note: there is no browser/DOM test harness for `write.js`; verification is via `node --check` plus the full API/view-model suite. Manual UI check instructions are included in the final step.

- [ ] **Step 1: Replace `renderIssueBooks`**

Replace the whole function (lines 132-150):

```js
  function renderIssueBooks(studentId) {
    const box = dialogs.issue.querySelector("[data-books]");
    if (!box || !issueOpts) return;
    const student = (issueOpts.students || []).find(s => s.studentId === studentId);
    if (!student) {
      box.innerHTML = '<p class="empty-note">Select a student to see their available books.</p>';
      return;
    }
    const textbooks = root.viewModels.issueEligibleBooks(issueOpts.books, student, issueOpts.activity);
    const exbooks = root.viewModels.issueEligibleExBooks(issueOpts.books, student, issueOpts.activity, issueOpts.classFees);
    if (!textbooks.length && !exbooks.length) {
      box.innerHTML = '<p class="empty-note">No books available for ' + esc(student.name) + " right now.</p>";
      return;
    }
    const parts = [];
    if (textbooks.length) {
      parts.push('<h4 class="book-group-head">Textbooks</h4>');
      textbooks.forEach(b => {
        parts.push(
          '<label class="book-option"><input type="checkbox" data-book-check value="' + esc(b.bookId) + '">' +
          '<span class="book-name">' + esc(b.subject) + "<small>" + esc(b.publisher) + " · stock " + b.stockQty + "</small></span>" +
          '<span class="price">GH₵' + Number(b.price) + "</span></label>"
        );
      });
    }
    if (exbooks.length) {
      parts.push('<h4 class="book-group-head">ExBooks</h4>');
      exbooks.forEach(x => {
        parts.push(
          '<label class="book-option"><input type="checkbox" data-exbook-check value="' + esc(x.book.bookId) + '" data-qty="' + x.qty + '">' +
          '<span class="book-name">' + esc(x.book.subject) + " (" + esc(x.book.category) + ") · need " + x.qty + " · stock " + x.stock + "</small></span>" +
          '<span class="price">×' + x.qty + "</span></label>"
        );
      });
    }
    box.innerHTML = parts.join("");
  }
```

- [ ] **Step 2: Replace the submit book collection and payload**

Replace the book-collection lines (281-282):

```js
    const books = Array.prototype.slice.call(dlg.querySelectorAll("[data-book-check]:checked"))
      .map(cb => cb.value);
```

with:

```js
    const textbookIds = Array.prototype.slice.call(dlg.querySelectorAll("[data-book-check]:checked"))
      .map(cb => cb.value);
    const exbooks = Array.prototype.slice.call(dlg.querySelectorAll("[data-exbook-check]:checked"))
      .map(cb => ({ book_id: cb.value, qty: Number(cb.dataset.qty) }));
    const books = textbookIds.concat(exbooks);
```

The guards directly below (`if (!studentId) return showError(dlg, "Select a student.");` at line 283 and `if (!books.length) return showError(dlg, "Tick at least one book to issue.");` at line 284) and the payload `await root.write.issueBooks({ student_id: studentId, books });` (line 288) are unchanged — `array.concat` accepts mixed strings + objects.

- [ ] **Step 3: Verify**

Run: `node --check js/write.js`
Expected: no syntax errors.
Run: `npm test`
Expected: PASS — **131 tests** (no regression).

- [ ] **Step 4: Manual UI verification (browser)**

Serve the folder (e.g. `python -m http.server 8000` or open `index.html`), then for a student with `exbooks > 0` whose ClassFees row has sizes and whose exercise-book rows have stock >= the required count:
1. Open Issue books → the modal shows a **Textbooks** group and an **ExBooks** group.
2. Each ExBooks line reads e.g. `Writing Exercise Book (A1 Small) · need 5 · stock 12` with a `×5` price tag and a tickable checkbox.
3. Tick it and submit → activity log shows `Books issued to <Name> [B075x5]` and Books stock for that row drops by 5.
4. Reopen the modal → that size is no longer listed for the student (already issued).
5. For a student with `exbooks = 0` → no ExBooks group at all; Textbooks behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add js/write.js
git commit -m "feat: issue modal - render ExBooks per-size lines with quantity and send mixed payload"
```

---

### Task 7: Data-side follow-up (no code)

These are user actions, documented for the operator, not code tasks.

- [ ] **Step 1: Add the `exbooks` column to the live Students sheet** at column 9 (I), between `books_total` (H) and `status` (J), header spelled exactly `exbooks` (lowercase) so `normalizeStudents` reads `num(r.exbooks)`. Fill existing students' expected exbooks counts.
- [ ] **Step 2: Set exercise-book stock** for the seven size rows (A1 Small, D1 Small, C Small, G Small, A1 Big, D1 Big, Exercise Book) via the stock dialog's "ExBooks" mode so `issueEligibleExBooks` lines appear once stock >= the required per-size count.

---

## Self-Review

**Spec coverage:**
- normalizeClassFees `sizes` map → Task 1 ✓
- `issueEligibleExBooks` gated on `exbooks > 0`, class-fees sizes, category match via tolerant `classKey`, stock >= qty, excludes already-issued → Task 2 ✓
- `issuedBookIds` strips `xN` suffix (backward compatible with old plain-id logs) → Task 2 ✓
- `validateIssuePayload` mixed array + canonical `{book_id, qty}` + duplicate rejection → Task 3 ✓
- `runIssue` uses canonical requests per quantity, activity token `id` vs `idx<qty>`, insufficient-stock rejection per line → Task 4 ✓
- `renderIssueBooks` two-group render + `data-exbook-check` + `data-qty` + mixed submit payload → Tasks 5, 6 ✓
- Students sheet data step + exercise stock step (out of code scope) → Task 7 ✓

**Placeholder scan:** no TBD/TODO; every code step has full replacement text and exact line anchors; every test has concrete inputs/expected outputs.

**Type consistency:** `issueEligibleExBooks` returns `{ book, qty, stock }`, consumed as `x.book.bookId / x.qty / x.stock` in write.js and asserted as `{ id, qty, stock }` in tests. `validateIssuePayload` array output is `{book_id, qty}` objects consumed directly by `runIssue` requests. `normalizeClassFees` rows gain `sizes` and existing consumers (`classBookInfo`, `classOptionLabel`, `fillClassFields`) read only `className/fee/exbooks` — unaffected. Live ClassFees has a duplicate `exbooks` header; reading `r.exbooks` yields the value from both columns, identical, so no behavior change.