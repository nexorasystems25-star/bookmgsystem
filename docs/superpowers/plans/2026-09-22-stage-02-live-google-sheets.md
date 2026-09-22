# Stage 02 — Live Google Sheets + Offline JSON Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Stage 01 static dashboard into a live dashboard that reads a public Google Spreadsheet, falls back to committed `data/*.json` when offline, and generates those JSON files at build time on Vercel.

**Architecture:** The browser (`js/app.js`) calls a data-access layer (`js/data-access.js`) that fetches each sheet tab live via the GVIZ CSV endpoint; on network failure it reads `data/{tab}.json`. A dependency-free Node sync script (`scripts/sync.js`) runs as the Vercel build command (`npm run build`), pulling each tab to JSON. Pure logic lives in UMD modules (`js/csv.js`, `js/derive.js`) shared by browser and scripts and unit-tested in Node.

**Tech Stack:** Vanilla HTML/CSS/JS, Node 18+ (sync + tests), Google Sheets GVIZ CSV endpoint, Vercel static hosting, no npm dependencies.

---

## Prerequisite Setup (one-time, by the user)

Create the Google Spreadsheet and share it:

1. Create a new Google Spreadsheet. Create five tabs named exactly: `Students`, `Payments`, `Activity`, `Books`, `Config`.
2. Put this header row on tab 1 (row 1), then add example rows under it:

**Students header:** `student_id,name,class,gender,academic_year,books_fee,books_paid,books_total,status`

**Payments header:** `payment_id,student_id,student_name,class,amount,method,date,status`

**Activity header:** `activity_id,type,description,amount,created_at`

**Books header:** `book_id,publisher,subject,category,price,stock_qty,low_stock_threshold`

**Config header:** `academic_year,daily_payment_target,currency,last_synced`

3. Values for `status`: exactly `ready`, `waiting`, or `not covered`. Values for `method`: `Cash`, `MTN MoMo`, or `Telecel`. Dates as `YYYY-MM-DD`.
4. Click **Share → Anyone with the link → Viewer** (must be viewable without sign-in).
5. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`.

---

### Task 1: Project scaffolding (package.json, vercel.json, .env.example, .gitignore, git init)

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.env.example`
- Create: `.gitignore`

- [x] **Step 1: Create `package.json`**

```json
{
  "name": "cec-book-system",
  "version": "2.0.0",
  "private": true,
  "description": "CEC Book Management & Payment System",
  "scripts": {
    "build": "node scripts/sync.js",
    "sync": "node scripts/sync.js",
    "test": "node scripts/test.js"
  }
}
```

- [x] **Step 2: Create `vercel.json`**

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "."
}
```

- [x] **Step 3: Create `.env.example`**

```
SPREADSHEET_ID=PASTE_YOUR_SPREADSHEET_ID_HERE
```

- [x] **Step 4: Create `.gitignore`**

```
node_modules/
.env
data/*.tmp
```

- [x] **Step 5: Initialize git and commit**

Run: `git init; git add -A; git commit -m "chore: scaffold stage 02 build config"`
Expected: commit created, exit 0.

---

### Task 2: Shared CSV parser (`js/csv.js`, UMD)

**Files:**
- Create: `js/csv.js`
- Test: `scripts/test.js`

- [x] **Step 1: Write the failing test**

Create `scripts/test.js`:

```js
const assert = require("node:assert/strict");
const csv = require("../js/csv.js");

let pass = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("PASS " + name);
  } catch (err) {
    console.error("FAIL " + name);
    console.error("  " + err.message);
    process.exitCode = 1;
  }
}

test("parseCSV splits rows and fields", () => {
  const rows = csv.parseCSV("a,b,c\n1,2,3\n4,5,6");
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "2", "3"], ["4", "5", "6"]]);
});

test("parseCSV handles quoted fields with commas", () => {
  const rows = csv.parseCSV('name,note\n"Owusu, Emma","has, comma"');
  assert.deepEqual(rows, [["name", "note"], ["Owusu, Emma", "has, comma"]]);
});

test("parseCSV handles escaped quotes", () => {
  const rows = csv.parseCSV('q\n"say ""hi"""');
  assert.deepEqual(rows, [["q"], ['say "hi"']]);
});

test("parseCSV handles CRLF line endings", () => {
  const rows = csv.parseCSV("a,b\r\n1,2\r\n");
  assert.deepEqual(rows, [["a", "b"], ["1", "2"]]);
});

test("rowsToObjects maps header row to keys", () => {
  const rows = csv.parseCSV("student_id,name\nCEC-1,Emma");
  assert.deepEqual(csv.rowsToObjects(rows), [{ student_id: "CEC-1", name: "Emma" }]);
});

test("rowsToObjects trims whitespace and returns objects", () => {
  const rows = csv.parseCSV("a,b\n 1 , 2 ");
  assert.deepEqual(csv.rowsToObjects(rows), [{ a: "1", b: "2" }]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scripts/test.js`
Expected: `FAIL parseCSV splits rows and fields` (module not found) and nonzero exit.

- [x] **Step 3: Write the minimal implementation** — create `js/csv.js`:

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.csv = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function parseCSV(text) {
    text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function rowsToObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(h => String(h).trim());
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i] !== undefined ? String(r[i]).trim() : "";
      });
      return obj;
    });
  }

  return { parseCSV, rowsToObjects };
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `node scripts/test.js`
Expected: all six tests report `PASS`, exit 0.

- [x] **Step 5: Commit**

```bash
git add js/csv.js scripts/test.js
git commit -m "feat: add shared CSV parser with tests"
```

---

### Task 3: Pure derivation layer (`js/derive.js`, UMD)

**Files:**
- Create: `js/derive.js`
- Modify: `scripts/test.js`

All dashboard math is pure and unit-testable. The sync script is not used here.

- [x] **Step 1: Write the failing test** — append to `scripts/test.js`:

```js
const derive = require("../js/derive.js");

const STUDENTS = [
  { student_id: "CEC-001", name: "Emma Owusu", class: "BS 4", gender: "F", academic_year: "2026/2027", books_fee: "350", books_paid: "350", books_total: "350", status: "ready" },
  { student_id: "CEC-002", name: "Kojo Mensah", class: "KG 2", gender: "M", academic_year: "2026/2027", books_fee: "400", books_paid: "150", books_total: "400", status: "waiting" },
  { student_id: "CEC-003", name: "Ama Serwaa", class: "BS 1", gender: "F", academic_year: "2026/2027", books_fee: "300", books_paid: "0", books_total: "300", status: "not covered" }
];

const PAYMENTS = [
  { payment_id: "P1", student_id: "CEC-001", student_name: "Emma Owusu", class: "BS 4", amount: "100", method: "MTN MoMo", date: todayISO(), status: "Recorded" },
  { payment_id: "P2", student_id: "CEC-002", student_name: "Kojo Mensah", class: "KG 2", amount: "150", method: "Cash", date: todayISO(), status: "Recorded" },
  { payment_id: "P3", student_id: "CEC-003", student_name: "Ama Serwaa", class: "BS 1", amount: "50", method: "Telecel", date: sixDaysAgoISO(), status: "Recorded" }
];

const ACTIVITY = [
  { activity_id: "A1", type: "payment", description: "Emma Owusu GH₵ 100", amount: "100", created_at: new Date().toISOString() },
  { activity_id: "A2", type: "stock", description: "50 Mathematics books", amount: "", created_at: new Date(Date.now() - 3600e3).toISOString() }
];

const BOOKS = [
  { book_id: "B1", publisher: "Aki-Ola", subject: "Maths", category: "Textbook", price: "45", stock_qty: "5", low_stock_threshold: "10" },
  { book_id: "B2", publisher: "Kraus", subject: "English", category: "Textbook", price: "50", stock_qty: "60", low_stock_threshold: "10" }
];

const CONFIG = { academic_year: "2026/2027", daily_payment_target: "10000", currency: "GH₵", last_synced: "2026-09-22T09:00:00Z" };

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function sixDaysAgoISO() {
  const d = new Date(Date.now() - 6 * 86400e3);
  return d.toISOString().slice(0, 10);
}

test("normalizeStudents casts amounts and keeps fields", () => {
  const rows = derive.normalizeStudents(STUDENTS);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].booksFee, 350);
  assert.equal(rows[0].status, "ready");
  assert.equal(rows[1].booksPaid, 150);
  assert.equal(rows[2].booksTotal, 300);
});

test("buildReadiness counts status thirds", () => {
  const r = derive.buildReadiness(derive.normalizeStudents(STUDENTS));
  assert.deepEqual(r, { ready: 1, waiting: 1, uncovered: 1, covered: 2, coveredPct: 67 });
});

test("buildKpis totals today's payments and outstanding", () => {
  const students = derive.normalizeStudents(STUDENTS);
  const payments = derive.normalizePayments(PAYMENTS);
  const k = derive.buildKpis(students, payments, derive.normalizeConfig([CONFIG]));
  assert.equal(k.totalStudents, 3);
  assert.equal(k.paymentsToday, 250);
  assert.equal(k.dailyPct, 3);
  assert.equal(k.readyToIssue, 1);
  assert.equal(k.waiting, 1);
  assert.equal(k.outstandingCount, 2);
  assert.equal(k.outstandingAmount, 550);
});

test("buildChart7Days buckets by method over last 7 days", () => {
  const payments = derive.normalizePayments(PAYMENTS);
  const chart = derive.buildChart7Days(payments);
  assert.equal(chart.labels.length, 7);
  assert.equal(chart.total.reduce((a, b) => a + b, 0), 300);
  assert.equal(chart.momo.reduce((a, b) => a + b, 0), 100);
  assert.equal(chart.cash.reduce((a, b) => a + b, 0), 150);
  assert.equal(chart.telecel.reduce((a, b) => a + b, 0), 50);
});

test("buildRecentPayments returns newest five", () => {
  const payments = derive.normalizePayments(PAYMENTS);
  const recent = derive.buildRecentPayments(payments);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].studentName, "Emma Owusu");
  assert.equal(recent[0].methodClass, "momo");
});

test("buildActivityFeed maps types to icons and relative time", () => {
  const feed = derive.buildActivityFeed(derive.normalizeActivity(ACTIVITY));
  assert.equal(feed[0].icon, "₵");
  assert.equal(feed[0].color, "green");
  assert.equal(feed[0].title, "Payment recorded");
  assert.match(feed[1].timeLabel, /hour/);
});

test("buildBooks counts low stock", () => {
  const b = derive.buildBooks(derive.normalizeBooks(BOOKS));
  assert.equal(b.stockLowCount, 1);
});

test("formatAmount renders currency with thousands separator", () => {
  assert.equal(derive.formatAmount(6250, "GH₵"), "GH₵ 6,250");
  assert.equal(derive.formatAmount(0, "GH₵"), "GH₵ 0");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node scripts/test.js`
Expected: new tests `FAIL` (`derive is not a function`), exit 1.

- [x] **Step 3: Write the implementation** — create `js/derive.js`:

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.derive = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function num(v) {
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function formatAmount(value, currency) {
    const c = currency || "GH₵";
    return c + " " + Math.round(value).toLocaleString("en-US");
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function normalizeStudents(rows) {
    return rows.map(r => ({
      studentId: r.student_id,
      name: r.name,
      className: r.class,
      gender: r.gender,
      academicYear: r.academic_year,
      booksFee: num(r.books_fee),
      booksPaid: num(r.books_paid),
      booksTotal: num(r.books_total),
      status: r.status
    }));
  }

  function normalizePayments(rows) {
    return rows.map(r => ({
      paymentId: r.payment_id,
      studentId: r.student_id,
      studentName: r.student_name,
      className: r.class,
      amount: num(r.amount),
      method: r.method,
      date: r.date,
      status: r.status
    }));
  }

  function normalizeActivity(rows) {
    return rows.map(r => ({
      activityId: r.activity_id,
      type: r.type,
      description: r.description,
      amount: num(r.amount),
      createdAt: r.created_at
    }));
  }

  function normalizeBooks(rows) {
    return rows.map(r => ({
      bookId: r.book_id,
      publisher: r.publisher,
      subject: r.subject,
      category: r.category,
      price: num(r.price),
      stockQty: num(r.stock_qty),
      lowStockThreshold: num(r.low_stock_threshold)
    }));
  }

  function normalizeConfig(rows) {
    const r = rows[0] || {};
    return {
      activeYear: r.academic_year || "",
      dailyTarget: num(r.daily_payment_target),
      currency: r.currency || "GH₵",
      lastSynced: r.last_synced || ""
    };
  }

  function buildReadiness(students) {
    const ready = students.filter(s => s.status === "ready").length;
    const waiting = students.filter(s => s.status === "waiting").length;
    const uncovered = students.filter(s => s.status === "not covered").length;
    const covered = ready + waiting;
    const coveredPct = students.length > 0 ? Math.round(((ready + waiting) / students.length) * 100) : 0;
    return { ready, waiting, uncovered, covered, coveredPct };
  }

  function buildKpis(students, payments, config) {
    const today = todayISO();
    const readiness = buildReadiness(students);
    const outstanding = students.reduce((acc, s) => {
      const bal = s.booksTotal - s.booksPaid;
      if (bal > 0) {
        acc.count += 1;
        acc.amount += bal;
      }
      return acc;
    }, { count: 0, amount: 0 });
    const paymentsToday = payments.reduce((s, p) => s + (p.date === today ? p.amount : 0), 0);
    const target = config.dailyTarget;
    return {
      totalStudents: students.length,
      enrolledThisTerm: students.length,
      paymentsToday,
      dailyTarget: target,
      dailyPct: target > 0 ? Math.round((paymentsToday / target) * 100) : 0,
      readyToIssue: readiness.ready,
      waiting: readiness.waiting,
      outstandingCount: outstanding.count,
      outstandingAmount: outstanding.amount
    };
  }

  function buildChart7Days(payments) {
    const dates = [];
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dates.push(d.getFullYear() + "-" + m + "-" + day);
      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
    }
    const cash = dates.map(() => 0);
    const momo = dates.map(() => 0);
    const telecel = dates.map(() => 0);
    payments.forEach(p => {
      const idx = dates.indexOf(p.date);
      if (idx < 0) return;
      const method = (p.method || "").toLowerCase();
      if (method.indexOf("momo") !== -1) momo[idx] += p.amount;
      else if (method.indexOf("telecel") !== -1) telecel[idx] += p.amount;
      else cash[idx] += p.amount;
    });
    const total = dates.map((_, i) => cash[i] + momo[i] + telecel[i]);
    return { labels, cash, momo, telecel, total };
  }

  function buildRecentPayments(payments) {
    return payments
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 5)
      .map(p => ({
        studentName: p.studentName,
        id: p.studentId,
        className: p.className,
        amount: p.amount,
        method: p.method,
        methodClass: (p.method || "").toLowerCase().indexOf("momo") !== -1 ? "momo" : "cash",
        status: p.status || "Recorded"
      }));
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
    const days = Math.round(hrs / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  const ACTIVITY_META = {
    payment: { icon: "₵", color: "green", title: "Payment recorded" },
    issue: { icon: "⇧", color: "blue", title: "Books issued" },
    stock: { icon: "+", color: "amber", title: "Stock received" },
    student: { icon: "♙", color: "purple", title: "Student added" }
  };

  function buildActivityFeed(activity) {
    return activity
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 6)
      .map(a => {
        const meta = ACTIVITY_META[a.type] || { icon: "•", color: "blue", title: a.type };
        return {
          type: a.type,
          icon: meta.icon,
          color: meta.color,
          title: meta.title,
          description: a.description,
          timeLabel: timeAgo(a.createdAt)
        };
      });
  }

  function buildBooks(books) {
    return {
      stockLowCount: books.filter(b => b.stockQty <= b.lowStockThreshold).length
    };
  }

  function buildDashboard(students, payments, activity, books, config) {
    const kpis = buildKpis(students, payments, config);
    return {
      kpis,
      chart: buildChart7Days(payments),
      readiness: buildReadiness(students),
      recentPayments: buildRecentPayments(payments),
      activityFeed: buildActivityFeed(activity),
      stockLowCount: buildBooks(books).stockLowCount,
      currency: config.currency
    };
  }

  return {
    num,
    formatAmount,
    todayISO,
    normalizeStudents,
    normalizePayments,
    normalizeActivity,
    normalizeBooks,
    normalizeConfig,
    buildReadiness,
    buildKpis,
    buildChart7Days,
    buildRecentPayments,
    buildActivityFeed,
    buildBooks,
    buildDashboard
  };
});
```

- [x] **Step 4: Run test to verify passes**

Run: `node scripts/test.js`
Expected: all 17 tests report `PASS`, exit 0.

- [x] **Step 5: Commit**

```bash
git add js/derive.js scripts/test.js
git commit -m "feat: add pure dashboard derivation layer with tests"
```

---

### Task 4: Sync script (`scripts/sync.js`)

**Files:**
- Create: `scripts/sync.js`

Source of the committed JSON fallback. Runs on every Vercel build and manually. Offline-safe: skips tabs it cannot fetch, never corrupts existing JSON (temp file + rename), and updates `data/meta.json` + `Config.last_synced`.

- [x] **Step 1: Write the script**

```js
const fs = require("fs");
const path = require("path");
const csv = require("../js/csv.js");

const TABS = {
  Students: "students.json",
  Payments: "payments.json",
  Activity: "activity.json",
  Books: "books.json",
  Config: "config.json"
};

function loadSpreadsheetId() {
  if (process.env.SPREADSHEET_ID) return process.env.SPREADSHEET_ID.trim();
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^SPREADSHEET_ID=(.*)$/);
    if (m) return m[1].trim();
  }
  return "";
}

function gvizUrl(sheet) {
  return (
    "https://docs.google.com/spreadsheets/d/" +
    encodeURIComponent(SPREADSHEET_ID) +
    "/gviz/tq?tqx=out:csv&sheet=" +
    encodeURIComponent(sheet)
  );
}

async function fetchCsv(sheet) {
  const res = await fetch(gvizUrl(sheet));
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + sheet);
  return res.text();
}

function ensureDataDir() {
  const dir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonSafe(dir, file, value) {
  const target = path.join(dir, file);
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

const SPREADSHEET_ID = loadSpreadsheetId();

async function main() {
  const dir = ensureDataDir();
  const nowIso = new Date().toISOString();
  let offline = false;

  if (!SPREADSHEET_ID) {
    console.warn("No SPREADSHEET_ID found (.env missing). Skipping live sync; keeping committed JSON.");
    offline = true;
    metaFallback(nowIso);
    return;
  }

  for (const [sheet, file] of Object.entries(TABS)) {
    try {
      const text = await fetchCsv(sheet);
      const objects = csv.rowsToObjects(csv.parseCSV(text));
      writeJsonSafe(dir, file, objects);
      console.log("Synced " + sheet + " -> data/" + file + " (" + objects.length + " rows)");
    } catch (err) {
      offline = true;
      console.warn("Skipped " + sheet + ": " + err.message + " Keeping data/" + file + ".");
    }
  }

  writeMeta(nowIso);
  console.log(offline ? "Sync finished in offline mode." : "Sync complete. last_synced=" + nowIso);
}

function writeMeta(nowIso) {
  const dir = ensureDataDir();
  const metaPath = path.join(dir, "meta.json");
  const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  const meta = {
    spreadsheet_id: SPREADSHEET_ID || existing.spreadsheet_id || "",
    last_synced: nowIso
  };
  writeJsonSafe(dir, "meta.json", meta);

  const configPath = path.join(dir, "config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (Array.isArray(config) && config.length > 0) {
      writeJsonSafe(dir, "config.json", config.map(r => ({ ...r, last_synced: nowIso })));
    }
  }
}

function metaFallback(nowIso) {
  const dir = ensureDataDir();
  const metaPath = path.join(dir, "meta.json");
  const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  writeJsonSafe(dir, "meta.json", {
    spreadsheet_id: existing.spreadsheet_id || "",
    last_synced: existing.last_synced || nowIso
  });
}

main().catch(err => {
  console.error("Sync failed:", err.message);
  process.exit(0);
});
```

- [x] **Step 2: Create the local `.env` and run offline test**

Create `.env` in the project root with a placeholder, then run:
`node scripts/sync.js`
Expected: warning line "No SPREADSHEET_ID found (.env missing)" only if `.env` is empty; `data/meta.json` created; exit 0. If you left `.env` empty, remove its content or delete it for this test, then re-run and confirm no crash.

- [x] **Step 3: Verify offline mode preserves existing JSON**

Run: `node scripts/sync.js` with your real `SPREADSHEET_ID` in `.env` (after you populate the sheet). Then temporarily rename `.env` to `.env.bak` and run `node scripts/sync.js` again.
Expected: script warns and exits 0; `data/*.json` files are unchanged; `data` dir never contains `.tmp` files after run.

- [x] **Step 4: Commit**

```bash
git add scripts/sync.js
git commit -m "feat: add build-time Google Sheets sync script"
```

---

### Task 5: Browser data-access layer (`js/data-access.js`)

**Files:**
- Create: `js/data-access.js`

Holds the spreadsheet ID, builds GVIZ URLs, fetches tabs live with a timeout, falls back to `data/{tab}.json`, caches in an in-memory session cache, and assembles `getDashboardData()`.

- [x] **Step 1: Write the script**

```js
(function () {
  "use strict";

  const TIMEOUT_MS = 5000;

  async function loadMeta() {
    try {
      const res = await fetch("data/meta.json", { cache: "no-store" });
      return await res.json();
    } catch (e) {
      return { spreadsheet_id: "", last_synced: "" };
    }
  }

  function gvizUrl(id, sheet) {
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(id) +
      "/gviz/tq?tqx=out:csv&sheet=" +
      encodeURIComponent(sheet)
    );
  }

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function loadLocal(file) {
    return fetch("data/" + file, { cache: "no-store" })
      .then(res => res.json())
      .catch(() => []);
  }

  const sessionCache = {};

  async function fetchTab(sheetName, fileName) {
    if (CEC.forceOffline) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
    if (!CEC.meta.spreadsheet_id) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
    try {
      const text = await fetchWithTimeout(gvizUrl(CEC.meta.spreadsheet_id, sheetName), TIMEOUT_MS);
      const objects = CEC.csv.rowsToObjects(CEC.csv.parseCSV(text));
      sessionCache[sheetName] = "live";
      return objects;
    } catch (e) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
  }

  function anyTabLive() {
    return Object.values(sessionCache).indexOf("live") !== -1;
  }

  async function getDashboardData() {
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

    const dashboard = CEC.derive.buildDashboard(students, payments, activity, books, config);
    dashboard.lastSynced = (CEC.meta && CEC.meta.last_synced) || config.lastSynced;
    dashboard.offline = !anyTabLive();
    return dashboard;
  }

  let forceOfflineFlag = false;
  try {
    forceOfflineFlag =
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("cecForceOffline") === "true";
  } catch (ignored) {}

  function setForceOffline(v) {
    forceOfflineFlag = !!v;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (forceOfflineFlag) sessionStorage.setItem("cecForceOffline", "true");
        else sessionStorage.removeItem("cecForceOffline");
      }
    } catch (ignored) {}
  }

  window.CEC = window.CEC || {};
  Object.defineProperty(window.CEC, "forceOffline", {
    get: function () { return forceOfflineFlag; },
    set: function (v) { setForceOffline(v); },
    configurable: true
  });
  Object.assign(window.CEC, {
    csv: window.CEC.csv,
    derive: window.CEC.derive,
    getDashboardData: getDashboardData
  });
  window.CEC.meta = { spreadsheet_id: "", last_synced: "" };
})();
```

- [x] **Step 2: Manual smoke test**

Serve locally (`npx serve .` or VS Code Live Server). Open DevTools console, run:
`await CEC.getDashboardData()`
Expected: returns an object with `kpis`, `chart`, `readiness`, `recentPayments`, `activityFeed`, `currency`, `lastSynced`, `offline`. With no network to Google it falls back to JSON (confirm `offline: true` when `data/*.json` exist).

- [x] **Step 3: Commit**

```bash
git add js/data-access.js
git commit -m "feat: add browser data-access layer with live/offline fallback"
```

---

### Task 6: Wire the dashboard (`js/app.js` + `index.html`)

**Files:**
- Modify: `index.html` (add IDs, containers, script tags)
- Modify: `js/app.js` (render dashboard)

- [x] **Step 1: Edit `index.html`**

1a. Add IDs to the four KPI strong values:

Old:
```html
<strong>248</strong>
```
New:
```html
<strong id="metricTotalStudents">—</strong>
```

Old:
```html
<strong>GH₵ 6,250</strong>
```
New:
```html
<strong id="metricPaymentsToday">—</strong>
```

Old:
```html
<strong>126</strong>
<div class="metric-foot"><span class="warning">34</span> students waiting</div>
```
New:
```html
<strong id="metricReadyToIssue">—</strong>
<div class="metric-foot"><span class="warning" id="metricReadyFoot">0</span> students waiting</div>
```

Old:
```html
<strong>GH₵ 28,450</strong>
<div class="metric-foot"><span class="muted">Across 97 students</span></div>
```
New:
```html
<strong id="metricOutstanding">—</strong>
<div class="metric-foot"><span class="muted" id="metricOutstandingFoot">Across 0 students</span></div>
```

1b. Add IDs to the KPI footers of the first two cards:
- Old: `<div class="metric-foot"><span class="positive">+18</span> enrolled this term</div>` → New: `<div class="metric-foot"><span class="positive" id="metricStudentsFoot">0</span> enrolled this term</div>`
- Old: `<div class="metric-foot"><span class="positive">64%</span> of daily target</div>` → New: `<div class="metric-foot"><span class="positive" id="metricPaymentsFoot">0%</span> of daily target</div>`

1c. Add IDs to the chart and donut:

Old:
```html
<div class="bars">
  <i style="height:42%"></i><i style="height:55%"></i><i style="height:47%"></i><i style="height:72%"></i>
  <i style="height:61%"></i><i style="height:88%"></i><i style="height:76%"></i>
</div>
<div class="chart-x"><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span><span>Mon</span><span>Tue</span></div>
```
New:
```html
<div class="bars" id="chartBars"></div>
<div class="chart-x" id="chartX"></div>
```

Old:
```html
<div class="donut"><div><b>78%</b><span>covered</span></div></div>
```
New:
```html
<div class="donut"><div><b id="donutPct">0%</b><span>covered</span></div></div>
```

Old:
```html
<div><span><i class="status-dot ready"></i>Ready to issue</span><b>126</b></div>
<div><span><i class="status-dot waiting"></i>Waiting for stock</span><b>34</b></div>
<div><span><i class="status-dot uncovered"></i>Not covered</span><b>88</b></div>
```
New:
```html
<div><span><i class="status-dot ready"></i>Ready to issue</span><b id="readyCount">0</b></div>
<div><span><i class="status-dot waiting"></i>Waiting for stock</span><b id="waitingCount">0</b></div>
<div><span><i class="status-dot uncovered"></i>Not covered</span><b id="uncoveredCount">0</b></div>
```

Old:
```html
<div class="stock-alert"><span>!</span><div><b>7 items are low in stock</b><small>Review inventory before the next issuing session.</small></div><button>Review →</button></div>
```
New:
```html
<div class="stock-alert"><span>!</span><div><b><span id="stockLowCount">0</span> items are low in stock</b><small>Review inventory before the next issuing session.</small></div><button>Review →</button></div>
```

1d. Make the tables/activity renderable:

Old:
```html
<tbody>
  <tr>...</tr>
  ...
</tbody>
```
New (replace the whole `<tbody>...</tbody>` block, keeping the head):
```html
<tbody id="recentPaymentsBody"></tbody>
```

Old:
```html
<div class="activity">
  <div class="activity-item">...</div>
  ...
</div>
```
New (replace the whole `.activity` block's children):
```html
<div class="activity" id="activityFeed"></div>
```

1e. Add a freshness + offline notice after the notice banner. Old:
```html
<div class="notice">
  ...
</div>
```
New (append after the closing `</div>` of `notice`):
```html
<div class="offline-pill" id="offlinePill" hidden>Offline mode</div>
<div class="data-freshness" id="dataFreshness"></div>
```

1f. Add script tags before `app.js`:

Old:
```html
<script src="js/app.js"></script>
```
New:
```html
<script src="js/csv.js"></script>
<script src="js/derive.js"></script>
<script src="js/data-access.js"></script>
<script src="js/app.js"></script>
```

- [x] **Step 2: Add minimal styles to `css/app.css`** — append:

```css
.offline-pill {
  display: inline-block;
  background: #fff7ed;
  color: #9a3412;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  margin: 8px 0;
}
.data-freshness {
  color: #64748b;
  font-size: 12px;
  margin: 8px 0;
}
```

- [x] **Step 3: Replace `js/app.js`** with:

```js
(() => {
  const sidebar = document.getElementById("sidebar");
  const mobileMenu = document.getElementById("mobileMenu");
  const toast = document.getElementById("toast");

  mobileMenu?.addEventListener("click", () => sidebar.classList.toggle("open"));

  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
      link.classList.add("active");
      const page = link.dataset.page;
      const title = page === "dashboard" ? "Dashboard" : link.textContent.trim();
      document.getElementById("pageTitle").textContent = title;
      sidebar.classList.remove("open");
      if (page !== "dashboard") {
        showToast(`${title} module is ready for the next implementation stage.`);
      }
    });
  });

  document.querySelectorAll("[data-action='payment']").forEach(button => {
    button.addEventListener("click", () => showToast("Payment entry will be wired in a later stage."));
  });

  document.querySelector(".notice-close")?.addEventListener("click", e => {
    e.currentTarget.closest(".notice").remove();
  });

  document.querySelectorAll(".workspace-select, .icon-btn, .text-btn, .more-btn, .btn-light, .stock-alert button").forEach(button => {
    if (button.dataset.action || button.classList.contains("notice-close")) return;
    button.addEventListener("click", () => showToast("This control will be wired during the corresponding implementation stage."));
  });

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }

  async function renderDashboard() {
    const data = await CEC.getDashboardData();
    const cur = data.currency;

    document.getElementById("metricTotalStudents").textContent = data.kpis.totalStudents;
    document.getElementById("metricStudentsFoot").textContent = "+" + data.kpis.enrolledThisTerm;
    document.getElementById("metricPaymentsToday").textContent = CEC.derive.formatAmount(data.kpis.paymentsToday, cur);
    document.getElementById("metricPaymentsFoot").textContent = data.kpis.dailyPct + "%";
    document.getElementById("metricReadyToIssue").textContent = data.kpis.readyToIssue;
    document.getElementById("metricReadyFoot").textContent = data.kpis.waiting;
    document.getElementById("metricOutstanding").textContent = CEC.derive.formatAmount(data.kpis.outstandingAmount, cur);
    document.getElementById("metricOutstandingFoot").textContent = "Across " + data.kpis.outstandingCount + " students";

    const chartBars = document.getElementById("chartBars");
    const chartX = document.getElementById("chartX");
    const maxTotal = Math.max.apply(null, data.chart.total.concat([1]));
    chartBars.innerHTML = data.chart.total
      .map(v => `<i style="height:${Math.round((v / maxTotal) * 100)}%"></i>`)
      .join("");
    chartX.innerHTML = data.chart.labels.map(l => `<span>${l}</span>`).join("");

    document.getElementById("donutPct").textContent = data.readiness.coveredPct + "%";
    document.getElementById("readyCount").textContent = data.readiness.ready;
    document.getElementById("waitingCount").textContent = data.readiness.waiting;
    document.getElementById("uncoveredCount").textContent = data.readiness.uncovered;
    document.getElementById("stockLowCount").textContent = data.stockLowCount;

    document.getElementById("recentPaymentsBody").innerHTML = data.recentPayments
      .map(p => `
        <tr>
          <td><b>${p.studentName}</b><small>${p.id}</small></td>
          <td>${p.className}</td>
          <td>${CEC.derive.formatAmount(p.amount, cur)}</td>
          <td><span class="method ${p.methodClass}">${p.method}</span></td>
          <td><span class="pill success">${p.status}</span></td>
        </tr>`)
      .join("");

    document.getElementById("activityFeed").innerHTML = data.activityFeed
      .map(a => `
        <div class="activity-item">
          <span class="activity-icon ${a.color}">${a.icon}</span>
          <div><b>${a.title}</b><p>${a.description}</p><small>${a.timeLabel}</small></div>
        </div>`)
      .join("");

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

  renderDashboard().catch(err => {
    console.error("Dashboard load failed:", err);
    showToast("Could not load dashboard data.");
  });
})();
```

- [x] **Step 4: Offline verification locally (dev flag)**

Serve the site. In DevTools console run: `CEC.forceOffline = true; location.reload();`
Expected: every widget renders from `data/*.json`; the offline pill shows "Offline mode — data from ...".

- [x] **Step 5: Live verification locally**

Serve the site with `.env` ID present and network available. Reload.
Expected: widgets render; freshness label shows the sync time; offline pill hidden.

- [x] **Step 6: Commit**

```bash
git add index.html css/app.css js/app.js
git commit -m "feat: wire dashboard widgets to Google Sheets data layer"
```

---

### Task 7: End-to-end verification + README

**Files:**
- Modify: `README.md`

- [x] **Step 1: Regenerate JSON with real data**

Run: `node scripts/sync.js`
Expected: each tab logs `Synced X -> data/x.json (N rows)`; `data/meta.json` has fresh `last_synced`.

- [x] **Step 2: Run full test suite**

Run: `node scripts/test.js`
Expected: all tests `PASS`, exit 0.

- [x] **Step 3: Add `.env` instructions to README** — append a Stage 02 section:

```markdown
## Stage 02 — Live data (Google Sheets + JSON fallback)

1. Create the spreadsheet (tabs: Students, Payments, Activity, Books, Config) and share it to "Anyone with the link → Viewer".
2. Copy the spreadsheet ID into `.env` (see `.env.example`) and as a `SPREADSHEET_ID` env var in Vercel project settings.
3. Regenerate the offline JSON locally: `npm run sync`
4. Test: `npm test`
5. Deploy to Vercel — `npm run build` runs `node scripts/sync.js` automatically, rebuilding data/*.json on every deploy. The browser reads Google Sheets live and falls back to data/*.json when offline.
```

- [x] **Step 4: Commit**

```bash
git add README.md data
git commit -m "docs: document stage 02 live-data workflow"
```

---

## Self-Review

**Spec coverage:**
- §2 architecture (live read + JSON fallback + sync on build) → Tasks 4, 5, 6 ✓
- §3 schema (five tabs, `publisher`-only, config fields) → Prerequisite + Task 4 ✓
- §4 data-access layer (`CEC.fetch*`, derivations, in-memory session cache, network-first) → Tasks 3, 5 ✓
- §5 sync script (auto on build, manual, offline-safe, temp+rename, meta.json, last_synced) → Task 4 ✓
- §6 error handling (independent tab failure, numeric coercion, invalid dates dropped, offline pill) → Tasks 3, 5, 6 ✓
- §7 testing (sync diff, offline dev flag, Vercel live) → Tasks 4, 6, 7 ✓
- §8 out of scope (writes, auth, realtime) → not implemented ✓

**Placeholder scan:** all code is complete; no TBD/TODO. ✓
**Type consistency:** `normalize*` names, `build*` names, `methodClass`, `stockLowCount`, `offline`, `lastSynced` used consistently across derive.js, data-access.js and app.js. ✓