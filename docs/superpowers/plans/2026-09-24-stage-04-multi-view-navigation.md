# Stage 04 — Implementation Plan: Multi-View Navigation

**Date:** 2026-09-24
**Status:** Plan ready for approval
**Spec:** `docs/superpowers/specs/2026-09-24-stage-04-multi-view-navigation-design.md`

## Goal

Every sidebar nav item in the single-page CEC Books dashboard opens a **real, data-backed
page**, switched client-side via a hash router. The app stays a single `index.html` SPA, is
deep-linkable (`/#students`, `/#reports`, …), and every view reads from **one shared dataset
load**. Unknown hashes fall back to the dashboard. The old "module is ready for the next
implementation stage" stub toast is removed; the "View payments →" / "See all →" text buttons
navigate to the Payments page; file-write flows repaint whichever view is currently active.

## Architecture decisions (from spec §5 and the approved brainstorming)

1. **Single shared load.** New `CEC.getAllData()` memoizes one normalized dataset
   (`students`, `payments`, `activity`, `books`, `config` + `offline` + `lastSynced`).
   `getDashboardData()` is re-derived from it and keeps its exact public shape so the
   Stage 02 browser harness assertions still hold (`offline`, `kpis.totalStudents === 9`,
   `readyToIssue === 4`, `paymentsToday === 1200`, `lastSynced`). `clearCache()` also drops
   the shared dataset.
2. **Pure view models.** New `js/view-models.js` (UMD, mirrored on `js/derive.js`) holds
   `PAGES`, `pageForHash`, `methodSummary`, `classTotals`, `stockStatus`,
   `studentOutstanding`, `outstandingList`. It has **no browser globals at call time**, so it
   is unit-testable in Node via `require("../js/view-models.js")`.
3. **Hash router in `app.js`.** `location.hash` is the single source of truth. `hashchange`
   + initial load both call `route()`; `route()` hides/shows `.page` sections, toggles the
   active nav item, ensures data, and calls the page renderer. No new files, no new globals
   beyond `window.CEC.refreshAll`.
4. **Shared shell.** `#offlinePill` and `#dataFreshness` move to direct children of
   `#content` (page-level, persist across views). Each `.page` section carries its own
   `page-head` (eyebrow, title, description, optional action button reusing the existing
   `[data-action]` dialogs).
5. **Post-write repaint.** `js/app.js` exposes `refreshAll()` = `clearCache()` + `route()`.
   `js/write.js`'s `runAndRefresh` calls it instead of `clearCache` + `renderDashboard`, so a
   POST repaints whichever view is active.
6. **Derived Reports/Settings.** Reports = method summary + class totals + outstanding list
   (all from `viewModels`). Settings = `config.activeYear`, `dailyTarget`, `currency`, and
   live/offline status. No new data fetched.
7. **`data-go` links.** Dashboard "View payments →" and "See all →" get `data-go="payments"`;
   the stock-alert "Review →" gets `data-go="inventory"`. `[data-go]` clicks set
   `location.hash`. The generic "will be wired later" toast handler skips elements that carry
   `data-action` or `data-go`.

## Task list

Each task is self-contained, ends with a passing verification command, and is committed
separately. Commit messages use the repo's lowercase `prefix:` style.

**Task numbering is the commit order.**

---

### Task 1 — `js/view-models.js` (pure) + unit tests

**TDD: write the tests first, watch them FAIL, then add the module and watch them PASS.**

#### 1a. Append tests to `scripts/test.js`

Add at the top, next to the existing requires:

```js
const vm = require("../js/view-models.js");
```

Append at the end of the file (before the closing summary `console.log`, or simply at EOF —
the file is a flat script of `test(...)` calls):

```js
const FIXTURE_STUDENTS = [
  { studentId: "S1", name: "Ama", className: "JS 1", booksTotal: 1200, booksPaid: 1200 },
  { studentId: "S2", name: "Kwame", className: "JS 1", booksTotal: 1200, booksPaid: 500 },
  { studentId: "S3", name: "Efua", className: "BS 2", booksTotal: 1400, booksPaid: 0 }
];
const FIXTURE_PAYMENTS = [
  { paymentId: "P1", studentName: "Ama", className: "JS 1", amount: 1000, method: "Cash" },
  { paymentId: "P2", studentName: "Kwame", className: "JS 1", amount: 2000, method: "MTN MoMo" },
  { paymentId: "P3", studentName: "Efua", className: "BS 2", amount: 1500, method: "Telecel" },
  { paymentId: "P4", studentName: "Kwame", className: "JS 1", amount: 500, method: "cash" }
];
const FIXTURE_BOOKS = [
  { bookId: "B1", subject: "English", publisher: "A", stockQty: 20, lowStockThreshold: 5 },
  { bookId: "B2", subject: "Maths", publisher: "B", stockQty: 4, lowStockThreshold: 5 },
  { bookId: "B3", subject: "Science", publisher: "C", stockQty: 0, lowStockThreshold: 3 }
];

test("viewModels.pageForHash maps known hashes", () => {
  assert.equal(vm.pageForHash("#payments"), "payments");
  assert.equal(vm.pageForHash("#students"), "students");
  assert.equal(vm.pageForHash("#reports"), "reports");
  assert.equal(vm.pageForHash("#settings"), "settings");
});

test("viewModels.pageForHash falls back to dashboard for empty/unknown", () => {
  assert.equal(vm.pageForHash(""), "dashboard");
  assert.equal(vm.pageForHash("#bogus"), "dashboard");
  assert.equal(vm.pageForHash(null), "dashboard");
});

test("viewModels.pageForHash is case-insensitive", () => {
  assert.equal(vm.pageForHash("#INVENTORY"), "inventory");
});

test("viewModels.methodSummary buckets by method and shares of total", () => {
  const s = vm.methodSummary(FIXTURE_PAYMENTS);
  assert.equal(s.length, 3);
  assert.deepEqual(
    s.map(r => ({ key: r.key, total: r.total, share: r.share })),
    [
      { key: "cash", total: 1500, share: 30 },
      { key: "momo", total: 2000, share: 40 },
      { key: "telecel", total: 1500, share: 30 }
    ]
  );
});

test("viewModels.methodSummary on empty list returns zero rows", () => {
  const s = vm.methodSummary([]);
  assert.deepEqual(s.map(r => r.total), [0, 0, 0]);
  assert.deepEqual(s.map(r => r.share), [0, 0, 0]);
});

test("viewModels.classTotals groups by class and sorts desc", () => {
  assert.deepEqual(vm.classTotals(FIXTURE_PAYMENTS), [
    { className: "JS 1", total: 3500 },
    { className: "BS 2", total: 1500 }
  ]);
});

test("viewModels.stockStatus flags OK / Low / Out with counts", () => {
  const inv = vm.stockStatus(FIXTURE_BOOKS);
  assert.equal(inv.totalTitles, 3);
  assert.equal(inv.okCount, 1);
  assert.equal(inv.lowCount, 1);
  assert.equal(inv.outCount, 1);
  assert.deepEqual(inv.rows.map(r => r.status), ["OK", "Low", "Out"]);
});

test("viewModels.studentOutstanding is never negative", () => {
  assert.equal(vm.studentOutstanding({ booksTotal: 1200, booksPaid: 500 }), 700);
  assert.equal(vm.studentOutstanding({ booksTotal: 1200, booksPaid: 1400 }), 0);
  assert.equal(vm.studentOutstanding({ booksTotal: undefined, booksPaid: 0 }), 0);
});

test("viewModels.outstandingList filters and sorts desc", () => {
  assert.deepEqual(vm.outstandingList(FIXTURE_STUDENTS).map(r => r.studentId), ["S3", "S2"]);
  assert.deepEqual(
    vm.outstandingList(FIXTURE_STUDENTS).map(r => r.balance),
    [1400, 700]
  );
});
```

Run the suite and confirm the new tests are the only failures:

```powershell
$env:TZ="Asia/Tokyo"; node scripts/test.js; $env:TZ=""
```

#### 1b. Create `js/view-models.js`

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.viewModels = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PAGES = {
    dashboard: { title: "Dashboard", eyebrow: "Overview" },
    students: { title: "Students", eyebrow: "Operations" },
    payments: { title: "Payments", eyebrow: "Operations" },
    books: { title: "Books & Packages", eyebrow: "Operations" },
    inventory: { title: "Inventory", eyebrow: "Operations" },
    issuing: { title: "Issue Books", eyebrow: "Operations" },
    reports: { title: "Reports", eyebrow: "Insights" },
    settings: { title: "Settings", eyebrow: "Insights" }
  };

  function pageForHash(hash) {
    const raw = String(hash || "").replace(/^#/, "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : "dashboard";
  }

  function classifyMethod(method) {
    const m = String(method || "").toLowerCase();
    if (m.indexOf("momo") !== -1) return "momo";
    if (m.indexOf("telecel") !== -1) return "telecel";
    return "cash";
  }

  function methodSummary(payments) {
    const bucket = { cash: 0, momo: 0, telecel: 0 };
    let grand = 0;
    (payments || []).forEach(p => {
      bucket[classifyMethod(p.method)] += p.amount;
      grand += p.amount;
    });
    return Object.keys(bucket).map(key => ({
      key,
      label: key === "cash" ? "Cash" : key === "momo" ? "MTN MoMo" : "Telecel",
      total: bucket[key],
      share: grand > 0 ? Math.round((bucket[key] / grand) * 100) : 0
    }));
  }

  function classTotals(payments) {
    const map = {};
    (payments || []).forEach(p => {
      const k = p.className || "\u2014";
      map[k] = (map[k] || 0) + p.amount;
    });
    return Object.keys(map)
      .map(k => ({ className: k, total: map[k] }))
      .sort((a, b) => b.total - a.total);
  }

  function stockStatus(books) {
    const rows = (books || []).map(b => {
      const status = b.stockQty <= 0 ? "Out" : b.stockQty <= b.lowStockThreshold ? "Low" : "OK";
      return {
        bookId: b.bookId,
        subject: b.subject,
        publisher: b.publisher,
        stockQty: b.stockQty,
        lowStockThreshold: b.lowStockThreshold,
        status
      };
    });
    return {
      rows,
      totalTitles: rows.length,
      okCount: rows.filter(r => r.status === "OK").length,
      lowCount: rows.filter(r => r.status === "Low").length,
      outCount: rows.filter(r => r.status === "Out").length
    };
  }

  function studentOutstanding(student) {
    return Math.max(0, (student.booksTotal || 0) - (student.booksPaid || 0));
  }

  function outstandingList(students) {
    return (students || [])
      .map(s => ({
        studentId: s.studentId,
        name: s.name,
        className: s.className,
        balance: studentOutstanding(s)
      }))
      .filter(r => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }

  return {
    PAGES,
    pageForHash,
    classifyMethod,
    methodSummary,
    classTotals,
    stockStatus,
    studentOutstanding,
    outstandingList
  };
});
```

#### Verify

```powershell
$env:TZ="Asia/Tokyo"; node scripts/test.js; $env:TZ=""
```

**All tests pass, including the 10 new `viewModels.*` tests (52 → 62).**

#### Commit

```
git add js/view-models.js scripts/test.js
git commit -m "feat: stage 04 view models with unit tests"
```

---

### Task 2 — `js/data-access.js`: shared `getAllData()`

Replace the body of `data-access.js` so the dataset is memoized and `getDashboardData()` is
derived from it. Everything above `getDashboardData` (`loadMeta`, `gvizUrl`, `tabUrl`,
`fetchWithTimeout`, `loadLocal`, `sessionCache`, `fetchTab`, `anyTabLive`) and everything
from `fetchOptions` down (`setForceOffline`, the `forceOffline` accessor, the
`Object.assign(window.CEC, …)` export block) is **unchanged**. Only the middle section is
replaced:

```js
  let sessionData = null;

  async function getAllData() {
    if (sessionData) return sessionData;
    CEC.meta = await loadMeta();

    const [studentsRows, paymentsRows, activityRows, booksRows, configRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Payments", "payments.json"),
      fetchTab("Activity", "activity.json"),
      fetchTab("Books", "books.json"),
      fetchTab("Config", "config.json")
    ]);

    const students = CEC.derive.normalizeStudents(studentsRows);
    const payments = CEC.derive.normalizePayments(paymentsRows);
    const activity = CEC.derive.normalizeActivity(activityRows);
    const books = CEC.derive.normalizeBooks(booksRows);
    const config = CEC.derive.normalizeConfig(configRows);

    sessionData = {
      students,
      payments,
      activity,
      books,
      config,
      lastSynced: (CEC.meta && CEC.meta.last_synced) || config.lastSynced,
      offline: !anyTabLive()
    };
    return sessionData;
  }

  async function getDashboardData() {
    const data = await getAllData();
    const dashboard = CEC.derive.buildDashboard(data.students, data.payments, data.activity, data.books, data.config);
    dashboard.lastSynced = data.lastSynced;
    dashboard.offline = data.offline;
    return dashboard;
  }

  function clearCache() {
    Object.keys(sessionCache).forEach(k => delete sessionCache[k]);
    sessionData = null;
  }
```

Add `getAllData: getAllData,` to the `Object.assign(window.CEC, { … })` exports.

**Notes**
- `getDashboardData()` keeps its exact return shape (`kpis`, `chart`, `readiness`,
  `recentPayments`, `activityFeed`, `stockLowCount`, `currency`, `lastSynced`, `offline`) so
  the Stage 02 harness assertions in `cec-browser-e2e.cjs:120-128` and `:141-146` still pass.
- Memoization is safe for that harness because every scenario does a full page navigation
  (fresh JS context → `sessionData` is null again).
- The write path refreshes by `refreshAll()` → `clearCache()` (which now also nulls
  `sessionData`) → `route()` → refetch.

**DO NOT change** `fetchOptions`; it keeps its own two-tab fetch and feeds the dialog
dropdowns. Resetting `sessionData` on `clearCache` prevents stale-view reads after a write.

#### Verify

```powershell
node --check js/data-access.js
$env:TZ="Asia/Tokyo"; node scripts/test.js; $env:TZ=""
```

**62/62 pass (regression green).**

#### Commit

```
git add js/data-access.js
git commit -m "feat: stage 04 shared dataset load via getAllData"
```

---

### Task 3 — `index.html` page shells + `css/app.css` styles

#### 3a. Rewrite the `.content` block

Replace the entire current `<section class="content" id="content"> … </section>` element
(index.html lines 92-193) with the markup below. The dashboard's inner widgets
(`metric-grid`, `dashboard-grid`, `bottom-grid`) keep their existing ids/text verbatim —
they are simply wrapped in `<section class="page" id="page-dashboard">`. The two text buttons
and the stock-alert button gain `data-go`. `#offlinePill` and `#dataFreshness` move up to be
direct children of `#content`.

```html
      <section class="content" id="content">
        <div class="offline-pill" id="offlinePill" hidden>Offline mode</div>
        <div class="data-freshness" id="dataFreshness"></div>

        <section class="page" id="page-dashboard">
          <div class="page-head">
            <div>
              <p class="eyebrow">Overview</p>
              <h1>Good afternoon, David.</h1>
              <p class="muted">Here is what is happening with books and payments today.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-light" type="button">Export report</button>
              <button class="btn btn-primary" type="button" data-action="payment">+ Record payment</button>
            </div>
          </div>

          <div class="notice">
            <div class="notice-icon">↗</div>
            <div>
              <b>2026/2027 academic year is active</b>
              <span>Package prices and book entitlements are currently being recorded against this year.</span>
            </div>
            <button class="notice-close" aria-label="Dismiss">×</button>
          </div>

          <div class="metric-grid">
            <article class="metric-card">
              <div class="metric-top"><span>Total students</span><span class="metric-icon blue">♙</span></div>
              <strong id="metricTotalStudents">—</strong>
              <div class="metric-foot"><span class="positive" id="metricStudentsFoot">0</span> enrolled this term</div>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Payments today</span><span class="metric-icon green">₵</span></div>
              <strong id="metricPaymentsToday">—</strong>
              <div class="metric-foot"><span class="positive" id="metricPaymentsFoot">0%</span> of daily target</div>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Ready to issue</span><span class="metric-icon amber">⇧</span></div>
              <strong id="metricReadyToIssue">—</strong>
              <div class="metric-foot"><span class="warning" id="metricReadyFoot">0</span> students waiting</div>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Outstanding</span><span class="metric-icon red">!</span></div>
              <strong id="metricOutstanding">—</strong>
              <div class="metric-foot"><span class="muted" id="metricOutstandingFoot">Across 0 students</span></div>
            </article>
          </div>

          <div class="dashboard-grid">
            <section class="panel collection-panel">
              <div class="panel-head">
                <div><h2>Collection overview</h2><p>Payments recorded in the last 7 days.</p></div>
                <button class="text-btn" data-go="payments">View payments →</button>
              </div>
              <div class="chart-wrap">
                <div class="chart-y"><span>8k</span><span>6k</span><span>4k</span><span>2k</span><span>0</span></div>
                <div class="chart">
                  <div class="grid-line g1"></div><div class="grid-line g2"></div><div class="grid-line g3"></div><div class="grid-line g4"></div>
                  <div class="bars" id="chartBars"></div>
                  <div class="chart-x" id="chartX"></div>
                </div>
              </div>
              <div class="legend"><span><i class="legend-dot cash"></i> Cash</span><span><i class="legend-dot momo"></i> Mobile Money</span></div>
            </section>

            <section class="panel readiness-panel">
              <div class="panel-head">
                <div><h2>Book readiness</h2><p>Current entitlement status.</p></div>
                <button class="more-btn">•••</button>
              </div>
              <div class="donut-row">
                <div class="donut"><div><b id="donutPct">0%</b><span>covered</span></div></div>
                <div class="status-list">
                  <div><span><i class="status-dot ready"></i>Ready to issue</span><b id="readyCount">0</b></div>
                  <div><span><i class="status-dot waiting"></i>Waiting for stock</span><b id="waitingCount">0</b></div>
                  <div><span><i class="status-dot uncovered"></i>Not covered</span><b id="uncoveredCount">0</b></div>
                </div>
              </div>
              <div class="stock-alert"><span>!</span><div><b><span id="stockLowCount">0</span> items are low in stock</b><small>Review inventory before the next issuing session.</small></div><button data-go="inventory">Review →</button></div>
            </section>
          </div>

          <div class="bottom-grid">
            <section class="panel">
              <div class="panel-head">
                <div><h2>Recent payments</h2><p>Latest transactions across the active academic year.</p></div>
                <button class="text-btn" data-go="payments">See all →</button>
              </div>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
                  <tbody id="recentPaymentsBody"></tbody>
                </table>
              </div>
            </section>

            <section class="panel activity-panel">
              <div class="panel-head"><div><h2>Activity</h2><p>Latest system events.</p></div><button class="more-btn">•••</button></div>
              <div class="activity" id="activityFeed"></div>
            </section>
          </div>
        </section>

        <section class="page" id="page-students" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Operations</p>
              <h1>Students</h1>
              <p class="muted">Registered students for the active academic year.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-primary" type="button" data-action="student">+ Register student</button>
            </div>
          </div>
          <section class="panel">
            <div class="panel-head">
              <div><h2>All students</h2><p>Books fee, payments and entitlement status.</p></div>
              <span class="count-note" id="studentCount">—</span>
            </div>
            <div class="search-wrap">
              <input class="search-input" id="studentSearch" type="search" placeholder="Search by name, ID or class…" autocomplete="off">
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Gender</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
                <tbody id="studentsBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="page" id="page-payments" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Operations</p>
              <h1>Payments</h1>
              <p class="muted">All payments recorded this academic year.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-light" type="button">Export report</button>
              <button class="btn btn-primary" type="button" data-action="payment">+ Record payment</button>
            </div>
          </div>
          <div class="chip-row" id="methodChips"></div>
          <section class="panel">
            <div class="panel-head">
              <div><h2>Payment history</h2><p>Newest first.</p></div>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Ref</th><th>Student</th><th>Class</th><th>Amount</th><th>Method</th><th>Date</th><th>Status</th></tr></thead>
                <tbody id="paymentsBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="page" id="page-books" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Operations</p>
              <h1>Books &amp; Packages</h1>
              <p class="muted">Pricing and entitlements on offer this year.</p>
            </div>
          </div>
          <section class="panel">
            <div class="panel-head">
              <div><h2>Book catalogue</h2><p>Price per title and current stock.</p></div>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>ID</th><th>Subject</th><th>Publisher</th><th>Price</th><th>Stock</th></tr></thead>
                <tbody id="booksBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="page" id="page-inventory" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Operations</p>
              <h1>Inventory</h1>
              <p class="muted">Stock levels per title.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-primary" type="button" data-action="stock">+ Adjust stock</button>
            </div>
          </div>
          <div class="metric-grid" id="inventoryCards"></div>
          <section class="panel">
            <div class="panel-head">
              <div><h2>Stock levels</h2><p>Low stock is flagged at or below each title's threshold.</p></div>
            </div>
            <div class="table-scroll">
              <table>
                <thead><tr><th>Title</th><th>In stock</th><th>Threshold</th><th>Status</th></tr></thead>
                <tbody id="inventoryBody"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="page" id="page-issuing" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Operations</p>
              <h1>Issue Books</h1>
              <p class="muted">Students ready to receive their book package.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-primary" type="button" data-action="issue">Issue books</button>
            </div>
          </div>
          <div class="metric-grid">
            <article class="metric-card">
              <div class="metric-top"><span>Ready to issue</span><span class="metric-icon green">⇧</span></div>
              <strong id="issueReadyCount">0</strong>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Waiting for stock</span><span class="metric-icon amber">!</span></div>
              <strong id="issueWaitingCount">0</strong>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Not covered</span><span class="metric-icon red">!</span></div>
              <strong id="issueUncoveredCount">0</strong>
            </article>
          </div>
          <div class="bottom-grid">
            <section class="panel">
              <div class="panel-head"><div><h2>Ready students</h2><p>Fully covered, cleared to collect books.</p></div></div>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Student</th><th>Class</th><th>Status</th></tr></thead>
                  <tbody id="issueStudentsBody"></tbody>
                </table>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2>Stock availability</h2><p>Per-title stock heading into the next session.</p></div></div>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Title</th><th>In stock</th><th>Status</th></tr></thead>
                  <tbody id="issueBooksBody"></tbody>
                </table>
              </div>
            </section>
          </div>
        </section>

        <section class="page" id="page-reports" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Insights</p>
              <h1>Reports</h1>
              <p class="muted">Summaries derived from live payments and balances.</p>
            </div>
            <div class="head-actions">
              <button class="btn btn-light" type="button">Export report</button>
            </div>
          </div>
          <div class="metric-grid">
            <article class="metric-card">
              <div class="metric-top"><span>Cash collected</span><span class="metric-icon blue">₵</span></div>
              <strong id="reportCash">—</strong>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>MTN MoMo</span><span class="metric-icon green">₵</span></div>
              <strong id="reportMomo">—</strong>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Telecel</span><span class="metric-icon amber">₵</span></div>
              <strong id="reportTelecel">—</strong>
            </article>
            <article class="metric-card">
              <div class="metric-top"><span>Outstanding</span><span class="metric-icon red">!</span></div>
              <strong id="reportOutstanding">—</strong>
            </article>
          </div>
          <div class="bottom-grid">
            <section class="panel">
              <div class="panel-head"><div><h2>Collections by class</h2><p>Total per class, highest first.</p></div></div>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Class</th><th>Total</th></tr></thead>
                  <tbody id="reportClassBody"></tbody>
                </table>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2>Top outstanding balances</h2><p>Students owing the most.</p></div></div>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Student</th><th>Class</th><th>Balance</th></tr></thead>
                  <tbody id="reportOutstandingBody"></tbody>
                </table>
              </div>
            </section>
          </div>
        </section>

        <section class="page" id="page-settings" hidden>
          <div class="page-head">
            <div>
              <p class="eyebrow">Insights</p>
              <h1>Settings</h1>
              <p class="muted">System defaults and the active data source.</p>
            </div>
          </div>
          <div class="dashboard-grid">
            <section class="panel">
              <div class="panel-head"><div><h2>Academic year</h2><p>Currently active period.</p></div></div>
              <p class="settings-value" id="settingsYear">—</p>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2>Daily payment target</h2><p>Benchmark shown on the dashboard.</p></div></div>
              <p class="settings-value" id="settingsTarget">—</p>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2>Currency</h2><p>Symbol prefix for all amounts.</p></div></div>
              <p class="settings-value" id="settingsCurrency">—</p>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2>Data source</h2><p>Live Google Sheet or offline snapshot.</p></div></div>
              <p class="settings-value" id="settingsStatus">—</p>
            </section>
          </div>
        </section>
      </section>
```

#### 3b. Add the `view-models.js` script tag

In the script block at the end of `index.html`, insert it after `derive.js` and before
`data-access.js`:

```html
  <script src="js/csv.js"></script>
  <script src="js/derive.js"></script>
  <script src="js/view-models.js"></script>
  <script src="js/data-access.js"></script>
  <script src="js/app.js"></script>
  <script src="js/write.js"></script>
```

#### 3c. Append styles to `css/app.css`

```css
section.page[hidden]{display:none}
.count-note{color:#96a0ae;font-size:10px;font-weight:600;align-self:center}
.search-wrap{display:flex;align-items:center;gap:8px;padding:0 16px 14px}
.search-input{width:100%;max-width:340px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:11px;color:#26354b;background:#fff}
.search-input::placeholder{color:#a0a9b6}
.chip-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.chip{flex:1 1 180px;max-width:220px;background:#fff;border:1px solid #eceff3;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.chip small{color:#96a0ae;font-size:9px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.chip b{font-size:16px;color:#26354b}
.chip span{color:#a0a9b6;font-size:9px}
.pill.warn{color:#8a5a08;background:#fff3d6}
.pill.out{color:#9b1c1c;background:#fdeaea}
.pill.muted{color:#64748b;background:#eef1f5}
.empty-cell{text-align:center;color:#a0a9b6;font-size:11px;padding:24px 10px !important}
.settings-value{font-size:20px;font-weight:800;color:#26354b;padding:8px 16px 18px;margin:0}
```

#### Verify

```powershell
node --check js/view-models.js
```

No JS runtime here; visual/DOM verification happens in Task 5 via the browser harness.

#### Commit

```
git add index.html css/app.css
git commit -m "feat: stage 04 page shells and styles"
```

---

### Task 4 — `js/app.js` hash router + renderers, and `js/write.js` repaint

Replace the whole `js/app.js` file with:

```js
(() => {
  const sidebar = document.getElementById("sidebar");
  const mobileMenu = document.getElementById("mobileMenu");
  const toast = document.getElementById("toast");

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const PAGES = CEC.viewModels.PAGES;

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  mobileMenu?.addEventListener("click", () => sidebar.classList.toggle("open"));

  document.querySelector(".notice-close")?.addEventListener("click", e => {
    e.currentTarget.closest(".notice").remove();
  });

  document.querySelectorAll("[data-go]").forEach(btn => {
    btn.addEventListener("click", () => { location.hash = btn.dataset.go; });
  });

  document.querySelectorAll(".workspace-select, .icon-btn, .text-btn, .more-btn, .btn-light, .stock-alert button").forEach(button => {
    if (button.dataset.action || button.dataset.go || button.classList.contains("notice-close")) return;
    button.addEventListener("click", () => showToast("This control will be wired during the corresponding implementation stage."));
  });

  function statusPillClass(status) {
    return status === "ready" ? "success" : status === "waiting" ? "warn" : "muted";
  }

  function stockPillClass(status) {
    return status === "OK" ? "success" : status === "Low" ? "warn" : "out";
  }

  function emptyRow(cols, label) {
    return `<tr><td colspan="${cols}" class="empty-cell">${label || "No data yet."}</td></tr>`;
  }

  let currentData = null;

  function renderShell(data) {
    const fresh = document.getElementById("dataFreshness");
    fresh.textContent = data.lastSynced ? "Synced " + new Date(data.lastSynced).toLocaleString() : "";

    const pill = document.getElementById("offlinePill");
    if (data.offline) {
      pill.hidden = false;
      pill.textContent = data.lastSynced
        ? "Offline mode — data from " + new Date(data.lastSynced).toLocaleDateString()
        : "Offline mode — snapshot data";
    } else {
      pill.hidden = true;
    }
  }

  function renderDashboard(data) {
    const cur = data.config.currency;
    const dash = CEC.derive.buildDashboard(data.students, data.payments, data.activity, data.books, data.config);

    document.getElementById("metricTotalStudents").textContent = dash.kpis.totalStudents;
    document.getElementById("metricStudentsFoot").textContent = "+" + dash.kpis.enrolledThisTerm;
    document.getElementById("metricPaymentsToday").textContent = CEC.derive.formatAmount(dash.kpis.paymentsToday, cur);
    document.getElementById("metricPaymentsFoot").textContent = dash.kpis.dailyPct + "%";
    document.getElementById("metricReadyToIssue").textContent = dash.kpis.readyToIssue;
    document.getElementById("metricReadyFoot").textContent = dash.kpis.waiting;
    document.getElementById("metricOutstanding").textContent = CEC.derive.formatAmount(dash.kpis.outstandingAmount, cur);
    document.getElementById("metricOutstandingFoot").textContent = "Across " + dash.kpis.outstandingCount + " students";

    const chartBars = document.getElementById("chartBars");
    const chartX = document.getElementById("chartX");
    const maxTotal = Math.max.apply(null, dash.chart.total.concat([1]));
    chartBars.innerHTML = dash.chart.total
      .map(v => `<i style="height:${Math.round((v / maxTotal) * 100)}%"></i>`)
      .join("");
    chartX.innerHTML = dash.chart.labels.map(l => `<span>${l}</span>`).join("");

    document.getElementById("donutPct").textContent = dash.readiness.coveredPct + "%";
    document.getElementById("readyCount").textContent = dash.readiness.ready;
    document.getElementById("waitingCount").textContent = dash.readiness.waiting;
    document.getElementById("uncoveredCount").textContent = dash.readiness.uncovered;
    document.getElementById("stockLowCount").textContent = dash.stockLowCount;

    document.getElementById("recentPaymentsBody").innerHTML = dash.recentPayments
      .map(p => `
        <tr>
          <td><b>${esc(p.studentName)}</b><small>${esc(p.id)}</small></td>
          <td>${esc(p.className)}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${p.methodClass}">${esc(p.method)}</span></td>
          <td><span class="pill success">${esc(p.status)}</span></td>
        </tr>`)
      .join("");

    document.getElementById("activityFeed").innerHTML = dash.activityFeed
      .map(a => `
        <div class="activity-item">
          <span class="activity-icon ${a.color}">${a.icon}</span>
          <div><b>${esc(a.title)}</b><p>${esc(a.description)}</p><small>${a.timeLabel}</small></div>
        </div>`)
      .join("");

    renderShell(data);
  }

  function renderStudents(data) {
    const cur = data.config.currency;
    const q = document.getElementById("studentSearch").value.trim().toLowerCase();
    const rows = data.students.filter(s =>
      !q ||
      s.name.toLowerCase().indexOf(q) !== -1 ||
      s.studentId.toLowerCase().indexOf(q) !== -1 ||
      s.className.toLowerCase().indexOf(q) !== -1
    );
    document.getElementById("studentsBody").innerHTML = rows.length
      ? rows.map(s => {
          const balance = CEC.viewModels.studentOutstanding(s);
          return `
        <tr>
          <td>${esc(s.studentId)}</td>
          <td><b>${esc(s.name)}</b></td>
          <td>${esc(s.className)}</td>
          <td>${esc(s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : "")}</td>
          <td>${CEC.derive.formatAmount(s.booksPaid, cur)}</td>
          <td>${balance > 0 ? CEC.derive.formatAmount(balance, cur) : '<span class="positive">Paid</span>'}</td>
          <td><span class="pill ${statusPillClass(s.status)}">${esc(s.status)}</span></td>
        </tr>`;
        }).join("")
      : emptyRow(7);
    document.getElementById("studentCount").textContent = rows.length + " of " + data.students.length;
  }

  function renderPayments(data) {
    const cur = data.config.currency;
    document.getElementById("methodChips").innerHTML = CEC.viewModels.methodSummary(data.payments)
      .map(m => `
        <div class="chip">
          <small>${esc(m.label)}</small>
          <b>${CEC.derive.formatAmount(m.total, cur)}</b>
          <span>${m.share}% of collections</span>
        </div>`)
      .join("");

    const rows = data.payments.slice().sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) || String(b.paymentId).localeCompare(String(a.paymentId)));
    document.getElementById("paymentsBody").innerHTML = rows.length
      ? rows.map(p => `
        <tr>
          <td>${esc(p.paymentId)}</td>
          <td><b>${esc(p.studentName)}</b><small>${esc(p.studentId)}</small></td>
          <td>${esc(p.className)}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${CEC.viewModels.classifyMethod(p.method)}">${esc(p.method)}</span></td>
          <td>${esc(p.date)}</td>
          <td><span class="pill success">${esc(p.status || "Recorded")}</span></td>
        </tr>`).join("")
      : emptyRow(7);
  }

  function renderBooks(data) {
    const cur = data.config.currency;
    document.getElementById("booksBody").innerHTML = data.books.length
      ? data.books.map(b => `
        <tr>
          <td>${esc(b.bookId)}</td>
          <td><b>${esc(b.subject)}</b><small>${esc(b.category)}</small></td>
          <td>${esc(b.publisher)}</td>
          <td>${CEC.derive.formatAmount(b.price, cur)}</td>
          <td>${b.stockQty}${b.stockQty <= b.lowStockThreshold ? ' <span class="pill warn">Low</span>' : ""}</td>
        </tr>`).join("")
      : emptyRow(5);
  }

  function renderInventory(data) {
    const inv = CEC.viewModels.stockStatus(data.books);
    document.getElementById("inventoryCards").innerHTML = [
      { label: "Total titles", val: inv.totalTitles, cls: "blue", glyph: "▤" },
      { label: "In stock", val: inv.okCount, cls: "green", glyph: "✓" },
      { label: "Low stock", val: inv.lowCount, cls: "amber", glyph: "!" },
      { label: "Out of stock", val: inv.outCount, cls: "red", glyph: "!" }
    ].map(c => `
      <article class="metric-card">
        <div class="metric-top"><span>${c.label}</span><span class="metric-icon ${c.cls}">${c.glyph}</span></div>
        <strong>${c.val}</strong>
      </article>`).join("");

    document.getElementById("inventoryBody").innerHTML = inv.rows.length
      ? inv.rows.map(r => `
        <tr>
          <td><b>${esc(r.subject)}</b><small>${esc(r.publisher)}</small></td>
          <td>${r.stockQty}</td>
          <td>${r.lowStockThreshold}</td>
          <td><span class="pill ${stockPillClass(r.status)}">${r.status}</span></td>
        </tr>`).join("")
      : emptyRow(4);
  }

  function renderIssuing(data) {
    const readiness = CEC.derive.buildReadiness(data.students);
    document.getElementById("issueReadyCount").textContent = readiness.ready;
    document.getElementById("issueWaitingCount").textContent = readiness.waiting;
    document.getElementById("issueUncoveredCount").textContent = readiness.uncovered;

    const ready = data.students.filter(s => s.status === "ready");
    document.getElementById("issueStudentsBody").innerHTML = ready.length
      ? ready.map(s => `
        <tr>
          <td><b>${esc(s.name)}</b><small>${esc(s.studentId)}</small></td>
          <td>${esc(s.className)}</td>
          <td><span class="pill success">Ready</span></td>
        </tr>`).join("")
      : emptyRow(3, "No students ready to issue yet.");

    const inv = CEC.viewModels.stockStatus(data.books);
    document.getElementById("issueBooksBody").innerHTML = inv.rows.length
      ? inv.rows.map(r => `
        <tr>
          <td><b>${esc(r.subject)}</b></td>
          <td>${r.stockQty}</td>
          <td><span class="pill ${stockPillClass(r.status)}">${r.status}</span></td>
        </tr>`).join("")
      : emptyRow(3);
  }

  function renderReports(data) {
    const cur = data.config.currency;
    const summary = CEC.viewModels.methodSummary(data.payments);
    const outstandingAmount = data.students.reduce((n, s) => n + CEC.viewModels.studentOutstanding(s), 0);
    document.getElementById("reportCash").textContent = CEC.derive.formatAmount(summary[0].total, cur);
    document.getElementById("reportMomo").textContent = CEC.derive.formatAmount(summary[1].total, cur);
    document.getElementById("reportTelecel").textContent = CEC.derive.formatAmount(summary[2].total, cur);
    document.getElementById("reportOutstanding").textContent = CEC.derive.formatAmount(outstandingAmount, cur);

    const classRows = CEC.viewModels.classTotals(data.payments);
    document.getElementById("reportClassBody").innerHTML = classRows.length
      ? classRows.map(r => `
        <tr>
          <td><b>${esc(r.className)}</b></td>
          <td>${CEC.derive.formatAmount(r.total, cur)}</td>
        </tr>`).join("")
      : emptyRow(2);

    const outRows = CEC.viewModels.outstandingList(data.students).slice(0, 10);
    document.getElementById("reportOutstandingBody").innerHTML = outRows.length
      ? outRows.map(r => `
        <tr>
          <td><b>${esc(r.name)}</b><small>${esc(r.studentId)}</small></td>
          <td>${esc(r.className)}</td>
          <td>${CEC.derive.formatAmount(r.balance, cur)}</td>
        </tr>`).join("")
      : emptyRow(3);
  }

  function renderSettings(data) {
    const cur = data.config.currency;
    document.getElementById("settingsYear").textContent = data.config.activeYear || "—";
    document.getElementById("settingsTarget").textContent = CEC.derive.formatAmount(data.config.dailyTarget, cur) + " / day";
    document.getElementById("settingsCurrency").textContent = cur;
    document.getElementById("settingsStatus").textContent = data.offline ? "Offline (snapshot data)" : "Live (Google Sheets)";
  }

  const renderers = {
    dashboard: renderDashboard,
    students: renderStudents,
    payments: renderPayments,
    books: renderBooks,
    inventory: renderInventory,
    issuing: renderIssuing,
    reports: renderReports,
    settings: renderSettings
  };

  function setActiveNav(page) {
    document.querySelectorAll(".nav-item").forEach(item =>
      item.classList.toggle("active", item.dataset.page === page));
    sidebar.classList.remove("open");
  }

  function updateShell(page) {
    document.getElementById("pageTitle").textContent = PAGES[page].title;
    document.querySelectorAll(".page").forEach(sec => {
      sec.hidden = sec.id !== "page-" + page;
    });
  }

  async function route() {
    const page = CEC.viewModels.pageForHash(location.hash);
    setActiveNav(page);
    updateShell(page);
    currentData = await CEC.getAllData();
    renderers[page](currentData);
  }

  async function refreshAll() {
    CEC.clearCache();
    await route();
  }

  const studentSearch = document.getElementById("studentSearch");
  if (studentSearch) {
    studentSearch.addEventListener("input", () => {
      if (currentData && CEC.viewModels.pageForHash(location.hash) === "students") {
        renderStudents(currentData);
      }
    });
  }

  window.CEC = window.CEC || {};
  window.CEC.refreshAll = refreshAll;

  window.addEventListener("hashchange", () => {
    route().catch(err => {
      console.error("Navigation load failed:", err);
      showToast("Could not load this view.");
    });
  });

  route().catch(err => {
    console.error("Dashboard load failed:", err);
    showToast("Could not load dashboard data.");
  });
})();
```

Then replace the `runAndRefresh` implementation in `js/write.js` (currently lines 22-29):

```js
  async function runAndRefresh(op, body) {
    try {
      await post(op, body);
    } finally {
      await root.refreshAll();
    }
  }
```

`root.refreshAll` is installed on `window.CEC` by `app.js` (which loads before `write.js`),
so this is always available at call time. Note this **removes** the
`window.CEC.renderDashboard` export — nothing else references it (confirmed: the Stage 02/03
harnesses only call `CEC.getDashboardData()`, `CEC.forceOffline`, and wrap `CEC.clearCache`).

#### Verify

```powershell
node --check js/app.js js/write.js
$env:TZ="Asia/Tokyo"; node scripts/test.js; $env:TZ=""
```

**62/62 pass.** Then run the Stage 02 + Stage 03 regression harnesses (they serve the local
working copy — the new markup/JS — so they must stay green):

```powershell
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-browser-e2e.cjs
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs
```

**Both exit 0** (browser harness: 7/7 scenarios, incl. `offline=false` live block; write
harness: 6/6 checks, incl. the `clearCache`-bump that `refreshAll` now triggers through the
same `CEC.clearCache`).

#### Commit

```
git add js/app.js js/write.js
git commit -m "feat: stage 04 hash router and page renderers"
```

---

### Task 5 — browser E2E harness for navigation (Temp, uncommitted)

Create `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-nav-e2e.cjs` by adapting
`cec-write-e2e.cjs` (same `staticServer`, `CDP` class, `launchChrome`, stub, `poll`). The
stub is the **same** one as `cec-write-e2e.cjs` (fetch wrapper + `clearCache`-bump) plus the
`__issueBtn` injector. Checks:

1. **Clean load** — 0 console errors/exceptions; `#page-dashboard` visible
   (`page-dashboard.hidden === false`), all other `.page` sections hidden; `#pageTitle` is
   "Dashboard".
2. **Nav switch → Students** — click `a[data-page="students"]`; poll until
   `page-students.hidden === false` and `studentsBody` has **9** rows and the nav item has
   class `active`; `#studentCount` reads `9 of 9`.
3. **Student search filters** — set `#studentSearch` value to a real substring
   (e.g. "ama", lowercased from the live sheet — safer: search `"CEC-"` which every ID
   starts with) and dispatch `input`; assert row count drops below 9 and `#studentCount`
   updates to `n of 9`.
4. **Payments page** — click `a[data-page="payments"]`; assert `methodChips` has 3 `.chip`
   children; `paymentsBody` has ≥ 1 row; the "View payments →" `data-go` path: navigate to
   `BASE` (dashboard), click `.text-btn[data-go="payments"]`, assert `location.hash ===
   "#payments"` and `page-payments.hidden === false`.
5. **Inventory derived data** — click `a[data-page="inventory"]`; assert `inventoryBody` has
   **6** rows and at least one `.pill.warn` ("Low") is present; `inventoryCards` has 4
   `.metric-card` children.
6. **Deep links** — `gotoAndWait(BASE + "#reports")`; assert `page-reports.hidden === false`
   and `reportClassBody` has ≥ 1 row and `#pageTitle` is "Reports". Then
   `gotoAndWait(BASE + "#bogus")` asserts `page-dashboard.hidden === false` (fallback).
7. **Write → repaint active view** — `gotoAndWait(BASE + "#students")`; call
   `window.CEC.refreshAll()`; assert `__cleared === 1` and `studentsBody` still has 9 rows
   and `page-students` is still the visible view.
8. **Settings derived** — `gotoAndWait(BASE + "#settings")`; assert `settingsYear`,
   `settingsTarget`, `settingsCurrency`, `settingsStatus` are all non-empty and
   `settingsStatus` matches `/Live|Offline/`.

Rough harness skeleton (mirror `cec-write-e2e.cjs`; the `record`/`sleep`/`poll`/`CDP`
plumbing is unchanged from that file):

```js
const { staticServer, CDP, launchChrome, sleep, record, results } = (() => {
  // Copy verbatim from cec-write-e2e.cjs: staticServer, CDP, launchChrome,
  // sleep, record; capture `results` via a shared exported object returned here.
})();
```

Run it:

```powershell
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-nav-e2e.cjs
```

**All 8 checks PASS, exit 0.** (This artifact stays in Temp — it is per-stage throwaway
verification tooling, like the previous harnesses. Do not commit.)

---

### Task 6 — README, plan tick-off, deploy smoke

1. Add a **Stage 04** section to `README.md` documenting: the hash routes
   (`/#dashboard`, `/#students`, `/#payments`, `/#books`, `/#inventory`, `/#issuing`,
   `/#reports`, `/#settings`), the shared `CEC.getAllData()` dataset, the pure
   `js/view-models.js` module, and the `refreshAll()` repaint-after-write flow.
2. Tick every stage on the spec acceptance checklist that is verified here.
3. **Deploy smoke** (push `master` below, then browse the deployed app):
   - `https://bookmgsystem-sandy.vercel.app/` → Dashboard renders, `#offlinePill` global
     placement above the grid.
   - Each of `/#students`, `/#payments`, `/#books`, `/#inventory`, `/#issuing`,
     `/#reports`, `/#settings` loads directly (deep link) and shows a populated table/cards.
   - Navigating between all 8 nav items shows only one `.page` section at a time with the
     matching `#pageTitle`; browser back/forward works (hash history).
   - On `#payments`, opening "+ Record payment", submitting a valid payment: dialog closes,
     toast shows, and the **payments table repaints** (refreshAll) with the new row.
   - Unknown `/#anything` shows the Dashboard.

#### Verify

```powershell
git push origin master
```

Then run the deployed-URL smoke steps above and the full local suite one final time:

```powershell
node --check js/view-models.js js/data-access.js js/app.js js/write.js
$env:TZ="Asia/Tokyo"; node scripts/test.js; $env:TZ=""
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-browser-e2e.cjs
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs
node C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-nav-e2e.cjs
```

All green: **62/62 unit, 7/7 browser, 7/7 write, 10/10 nav, deploy smoke PASS.**

#### Commit

```
git add README.md docs/superpowers/specs/2026-09-24-stage-04-multi-view-navigation-design.md
git commit -m "docs: stage 04 shipped, tick plan and smoke notes"
```

---

## Final checklist (what "done" looks like)

- [x] `js/view-models.js` exists; TDD tests appended and green (62/62).
- [x] `js/data-access.js` exposes `getAllData()`; `getDashboardData()` keeps its shape;
      `clearCache()` drops the shared dataset.
- [x] `index.html` has 8 `.page` sections; `#offlinePill`/`#dataFreshness` are page-level;
      `view-models.js` script tag added; `data-go` wired on the three dashboard buttons.
- [x] `css/app.css` has `.page[hidden]`, chips, search, new pills; no rule collisions
      (checked against existing `.pill.success`, `.method.*`, `.metric-icon.*`).
- [x] `js/app.js` routes on `location.hash`, renders all 8 pages from one dataset, exposes
      `window.CEC.refreshAll`; no "module is ready" stub toast remains.
- [x] `js/write.js` repaints via `root.refreshAll()`.
- [x] Stage 02/03 regression harnesses still green; new nav harness green.
- [x] Deployed deep links + nav switching + post-write repaint verified on Vercel.
- [x] README Stage 04 section added; spec checklist ticked; final commit pushed.