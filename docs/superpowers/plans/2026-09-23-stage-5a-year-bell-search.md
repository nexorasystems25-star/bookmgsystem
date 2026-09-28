# Stage 5A — Year Switcher, Notifications Bell & Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the academic-year workspace selector (filters all views), the notifications bell (derived alerts), and the global search icon across the CEC Books SPA — removing their stub-toast behavior.

**Architecture:** Pure filter + in-memory state. A `filterYear(dataset, year)` view-model produces a year-filtered snapshot that every renderer consumes via one `viewData()` helper in `app.js`; switching years re-renders only (no refetch). Payment/activity year is derived from the student join at filter time; unmatched rows fall back to the config year. **Activity has no `student_id` column (confirmed in `data/activity.json`) so it is year-independent and always shown.** Dropdowns use one reusable `openMenu`/`closeMenu` component.

**Tech Stack:** Vanilla JS (UMD modules on `window.CEC`), existing node `assert`-based unit runner (`scripts/test.js`, `TZ=Asia/Tokyo`), CDP browser harness for E2E.

**Spec:** `docs/superpowers/specs/2026-09-23-stage-05-interactive-controls-design.md`
**Sibling plan (separate stage):** 5B covers export/CSS-more-menu/profile (not now).

---

## File Structure

- **`js/view-models.js`** (modify) — add pure, DOM-free additions: `availableYears`, `filterYear`, `globalSearch`, `notifications` (+ internal `timeAgo`). One responsibility: derived data for views.
- **`js/app.js`** (modify) — `viewData()` helper; active-year state; dropdown helper; workspace-selector / bell / search wiring; remove blanket stub toast; explicit stub toasts for the 5B controls.
- **`index.html`** (modify) — add `<div id="menuRoot">` mount (one line; no control markup changes).
- **`css/app.css`** (modify) — add dropdown panel / menu item / search / notification styles (new classes only, existing tokens).
- **`scripts/test.js`** (modify) — unit tests for the four new view-model functions.
- **`cec-controls-e2e.cjs`** (create, throwaway under Temp) — CDP E2E harness for the three controls.

---

## Task 1: `availableYears` in view-models.js (TDD)

**Files:**
- Modify: `js/view-models.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test.js` after the existing view-model tests (after line 621, before `console.log`):

```js
const YEAR_STUDENTS = [
  { studentId: "26-1", name: "A", className: "JS 1", academicYear: "2026/2027" },
  { studentId: "25-1", name: "B", className: "JS 1", academicYear: "2025/2026" }
];
const YEAR_CONFIG = { activeYear: "2026/2027", dailyTarget: 100000, currency: "GH₵", lastSynced: "" };

test("viewModels.availableYears de-dupes and leads with active year", () => {
  const yrs = vm.availableYears(YEAR_STUDENTS, YEAR_CONFIG);
  assert.deepEqual(yrs, ["2026/2027", "2025/2026"]);
});

test("viewModels.availableYears guarantees config active year first", () => {
  const students = [{ studentId: "x", name: "x", className: "x", academicYear: "2024/2025" }];
  assert.deepEqual(vm.availableYears(students, YEAR_CONFIG), ["2026/2027", "2024/2025"]);
});

test("viewModels.availableYears returns empty when nothing", () => {
  assert.deepEqual(vm.availableYears([], { activeYear: "" }), []);
});

test("viewModels.availableYears trims whitespace in years", () => {
  const students = [{ studentId: "x", name: "x", className: "x", academicYear: "  2027/2028 " }];
  assert.deepEqual(vm.availableYears(students, YEAR_CONFIG), ["2026/2027", "2027/2028"]);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `node scripts/test.js`
Expected: `FAIL viewModels.availableYears ...` × 4 (function not defined), total shows only prior passes at the `console.log` line and exit code 1.

- [ ] **Step 3: Implement `availableYears`**

In `js/view-models.js`, add after `studentOutstanding`:

```js
function availableYears(students, config) {
  const set = {};
  (students || []).forEach(s => {
    const y = String(s.academicYear || "").trim();
    if (y) set[y] = true;
  });
  const active = String((config && config.activeYear) || "").trim();
  if (active) set[active] = true;
  const years = Object.keys(set);
  if (!active) return years;
  const rest = years.filter(y => y !== active).sort();
  return [active].concat(rest);
}
```

- [ ] **Step 4: Run tests to verify passes**

Run: `node scripts/test.js`
Expected: all 4 new tests `PASS`, exit code 0.

- [ ] **Step 5: Export the function**

In `js/view-models.js`, add `availableYears,` to the returned object:

```js
  return {
    PAGES,
    pageForHash,
    classifyMethod,
    methodSummary,
    classTotals,
    stockStatus,
    studentOutstanding,
    outstandingList,
    availableYears
  };
```

- [ ] **Step 6: Re-run and commit**

Run: `node scripts/test.js` — expected all PASS.
Commit:

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: add availableYears view-model with tests"
```

---

## Task 2: `filterYear` in view-models.js (TDD)

**Files:**
- Modify: `js/view-models.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test.js` (before the `console.log(pass + ...)` line):

```js
function makeDataset(students, payments) {
  return {
    students,
    payments,
    activity: [],
    books: [],
    config: YEAR_CONFIG,
    offline: false,
    lastSynced: ""
  };
}

const YEAR_PAYMENTS = [
  { paymentId: "P1", studentId: "26-1", studentName: "A", className: "JS 1", amount: 100, method: "Cash", date: "2026-09-22", status: "confirmed" },
  { paymentId: "P2", studentId: "25-1", studentName: "B", className: "JS 1", amount: 200, method: "Cash", date: "2026-09-22", status: "confirmed" },
  { paymentId: "P3", studentId: "UNKNOWN-9", studentName: "Ghost", className: "JS 2", amount: 50, method: "Cash", date: "2026-09-22", status: "confirmed" }
];

test("viewModels.filterYear filters students to the year", () => {
  const out = vm.filterYear(makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS), "2025/2026");
  assert.deepEqual(out.students.map(s => s.studentId), ["25-1"]);
});

test("viewModels.filterYear joins payment year via student map", () => {
  const out = vm.filterYear(makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS), "2025/2026");
  const ids = out.payments.map(p => p.paymentId).sort();
  assert.deepEqual(ids, ["P2"]);
});

test("viewModels.filterYear unmatched payments fall back to config active year", () => {
  const out = vm.filterYear(makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS), "2026/2027");
  const ghost = out.payments.find(p => p.paymentId === "P3");
  assert.equal(ghost.academicYear, "2026/2027");
});

test("viewModels.filterYear keeps books/config/offline/lastSynced passthrough", () => {
  const data = makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS);
  data.books = [{ bookId: "B1", subject: "English", publisher: "X", price: 50, stockQty: 2, lowStockThreshold: 3 }];
  data.offline = true;
  data.lastSynced = "2026-09-22T10:00:00Z";
  const out = vm.filterYear(data, "2025/2026");
  assert.equal(out.books.length, 1);
  assert.equal(out.offline, true);
  assert.equal(out.lastSynced, "2026-09-22T10:00:00Z");
  assert.equal(out.config.dailyTarget, 100000);
});

test("viewModels.filterYear attaches academicYear to each filtered payment", () => {
  const out = vm.filterYear(makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS), "2026/2027");
  const p = out.payments.find(x => x.paymentId === "P1");
  assert.equal(p.academicYear, "2026/2027");
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `node scripts/test.js`
Expected: `FAIL viewModels.filterYear ...` × 5 (function not defined), exit code 1.

- [ ] **Step 3: Implement `filterYear`**

In `js/view-models.js`, add after `availableYears`:

```js
function filterYear(dataset, year, opts) {
  const target = String(year || "").trim();
  const active = String(((opts && opts.activeYear) || (dataset.config && dataset.config.activeYear)) || "").trim();
  const students = (dataset.students || []).filter(s => String(s.academicYear || "").trim() === target);
  const byId = {};
  students.forEach(s => { byId[String(s.studentId)] = true; });
  const yearOf = p => (byId[String(p.studentId)] ? target : active);
  const payments = (dataset.payments || []).map(pid => {
    const p = Object.assign({}, pid);
    p.academicYear = yearOf(p);
    return p;
  });
  return {
    students,
    payments,
    activity: dataset.activity || [],
    books: dataset.books || [],
    config: dataset.config || {},
    offline: dataset.offline,
    lastSynced: dataset.lastSynced
  };
}
```

- [ ] **Step 4: Run tests to verify passes**

Run: `node scripts/test.js`
Expected: 5 new `PASS`, exit code 0.

- [ ] **Step 5: Export the function**

Add `filterYear,` to the returned object in `js/view-models.js` (right after `availableYears,`).

- [ ] **Step 6: Re-run and commit**

Run: `node scripts/test.js` — expected all PASS.
Commit:

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: add year-filter view-model with tests"
```

---

## Task 3: `globalSearch` in view-models.js (TDD)

**Files:**
- Modify: `js/view-models.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/test.js` (before the final `console.log`):

```js
const SEARCH_FIXTURE = {
  students: [
    { studentId: "S001", name: "Abena Mensah", className: "BS 1A" },
    { studentId: "S002", name: "Kofi Owusu", className: "JS 1A" }
  ],
  books: [
    { bookId: "B001", subject: "Core English", publisher: "GES Press", category: "Core" },
    { bookId: "B002", subject: "Mathematics", publisher: "Longman", category: "Core" }
  ],
  payments: [
    { paymentId: "P001", studentName: "Abena Mensah", amount: 1200 },
    { paymentId: "P002", studentName: "Kofi Owusu", amount: 900 }
  ]
};

test("viewModels.globalSearch finds students by name/id/class", () => {
  const r = vm.globalSearch(SEARCH_FIXTURE, "abena");
  assert.equal(r.students.length, 1);
  assert.equal(r.students[0].studentId, "S001");
  assert.equal(r.books.length, 0);
  assert.equal(r.payments.length, 0);
});

test("viewModels.globalSearch finds books by subject/publisher", () => {
  const r = vm.globalSearch(SEARCH_FIXTURE, "longman");
  assert.equal(r.books.length, 1);
  assert.equal(r.books[0].bookId, "B002");
});

test("viewModels.globalSearch finds payments by ref/student name", () => {
  const r = vm.globalSearch(SEARCH_FIXTURE, "P001");
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].studentName, "Abena Mensah");
});

test("viewModels.globalSearch is case-insensitive", () => {
  const r = vm.globalSearch(SEARCH_FIXTURE, "ABENA");
  assert.equal(r.students.length, 1);
});

test("viewModels.globalSearch empty query returns all-empty groups", () => {
  const r = vm.globalSearch(SEARCH_FIXTURE, "");
  assert.deepEqual(r.students, []);
  assert.deepEqual(r.books, []);
  assert.deepEqual(r.payments, []);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `node scripts/test.js`
Expected: `FAIL viewModels.globalSearch ...` × 5, exit code 1.

- [ ] **Step 3: Implement `globalSearch`**

In `js/view-models.js`, add after `filterYear`:

```js
function searchHits(items, fnMask) {
  return (items || []).filter(it => fnMask(it).toLowerCase().indexOf(q) !== -1);
}

let q = "";
function globalSearch(data, query) {
  q = String(query || "").trim().toLowerCase();
  if (!q) return { students: [], books: [], payments: [] };
  const students = searchHits(data.students, s => [s.name, s.studentId, s.className].join(" "));
  const books = searchHits(data.books, b => [b.subject, b.publisher, b.category].join(" "));
  const payments = searchHits(data.payments, p => [p.studentName, p.paymentId].join(" "));
  return {
    students: students.slice(0, 6),
    books: books.slice(0, 6),
    payments: payments.slice(0, 6)
  };
}
```

- [ ] **Step 4: Run tests to verify passes**

Run: `node scripts/test.js`
Expected: 5 new `PASS`, exit code 0.

- [ ] **Step 5: Export the function**

Add `globalSearch,` to the returned object in `js/view-models.js` (after `filterYear,`).

- [ ] **Step 6: Re-run and commit**

Run: `node scripts/test.js` — expected all PASS.
Commit:

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: add globalSearch view-model with tests"
```

---

## Task 4: `notifications` in view-models.js (TDD)

**Files:**
- Modify: `js/view-models.js`
- Test: `scripts/test.js`

**Design note:** `notifications(dataset)` takes a **filtered snapshot** produced by `filterYear` (so alerts respect the active year). Activity is year-independent and appended last. Alerts: low stock → `#inventory`, waiting students → `#issuing`, daily-target progress → `#payments`, ready-to-issue count → `#issuing`, latest activity → `#payments`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/test.js` (before the final `console.log`):

```js
function notificationFixture() {
  return vm.filterYear({
    students: [
      { studentId: "S1", name: "Ama", className: "JS 1", academicYear: "2026/2027", status: "ready" },
      { studentId: "S2", name: "Kofi", className: "JS 1", academicYear: "2026/2027", status: "waiting" },
      { studentId: "S3", name: "Efua", className: "BS 2", academicYear: "2026/2027", status: "waiting" }
    ],
    payments: [
      { paymentId: "P1", studentId: "S1", amount: 500, date: "2026-09-22", method: "Cash", status: "confirmed" }
    ],
    activity: [
      { activityId: "A1", type: "payment", description: "Payment received from Ama", amount: 500, createdAt: "2026-09-22" }
    ],
    books: [
      { bookId: "B1", subject: "Maths", publisher: "P", price: 50, stockQty: 2, lowStockThreshold: 3 },
      { bookId: "B2", subject: "Science", publisher: "P", price: 60, stockQty: 20, lowStockThreshold: 3 }
    ],
    config: { activeYear: "2026/2027", dailyTarget: 1000, currency: "GH₵", lastSynced: "" },
    offline: false,
    lastSynced: ""
  }, "2026/2027");
}

test("viewModels.notifications reports low stock and waiting students", () => {
  const n = vm.notifications(notificationFixture());
  const kinds = n.map(x => x.kind);
  assert.ok(kinds.indexOf("inventory") !== -1);
  assert.ok(kinds.indexOf("issuing") !== -1);
});

test("viewModels.notifications includes daily-target progress", () => {
  const n = vm.notifications(notificationFixture());
  const t = n.find(x => x.kind === "payments");
  assert.ok(t);
  assert.equal(t.title, "Daily target 50% reached");
});

test("viewModels.notifications names stock counts", () => {
  const n = vm.notifications(notificationFixture());
  const inv = n.find(x => x.kind === "inventory");
  assert.equal(inv.title, "1 title low on stock");
});

test("viewModels.notifications returns empty for an empty healthy dataset", () => {
  const n = vm.notifications(vm.filterYear({
    students: [], payments: [], activity: [], books: [],
    config: { activeYear: "2026/2027", dailyTarget: 1000, currency: "GH₵", lastSynced: "" },
    offline: false, lastSynced: ""
  }, "2026/2027"));
  assert.deepEqual(n, []);
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `node scripts/test.js`
Expected: `FAIL viewModels.notifications ...` × 4, exit code 1.

- [ ] **Step 3: Implement `notifications`**

In `js/view-models.js`, add after `globalSearch`:

```js
function timeAgo(iso) {
  const t = new Date(String(iso || "")).getTime();
  if (isNaN(t)) return "";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
  const days = Math.round(hrs / 24);
  return days + " day" + (days === 1 ? "" : "s") + " ago";
}

function notifications(dataset) {
  const out = [];
  const today = (function () {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();

  const books = dataset.books || [];
  const low = books.filter(b => b.stockQty <= b.lowStockThreshold).length;
  if (low > 0) {
    out.push({
      id: "low-stock", kind: "inventory", icon: "!", color: "amber",
      title: low + (low === 1 ? " title low on stock" : " titles low on stock"),
      desc: "Below or at the restock threshold.",
      href: "#inventory"
    });
  }

  const students = dataset.students || [];
  const waiting = students.filter(s => s.status === "waiting").length;
  if (waiting > 0) {
    out.push({
      id: "waiting", kind: "issuing", icon: "!", color: "warn",
      title: waiting + (waiting === 1 ? " student waiting for stock" : " students waiting for stock"),
      desc: "Review stock before the next issuing session.",
      href: "#issuing"
    });
  }

  const ready = students.filter(s => s.status === "ready").length;
  if (ready > 0) {
    out.push({
      id: "ready", kind: "issuing", icon: "⇧", color: "green",
      title: ready + (ready === 1 ? " student ready to issue" : " students ready to issue"),
      desc: "Cleared to collect their book package.",
      href: "#issuing"
    });
  }

  const config = dataset.config || {};
  const target = config.dailyTarget || 0;
  const todayPay = (dataset.payments || []).reduce((s, p) => s + (p.date === today ? p.amount : 0), 0);
  const pct = target > 0 ? Math.round((todayPay / target) * 100) : 0;
  out.push({
    id: "target", kind: "payments", icon: "₵", color: pct >= 100 ? "green" : "blue",
    title: pct >= 100 ? "Daily target reached" : "Daily target " + pct + "% reached",
    desc: (dataset.payments || []).length + " payments recorded in the active year.",
    href: "#payments"
  });

  const activity = (dataset.activity || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const latest = activity[0];
  if (latest) {
    out.push({
      id: "activity", kind: "activity", icon: "•", color: "blue",
      title: "Latest activity",
      desc: latest.description || "",
      href: "#payments",
      timeLabel: timeAgo(latest.createdAt)
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify passes**

Run: `node scripts/test.js`
Expected: 4 new `PASS`, exit code 0. (If a test asserts a different pct because fixture amounts changed, adjust the fixture — the fixture above is self-consistent: pay 500 of target 1000 = 50%.)

- [ ] **Step 5: Export the function**

Add `notifications,` to the returned object in `js/view-models.js` (after `globalSearch,`).

- [ ] **Step 6: Re-run and commit**

Run: `node scripts/test.js` — expected all PASS.
Commit:

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: add notifications view-model with tests"
```

---

## Task 5: `viewData()` plumbing + active-year state in app.js

**Files:**
- Modify: `js/app.js`
- Test: run existing units (node) + later E2E

Now the app layer. Every renderer call goes through `viewData()`.

**Files:**

- [ ] **Step 1: Add active-year state and `viewData()`**

In `js/app.js`, right after line 44 (`let currentData = null;`), add:

```js
  let activeYear = "";

  function viewData() {
    if (!currentData) return currentData;
    if (!activeYear) activeYear = currentData.config.activeYear || "";
    return currentData === null ? null : CEC.viewModels.filterYear(currentData, activeYear || currentData.config.activeYear || "");
  }
```

- [ ] **Step 2: Route renderers through `viewData()`**

Change `route()` (currently at `js/app.js:290-296`) to:

```js
  async function route() {
    const page = CEC.viewModels.pageForHash(location.hash);
    setActiveNav(page);
    updateShell(page);
    currentData = await CEC.getAllData();
    if (!activeYear) activeYear = currentData.config.activeYear || "";
    renderers[page](viewData());
  }
```

- [ ] **Step 3: Render settings year through active state**

Change `renderSettings` (`js/app.js:258-264`) — the year line must show the **selected** year with the system year appended when different:

```js
  function renderSettings(data) {
    const cur = data.config.currency;
    const sys = data.config.activeYear || "—";
    const yrEl = document.getElementById("settingsYear");
    if (!activeYear || activeYear === sys) {
      yrEl.textContent = sys;
    } else {
      yrEl.innerHTML = esc(activeYear) + ' <small class="muted">(system: ' + esc(sys) + ")</small>";
    }
    document.getElementById("settingsTarget").textContent = CEC.derive.formatAmount(data.config.dailyTarget, cur) + " / day";
    document.getElementById("settingsCurrency").textContent = cur;
    document.getElementById("settingsStatus").textContent = data.offline ? "Offline (snapshot data)" : "Live (Google Sheets)";
  }
```

- [ ] **Step 4: Student-search re-render uses `viewData()`**

Change the `#studentSearch` input handler (`js/app.js:303-310`) to:

```js
  const studentSearch = document.getElementById("studentSearch");
  if (studentSearch) {
    studentSearch.addEventListener("input", () => {
      if (currentData && CEC.viewModels.pageForHash(location.hash) === "students") {
        renderStudents(viewData());
      }
    });
  }
```

- [ ] **Step 5: Syntax check + unit regression**

Run: `node --check js/app.js` — expected no output, exit 0.
Run: `node scripts/test.js` — expected all unit PASS (view-models additions).

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "feat: route renderers through year-filtered view data"
```

---

## Task 6: Dropdown helper + remove blanket stub toast

**Files:**
- Modify: `js/app.js`
- Modify: `index.html` (one line)

- [ ] **Step 1: Add `<div id="menuRoot">` mount**

In `index.html`, just before the toast div (line 496), add:

```html
  <div id="menuRoot"></div>
```

- [ ] **Step 2: Add the dropdown helper**

In `js/app.js`, after `showToast` (line 15), add:

```js
  const menuRoot = document.getElementById("menuRoot");
  let openMenuEl = null;

  function closeMenu() {
    if (!openMenuEl) return;
    openMenuEl.remove();
    document.querySelectorAll("[aria-expanded]").forEach(b => b.setAttribute("aria-expanded", "false"));
    openMenuEl = null;
  }

  function openMenu(anchor, panelHtml) {
    closeMenu();
    const rect = anchor.getBoundingClientRect();
    const panel = document.createElement("div");
    panel.className = "menu-panel";
    panel.setAttribute("role", "menu");
    panel.innerHTML = panelHtml;
    panel.style.position = "fixed";
    panel.style.top = Math.max(8, rect.bottom + 6) + "px";
    panel.style.left = Math.max(8, rect.left) + "px";
    panel.addEventListener("click", () => {});
    menuRoot.appendChild(panel);
    openMenuEl = panel;
    anchor.setAttribute("aria-expanded", "true");
  }

  function bindMenuToggle(anchor, buildPanel) {
    anchor.addEventListener("click", ev => {
      ev.stopPropagation();
      ev.preventDefault();
      if (openMenuEl) closeMenu();
      else openMenu(anchor, buildPanel());
    });
  }

  document.addEventListener("click", ev => {
    if (openMenuEl && !openMenuEl.contains(ev.target)) closeMenu();
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape") closeMenu();
  });
```

- [ ] **Step 3: Replace the blanket toast with explicit stub toasts**

Remove lines 27-30 (`document.querySelectorAll(".workspace-select, .icon-btn, .text-btn, .more-btn, .btn-light, .stock-alert button").forEach(...)`) and replace with explicit stubs for the 5B controls only:

```js
  document.querySelectorAll(".more-btn, .btn.btn-light, .profile-mini").forEach(button => {
    button.addEventListener("click", () => showToast("This control is wired in the Controls stage (export, menus, profile)."));
  });
```

> Note: `.stock-alert button` and `.text-btn` are excluded because they already bind via `[data-go]` at lines 23-25. Workspace-select, `[aria-label="Search"]`, and `[aria-label="Notifications"]` are removed from the automatic stub because the next tasks wire them explicitly.

- [ ] **Step 4: Syntax check**

Run: `node --check js/app.js` — expected no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add js/app.js index.html
git commit -m "refactor: reusable menu dropdown and explicit stub toasts"
```

---

## Task 7: Workspace selector — year dropdown + switch

**Files:**
- Modify: `js/app.js`
- Modify: `css/app.css`

- [ ] **Step 1: Add workspace-selector wiring**

In `js/app.js`, after the `[data-go]` binding block (line 25), add:

```js
  function renderWorkspaceYears(currentData, anchor) {
    const years = CEC.viewModels.availableYears(currentData.students, currentData.config);
    if (!years.length) {
      showToast("No academic years found yet.");
      return;
    }
    const cur = activeYear || currentData.config.activeYear || "";
    openMenu(anchor, years.map(y =>
      '<button class="menu-item" role="menuitem" data-year="' + esc(y) + '">' +
        esc(y) +
        (y === cur ? ' <span class="menu-check">✓</span>' : "") +
      "</button>").join(""));
    menuRoot.querySelector('[data-year="' + cur + '"]')?.scrollIntoView({ block: "nearest" });
  }

  const workspaceSelect = document.querySelector(".workspace-select");
  if (workspaceSelect) {
    bindMenuToggle(workspaceSelect, () => {
      if (!currentData) return closeMenu() || "";
      closeMenu();
      renderWorkspaceYears(currentData, workspaceSelect);
      return "";
    });
    workspaceSelect.addEventListener("click", ev => {
      const btn = ev.target.closest("[data-year]");
      if (!btn) return;
      ev.stopPropagation();
      const year = btn.dataset.year;
      const b = workspaceSelect.querySelector("b");
      if (b) b.textContent = year;
      activeYear = year;
      closeMenu();
      if (currentData) {
        const page = CEC.viewModels.pageForHash(location.hash);
        renderers[page](viewData());
      }
      showToast("Switched to " + year);
    });
  }
```

> Because the year-option buttons are re-created on each open (the menu rebuilds), the click handler is delegated on the anchor. `closeMenu() || ""` keeps the toggle single-action when data isn't ready. The label (`b`) always mirrors `activeYear`.

- [ ] **Step 2: Add dropdown CSS**

Append to `css/app.css`:

```css
.menu-panel{position:fixed;z-index:60;min-width:180px;max-width:300px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(23,32,51,.16);padding:6px;display:flex;flex-direction:column;gap:2px}.menu-item{display:flex;align-items:center;gap:8px;width:100%;border:0;background:none;text-align:left;font-size:12px;color:#29364b;padding:8px 10px;border-radius:7px;cursor:pointer}.menu-item:hover{background:#f1f5fb}.menu-check{margin-left:auto;color:var(--primary)}
```

- [ ] **Step 3: Syntax check**

Run: `node --check js/app.js` — expected no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add js/app.js css/app.css
git commit -m "feat: wire academic-year workspace selector"
```

---

## Task 8: Notifications bell — derived alerts dropdown + badge

**Files:**
- Modify: `js/app.js`
- Modify: `css/app.css`

- [ ] **Step 1: Add bell wiring**

In `js/app.js`, after the workspace-selector block, add:

```js
  const notificationBtn = document.querySelector(".notification");
  function renderBell() {
    if (!notificationBtn || !currentData) return;
    const alerts = CEC.viewModels.notifications(viewData());
    const dot = notificationBtn.querySelector("i");
    if (dot) dot.hidden = alerts.length === 0;
    bindMenuToggle(notificationBtn, () => {
      const panel = alerts.length
        ? alerts.map(a =>
            '<button class="menu-item bell-item" role="menuitem" data-href="' + a.href + '">' +
              '<span class="bell-icon ' + a.color + '">' + a.icon + "</span>" +
              "<span><b>" + esc(a.title) + "</b><small>" + esc(a.desc) + "</small>" +
              (a.timeLabel ? "<small>" + esc(a.timeLabel) + "</small>" : "") +
              "</span></button>").join("")
        : '<div class="bell-empty">All clear — no alerts today.</div>';
      return panel;
    });
    menuRoot.addEventListener("click", ev => {
      const item = ev.target.closest("[data-href]");
      if (!item) return;
      ev.stopPropagation();
      closeMenu();
      location.hash = item.dataset.href;
    });
  }
  renderBell();
```

> The menuRoot click delegate handles all dropdown item navigation (workspace `data-year` handled separately by the anchor delegate; `data-href` items here). `renderBell()` runs once at load; after a write, call it again from `refreshAll` below.

- [ ] **Step 2: Refresh the bell after writes**

In `refreshAll()` (`js/app.js:298-301`), append a renderBell call:

```js
  async function refreshAll() {
    CEC.clearCache();
    await route();
    renderBell();
  }
```

- [ ] **Step 3: Add bell CSS**

Append to `css/app.css`:

```css
.bell-item{align-items:flex-start;gap:10px}.bell-item b{display:block;font-size:12px;color:#29364b}.bell-item small{display:block;color:#8b97a7;font-size:10px;margin-top:2px}.bell-icon{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-weight:700;font-size:11px;flex:none}.bell-icon.amber,.bell-icon.warn{background:#fff2d9;color:#c08a1e}.bell-icon.green{background:#e4f7ec;color:#1d9e66}.bell-icon.blue{background:#e8efff;color:#3b6ae0}.bell-empty{padding:18px 14px;text-align:center;color:#8b97a7;font-size:11px}
```

- [ ] **Step 4: Syntax check**

Run: `node --check js/app.js` — expected no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add js/app.js css/app.css
git commit -m "feat: wire notifications bell with derived alerts"
```

---

## Task 9: Global search — dropdown with grouped results

**Files:**
- Modify: `js/app.js`
- Modify: `css/app.css`

- [ ] **Step 1: Add search wiring**

In `js/app.js`, after the bell block, add:

```js
  const searchBtn = document.querySelector('[aria-label="Search"]');
  const searchInput = document.getElementById("studentSearch");
  if (searchBtn) {
    bindMenuToggle(searchBtn, () => {
      const prefill = searchInput ? searchInput.value.trim() : "";
      return '<div class="search-panel">' +
        '<input class="search-input" type="search" placeholder="Search students, books, payments…" value="' + esc(prefill) + '">' +
        '<div class="search-results"></div></div>';
    });
    menuRoot.addEventListener("input", ev => {
      if (!ev.target.classList.contains("search-input")) return;
      ev.stopPropagation();
      runSearch();
    });
    menuRoot.addEventListener("click", ev => {
      const hit = ev.target.closest("[data-search-go]");
      if (!hit) return;
      ev.stopPropagation();
      closeMenu();
      const page = hit.dataset.searchGo;
      const q = hit.dataset.searchQ || "";
      if (page === "students" && searchInput) {
        searchInput.value = q;
        location.hash = "#students";
        // hashchange event may not fire if already on students; re-render directly
        if (CEC.viewModels.pageForHash(location.hash) === "students") {
          renderStudents(viewData());
        }
      } else {
        location.hash = "#" + page;
      }
    });

    function runSearch() {
      const panel = document.querySelector(".search-panel");
      if (!panel) return;
      const input = panel.querySelector(".search-input");
      const results = document.querySelector(".search-results");
      if (!input || !results) return;
      const query = input.value.trim();
      if (!currentData) { results.innerHTML = ""; return; }
      const g = CEC.viewModels.globalSearch(viewData(), query);
      if (!query) {
        results.innerHTML = '<div class="search-hint">Type to search students, books, and payments.</div>';
        return;
      }
      const allEmpty = !g.students.length && !g.books.length && !g.payments.length;
      if (allEmpty) {
        results.innerHTML = '<div class="search-hint">No results for &ldquo;' + esc(query) + "&rdquo;.</div>";
        return;
      }
      const rows = (label, arr, go, fields) =>
        arr.length ? '<div class="search-group"><h4>' + label + "</h4>" +
          arr.map(r =>
            '<button class="menu-item search-hit" role="menuitem" data-search-go="' + go + '" data-search-q="' + esc(query) + '">' +
              fields(r).map(f => "<span>" + esc(f) + "</span>").join("") +
            "</button>").join("") + "</div>" : "";
      results.innerHTML =
        rows("Students", g.students, "students", s => [s.name, s.studentId, s.className]) +
        rows("Books", g.books, "books", b => [b.subject, b.publisher]) +
        rows("Payments", g.payments, "payments", p => [p.studentName, p.paymentId]);
    }
    menuRoot.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      const panel = document.querySelector(".search-panel");
      if (panel) { closeMenu(); ev.stopPropagation(); }
    });
  }
```

> Search queries run against the **year-filtered** view, so results respect the active year. Student result navigation pre-fills the students page's existing `#studentSearch` and re-filters via `renderStudents(viewData())`.

- [ ] **Step 2: Add search CSS**

Append to `css/app.css`:

```css
.search-panel{width:320px;max-width:calc(100vw - 24px)}.search-panel .search-input{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12px;margin-bottom:6px;outline:none}.search-panel .search-input:focus{border-color:var(--primary)}.search-results{max-height:340px;overflow:auto}.search-group h4{margin:8px 4px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#8b97a7}.search-hit{flex-direction:column;align-items:flex-start;gap:1px}.search-hit span{font-size:11px;color:#526178}.search-hit span:first-child{font-weight:700;color:#29364b;font-size:12px}.search-hint{padding:16px 12px;text-align:center;color:#8b97a7;font-size:11px}
```

- [ ] **Step 3: Syntax check**

Run: `node --check js/app.js` — expected no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add js/app.js css/app.css
git commit -m "feat: wire global search dropdown"
```

---

## Task 10: Full unit run + browser E2E harness

**Files:**
- Create: `cec-controls-e2e.cjs` (throwaway, under Temp dir, not committed)

- [ ] **Step 1: Unit regression**

Run: `node scripts/test.js`
Expected: all PASS, exit code 0. Count should be **prior total + 22 new** (4+5+5+4 availableYears/filterYear/globalSearch/notifications, plus 4-year × 0 — see actual run; trust `PASS` lines + exit 0).

- [ ] **Step 2: Write the E2E harness**

Create `cec-controls-e2e.cjs` in `C:\Users\SANDRA\AppData\Local\Temp\opencode\` following the Stage 04 CDP harness pattern (static server on `localhost:8123`, stub `fetch` for `data/*.json` with multi-year fixtures so the year switch is exercisable). Core assertions:

1. Workspace selector: click → panel opens listing `2026/2027` (checked) and `2025/2026`; click `2025/2026` → `.workspace-select b` text = `2025/2026`, KPI `metricTotalStudents` updates to the 2025 subset, `#pageTitle` unchanged (same page).
2. Bell: `.notification i` visible; click → dropdown lists ≥2 alerts; click an `#inventory` alert → hash becomes `#inventory`.
3. Search: click search icon → input autofocused; type `abena` → Students group shows ≥1 hit; click → hash `#students` and `#studentSearch` value = `abena` and `studentsBody` rows filtered.
4. Outside-click closes open dropdown; `Escape` closes too.
5. Stub toast for a `.btn.btn-light` still toasts (5B pending control).
6. Close all.

- [ ] **Step 3: Run harness**

Run: `node cec-controls-e2e.cjs`
Expected: all assertions PASS, 0 console errors.

- [ ] **Step 4: Nightly regression — existing browser harnesses**

Re-run Stage 04's `cec-browser-e2e.cjs` and `cec-write-e2e.cjs` against the serving tree to confirm no router/write regressions. Expected: prior PASS counts.

- [ ] **Step 5: Commit final**

```bash
git add js/app.js css/app.css index.html js/view-models.js scripts/test.js
git commit -m "test: stage 5A browser E2E for year bell search"
```

---

## Self-Review

**Spec coverage check (5A sections):** §2.1 filter+state ✓ (Task 2, 5); §2.2 derive-from-student ✓ (Task 2, unmatched→config); §2.3 dropdown component ✓ (Task 6); §3.1 workspace selector ✓ (Task 7, includes settings display Task 5 Step 3); §3.2 notifications + badge ✓ (Task 4, 8, incl. `notifications(dataset).length` badge semantics); §3.3 global search ✓ (Task 3, 9, incl. pre-fill + re-filter); §4 stub unwiring ✓ (Task 6, explicit stubs for 5B controls only); §5 module placement ✓ (view-models pure, app wiring, css, index mount); §6.1/6.2 tests ✓ (Task 1-4 units, Task 10 E2E).

**Adjustments from spec made during planning (flagged):**
- Activity is **year-independent** (no `student_id` in `data/activity.json`) — spec §2.2 said "same join rule" for activity; corrected here.
- Section 3.4/3.5/3.6 (export, more-menus, profile) are **excluded** from this plan — they are Stage 5B per the approved split.

**Placeholder scan:** All code steps contain full implementations; no TBD/TODO.
**Type consistency:** `filterYear(dataset, year, opts)` signature unchanged across Task 2, 5, notifications fixtures; `notifications(dataset)` takes a filtered snapshot everywhere; `globalSearch(data, query)` returns `{students, books, payments}`.

**One spec detail deferred:** search against offline fallback uses `viewData()` regardless of `offline` — same data the views render; acceptable.