# Book Collection Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Ready students" table on the Issue Books page with a "Book collection" panel listing, per student who has collected books, what they collected (all types + quantities) and what is still owed given the amount paid and registration mode.

**Architecture:** Pure view-model functions (`issuedBooks`, `studentCollection`) parse the activity log and compute `{ mode, collected, remaining }`; `renderIssuing` in app.js consumes them to render the panel. Registration mode is derived from `books_total` / `exbooks` columns (approved). Textbook gate keeps the existing paid/price/class/stock check and ignores `books_total` (approved).

**Tech Stack:** Vanilla JS (no framework), Node 5.1 runner `scripts/test.js` (sync tests only — `test()` does NOT await async fns), Google-Sheet-backed data model.

---

### Task 1: `issuedBooks` — sum per-book quantities from the activity log

**Spec ref:** Data layer, `issuedBooks`.

**Files:**
- Modify: `js/view-models.js` — insert `issuedBooks` after `issueEligibleExBooks` (after line 180); add `issuedBooks,` to the exports object (near line 350).
- Test: `scripts/test.js` — add 2 tests after the `viewModels.issueEligibleExBooks matches abbreviated Nursery class labels (N1)` test (after line 819).

- [ ] **Step 1: Write the failing tests**

Insert this after line 819 in `scripts/test.js`:

```js
test("viewModels.issuedBooks sums xN quantities across issue entries", () => {
  const activity = [
    { type: "issue", description: "Books issued to Abena Mensah [B001,B075x5,B076x3]" },
    { type: "issue", description: "Books issued to Abena Mensah [B075x2]" },
    { type: "payment", description: "Books issued to Abena Mensah [B999]" },
    { type: "issue", description: "Books issued to Kwabena Yaw [B003x4]" }
  ];
  assert.deepEqual(vm.issuedBooks(activity, { name: "Abena Mensah" }), { B001: 1, B075: 7, B076: 3 });
  assert.deepEqual(vm.issuedBooks(activity, { name: "Kwabena Yaw" }), { B003: 4 });
  assert.deepEqual(vm.issuedBooks(activity, { name: "No One" }), {});
  assert.deepEqual(vm.issuedBooks([], { name: "Abena Mensah" }), {});
});

test("viewModels.issuedBooks matches student name case-insensitively", () => {
  const activity = [{ type: "issue", description: "Books issued to ABENA MENSAH [B001x2]" }];
  assert.deepEqual(vm.issuedBooks(activity, { name: "abena mensah" }), { B001: 2 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test.js`
Expected: 2 × `FAIL viewModels.issuedBooks …` with `vm.issuedBooks is not a function`; suite exit code 1; pass count stays 133.

- [ ] **Step 3: Implement `issuedBooks`**

In `js/view-models.js`, insert after `issueEligibleExBooks` (the closing `  }` at line 180, immediately before `function classBookInfo`):

```js
  function issuedBooks(activity, student) {
    const name = String((student && student.name) || "").trim().toLowerCase();
    const out = {};
    (activity || []).forEach(a => {
      if (String((a && a.type) || "").trim() !== "issue") return;
      const m = String((a && a.description) || "").match(/^Books issued to (.+?)\s*\[([^\]]*)\]$/i);
      if (!m) return;
      if (String(m[1]).trim().toLowerCase() !== name) return;
      String(m[2]).split(",").forEach(part => {
        const token = part.trim();
        if (!token) return;
        const x = token.match(/^(.+?)x(\d+)$/);
        const id = x ? x[1] : token;
        const qty = x ? Number(x[2]) : 1;
        if (!id) return;
        out[id] = (out[id] || 0) + qty;
      });
    });
    return out;
  }
```

Add `issuedBooks,` to the exports object (current block `issuedBookIds,` / `issueEligibleBooks,` / `issueEligibleExBooks,` / `purchasePayload`):

```js
    issuedBookIds,
    issuedBooks,
    issueEligibleBooks,
    issueEligibleExBooks,
    studentCollection,
    purchasePayload
```

(`studentCollection` is added in Task 2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: 2 × `PASS viewModels.issuedBooks …`; final line `135 tests passed`; exit code 0.

- [ ] **Step 5: Syntax check and commit**

Run: `node --check js/view-models.js`
Expected: no output, exit code 0.

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: view models - issuedBooks maps per-student issued quantities"
```

---

### Task 2: `studentCollection` — mode, collected, remaining

**Spec ref:** Data layer, `studentCollection` (decisions 1–5).

**Files:**
- Modify: `js/view-models.js` — insert `registrationMode` + `studentCollection` after `issuedBooks`; export `studentCollection,`.
- Test: `scripts/test.js` — add 6 tests after the `issuedBooks` tests added in Task 1.

- [ ] **Step 1: Write the failing tests**

Insert these 6 tests immediately after the `issuedBooks matches student name case-insensitively` test:

```js
test("viewModels.studentCollection derives mode from books_total and exbooks columns", () => {
  const student = { studentId: "S1", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 0 };
  assert.equal(vm.studentCollection(student, [], [], []).mode, "Textbooks");
  student.booksTotal = 0; student.exbooks = 20;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "ExBooks");
  student.booksTotal = 6;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "Both");
  student.booksTotal = 0; student.exbooks = 0;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "None");
});

test("viewModels.studentCollection collected resolves textbook and exbook items with qty", () => {
  const books = [
    { bookId: "B001", subject: "Literacy", category: "KG 1", publisher: "GES", price: 55, stockQty: 5 },
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", price: 2.5, stockQty: 12 },
    { bookId: "B999", subject: "Gone", category: "KG 1", publisher: "GES", price: 10, stockQty: 5 },
    { bookId: "B079", subject: "Writing Exercise Book C", category: "C Small", publisher: "Exercise Book", price: 2.5, stockQty: 10 }
  ];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 20 };
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B001x1,B075x5,B999x2]" }];
  const got = vm.studentCollection(student, books, [], activity);
  assert.deepEqual(got.collected.map(x => ({ id: x.book.bookId, qty: x.qty, kind: x.kind })), [
    { id: "B001", qty: 1, kind: "textbook" },
    { id: "B075", qty: 5, kind: "exbook" }
  ]);
});

test("viewModels.studentCollection remaining keeps paid-gated class textbooks not yet collected", () => {
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 120, booksTotal: 6, exbooks: 0 };
  const books = [
    { bookId: "B1", subject: "Literacy", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" },
    { bookId: "B2", subject: "Numeracy", category: "KG 1", price: 220, stockQty: 5, publisher: "GES" },
    { bookId: "B3", subject: "Colouring", category: "KG 1", price: 70, stockQty: 0, publisher: "GES" },
    { bookId: "B4", subject: "Science", category: "KG 2", price: 60, stockQty: 5, publisher: "GES" },
    { bookId: "B5", subject: "Drawing", category: "KG 1", price: 60, stockQty: 5, publisher: "Exercise Book" }
  ];
  const got = vm.studentCollection(student, books, [], []);
  assert.deepEqual(got.remaining.map(x => x.book.bookId), ["B1"]);
});

test("viewModels.studentCollection remaining excludes textbooks already collected", () => {
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 0 };
  const books = [
    { bookId: "B1", subject: "Literacy", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" },
    { bookId: "B6", subject: "Creative Arts", category: "KG 1", price: 60, stockQty: 5, publisher: "GES" }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B1]" }];
  const got = vm.studentCollection(student, books, [], activity);
  assert.deepEqual(got.remaining.map(x => x.book.bookId), ["B6"]);
});

test("viewModels.studentCollection remaining subtracts collected exbook quantities per size", () => {
  const classFees = [{ className: "KG 1", fee: 400, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5 } }];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 0, booksTotal: 0, exbooks: 10 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 12 }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B075x2]" }];
  const got = vm.studentCollection(student, books, classFees, activity);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, stockShort: x.stockShort })), [
    { id: "B075", qty: 3, stockShort: false },
    { id: "B078", qty: 5, stockShort: false }
  ]);
});

test("viewModels.studentCollection remaining drops full sizes and flags stock short", () => {
  const classFees = [{ className: "KG 1", fee: 400, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5, "C Small": 5 } }];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 0, booksTotal: 0, exbooks: 15 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 3 },
    { bookId: "B077", subject: "Writing Exercise Book C", category: "C Small", publisher: "Exercise Book", stockQty: 12 }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B075x5,B078x1]" }];
  const got = vm.studentCollection(student, books, classFees, activity);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, stockShort: x.stockShort })), [
    { id: "B078", qty: 4, stockShort: true },
    { id: "B077", qty: 5, stockShort: false }
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test.js`
Expected: 6 × `FAIL viewModels.studentCollection …` with `vm.studentCollection is not a function`; suite exit code 1; pass count stays 135.

- [ ] **Step 3: Implement `registrationMode` + `studentCollection`**

In `js/view-models.js`, insert directly after the `issuedBooks` function added in Task 1:

```js
  function registrationMode(student) {
    const hasTextbooks = Number((student && student.booksTotal) || 0) > 0;
    const hasExbooks = Number((student && student.exbooks) || 0) > 0;
    if (hasTextbooks && hasExbooks) return "Both";
    if (hasTextbooks) return "Textbooks";
    if (hasExbooks) return "ExBooks";
    return "None";
  }

  function studentCollection(student, books, classFees, activity) {
    const mode = registrationMode(student);
    const paid = Number((student && student.booksPaid) || 0);
    const target = classKey(student && student.className);
    const issued = issuedBooks(activity, student);
    const catalog = {};
    (books || []).forEach(b => { catalog[b.bookId] = b; });

    const collected = Object.keys(issued).map(id => {
      const book = catalog[id];
      if (!book) return null;
      return { book: book, qty: issued[id], kind: isExerciseBook(book) ? "exbook" : "textbook" };
    }).filter(Boolean);

    const remaining = [];
    if (mode === "Textbooks" || mode === "Both") {
      (books || []).forEach(b => {
        if (isExerciseBook(b)) return;
        if (classKey(b.category) !== target) return;
        if (!(Number(b.price) > 0) || Number(b.price) > paid) return;
        if (!(Number(b.stockQty) > 0)) return;
        if (issued[b.bookId]) return;
        remaining.push({ book: b, qty: 1, kind: "textbook" });
      });
    }
    if ((mode === "ExBooks" || mode === "Both") && target) {
      const feesRow = (classFees || []).find(f => classKey(f.className) === target);
      if (feesRow && feesRow.sizes) {
        Object.keys(feesRow.sizes).forEach(sizeName => {
          const sizeQty = Number(feesRow.sizes[sizeName] || 0);
          if (!(sizeQty > 0)) return;
          const book = (books || []).find(b => isExerciseBook(b) && classKey(b.category) === classKey(sizeName));
          if (!book) return;
          const got = Number(issued[book.bookId] || 0);
          const qty = sizeQty - got;
          if (qty <= 0) return;
          const stock = Number(book.stockQty) || 0;
          remaining.push({ book: book, qty: qty, kind: "exbook", stockShort: stock < qty });
        });
      }
    }

    return { mode: mode, collected: collected, remaining: remaining };
  }
```

(`studentCollection` export was already added in Task 1's Step 3.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: 6 × `PASS viewModels.studentCollection …`; final line `141 tests passed`; exit code 0.

- [ ] **Step 5: Syntax check and commit**

Run: `node --check js/view-models.js`
Expected: no output, exit code 0.

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: view models - studentCollection summarizes collected vs remaining by mode"
```

---

### Task 3: UI — Book collection panel

**Spec ref:** UI section.

**Files:**
- Modify: `index.html:324-333` — replace the "Ready students" panel.
- Modify: `js/app.js:399-425` — `renderIssuing` no longer touches `issueStudentsBody`; builds `collectionBody` rows.

- [ ] **Step 1: Replace the panel markup**

In `index.html`, replace lines 324–333 (the `Ready students` `<section class="panel">…</section>`) with:

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

- [ ] **Step 2: Rewrite the table renderer**

In `js/app.js`, replace lines 405–413 (the `const ready = ...` block through the `: emptyRow(3, ...)` line) with:

```js
    const collectionRows = data.students
      .map(s => Object.assign({ student: s }, CEC.viewModels.studentCollection(s, data.books, data.classFees, data.activity)))
      .filter(r => r.collected.length > 0);
    document.getElementById("collectionBody").innerHTML = collectionRows.length
      ? collectionRows.map(r => `
        <tr>
          <td><b>${esc(r.student.name)}</b><small>${esc(r.student.studentId)}</small></td>
          <td>${esc(r.mode)}</td>
          <td>${formatCollected(r.collected)}</td>
          <td>${r.remaining.length ? formatCollected(r.remaining) : '<span class="pill success">All collected</span>'}</td>
        </tr>`).join("")
      : emptyRow(4, "No books collected yet.");
```

- [ ] **Step 3: Add the `formatCollected` helper**

In `js/app.js`, add this helper just above `renderIssuing` (before line 399):

```js
  function formatCollected(items) {
    const groups = [];
    const tx = items.filter(i => i.kind === "textbook").map(i => esc(i.book.subject) + " ×" + i.qty);
    if (tx.length) groups.push("<b>Textbooks:</b> " + tx.join(", "));
    const ex = items.filter(i => i.kind === "exbook")
      .map(i => esc(i.book.category) + " ×" + i.qty + (i.stockShort ? ' <span class="pill warn">out of stock</span>' : ""));
    if (ex.length) groups.push("<b>ExBooks:</b> " + ex.join(", "));
    return groups.join(" · ");
  }
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/app.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Run the full suite**

Run: `node scripts/test.js`
Expected: final line `141 tests passed`; exit code 0.

- [ ] **Step 6: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: issuing page - book collection panel shows collected vs left to add"
```

---

## Self-Review

**Spec coverage:**
- `issuedBooks` (qty-preserving parse, case-insensitive, accumulate) → Task 1. ✔
- `studentCollection` mode from columns (Textbooks/ExBooks/Both/None) → Task 2 test 1. ✔
- collected resolves textbook + exbook with qty, skips unknown ids → Task 2 test 2. ✔
- remaining textbooks: paid/price/class/stock gate, excludes collected, `books_total` ignored → Task 2 tests 3–4; implementation matches `issueEligibleBooks` gates. ✔
- remaining: **class package minus issued** (resolved 2026-09-28, superseding the paid-budget model of 2026-09-27 and the "omit out-of-stock" rule): every class textbook (`price > 0`, not yet collected) and every exbook size line (`sizeQty − collectedQty > 0`) is owed, regardless of the paid budget (school issues first, pays later — a student issued more than they paid, e.g. S009/S019 on the BS 1 sheet, still sees missing textbooks); stock never hides an owed item — a shortage flags `stockShort` (`out of stock` pill) instead; issuing is gated only by "has paid anything" (`booksPaid > 0`) plus stock (the whole-type budget gates in `issueEligibleExBooks`/`runIssue` and the `price <= paid` filter in `issueEligibleBooks` were removed 2026-09-28) → Task 2 tests 5–7 (rewritten) + implementation; regression pinned by the real-sheet Nursery 2 test (S001/S002) and the real BS 1 test (S009 issued 445 worth while paid 250 — still sees Computing book 30), never "All collected" while owed. Plus 2026-09-28: runIssue zero-paid rejection, "paid 8 gets the 12.5 exbook" issue test, and combobox gashes below. ✔
- Panel lists only students with ≥1 collected book; "All collected" pill; `(out of stock)` tag; empty state → Task 3. ✔
- Metric cards + Stock availability unchanged → Task 3 only touches the one panel and its renderer. ✔

**Placeholder scan:** No TBD/TODO; every step carries exact code, paths, and expected output. ✔

**Type consistency:** `issuedBooks(activity, student)` → `{bookId:qty}`; `studentCollection(student, books, classFees, activity)` → `{mode, collected:[{book, qty, kind(, stockShort)}], remaining:[...]}`; UI consumes `r.student`, `r.mode`, `r.collected`, `r.remaining`. `stockShort` only on exbook remaining items. Column class is `collectionBody` everywhere. ✔