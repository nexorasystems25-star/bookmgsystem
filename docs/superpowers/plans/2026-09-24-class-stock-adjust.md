# Class-Based Adjust Stock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Adjust stock dialog to lead with a Class field, show that class's textbooks each with a per-book quantity box, and apply all non-zero quantities as one batch `POST api/stock`.

**Architecture:** Client reuses the issue-dialog pattern (class dropdown → filtered book list) but with a numeric qty per row instead of checkboxes. The API gains a batch path on the existing endpoint: `validateStockPayload` accepts `stock_adjustments: [{book_id, stock_delta}]` (legacy single-book shape stays), and `runStock` resolves every entry before writing any cell, then writes stock and one Activity row per adjustment. `api/stock.js`, `js/data-access.js`, and `js/view-models.js` are unchanged.

**Tech Stack:** Vanilla JS/HTML/CSS (no build step), Node unit tests (`scripts/test.js`, `node:test`), throwaway CDP E2E harness in the OS temp dir.

**Repo conventions:** 2-space indent; NO code comments; snake_case wire fields; gate = `node --check` each edited file then `cmd /c "node scripts/test.js > <log> 2>&1"` verifying exit 0 and full output.

---

## File Structure

- Modify: `api/_lib.js` — `validateStockPayload` (~95-101) gains batch path; `runStock` (~277-294) gains batch mode.
- Modify: `scripts/test.js` — new `validateStockPayload` batch tests after line 278; extend client-contract test at 280-289; new `runStock` batch tests after line 533.
- Modify: `index.html` — `dlgStock` (482-495): replace Book select + Adjustment input with Class select + `[data-stock-list]`.
- Modify: `css/app.css` — add `.book-list input.qty` style after line 95.
- Modify: `js/write.js` — `populate("stock")` (106-111), add `renderStockBooks` + change listener + rewritten stock submit (223-241), add `stockOpts` module var.
- Modify (scratch, outside repo): `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs` — 4 new stock scenarios + `api/stock` override.
- Unchanged: `api/stock.js` (shape-agnostic, passes `req.body` straight through), `js/data-access.js`, `js/view-models.js`.

Wire: batch payload entries are `{ book_id, stock_delta }` (client-side); after validation they become `{ book_id, stockDelta }` matching the existing legacy path. No spreadsheet/env/data changes.

---

### Task 1: API — validateStockPayload accepts a batch

**Files:**
- Modify: `scripts/test.js`
- Modify: `api/_lib.js:95-101`

- [ ] **Step 1: Add the failing batch tests**

Insert after line 278 (after the existing `validateStockPayload` test) in `scripts/test.js`:

```js
test("validateStockPayload accepts a stock_adjustments batch array", () => {
  assert.deepEqual(lib.validateStockPayload({
    stock_adjustments: [{ book_id: "B001", stock_delta: 10 }, { book_id: "B002", stock_delta: -5 }]
  }).payload, {
    stock_adjustments: [{ book_id: "B001", stockDelta: 10 }, { book_id: "B002", stockDelta: -5 }]
  });
});

test("validateStockPayload rejects bad batch entries", () => {
  assert.equal(lib.validateStockPayload({ stock_adjustments: [] }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ stock_delta: 10 }] }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 0 }] }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 1.5 }] }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 5 }, { book_id: "B001", stock_delta: 5 }] }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: "B001" }).ok, false);
});
```

In the same file, extend the client-contract test (lines 280-289) by adding these two assertions to its body:

```js
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 10 }] }).ok, true);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ bookId: "B001", stockDelta: 10 }] }).ok, false);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: the two new batch tests FAIL (`ok` is `undefined`), legacy tests still pass.

- [ ] **Step 3: Implement the batch path**

Replace the whole `validateStockPayload` function in `api/_lib.js` (lines 95-101):

```js
function validateStockPayload(raw) {
  const p = raw || {};
  if (Array.isArray(p.stock_adjustments)) {
    const items = p.stock_adjustments;
    if (!items.length) return { ok: false, error: "stock_adjustments must contain at least one adjustment" };
    const seen = {};
    const adjustments = items.map((it, i) => {
      const delta = Number(it && it.stock_delta);
      const bookId = it && it.book_id;
      if (!bookId || typeof bookId !== "string") return { error: "adjustment " + i + ": book_id is required" };
      if (!Number.isInteger(delta) || delta === 0) return { error: "adjustment " + i + ": stock_delta must be a non-zero integer" };
      if (seen[bookId]) return { error: "adjustment " + i + ": duplicate book_id " + bookId };
      seen[bookId] = true;
      return { book_id: bookId, stockDelta: delta };
    });
    for (const a of adjustments) if (a.error) return { ok: false, error: a.error };
    return { ok: true, payload: { stock_adjustments: adjustments } };
  }
  const delta = Number(p.stock_delta);
  if (!p.book_id || typeof p.book_id !== "string") return { ok: false, error: "book_id is required" };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: "stock_delta must be a non-zero integer" };
  return { ok: true, payload: { book_id: p.book_id, stockDelta: delta } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: exit 0; no `✖` failures; the two batch tests pass; legacy `validateStockPayload` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: accept batch stock_adjustments in validateStockPayload"
```

---

### Task 2: API — runStock batch mode

**Files:**
- Modify: `scripts/test.js`
- Modify: `api/_lib.js:277-294`

- [ ] **Step 1: Add the failing runStock batch tests**

Insert after line 533 (after `runStock rejects when the result would be negative`) in `scripts/test.js`:

```js
test("runStock applies a batch of adjustments and appends one activity row per book", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","40","10"],["B002","GoldenA","English","Core","78","25","10"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runStock(client, "spr", {
    stock_adjustments: [{ book_id: "B001", stockDelta: 10 }, { book_id: "B002", stockDelta: -5 }]
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [{ book_id: "B001", stock_qty: 50 }, { book_id: "B002", stock_qty: 20 }]);
  assert.equal(client.calls[0].range, "Books!F2");
  assert.deepEqual(client.calls[0].values, [["50"]]);
  assert.equal(client.calls[1].range, "Books!F3");
  assert.deepEqual(client.calls[1].values, [["20"]]);
  assert.equal(client.calls[2].tab, "Activity");
  assert.equal(client.calls[2].rows[0][0], "A007");
  assert.match(client.calls[2].rows[0][2], /New stock added for Math/);
  assert.equal(client.calls[3].tab, "Activity");
  assert.equal(client.calls[3].rows[0][0], "A008");
  assert.match(client.calls[3].rows[0][2], /Stock corrected for English/);
});

test("runStock batch aborts all writes when any adjustment would go below zero", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","5","10"],["B002","GoldenA","English","Core","78","25","10"]]
  });
  const r = await lib.runStock(client, "spr", {
    stock_adjustments: [{ book_id: "B001", stockDelta: -10 }, { book_id: "B002", stockDelta: 10 }]
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /below zero/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runStock batch reports unknown book ids without writing", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B001","GoldenA","Math","Core","85","40","10"]]
  });
  const r = await lib.runStock(client, "spr", {
    stock_adjustments: [{ book_id: "B001", stockDelta: 10 }, { book_id: "B999", stockDelta: 5 }]
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /book_id not found: B999/);
  assert.equal(client.calls.length, 0, "no writes happened");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: the three new batch tests FAIL; the existing single `runStock` test still passes.

- [ ] **Step 3: Implement batch mode**

Replace the whole `runStock` function in `api/_lib.js` (lines 277-294):

```js
async function runStock(client, spreadsheetId, payload) {
  const books = await client.sheetsGet(spreadsheetId, "Books!A:I");
  const resolve = (bookId, delta) => {
    const foundBook = findRowIndex(books, "book_id", bookId);
    if (!foundBook) return { error: "book_id not found: " + bookId };
    const bookRow = books[foundBook.rowIndex - 1];
    const stockQty = cellNum(bookRow[5]);
    const newQty = stockQty + delta;
    if (newQty < 0) return { error: "stock cannot go below zero for " + bookRow[2] };
    return { foundBook, bookRow, stockQty, newQty, delta };
  };

  if (payload.stock_adjustments) {
    const resolved = payload.stock_adjustments.map(item => resolve(item.book_id, item.stockDelta));
    for (const x of resolved) if (x.error) return { ok: false, error: x.error };
    const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
    let activityNum = Number(nextId(activity, "A").slice(1));
    for (const x of resolved) {
      await client.sheetsUpdate(spreadsheetId, "Books!" + colLetter(5) + x.foundBook.rowIndex, [[String(x.newQty)]]);
    }
    for (const x of resolved) {
      const verb = x.delta > 0 ? "New stock added for " : "Stock corrected for ";
      await client.sheetsAppend(spreadsheetId, "Activity", [["A" + String(activityNum++).padStart(3, "0"), "stock", verb + x.bookRow[2], "0", todayISO()]]);
    }
    return { ok: true, rows: resolved.map(x => ({ book_id: x.bookRow[0], stock_qty: x.newQty })) };
  }

  const foundBook = findRowIndex(books, "book_id", payload.book_id);
  if (!foundBook) return { ok: false, error: "book_id not found" };
  const bookRow = books[foundBook.rowIndex - 1];
  const stockQty = cellNum(bookRow[5]);
  const newQty = stockQty + payload.stockDelta;
  if (newQty < 0) return { ok: false, error: "stock cannot go below zero" };
  const subject = bookRow[2];
  const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
  const activityId = nextId(activity, "A");
  const verb = payload.stockDelta > 0 ? "New stock added for " : "Stock corrected for ";
  await client.sheetsUpdate(spreadsheetId, "Books!" + colLetter(5) + foundBook.rowIndex, [[String(newQty)]]);
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "stock", verb + subject, "0", todayISO()
  ]]);
  return { ok: true, row: { book_id: payload.book_id, stock_qty: newQty } };
}
```

Note: batch activity ids derive from `nextId(activity, "A")` once, then increment per row. `A006` fixture → `A007`, `A008`. This matches the single path's zero-padding style.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: exit 0; all three batch tests pass; the existing single `runStock` tests (513, 525, 596) still pass.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: batch runStock applies all adjustments with one activity row per book"
```

---

### Task 3: Dialog markup (index.html)

**Files:**
- Modify: `index.html:482-495`

- [ ] **Step 1: Replace the stock form body**

Replace lines 486-487 in `index.html`:

```html
        <label>Book<select data-book required></select></label>
        <label>Adjustment<small>Positive adds stock, negative removes.</small><input type="number" data-delta step="1" required></label>
```

with:

```html
        <label>Class<select data-class required></select></label>
        <label>Books<small>Positive adds stock, negative removes. Leave blank or 0 to skip a book.</small><div class="book-list" data-stock-list><p class="empty-note">Select a class to see its books.</p></div></label>
```

The `[data-error]` paragraph, Cancel and Apply buttons, and the rest of the dialog stay untouched.

- [ ] **Step 2: Verify syntax**

Run: `node --check index.html` will fail (not JS) — instead confirm the final dialog reads:

```html
  <dialog class="modal" id="dlgStock">
    <form method="dialog">
      <div class="modal-head"><h3>Adjust stock</h3><button type="button" class="modal-close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <label>Class<select data-class required></select></label>
        <label>Books<small>Positive adds stock, negative removes. Leave blank or 0 to skip a book.</small><div class="book-list" data-stock-list><p class="empty-note">Select a class to see its books.</p></div></label>
        <p class="modal-error" data-error hidden></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" data-submit>Apply</button>
      </div>
    </form>
  </dialog>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: class field and book qty list in adjust stock dialog"
```

---

### Task 4: Styles (css/app.css)

**Files:**
- Modify: `css/app.css:95`

- [ ] **Step 1: Add the qty input style**

Insert directly after the `.book-list input[type="checkbox"]` rule (line 95):

```css
.book-list input.qty { width: 96px; margin-left: auto; padding: 6px 8px; text-align: right; }
```

- [ ] **Step 2: Verify syntax**

Run: `node --check css/app.css` will fail (not JS) — visually confirm the line sits inside the `.book-list` block group after line 95.

- [ ] **Step 3: Commit**

```bash
git add css/app.css
git commit -m "style: qty input for per-book stock adjustment rows"
```

---

### Task 5: Client logic (js/write.js)

**Files:**
- Modify: `js/write.js:44-47`, `js/write.js:106-111`, `js/write.js:132` (insert after), `js/write.js:198-200`, `js/write.js:223-241`

- [ ] **Step 1: Add the stockOpts module variable**

Change lines 44-46 in `js/write.js`:

```js
  let studentBooks = [];
  let studentFees = [];
  let issueOpts = null;
```

to:

```js
  let studentBooks = [];
  let studentFees = [];
  let issueOpts = null;
  let stockOpts = null;
```

- [ ] **Step 2: Rewrite populate("stock")**

Replace lines 106-111 in `js/write.js`:

```js
    if (name === "stock") {
      const bookSel = dialogs.stock.querySelector("[data-book]");
      bookSel.innerHTML = '<option value="">Select book…</option>' + opts.books
        .map(b => '<option value="' + esc(b.bookId) + '" data-stock="' + b.stockQty + '">' + esc(b.subject) + " — " + esc(b.publisher) + " (stock " + b.stockQty + ")</option>")
        .join("");
    }
```

with:

```js
    if (name === "stock") {
      stockOpts = opts;
      const classSel = dialogs.stock.querySelector("[data-class]");
      classSel.innerHTML = '<option value="">Select class…</option>' + root.viewModels.bookCategories(opts.books)
        .map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>")
        .join("");
      renderStockBooks("");
    }
```

- [ ] **Step 3: Add renderStockBooks**

Insert after the `renderIssueBooks` function (after line 132) in `js/write.js`:

```js
  function renderStockBooks(className) {
    const box = dialogs.stock.querySelector("[data-stock-list]");
    if (!box || !stockOpts) return;
    if (!className) {
      box.innerHTML = '<p class="empty-note">Select a class to see its books.</p>';
      return;
    }
    const classBooks = stockOpts.books.filter(b => b.category === className);
    if (!classBooks.length) {
      box.innerHTML = '<p class="empty-note">No books for ' + esc(className) + " right now.</p>";
      return;
    }
    box.innerHTML = classBooks.map(b =>
      '<label class="book-option"><span class="book-name">' + esc(b.subject) +
      '<small>' + esc(b.publisher) + " · stock " + b.stockQty + "</small></span>" +
      '<input type="number" class="qty" step="1" data-qty data-book="' + esc(b.bookId) + '" placeholder="0"></label>'
    ).join("");
  }
```

Do NOT add a `min="-<stockQty>"` attribute: native constraint validation would block submits silently. The API's below-zero error reaches `showError` instead, matching legacy behavior.

- [ ] **Step 4: Add the class change listener**

Insert after the issue change listener (after line 200) in `js/write.js`:

```js
  dialogs.stock.querySelector("[data-class]").addEventListener("change", e => {
    renderStockBooks(e.currentTarget.value);
  });
```

- [ ] **Step 5: Rewrite the stock submit handler**

Replace lines 223-241 in `js/write.js`:

```js
  dialogs.stock.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const bookId = readValue(dlg, "[data-book]");
    const delta = Number(readValue(dlg, "[data-delta]"));
    if (!bookId) return showError(dlg, "Select a book.");
    if (!Number.isInteger(delta) || delta === 0) return showError(dlg, "Adjustment must be a non-zero whole number (use − to reduce).");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.adjustStock({ book_id: bookId, stock_delta: delta });
      dlg.close();
      showToast("Stock adjusted.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });
```

with:

```js
  dialogs.stock.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const adjustments = Array.prototype.slice.call(dlg.querySelectorAll("[data-qty]"))
      .filter(inp => {
        const v = Number(inp.value);
        return v !== 0 && Number.isInteger(v);
      })
      .map(inp => ({ book_id: inp.dataset.book, stock_delta: Number(inp.value) }));
    if (!adjustments.length) return showError(dlg, "Enter a quantity for at least one book.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.adjustStock({ stock_adjustments: adjustments });
      dlg.close();
      showToast("Stock adjusted.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });
```

- [ ] **Step 6: Lint and run the suite**

Run: `node --check js/write.js`
Expected: no output, exit 0.

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: exit 0; 114 PASS.

- [ ] **Step 7: Commit**

```bash
git add js/write.js
git commit -m "feat: per-book quantities post stock_adjustments batch from dialog"
```

---

### Task 6: Extend the E2E harness (scratch, outside repo)

**Files:**
- Modify: `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs`

- [ ] **Step 1: Add the api/stock override**

After `const issuePosts = [];` (line 88) add `const stockPosts = [];`. In the `OVERRIDES` object (lines 89-103) the `api/issue` entry is currently last (no trailing comma) — add a comma after it, then the `api/stock` entry:

```js
  "api/issue": body => { issuePosts.push(body); return JSON.stringify({ ok: true }); },
  "api/stock": body => { stockPosts.push(body); return JSON.stringify({ ok: true }); }
```

- [ ] **Step 2: Append the four stock scenarios**

Insert before `record("register: zero console errors across the run",` (line 380) the following block:

```js
  // ---------- ADJUST STOCK: class dropdown lists textbook categories ----------
  try {
    await evaluate(`document.querySelector('#dlgIssue').close(); true`);
    await evaluate(`document.querySelector('[data-action="stock"]').click(); true`);
    await waitFor(`document.getElementById("dlgStock").open === true`, "stock dialog opens");
    const opts = JSON.parse(await waitFor(`(() => { const s = document.querySelector('#dlgStock [data-class]'); const all = Array.prototype.map.call(s.querySelectorAll('option'), o => o.textContent).filter(Boolean).sort(); return all.length >= 2 ? JSON.stringify({ all }) : ""; })()`, "stock class dropdown ready"));
    const hasKg1 = opts.all.indexOf("KG 1") !== -1;
    const hasBs4 = opts.all.indexOf("BS 4") !== -1;
    const hasEx = opts.all.indexOf("A1 Small") !== -1;
    record("stock: class dropdown lists textbook categories, excludes exercise books",
      hasKg1 && hasBs4 && !hasEx, "options=" + JSON.stringify(opts.all));
  } catch (e) {
    record("stock: dropdown", false, "ERROR " + e.message);
  }

  // ---------- ADJUST STOCK: selecting KG 1 renders its books with qty boxes ----------
  try {
    await evaluate(`(async()=>{
      var c = document.querySelector('#dlgStock [data-class]');
      c.value = 'KG 1';
      c.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const info = JSON.parse(await waitFor(`(() => {
      const qs = Array.prototype.slice.call(document.querySelectorAll('#dlgStock [data-qty]'));
      if (qs.length === 0) return "";
      const labels = Array.prototype.slice.call(document.querySelectorAll('#dlgStock .book-option')).map(l => l.textContent.replace(/\\s+/g, ' ').trim());
      const books = qs.map(q => q.dataset.book);
      return JSON.stringify({ count: qs.length, books: books, labels: labels });
    })()`, "stock qty list renders"));
    const expected = ["B015", "B016", "B017", "B018", "B019", "B020"];
    const okIds = info.count === 6 && expected.every(b => info.books.indexOf(b) !== -1);
    const hasStock = info.labels.every(l => /stock 50/.test(l));
    const exbookFree = !JSON.stringify(info.labels).toLowerCase().includes("exercise");
    record("stock: selecting 'KG 1' renders 6 class books with qty boxes and current stock",
      okIds && hasStock && exbookFree, JSON.stringify(info));
  } catch (e) {
    record("stock: KG 1 qty list", false, "ERROR " + e.message);
  }

  // ---------- ADJUST STOCK: all-empty qty shows styled error, no post ----------
  try {
    const postsBefore = stockPosts.length;
    await evaluate(`document.querySelector('#dlgStock [data-submit]').click(); true`);
    await waitFor(`(() => { const el = document.querySelector('#dlgStock [data-error]'); return el && !el.hidden && el.textContent.indexOf('Enter a quantity for at least one book') !== -1; })()`, "stock empty-qty error shows");
    const still = await evaluate(`(() => { const d = document.getElementById('dlgStock'); return JSON.stringify({ open: d.open }); })()`);
    record("stock: submitting with all qty empty shows styled error, stays open, posts nothing",
      still === '{"open":true}' && stockPosts.length === postsBefore, still + " posts=" + stockPosts.length);
  } catch (e) {
    record("stock: empty-qty validation", false, "ERROR " + e.message);
  }

  // ---------- ADJUST STOCK: mixed +/- qty posts stock_adjustments, closes, toast ----------
  try {
    await evaluate(`(async()=>{
      var qs = Array.prototype.slice.call(document.querySelectorAll('#dlgStock [data-qty]'));
      qs[0].value = '10';
      qs[1].value = '-5';
      document.querySelector('#dlgStock [data-submit]').click();
      return true;
    })()`);
    await waitFor(`document.getElementById("dlgStock").open === false`, "stock dialog closes after submit");
    const toast = await waitFor(`(() => { const t = document.getElementById('toast'); return t.classList.contains('show') && t.textContent === 'Stock adjusted.'; })()`, "stock toast");
    const post = stockPosts.length ? stockPosts[stockPosts.length - 1] : null;
    const okPost = post && Array.isArray(post.stock_adjustments) && post.stock_adjustments.length === 2 &&
      post.stock_adjustments[0].book_id === "B015" && post.stock_adjustments[0].stock_delta === 10 &&
      post.stock_adjustments[1].book_id === "B016" && post.stock_adjustments[1].stock_delta === -5;
    record("stock: mixed +/- quantities post stock_adjustments batch, closes, shows toast",
      toast && okPost, "post=" + JSON.stringify(post));
  } catch (e) {
    record("stock: POST flow", false, "ERROR " + e.message);
  }
```

The KG 1 fixtures are B015-B020 (Creche 4, Nursery 1 5, Nursery 2 5 precede them), so `qs[0]` is B015 and `qs[1]` is B016.

- [ ] **Step 3: Run the harness**

Run: `node "C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs"`
Expected: 13 records, all PASS (9 existing + 4 new). Fix only harness bugs if a scenario fails; the app code is already covered by Tasks 1-5.

---

### Task 7: Full gate and deliver

- [ ] **Step 1: Lint all edited repo files**

Run:
```bash
node --check js/write.js
node --check api/_lib.js
node --check scripts/test.js
```
Expected: all silent, exit 0.

- [ ] **Step 2: Full unit suite**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"`
Expected: exit 0; 114 PASS; full output captured in `tests.log`. Delete `tests.log` from the repo directory when done (scratch, not committed). Do NOT commit it.

- [ ] **Step 3: Full E2E**

Run: `node "C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs"`
Expected: 13 passed, 0 failed.

- [ ] **Step 4: Review the diff**

Run: `git diff --stat HEAD~5`
Expected: 5 files changed (index.html, css/app.css, js/write.js, api/_lib.js, scripts/test.js), no stray files, no `tests.log`. The scratch harness in the temp dir is intentionally not part of the repo.

- [ ] **Step 5: Commit any remaining work**

Only if Tasks 1-6 already committed individually, this step is a no-op. Otherwise commit the remaining files with the gate green:

```bash
git add index.html css/app.css js/write.js api/_lib.js scripts/test.js
git commit -m "feat: class-based adjust stock with per-book quantities and batch writes"
```

- [ ] **Step 6: Report**

Summarize for the user: 114 unit tests PASS, 13 E2E records PASS, wire shape `POST api/stock { stock_adjustments: [{book_id, stock_delta}] }`, legacy single-book path intact. Await explicit approval before pushing.