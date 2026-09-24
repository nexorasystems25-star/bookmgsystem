# Textbooks vs ExBooks Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the register-student dialog list only classes (with textbook count + fee) and store a separate exercise-book count (`exbooks`) per student and per class.

**Architecture:** Exercise books are identified purely by data (`publisher === "Exercise Book"`), so the Books sheet needs no schema change. `exbooks` is added as a column on the ClassFees sheet (per-class exercise-book count) and on the Students sheet (per-student exercise-book count). View-models count textbooks only and expose `exbooks`; the write path persists it. The committed `data/class-fees.json` snapshot gains `exbooks` so offline/tests stay green while the live ClassFees tab is still missing.

**Tech Stack:** Vanilla JS (UMD modules: `js/derive.js`, `js/view-models.js`, `js/write.js`, `js/data-access.js`), Node.js tests (`scripts/test.js`, no framework, `node scripts/test.js`), Node.js Sheets API write path (`api/_lib.js`), throwaway CDP E2E harness (temp dir, port 8123).

**Repo conventions (MUST follow):** 2-space indent; **NO comments in code**; snake_case wire fields (`books_fee`, `books_total`, `exbooks`); pure functions; UMD wrapper for browser modules. Verify with `node --check <file>` after each edit and `node scripts/test.js` (currently 93 passing).

---

## File structure

- Modify `js/view-models.js` — `isExerciseBook`, textbook-only `bookCategories`/`bookCountForClass`/`classBookInfo`, `exbooks` in `classBookInfo`, new `classOptionLabel` format.
- Modify `js/derive.js` — `normalizeClassFees` reads `exbooks`; `normalizeStudents` reads `exbooks`.
- Modify `api/_lib.js` — `validateStudentPayload` accepts `exbooks`; `runStudent` appends the ExBooks column; `runPayment` column indexes shift.
- Modify `index.html` — add ExBooks input next to Books total.
- Modify `js/write.js` — fill ExBooks on class select; send `exbooks` on register.
- Modify `data/class-fees.json` — add `exbooks` per row per spec table.
- Modify `scripts/test.js` — update 9 existing assertions; add ~7 new tests.
- `scripts/sync.js` — NO change needed (`isClassFees` guard already tolerates the new column).

---

### Task 1: view-models — classify exercise books, count textbooks, expose `exbooks`

**Files:**
- Modify: `js/view-models.js` (functions `isExerciseBook`, `bookCategories`, `bookCountForClass`, `classBookInfo`, `classOptionLabel` at lines 97-143; export list at lines 261-264)
- Test: `scripts/test.js` (add tests after line 686, the `classOptionLabel degrades gracefully` test)

- [ ] **Step 1: Update existing `classBookInfo`/`classOptionLabel` tests to the new shape**

Replace the test bodies at `scripts/test.js:641-674` (`viewModels.classBookInfo picks fee from classFees sheet`, `viewModels.classBookInfo matches fees tolerantly`, `viewModels.classBookInfo fee fallback`, `viewModels.classBookInfo returns zeroed info`) with:

```js
test("viewModels.classBookInfo returns textbook count, fee, and exbooks", () => {
  const books = [
    { category: "KG 1" },
    { category: "KG 1" },
    { category: "BS 2" }
  ];
  const fees = [
    { className: "KG 1", fee: 400, exbooks: 20 },
    { className: "BS 2", fee: 430, exbooks: 15 }
  ];
  assert.deepEqual(vm.classBookInfo(books, "KG 1", fees), { count: 2, fee: 400, exbooks: 20 });
  assert.deepEqual(vm.classBookInfo(books, "BS 2", fees), { count: 1, fee: 430, exbooks: 15 });
});

test("viewModels.classBookInfo matches fees tolerantly (KG1 vs KG 1)", () => {
  const books = [{ category: "KG 1" }, { category: "BS 2" }];
  const fees = [{ className: "KG 1", fee: 400, exbooks: 20 }, { className: "BS 2", fee: 430 }];
  assert.deepEqual(vm.classBookInfo(books, "KG1", fees), { count: 1, fee: 400, exbooks: 20 });
  assert.deepEqual(vm.classBookInfo(books, "bs 2", fees), { count: 1, fee: 430, exbooks: 0 });
});

test("viewModels.classBookInfo fee fallback when no fee row", () => {
  const books = [{ category: "KG 1" }];
  assert.deepEqual(vm.classBookInfo(books, "KG 1", []), { count: 1, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo(books, "KG 1"), { count: 1, fee: 0, exbooks: 0 });
});

test("viewModels.classBookInfo returns zeroed info for unknown/empty", () => {
  const books = [{ category: "KG 1" }];
  const fees = [{ className: "KG 1", fee: 400, exbooks: 20 }];
  assert.deepEqual(vm.classBookInfo(books, "JS 1", fees), { count: 0, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo(books, "", fees), { count: 0, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo([], "KG 1", fees), { count: 0, fee: 0, exbooks: 0 });
});
```

Replace the two `classOptionLabel` tests at `scripts/test.js:676-686` with:

```js
test("viewModels.classOptionLabel renders textbook count and fee inline", () => {
  const books = [{ category: "KG 1" }, { category: "KG 1" }];
  const fees = [{ className: "KG 1", fee: 400 }];
  assert.equal(vm.classOptionLabel("KG 1", books, fees), "KG 1 \u2014 2 textbooks \u2014 400 GHS");
  assert.equal(vm.classOptionLabel("KG 1", [{ category: "KG 1" }], fees), "KG 1 \u2014 1 textbook \u2014 400 GHS");
});

test("viewModels.classOptionLabel degrades gracefully", () => {
  assert.equal(vm.classOptionLabel("BS 9", [], []), "BS 9");
  assert.equal(vm.classOptionLabel("", [], []), "");
});
```

- [ ] **Step 2: Add new classification tests** (append after the `degrades gracefully` test)

```js
test("viewModels.isExerciseBook classifies by publisher", () => {
  assert.equal(vm.isExerciseBook({ publisher: "Exercise Book" }), true);
  assert.equal(vm.isExerciseBook({ publisher: "GES Press" }), false);
  assert.equal(vm.isExerciseBook({}), false);
  assert.equal(vm.isExerciseBook(null), false);
});

test("viewModels.bookCategories excludes exercise-book categories", () => {
  const books = [
    { category: "KG 1", publisher: "GES Press" },
    { category: "BS 2", publisher: "GES Press" },
    { category: "A1 Small", publisher: "Exercise Book" }
  ];
  assert.deepEqual(vm.bookCategories(books), ["BS 2", "KG 1"]);
});

test("viewModels.bookCountForClass counts textbooks only", () => {
  const books = [
    { category: "KG 1", publisher: "GES Press" },
    { category: "KG 1", publisher: "GES Press" },
    { category: "A1 Small", publisher: "Exercise Book" }
  ];
  assert.equal(vm.bookCountForClass(books, "KG 1"), 2);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node scripts/test.js`
Expected: the new tests FAIL — `FAIL viewModels.isExerciseBook classifies by publisher` (and the updated `classBookInfo`/`classOptionLabel` tests FAIL because `isExerciseBook` is not exported yet and the shape changed).

- [ ] **Step 4: Implement the view-models changes**

Edit `js/view-models.js`. Replace the `bookCategories` function (lines 97-104) with:

```js
  function isExerciseBook(book) {
    return String((book && book.publisher) || "").trim() === "Exercise Book";
  }

  function bookCategories(books) {
    const set = {};
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      const c = String(b.category || "").trim();
      if (c) set[c] = true;
    });
    return Object.keys(set).sort();
  }
```

Replace `bookCountForClass` (lines 110-120) with:

```js
  function bookCountForClass(books, className) {
    const target = classKey(className);
    if (!target) return 0;
    const counts = {};
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      const key = classKey(b.category);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts[target] || 0;
  }
```

Replace `classBookInfo` (lines 122-134) with:

```js
  function classBookInfo(books, className, classFees) {
    const target = classKey(className);
    const info = { count: 0, fee: 0, exbooks: 0 };
    if (!target) return info;
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      if (classKey(b.category) !== target) return;
      info.count += 1;
    });
    (classFees || []).forEach(f => {
      if (classKey(f.className) !== target) return;
      info.fee = f.fee;
      info.exbooks = f.exbooks || 0;
    });
    return info;
  }
```

Replace `classOptionLabel` (lines 136-143) with:

```js
  function classOptionLabel(className, books, classFees) {
    const info = classBookInfo(books, className, classFees);
    const label = String(className || "").trim();
    const parts = [];
    if (info.count > 0) parts.push(info.count + (info.count === 1 ? " textbook" : " textbooks"));
    if (info.fee > 0) parts.push(info.fee + " GHS");
    return parts.length ? label + " \u2014 " + parts.join(" \u2014 ") : label;
  }
```

Update the export block (lines 261-264) to include `isExerciseBook`:

```js
    bookCategories,
    bookCountForClass,
    classBookInfo,
    classOptionLabel,
    isExerciseBook
```

- [ ] **Step 5: Lint and run tests**

Run: `node --check js/view-models.js; node scripts/test.js`
Expected: exit 0, all viewModels tests PASS.

- [ ] **Step 6: Commit**

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: classify exercise books and count textbooks per class in view models"
```

---

### Task 2: derive — `normalizeClassFees` and `normalizeStudents` read `exbooks`

**Files:**
- Modify: `js/derive.js` (`normalizeStudents` line 35, `normalizeClassFees` line 84)
- Test: `scripts/test.js`

- [ ] **Step 1: Update `normalizeClassFees` tests and add new derive tests**

Replace the three `normalizeClassFees` test bodies at `scripts/test.js:688-717` with:

```js
test("derive.normalizeClassFees reads class/fee/exbooks columns", () => {
  const rows = [
    { class: "KG 1", fee: "400", exbooks: "20" },
    { class: "BS 2", fee: "430", exbooks: "15" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20 },
    { className: "BS 2", fee: 430, exbooks: 15 }
  ]);
});

test("derive.normalizeClassFees defaults exbooks to zero", () => {
  const rows = [
    { class: "KG 1", fee: "400" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 0 }
  ]);
});

test("derive.normalizeClassFees drops rows with empty fee", () => {
  const rows = [
    { class: "Nursery 1", fee: "" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20 }
  ]);
});

test("derive.normalizeClassFees rejects foreign rows (e.g. student sheet)", () => {
  const rows = [
    { class: "N2", fee: "300", student_id: "S001", name: "Richmond" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20 }
  ]);
});
```

Add a `normalizeStudents` exbooks test right after the `normalizeStudents casts amounts and keeps fields` test (after `scripts/test.js:128`):

```js
test("normalizeStudents reads exbooks column", () => {
  const rows = derive.normalizeStudents([
    { student_id: "CEC-001", name: "Ama Serwaa", class: "KG 1", gender: "F", academic_year: "2026/2027", books_fee: "400", books_paid: "0", books_total: "6", exbooks: "20", status: "not covered" }
  ]);
  assert.equal(rows[0].booksTotal, 6);
  assert.equal(rows[0].exbooks, 20);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test.js`
Expected: the four `normalizeClassFees` tests and the `normalizeStudents reads exbooks column` test FAIL.

- [ ] **Step 3: Implement the derive changes**

Edit `js/derive.js`. In `normalizeStudents` (lines 35-47) add `exbooks` after `booksTotal`:

```js
      booksTotal: num(r.books_total),
      exbooks: num(r.exbooks),
      status: String(r.status || "").toLowerCase().trim()
```

Replace `normalizeClassFees` (lines 84-91) with:

```js
  function normalizeClassFees(rows) {
    return (rows || [])
      .filter(r => r && !r.student_id && !r.name && (r.class || r.className) && (r.fee || r.books_fee))
      .map(r => ({
        className: String(r.class || r.className || "").trim(),
        fee: num(r.fee || r.books_fee),
        exbooks: num(r.exbooks)
      }));
  }
```

- [ ] **Step 4: Lint and run tests**

Run: `node --check js/derive.js; node scripts/test.js`
Expected: exit 0, all derive tests PASS.

- [ ] **Step 5: Commit**

```bash
git add js/derive.js scripts/test.js
git commit -m "feat: read exbooks from ClassFees and Students sheets"
```

---

### Task 3: write path — accept and persist `exbooks` on student registration

**Files:**
- Modify: `api/_lib.js` (`validateStudentPayload` line 68, `runPayment` lines 193/210-211, `runStudent` line 218)
- Test: `scripts/test.js`

- [ ] **Step 1: Add `validateStudentPayload` exbooks tests** (after the `validateStudentPayload rejects bad input` test at `scripts/test.js:232`)

```js
test("validateStudentPayload accepts and forwards exbooks", () => {
  const r = lib.validateStudentPayload({ name: "Ama Serwaa", class: "JS 1", gender: "female", books_fee: "1400", books_total: "10", exbooks: "15" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.exbooks, 15);
});

test("validateStudentPayload defaults exbooks to zero", () => {
  const r = lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "female", books_fee: 1, books_total: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.payload.exbooks, 0);
});

test("validateStudentPayload rejects negative exbooks", () => {
  assert.equal(lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "female", books_fee: 1, books_total: 1, exbooks: -1 }).ok, false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test.js`
Expected: `FAIL validateStudentPayload accepts and forwards exbooks` (payload has no `exbooks` key yet).

- [ ] **Step 3: Implement the write-path changes**

Edit `api/_lib.js`.

Replace `validateStudentPayload` (lines 68-77) with:

```js
function validateStudentPayload(raw) {
  const p = raw || {};
  const fee = Number(p.books_fee);
  const total = Number(p.books_total);
  const exbooks = Number(p.exbooks || 0);
  if (!p.name || !String(p.name).trim()) return { ok: false, error: "name is required" };
  if (!p.class || !String(p.class).trim()) return { ok: false, error: "class is required" };
  if (GENDERS.indexOf(p.gender) === -1) return { ok: false, error: "gender must be male or female" };
  if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return { ok: false, error: "books_fee, books_total and exbooks must be non-negative numbers" };
  return { ok: true, payload: { name: String(p.name).trim(), className: String(p.class).trim(), gender: p.gender, booksFee: fee, booksTotal: total, exbooks: exbooks, academicYear: p.academic_year || "2026/2027" } };
}
```

In `runPayment`:
- Line 193: change the read range `"Students!A:I"` → `"Students!A:J"`.
- Line 211: change the status update target from `colLetter(8)` → `colLetter(9)`: `await client.sheetsUpdate(spreadsheetId, "Students!" + colLetter(9) + found.rowIndex, [[status]]);`
- (`colLetter(6)` on line 210 stays as the books_paid column — it does not move.)

In `runStudent` (lines 223-226), insert the ExBooks column between `booksTotal` and status:

```js
  await client.sheetsAppend(spreadsheetId, "Students", [[
    studentId, payload.name, payload.className, payload.gender, payload.academicYear,
    String(payload.booksFee), "0", String(payload.booksTotal), String(payload.exbooks), "not covered"
  ]]);
```

- [ ] **Step 4: Lint and run tests**

Run: `node --check api/_lib.js; node scripts/test.js`
Expected: exit 0, all tests PASS (93 + new).

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: accept and persist exercise book count on student registration"
```

---

### Task 4: form — add ExBooks field and send it on register

**Files:**
- Modify: `index.html:456`
- Modify: `js/write.js` (`fillClassFields` line 110, submit handler lines 142-165)

- [ ] **Step 1: Add the ExBooks input to the register dialog**

Edit `index.html`. After the Books total line (line 456) add:

```html
        <label>Exercise books<input type="number" data-exbooks min="0" step="1" required></label>
```

- [ ] **Step 2: Update `fillClassFields`**

Edit `js/write.js`. Replace `fillClassFields` (lines 110-114) with:

```js
  function fillClassFields(className) {
    const info = root.viewModels.classBookInfo(studentBooks, className, studentFees);
    dialogs.student.querySelector("[data-total]").value = info.count > 0 ? String(info.count) : "";
    dialogs.student.querySelector("[data-fee]").value = info.fee > 0 ? String(info.fee) : "";
    dialogs.student.querySelector("[data-exbooks]").value = info.exbooks > 0 ? String(info.exbooks) : "";
  }
```

- [ ] **Step 3: Update the register submit handler**

Edit `js/write.js` (lines 142-165). Add the `exbooks` read after `const total = ...`, update validation to include `exbooks`, and add it to the payload:

```js
    const fee = Number(readValue(dlg, "[data-fee]"));
    const total = Number(readValue(dlg, "[data-total]"));
    const exbooks = Number(readValue(dlg, "[data-exbooks]"));
    if (!name) return showError(dlg, "Student name is required.");
    if (!klass) return showError(dlg, "Class is required.");
    if (GENDERS.indexOf(gender) === -1) return showError(dlg, "Select a gender.");
    if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return showError(dlg, "Books fee, total and exercise books must be zero or more.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.registerStudent({ name, class: klass, gender, books_fee: fee, books_total: total, exbooks });
```

- [ ] **Step 4: Lint**

Run: `node --check js/write.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add index.html js/write.js
git commit -m "feat: show exbooks field in register dialog and persist on registration"
```

---

### Task 5: data snapshot — add `exbooks` to `data/class-fees.json`

**Files:**
- Modify: `data/class-fees.json`

- [ ] **Step 1: Rewrite `data/class-fees.json`**

Replace the file contents with the spec table (class | fee | exbooks):

```json
[
  {
    "class": "Creche",
    "fee": "380",
    "exbooks": "0"
  },
  {
    "class": "Nursery 1",
    "fee": "390",
    "exbooks": "20"
  },
  {
    "class": "Nursery 2",
    "fee": "395",
    "exbooks": "20"
  },
  {
    "class": "KG 1",
    "fee": "400",
    "exbooks": "20"
  },
  {
    "class": "KG 2",
    "fee": "410",
    "exbooks": "20"
  },
  {
    "class": "BS 1",
    "fee": "420",
    "exbooks": "15"
  },
  {
    "class": "BS 2",
    "fee": "430",
    "exbooks": "15"
  },
  {
    "class": "BS 3",
    "fee": "440",
    "exbooks": "15"
  },
  {
    "class": "BS 4",
    "fee": "450",
    "exbooks": "15"
  },
  {
    "class": "BS 5",
    "fee": "460",
    "exbooks": "15"
  },
  {
    "class": "BS 6",
    "fee": "470",
    "exbooks": "15"
  }
]
```

- [ ] **Step 2: Verify parsing through the pipeline**

Run: `node -e "const d=require('./js/derive.js');const r=require('./data/class-fees.json');const n=d.normalizeClassFees(r);console.log(JSON.stringify(n[3]), n.length);"`
Expected: `{"className":"KG 1","fee":400,"exbooks":20} 11`

- [ ] **Step 3: Run full unit suite**

Run: `node scripts/test.js`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add data/class-fees.json
git commit -m "feat: add per-class exbooks to class fees snapshot"
```

---

### Task 6: E2E verification — update the throwaway harness and rerun

**Files:**
- Modify: `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs`

- [ ] **Step 1: Add exercise books to the harness fixture**

In `buildFixtures()`, immediately after the `Object.keys(cat).forEach(...)` block (after line 46 `});`), insert:

```js
  const exbookCats = ["A1 Small", "D1 Small", "C Small", "G Small"];
  exbookCats.forEach(category => {
    n++;
    books.push({
      book_id: "B" + String(n).padStart(3, "0"),
      publisher: "Exercise Book",
      subject: category + " Exercise Book",
      category,
      price: "5",
      stock_qty: "50",
      low_stock_threshold: "5"
    });
  });
```

- [ ] **Step 2: Update the class-fees override to include `exbooks` and BS 4**

Replace the `"data/class-fees.json"` override (lines 61-65) with:

```js
  "data/class-fees.json": () => JSON.stringify([
    { class: "KG 1", fee: "400", exbooks: "20" },
    { class: "BS 1", fee: "420", exbooks: "15" },
    { class: "BS 4", fee: "440", exbooks: "15" },
    { class: "BS 6", fee: "470", exbooks: "15" }
  ])
```

- [ ] **Step 3: Update the dropdown label assertion** (lines 189-196)

```js
    const opts = JSON.parse(await waitFor(`(() => { const s = document.querySelector('#dlgStudent [data-class]'); const all = Array.prototype.map.call(s.querySelectorAll('option'), o => o.textContent).filter(Boolean).sort(); return all.length >= 2 ? JSON.stringify({ all }) : ""; })()`, "class dropdown has class categories"));
    const hasKg1 = opts.all.indexOf("KG 1 \u2014 6 textbooks \u2014 400 GHS") !== -1;
    const hasBs4 = opts.all.indexOf("BS 4 \u2014 8 textbooks \u2014 440 GHS") !== -1;
    const hasEx = opts.all.indexOf("A1 Small") !== -1;
    record("register: class dropdown shows textbooks + fee, excludes exercise books",
      hasKg1 && hasBs4 && !hasEx, "options=" + JSON.stringify(opts.all));
```

- [ ] **Step 4: Update the KG 1 auto-fill assertion** (lines 200-208) to also check `data-exbooks`

```js
    const v = JSON.parse(await waitFor(`(() => { const t = document.querySelector('#dlgStudent [data-total]'); const f = document.querySelector('#dlgStudent [data-fee]'); const x = document.querySelector('#dlgStudent [data-exbooks]'); return (t.value === "6" && f.value === "400" && x.value === "20") ? JSON.stringify({ total: t.value, fee: f.value, exbooks: x.value }) : ""; })()`, "selecting KG 1 fills total 6, fee 400, exbooks 20"));
    record("register: selecting 'KG 1' auto-fills total 6, fee 400, exbooks 20",
      v.total === "6" && v.fee === "400" && v.exbooks === "20", "total=" + v.total + " fee=" + v.fee + " exbooks=" + v.exbooks);
```

- [ ] **Step 5: Replace the BS 1 auto-fill assertion with BS 4 incl. exbooks** (lines 214-225)

```js
  try {
    await evaluate(`(async()=>{
      var c = document.querySelector('#dlgStudent [data-class]');
      c.value = 'BS 4';
      c.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const v = JSON.parse(await waitFor(`(() => { const t = document.querySelector('#dlgStudent [data-total]'); const f = document.querySelector('#dlgStudent [data-fee]'); const x = document.querySelector('#dlgStudent [data-exbooks]'); return (t.value === "8" && f.value === "440" && x.value === "15") ? JSON.stringify({ total: t.value, fee: f.value, exbooks: x.value }) : ""; })()`, "BS 4 fills total 8, fee 440, exbooks 15"));
    record("register: selecting 'BS 4' auto-fills total 8, fee 440, exbooks 15",
      v.total === "8" && v.fee === "440" && v.exbooks === "15", "total=" + v.total + " fee=" + v.fee + " exbooks=" + v.exbooks);
  } catch (e) {
    record("register: BS 4 auto-fill", false, "ERROR " + e.message);
  }
```

- [ ] **Step 6: Update the reset assertion** (lines 236-238) to include `data-exbooks`

```js
    const still = JSON.parse(await evaluate(`JSON.stringify({ total: document.querySelector('#dlgStudent [data-total]').value, fee: document.querySelector('#dlgStudent [data-fee]').value, exbooks: document.querySelector('#dlgStudent [data-exbooks]').value })`));
    record("register: clearing selection resets total, fee, and exbooks",
      still.total === "" && still.fee === "" && still.exbooks === "", JSON.stringify(still));
```

- [ ] **Step 7: Run the harness**

Run: `node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs`
**Run sequentially; do NOT run in parallel with another instance (EADDRINUSE on :8123).**
Expected: `5 passed, 0 failed`, including `register: class dropdown shows textbooks + fee, excludes exercise books`.

If the port is busy, wait ~5s and rerun.

- [ ] **Step 8: Full regression**

Run: `node scripts/test.js`
Expected: all PASS (100 total after this feature).

---

### Task 7: final commit + push

- [ ] **Step 1: Verify the working tree only holds the new plan file + spec (already committed)**

Run: `git status --short`
Expected: only the untracked leftover `docs/superpowers/plans/2026-09-23-stage-5a-year-bell-search.md` (do NOT commit) plus nothing else uncommitted from this feature.

- [ ] **Step 2: Push to origin to trigger Vercel rebuild**

```bash
git push origin master
```

Expected: `master -> master` succeeds. Vercel auto-deploys. (The throwaway harness in the temp dir is not part of the repo.)

- [ ] **Step 3: User spreadsheet actions (out of scope for code)**

Ask the user to add:
- `ExBooks` column on the Students sheet immediately after `books_total`.
- `exbooks` column on the ClassFees sheet (`class | fee | exbooks`) with the spec values, then run `node scripts/sync.js`.

---

## Self-review notes

- Spec coverage: classification (Task 1), ClassFees exbooks (Tasks 2+5), Students ExBooks column (Task 3), form field + label (Task 4), write path (Task 3), E2E assertions incl. `BS 4 → 8 textbooks — 440 GHS` + exbooks 15 (Task 6). All spec sections mapped.
- No placeholders: every step includes concrete code or exact command + expected output.
- Type consistency: `exbooks` is a JS `number` everywhere after `num()`/`Number(...)`/`String(...)` at the wire edge; `classBookInfo` returns `{ count, fee, exbooks }`; `normalizeClassFees` returns `{ className, fee, exbooks }`.
- Column-index check: Students columns become `A student_id, B name, C class, D gender, E academic_year, F books_fee, G books_paid, H books_total, I ExBooks, J status`. Only the `status` write in `runPayment` shifts (I→J); `books_paid` (G) is unaffected. The `sheetsAppend` template already targets `A1:J1`, which fits the 10-column row.