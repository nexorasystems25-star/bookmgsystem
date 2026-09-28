# Payment New-Student Registration Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Textbooks / ExBooks / Both chip-row to the `Record payment` dialog's *New student* section so a new student is registered with only the quantity they actually buy.

**Architecture:** Mirror the already-shipped Register-student mode logic in `js/write.js` (`applyStudentMode` + `purchasePayload`). A new `newStudentMode` state (default `"both"`) drives which fields are visible/cleared and zeroes hidden quantities via the existing `root.viewModels.purchasePayload` before POST. The server and `validateNewStudentPayload` are unchanged — hidden quantities arrive as `0` and fail no validation.

**Tech Stack:** Vanilla JS (browser IIFE in `js/write.js`), static HTML, node-based test harness (`scripts/test.js`), no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-payment-new-student-mode-design.md`

---

## File Structure

- `index.html` — `#dlgPayment`'s `[data-new-section]`: add `<h4 data-new-heading>`, a `[data-new-modes]` chip-row, and `data-new-mode-show` attributes on the fee/total/exbooks labels.
- `js/write.js` — new `newStudentMode` state; `applyNewStudentMode()` mirroring `applyStudentMode` (builds the class select from `bookCategories` or `exerciseBookCategories`, retitles the heading, toggles `[data-new-mode-show]` rows and chip styling); mode-gated `refreshNewStudentTotals`; mode reset in `resetNewStudent`/`commitAddNewStudent`; submit routes NEW quantities through `purchasePayload`.
- `scripts/test.js` — `loadWrite` gains a `paymentModeChips` seed; new submit tests for Textbooks and ExBooks zeroing; the index.html NEW-student test gains chip/toggle/heading assertions.

---

### Task 1: index.html markup for the mode chip-row

**Files:**
- Modify: `index.html:446-458` (the `[data-new-section]` block inside `#dlgPayment`)

- [ ] **Step 1: Write the failing test** — extend the existing index.html NEW-student test at `scripts/test.js:1396`.

Add these assertions inside the existing `index.html ships a NEW-student section inside #dlgPayment` test (after line 1405):

```js
  for (const m of ["textbook", "exbooks", "both"]) {
    assert.ok(section.indexOf('data-mode="' + m + '"') !== -1, "chip-row offers a " + m + " mode");
  }
  assert.ok(section.indexOf("data-new-modes") !== -1, "the new-student section ships a mode chip-row");
  assert.ok(section.indexOf("data-new-mode-show=\"both,textbook\"") !== -1, "fee/total labels show for Both+Textbooks");
  assert.ok(section.indexOf("data-new-mode-show=\"both,exbooks\"") !== -1, "exercise-books label shows for Both+ExBooks");
  assert.ok(section.indexOf("data-new-heading") !== -1, "the section heading is mode-tagged");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test.js`
Expected: the extended test fails (`data-mode="textbook"` not found).

- [ ] **Step 3: Implement the markup**

In `index.html`, replace lines 446-458:

```html
        <div class="new-student" data-new-section hidden>
          <h4 data-new-heading>New student</h4>
          <div class="chip-row" data-new-modes>
            <button type="button" class="btn btn-light" data-mode="textbook">Textbooks</button>
            <button type="button" class="btn btn-light" data-mode="exbooks">ExBooks</button>
            <button type="button" class="btn btn-primary" data-mode="both">Both</button>
          </div>
          <label>Full name<input type="text" data-new-name placeholder="Enter the student's full name" autocomplete="off"></label>
          <label>Class<select data-new-class><option value="">Select class…</option></select></label>
          <label>Gender<select data-new-gender>
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select></label>
          <label data-new-mode-show="both,textbook">Books fee (GHS)<input type="number" data-new-fee min="0" step="0.01"></label>
          <label data-new-mode-show="both,textbook">Books total<input type="number" data-new-total min="0" step="1"></label>
          <label data-new-mode-show="both,exbooks">Exercise books<input type="number" data-new-exbooks min="0" step="1"></label>
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(payment): ship Textbooks/ExBooks/Both chips in the NEW-student section"
```

---

### Task 2: Test harness seed + mode-aware submit zeroing

**Files:**
- Modify: `scripts/test.js` (seed support in `loadWrite` ~line 1249; two new submit tests after `submitting dlgPayment with a NEW student missing a name...` at line 1394)
- Modify: `js/write.js:131` (state), `js/write.js:343-349` area (chip wiring), `js/write.js:365-376` (submit)

- [ ] **Step 1: Write the failing tests** — add `paymentModeChips` seeding to `loadWrite`.

In `scripts/test.js`, inside `loadWrite`, after the `closeButtons` block (~line 1249) and before the `new Function(...)` eval, insert:

```js
  if (opts.paymentModeChips) {
    doc.getElementById("dlgPayment").children["[data-new-modes] [data-mode]"] = opts.paymentModeChips;
  }
```

Then add two tests after line 1394:

```js
test("submitting dlgPayment in Textbooks mode posts exbooks: 0", async () => {
  const chip = stubEl("textbook chip");
  chip.dataset.mode = "textbook";
  const { doc, fetchCalls } = loadWrite({ paymentModeChips: [chip] });
  const form = doc.ids.dlgPayment;
  chip.listeners.find(l => l.type === "click").fn();
  const set = (sel, value) => { form.querySelector(sel).value = value; };
  set("[data-student]", "NEW");
  set("[data-amount]", "100");
  set("[data-method]", "Cash");
  set("[data-new-name]", "Kojo Amoah");
  set("[data-new-class]", "KG 1");
  set("[data-new-gender]", "male");
  set("[data-new-fee]", "1200");
  set("[data-new-total]", "8");
  set("[data-new-exbooks]", "2");
  const handler = form.listeners.filter(l => l.type === "submit").map(l => l.fn).pop();
  await handler({ preventDefault() {}, currentTarget: form });
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.equal(body.new_student.exbooks, 0, "Textbooks mode zeroes exercise books");
  assert.equal(body.new_student.books_total, 8, "textbook total is untouched");
  assert.equal(body.new_student.books_fee, 1200, "textbook fee is untouched");
});

test("submitting dlgPayment in ExBooks mode posts books_fee 0 and books_total 0", async () => {
  const chip = stubEl("exbooks chip");
  chip.dataset.mode = "exbooks";
  const { doc, fetchCalls } = loadWrite({ paymentModeChips: [chip] });
  const form = doc.ids.dlgPayment;
  chip.listeners.find(l => l.type === "click").fn();
  const set = (sel, value) => { form.querySelector(sel).value = value; };
  set("[data-student]", "NEW");
  set("[data-amount]", "100");
  set("[data-method]", "Cash");
  set("[data-new-name]", "Kojo Amoah");
  set("[data-new-class]", "Small");
  set("[data-new-gender]", "male");
  set("[data-new-fee]", "1200");
  set("[data-new-total]", "8");
  set("[data-new-exbooks]", "2");
  const handler = form.listeners.filter(l => l.type === "submit").map(l => l.fn).pop();
  await handler({ preventDefault() {}, currentTarget: form });
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.equal(body.new_student.books_fee, 0, "ExBooks mode zeroes the textbooks fee");
  assert.equal(body.new_student.books_total, 0, "ExBooks mode zeroes the textbooks total");
  assert.equal(body.new_student.exbooks, 2, "exercise books are untouched");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node scripts/test.js`
Expected: both new tests FAIL (the chip stub has no click listener yet → `find(...).fn()` throws).

- [ ] **Step 3: Implement the state + chip wiring + submit zeroing**

In `js/write.js`:

After line 131 (`let studentMode = "both";`) add:

```js
  let newStudentMode = "both";
```

After the `[data-new-class]` change listener (line 353), add:

```js
  dialogs.payment.querySelectorAll("[data-new-modes] [data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      newStudentMode = btn.dataset.mode === "textbook" || btn.dataset.mode === "exbooks" ? btn.dataset.mode : "both";
    });
  });
```

In the payment submit handler, replace lines 365-376:

```js
    if (studentId === "NEW") {
      const checked = validateNewStudentPayload({
        name: readValue(dlg, "[data-new-name]"),
        class: readValue(dlg, "[data-new-class]"),
        gender: readValue(dlg, "[data-new-gender]"),
        books_fee: readValue(dlg, "[data-new-fee]"),
        books_total: readValue(dlg, "[data-new-total]"),
        exbooks: readValue(dlg, "[data-new-exbooks]")
      });
      if (!checked.ok) return showError(dlg, checked.error);
      const q = root.viewModels.purchasePayload(newStudentMode, {
        fee: checked.payload.books_fee, total: checked.payload.books_total, exbooks: checked.payload.exbooks
      });
      payload.new_student = {
        name: checked.payload.name, class: checked.payload.class, gender: checked.payload.gender,
        books_fee: q.fee, books_total: q.total, exbooks: q.exbooks
      };
    }
```

The default mode is `"both"`, so the existing "combined NEW payload" test (posts all three as entered) still passes unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: the two new tests PASS; total count rises (baseline was 233 in the last run).

- [ ] **Step 5: Run syntax check on the module**

Run: `node --check js/write.js`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add js/write.js scripts/test.js
git commit -m "feat(payment): zero hidden quantities when registering a textbook-only or exbooks-only new student"
```

---

### Task 3: Full mode UI (class-select swap, heading, row visibility, resets)

**Files:**
- Modify: `js/write.js` (`applyNewStudentMode` after `applyStudentMode` line 330; chip handler at ~line 353; `populate` `payment` branch lines 212-216; `refreshNewStudentTotals` lines 471-478; `commitAddNewStudent` lines 487-500; `resetNewStudent` lines 502-507)

- [ ] **Step 1: Write the failing test** — add after the ExBooks submit test (Task 2):

```js
test("clicking an ExBooks chip applies the size class select and mode heading", () => {
  const chip = stubEl("exbooks chip");
  chip.dataset.mode = "exbooks";
  const { doc } = loadWrite({ paymentModeChips: [chip] });
  chip.listeners.find(l => l.type === "click").fn();
  const classSel = doc.ids.dlgPayment.querySelector("[data-new-class]");
  assert.ok(classSel.innerHTML.indexOf("Select size") !== -1, "the new-class select lists exercise sizes in ExBooks mode");
  assert.equal(doc.ids.dlgPayment.querySelector("[data-new-heading]").textContent, "New student — ExBooks");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/test.js`
Expected: FAIL — the Task 2 chip handler only flips `newStudentMode`; `classSel.innerHTML` still records `""` and the heading stub text is empty.

- [ ] **Step 3: Implement `applyNewStudentMode` and wire it in**

In `js/write.js`, insert `applyNewStudentMode` right after `applyStudentMode` (ends line 330):

```js
  function applyNewStudentMode() {
    const ex = newStudentMode === "exbooks";
    const txt = newStudentMode === "textbook";
    const classSel = dialogs.payment.querySelector("[data-new-class]");
    const cats = root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](studentBooks);
    classSel.innerHTML = '<option value="">' + (ex ? "Select size…" : "Select class…") + "</option>" + cats
      .map(c => '<option value="' + esc(c) + '">' + esc(root.viewModels.classOptionLabel(c, studentBooks, studentFees)) + "</option>")
      .join("");
    const heading = dialogs.payment.querySelector("[data-new-heading]");
    if (heading) heading.textContent = ex ? "New student — ExBooks" : txt ? "New student — Textbooks" : "New student";
    dialogs.payment.querySelectorAll("[data-new-mode-show]").forEach(row => {
      const show = row.dataset.modeShow.split(",").indexOf(newStudentMode) !== -1;
      row.hidden = !show;
      row.style.display = show ? "" : "none";
    });
    dialogs.payment.querySelectorAll("[data-new-modes] [data-mode]").forEach(btn => {
      const active = btn.dataset.mode === newStudentMode;
      btn.classList.toggle("btn-primary", active);
      btn.classList.toggle("btn-light", !active);
    });
    return classSel;
  }
```

Replace the Task 2 chip handler (the three-line `forEach` added before the `[data-new-class]` listener region) with:

```js
  dialogs.payment.querySelectorAll("[data-new-modes] [data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      newStudentMode = btn.dataset.mode === "textbook" || btn.dataset.mode === "exbooks" ? btn.dataset.mode : "both";
      applyNewStudentMode();
      refreshNewStudentTotals(dialogs.payment);
    });
  });
```

Delete lines 212-216 (the inline `newClassSel` `bookCategories` build). `resetNewStudent` (called right after, at line 218) is now the single place that rebuilds a coherent "both" select each time the dialog opens.

Replace `refreshNewStudentTotals` (lines 471-478) with a mode-gated version:

```js
  function refreshNewStudentTotals(dlg) {
    if (!dlg.querySelector("[data-new-section]")) return;
    const info = root.viewModels.classBookInfo(studentBooks, readValue(dlg, "[data-new-class]"), studentFees);
    const field = (sel, val) => { const el = dlg.querySelector(sel); if (el) el.value = val; };
    const show = modeShow => modeShow.split(",").indexOf(newStudentMode) !== -1;
    field("[data-new-total]", show("both,textbook") && info.count > 0 ? String(info.count) : "");
    field("[data-new-fee]", show("both,textbook") && info.fee > 0 ? String(info.fee) : "");
    field("[data-new-exbooks]", show("both,exbooks") && info.exbooks > 0 ? String(info.exbooks) : "");
  }
```

In `resetNewStudent` (lines 502-507), make it the single "reset to a coherent Both UI" point so populate and dialog-close both converge on the same state:

```js
  function resetNewStudent(dlg) {
    const hidden = dlg.querySelector("[data-student]");
    if (hidden) hidden.value = "";
    newStudentMode = "both";
    applyNewStudentMode();
    hideNewStudent(dlg);
    refreshNewStudentTotals(dlg);
  }
```

In `commitAddNewStudent` (lines 487-500), before `section.hidden = false;` add:

```js
    newStudentMode = "both";
    applyNewStudentMode();
    refreshNewStudentTotals(dlg);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: the new mode-UI test PASSES and the full suite is green.

- [ ] **Step 5: Run syntax check**

Run: `node --check js/write.js`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add js/write.js scripts/test.js
git commit -m "feat(payment): apply Textbooks/ExBooks/Both mode UI to the NEW-student section"
```

---

### Task 4: Full verification + plan/spec of record

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-payment-new-student-mode-design.md` (mark as implemented, if the spec uses that convention)

- [ ] **Step 1: Run the entire suite**

Run: `node scripts/test.js`
Expected: all tests pass (233 + new ones).

- [ ] **Step 2: Syntax-check both edited JS modules**

Run: `node --check js/write.js`
Expected: exit 0.

- [ ] **Step 3: Review the diff**

Run: `git --no-pager diff --stat`
Expected: only `index.html`, `js/write.js`, `scripts/test.js` (and this plan/spec) changed.

- [ ] **Step 4: Commit this plan and any remaining docs**

```bash
git add docs/superpowers/plans/2026-09-28-payment-new-student-mode.md docs/superpowers/specs/2026-09-28-payment-new-student-mode-design.md
git commit -m "docs: plan and spec of record for payment new-student registration mode"
```