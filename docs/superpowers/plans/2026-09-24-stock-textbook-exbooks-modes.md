# Adjust Stock Textbook/ExBooks Modes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the single "Adjust stock" entry into two inventory buttons — `+Stock Textbook` and `+Stock ExBooks` — sharing one dialog, where ExBooks mode lists exercise-book sizes and only renders exercise books.

**Architecture:** Reuse `#dlgStock` with a `stockMode` flag (`"textbook"` | `"exbooks"`) that `openDialog` sets from which button was clicked. `populate("stock")` picks the category source (`bookCategories` vs new `exerciseBookCategories`), switches the dialog heading, and `renderStockBooks` is reused unchanged except for a mode-aware empty hint. Submit, wire contract (`stock_adjustments` batch), and backend are untouched.

**Tech Stack:** Vanilla JS (browser), Node for tests (`node:assert/strict`, no framework), scratch Playwright-less E2E harness served over localhost.

**Baseline:** 114 tests pass, E2E 13 PASS. After this plan: 116 unit tests, E2E 15 PASS.

---

### Task 1: `exerciseBookCategories` view-model + unit tests (TDD)

**Files:**
- Modify: `js/view-models.js:101-109` (add function after `bookCategories`) and `js/view-models.js:300` (export)
- Test: `scripts/test.js:877` (insert new tests after the closing `});` of the last bookCategories test), `scripts/test.js:671` (existing `vm` require — no change)

- [x] **Step 1: Write the failing tests**

Insert after line 877 in `scripts/test.js` (right after the `} );` closing `test("viewModels.bookCategories excludes exercise-book categories", ...)` — find that test by content, it ends:

```js
test("viewModels.bookCategories excludes exercise-book categories", () => {
  const books = [
    { category: "KG 1", publisher: "GES Press" },
    { category: "BS 2", publisher: "GES Press" },
    { category: "A1 Small", publisher: "Exercise Book" }
  ];
  assert.deepEqual(vm.bookCategories(books), ["BS 2", "KG 1"]);
});
```

Insert directly after that test:

```js
test("viewModels.exerciseBookCategories returns sorted distinct exercise sizes", () => {
  const books = [
    { category: "A1 Small", publisher: "Exercise Book" },
    { category: "A4", publisher: "Exercise Book" },
    { category: "A1 Small", publisher: "Exercise Book" },
    { category: "", publisher: "Exercise Book" },
    { category: "KG 1", publisher: "GES Press" }
  ];
  assert.deepEqual(vm.exerciseBookCategories(books), ["A1 Small", "A4"]);
});

test("viewModels.exerciseBookCategories returns empty for no books", () => {
  assert.deepEqual(vm.exerciseBookCategories([]), []);
  assert.deepEqual(vm.exerciseBookCategories(null), []);
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"; $code=$LASTEXITCODE; (Select-String -Path tests.log -Pattern '^FAIL').Count; Remove-Item -LiteralPath tests.log -Force`
Expected: exit 0 (runner sets exitCode only), output shows exactly 2 FAIL lines (`viewModels.exerciseBookCategories` … `is not a function`), and PASS count still `114 tests passed`.

- [x] **Step 3: Implement `exerciseBookCategories`**

In `js/view-models.js`, immediately after the `bookCategories` function (ends line 109, `return Object.keys(set).sort();\n  }`):

```js
  function exerciseBookCategories(books) {
    const set = {};
    (books || []).forEach(b => {
      if (!isExerciseBook(b)) return;
      const c = String(b.category || "").trim();
      if (c) set[c] = true;
    });
    return Object.keys(set).sort();
  }
```

Then extend the exported API: change `js/view-models.js:300` from `bookCategories,` to:

```js
    bookCategories,
    exerciseBookCategories,
```

- [x] **Step 4: Run tests to verify they pass**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"; $code=$LASTEXITCODE; $fail=(Select-String -Path tests.log -Pattern '^FAIL').Count; $sum=(Select-String -Path tests.log -Pattern 'tests passed').Line; Write-Output "exit=$code fails=$fail"; Write-Output $sum; Remove-Item -LiteralPath tests.log -Force`
Expected: `exit=0 fails=0` and `116 tests passed`.

- [x] **Step 5: Commit**

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: view-model exercise book categories for stock mode"
```

---

### Task 2: Inventory toolbar buttons

**Files:**
- Modify: `index.html:279`

- [x] **Step 1: Replace the single button with two**

`index.html:279` currently reads:

```html
              <button class="btn btn-primary" type="button" data-action="stock">+ Adjust stock</button>
```

Replace it with:

```html
              <button class="btn btn-primary" type="button" data-action="stock">+Stock Textbook</button>
              <button class="btn btn-primary" type="button" data-action="stock-ex">+Stock ExBooks</button>
```

The `.head-actions` container already has `display:flex; gap:8px` (css/app.css:23) and `@media(max-width:760px)` gives both buttons `flex:1` — no CSS change needed.

- [x] **Step 2: Verify well-formedness**

Run: `git diff --check`
Expected: no output.

At this point `data-action="stock-ex"` is inert (wired in Task 3) — expected.

- [x] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add +Stock ExBooks inventory button"
```

---

### Task 3: ExBooks mode in the adjust stock dialog

**Files:**
- Modify: `js/write.js` — line 47 (mode var), lines 61-73 (openDialog + wiring), after line 80 (close-reset), lines 107-114 (populate stock branch), lines 140-143 (empty note in `renderStockBooks`)

- [ ] **Step 1: Add the mode flag**

`js/write.js:47` reads `let stockOpts = null;`. Replace with:

```js
  let stockOpts = null;
  let stockMode = "textbook";
```

- [ ] **Step 2: Extend `openDialog` and the `data-action` wiring**

`js/write.js:61-66` currently:

```js
  function openDialog(name) {
    const dlg = dialogs[name];
    if (!dlg) return;
    clearError(dlg);
    populate(name).then(() => dlg.showModal());
  }
```

Replace with:

```js
  function openDialog(name, mode) {
    const dlg = dialogs[name];
    if (!dlg) return;
    clearError(dlg);
    if (name === "stock") stockMode = mode === "exbooks" ? "exbooks" : "textbook";
    populate(name).then(() => dlg.showModal());
  }
```

`js/write.js:68-73` currently:

```js
  document.querySelectorAll("[data-action]").forEach(btn => {
    const action = btn.dataset.action;
    if (action in dialogs) {
      btn.addEventListener("click", () => openDialog(action));
    }
  });
```

Replace with:

```js
  document.querySelectorAll("[data-action]").forEach(btn => {
    const action = btn.dataset.action;
    if (action in dialogs) {
      btn.addEventListener("click", () => openDialog(action));
    } else if (action === "stock-ex") {
      btn.addEventListener("click", () => openDialog("stock", "exbooks"));
    }
  });
```

- [ ] **Step 3: Reset mode on close**

After the `document.querySelectorAll("[data-close]")` block (ends `js/write.js:80`), insert:

```js
  dialogs.stock.addEventListener("close", () => {
    stockMode = "textbook";
  });
```

- [ ] **Step 4: Mode-aware `populate("stock")` and empty hint**

`js/write.js:107-114` currently:

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

Replace with:

```js
    if (name === "stock") {
      stockOpts = opts;
      const ex = stockMode === "exbooks";
      const cats = root.viewModels[ex ? "exerciseBookCategories" : "bookCategories"](opts.books);
      const classSel = dialogs.stock.querySelector("[data-class]");
      classSel.innerHTML = '<option value="">' + (ex ? "Select size…" : "Select class…") + "</option>" + cats
        .map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>")
        .join("");
      const title = dialogs.stock.querySelector(".modal-head h3");
      if (title) title.textContent = ex ? "Adjust stock — ExBooks" : "Adjust stock — Books";
      renderStockBooks("");
    }
```

Then `renderStockBooks` empty state (currently `js/write.js:140-143`):

```js
    if (!className) {
      box.innerHTML = '<p class="empty-note">Select a class to see its books.</p>';
      return;
    }
```

Replace with:

```js
    if (!className) {
      box.innerHTML = '<p class="empty-note">' + (stockMode === "exbooks" ? "Select an exercise size to see its books." : "Select a class to see its books.") + "</p>";
      return;
    }
```

- [ ] **Step 5: Verification**

Run: `node --check js/write.js`
Expected: silent, exit 0.

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"; $code=$LASTEXITCODE; $fail=(Select-String -Path tests.log -Pattern '^FAIL').Count; $sum=(Select-String -Path tests.log -Pattern 'tests passed').Line; Write-Output "exit=$code fails=$fail"; Write-Output $sum; Remove-Item -LiteralPath tests.log -Force`
Expected: `exit=0 fails=0` and `116 tests passed`.

- [ ] **Step 6: Commit**

```bash
git add js/write.js
git commit -m "feat: exbooks mode in the adjust stock dialog"
```

---

### Task 4: E2E harness — two ExBooks scenarios

**Files:**
- Modify: `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs` (scratch, NOT in the repo)

- [ ] **Step 1: Locate the insertion point**

Find the line `record("register: zero console errors across the run",` (near the end). The two new scenarios are inserted immediately BEFORE it. Also confirm the harness already declares `const stockPosts = [];` and the `"api/stock"` override (added by the previous stock feature — leave them as-is).

- [ ] **Step 2: Insert the two scenarios**

Insert before the zero-console-errors record:

```js
  // ---------- ADJUST STOCK: ExBooks mode dropdown lists exercise sizes only ----------
  try {
    await evaluate(`document.querySelector('#dlgStock').close(); true`);
    await evaluate(`document.querySelector('[data-action="stock-ex"]').click(); true`);
    await waitFor(`document.getElementById("dlgStock").open === true`, "stock-ex dialog opens");
    const opts = JSON.parse(await waitFor(`(() => { const s = document.querySelector('#dlgStock [data-class]'); const all = Array.prototype.map.call(s.querySelectorAll('option'), o => o.textContent).filter(Boolean).sort(); return all.length >= 1 ? JSON.stringify({ all: all, title: document.querySelector('#dlgStock .modal-head h3').textContent }) : ""; })()`, "stock-ex size dropdown ready"));
    const hasSize = opts.all.indexOf("A1 Small") !== -1;
    const noClass = opts.all.indexOf("KG 1") === -1 && opts.all.indexOf("BS 4") === -1;
    const okTitle = opts.title.indexOf("ExBooks") !== -1;
    record("stock-ex: size dropdown lists exercise sizes only, heading switches",
      hasSize && noClass && okTitle, JSON.stringify(opts));
  } catch (e) {
    record("stock-ex: dropdown", false, "ERROR " + e.message);
  }

  // ---------- ADJUST STOCK: ExBooks mode select size, set qty, posts batch ----------
  try {
    await evaluate(`(async()=>{
      var c = document.querySelector('#dlgStock [data-class]');
      c.value = 'A1 Small';
      c.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    const info = JSON.parse(await waitFor(`(() => {
      const qs = Array.prototype.slice.call(document.querySelectorAll('#dlgStock [data-qty]'));
      if (qs.length === 0) return "";
      const labels = Array.prototype.slice.call(document.querySelectorAll('#dlgStock .book-option')).map(l => l.textContent.replace(/\\s+/g, ' ').trim());
      return JSON.stringify({ count: qs.length, books: qs.map(q => q.dataset.book), labels: labels });
    })()`, "stock-ex qty list renders"));
    if (!info.books.length) throw new Error("no exercise books rendered");
    await evaluate(`document.querySelector('#dlgStock [data-qty]').value = '12'; true`);
    await evaluate(`document.querySelector('#dlgStock [data-submit]').click(); true`);
    await waitFor(`document.getElementById("dlgStock").open === false`, "stock-ex dialog closes after submit");
    const post = stockPosts.length ? stockPosts[stockPosts.length - 1] : null;
    const okPost = post && Array.isArray(post.stock_adjustments) && post.stock_adjustments.length === 1 &&
      post.stock_adjustments[0].book_id === info.books[0] && post.stock_adjustments[0].stock_delta === 12;
    const exOnly = info.labels.every(l => /Exercise Book/.test(l));
    record("stock-ex: selecting a size renders those exbooks and posts batch",
      okPost && exOnly, "post=" + JSON.stringify(post));
  } catch (e) {
    record("stock-ex: POST flow", false, "ERROR " + e.message);
  }
```

Note: inside the template literal the whitespace regex must be written `/\\s+/g` so the browser receives `/\s+/g` (this is the established idiom in the file's issue/stock scenarios — do NOT write it with a single backslash).

- [ ] **Step 3: Run the harness**

Run: `node "C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs"`
Expected: 15 records, all PASS — the 13 existing plus:
- `stock-ex: size dropdown lists exercise sizes only, heading switches`
- `stock-ex: selecting a size renders those exbooks and posts batch`

The harness serves the CURRENT repo files on localhost:8123. If a stock-ex scenario fails, fix the HARNESS (selector/ordering), not the app. Confirm cleanup: no leftover `cec-reg-` Chrome processes and nothing listening on 8123 after the run.

- [ ] **Step 4: Report**

Report the full 15-line output and the two stock-ex record lines verbatim. No commit (scratch file).

---

### Task 5: Full gate and deliver

**Files:**
- Verify: `js/view-models.js`, `js/write.js`, `index.html`, `scripts/test.js`

- [ ] **Step 1: Lint edited repo files**

Run:
```bash
node --check js/write.js
node --check js/view-models.js
node --check scripts/test.js
```
Expected: all silent, exit 0.

- [ ] **Step 2: Full unit suite**

Run: `cmd /c "node scripts/test.js > tests.log 2>&1"; $code=$LASTEXITCODE; $fail=(Select-String -Path tests.log -Pattern '^FAIL').Count; $sum=(Select-String -Path tests.log -Pattern 'tests passed').Line; Write-Output "exit=$code fails=$fail"; Write-Output $sum; Remove-Item -LiteralPath tests.log -Force`
Expected: `exit=0 fails=0`, `116 tests passed`. `tests.log` must be deleted afterward (it is, by the command).

- [ ] **Step 3: Full E2E**

Run: `node "C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-register-fill-e2e.cjs"`
Expected: 15 passed, 0 failed.

- [ ] **Step 4: Review the diff**

Run: `git diff --stat HEAD~3`
Expected: 4 files changed (index.html, js/view-models.js, js/write.js, scripts/test.js), no stray files, no `tests.log`. The scratch harness lives outside the repo.

- [ ] **Step 5: Commit any remaining work**

All Tasks 1-3 are committed individually, so this is a no-op. If anything is uncommitted, commit only index.html, js/view-models.js, js/write.js, scripts/test.js.

- [ ] **Step 6: Report**

Summarize: mode flag wiring, buttons, new view-model, unit/E2E results, the 3 commits. Present the final diff and ASK the user before pushing to origin.