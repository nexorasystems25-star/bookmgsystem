# Stage 03 — Write-Back to Google Sheets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the dashboard record payments, register students, issue books, and adjust stock by writing to the Google Spreadsheet through four Vercel serverless functions, then repaint the widgets in place.

**Architecture:** Browser modal forms call `js/write.js`, which POSTs JSON to one Vercel function per operation (`api/payment.js`, `api/student.js`, `api/issue.js`, `api/stock.js`). All share `api/_lib.js` for OAuth token refresh, Sheets API calls, and pure logic (ID generation, status recompute, validation). The Stage 02 read path (live GVIZ + JSON fallback) is unchanged; after a successful write the dashboard calls `CEC.clearCache()` + `CEC.renderDashboard()` to repaint.

**Tech Stack:** Plain Node (CommonJS, no framework, no Google SDK; global `fetch` in Node 18+/Vercel runtime), Google Sheets API v4 (`:append`, `values` GET/PUT), Vercel serverless functions, existing vanilla JS frontend.

**Reference spec:** `docs/superpowers/specs/2026-09-23-stage-03-write-back-google-sheets-design.md`

**Plan-time note (approved scope, two small corrections to §4/§6 of the spec):**
1. `buildDashboard()` does not expose raw student/book lists, so the modal dropdowns need `CEC.fetchOptions()` (new, returns `{ students, books }`) added to `js/data-access.js` alongside `CLEAR_`→`CEC.clearCache()`.
2. The spreadsheet-read helper is named `sheetsGet` (spec listed only `sheetsAppend`/`sheetsUpdate`); the four op functions `runPayment`/`runStudent`/`runIssue`/`runStock` live in `_lib.js` and are what the endpoints and tests call.

---

### Task 1: Pure helpers in `api/_lib.js`

**Files:**
- Create: `api/_lib.js` (first increment: pure functions only — no network code yet)
- Modify: `scripts/test.js` (append new tests)

- [x] **Step 1: Write the failing tests for the pure helpers**

Append to `scripts/test.js` (before the final `console.log(pass + " tests passed");` line):

```js
const lib = require("../api/_lib.js");

test("nextId returns next suffix after existing max", () => {
  const values = [["payment_id"], ["P001"], ["P005"], ["P002"]];
  assert.equal(lib.nextId(values, "P"), "P006");
});

test("nextId handles empty tab (header only)", () => {
  assert.equal(lib.nextId([["activity_id"]], "A"), "A001");
  assert.equal(lib.nextId([], "A"), "A001");
});

test("nextId ignores rows with a different prefix", () => {
  const values = [["id"], ["S002"], ["A007"], ["Q004"]];
  assert.equal(lib.nextId(values, "P"), "P001");
});

test("recomputeStatus maps zero, partial, and full", () => {
  assert.equal(lib.recomputeStatus(0, 1200), "not covered");
  assert.equal(lib.recomputeStatus(700, 1200), "waiting");
  assert.equal(lib.recomputeStatus(1200, 1200), "ready");
  assert.equal(lib.recomputeStatus(1500, 1200), "ready");
});

test("validatePaymentPayload accepts valid input", () => {
  const r = lib.validatePaymentPayload({ student_id: "S001", amount: "500", method: "MTN MoMo" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.amount, 500);
  assert.match(r.payload.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("validatePaymentPayload rejects bad input", () => {
  assert.equal(lib.validatePaymentPayload({ student_id: "S001", amount: "0", method: "Cash" }).ok, false);
  assert.equal(lib.validatePaymentPayload({ student_id: "S001", amount: "-5", method: "Cash" }).ok, false);
  assert.equal(lib.validatePaymentPayload({ student_id: "S001", amount: "10", method: "Visa" }).ok, false);
  assert.equal(lib.validatePaymentPayload({ amount: "10", method: "Cash" }).ok, false);
});

test("validateStudentPayload accepts valid input", () => {
  const r = lib.validateStudentPayload({ name: "Ama Serwaa", class: "JS 1", gender: "female", books_fee: "1400", books_total: "10" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.academicYear, "2026/2027");
});

test("validateStudentPayload rejects bad input", () => {
  assert.equal(lib.validateStudentPayload({ name: "", class: "JS 1", gender: "female", books_fee: 1, books_total: 1 }).ok, false);
  assert.equal(lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "other", books_fee: 1, books_total: 1 }).ok, false);
  assert.equal(lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "female", books_fee: -1, books_total: 1 }).ok, false);
});

test("validateIssuePayload accepts valid input and rejects bad", () => {
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 2 }).ok, true);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 0 }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 1.5 }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", qty: 1 }).ok, false);
});

test("validateStockPayload accepts valid input and rejects bad", () => {
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 20 }).ok, true);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 0 }).ok, false);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 1.5 }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_delta: 20 }).ok, false);
});

test("findRowIndex locates a row by id column", () => {
  const values = [["student_id", "name"], ["S001", "Abena"], ["S004", "Yaw"]];
  assert.equal(lib.findRowIndex(values, "student_id", "S004").rowIndex, 3);
  assert.equal(lib.findRowIndex(values, "student_id", "S999"), null);
});

test("colLetter renders spreadsheet column letters", () => {
  assert.equal(lib.colLetter(0), "A");
  assert.equal(lib.colLetter(5), "F");
  assert.equal(lib.colLetter(6), "G");
  assert.equal(lib.colLetter(8), "I");
  assert.equal(lib.colLetter(25), "Z");
  assert.equal(lib.colLetter(26), "AA");
});
```

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `node scripts/test.js`
Expected: new tests FAIL with a `Cannot find module '../api/_lib.js'` error (or similar) for the `require`.

- [x] **Step 3: Implement the pure helpers**

Create `api/_lib.js` with exactly this content:

```js
"use strict";

const OAUTH_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const METHODS = ["Cash", "MTN MoMo", "Telecel"];
const GENDERS = ["male", "female"];

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

// values: array of arrays (values[0] is the header row). Returns prefix + (max+1)
// zero-padded to 3 digits. Empty/header-only tables roll to prefix001.
function nextId(values, prefix) {
  let max = 0;
  (values || []).forEach((row, i) => {
    if (i === 0) return;
    const v = String(row[0] || "");
    if (v.indexOf(prefix) === 0) {
      const n = parseInt(v.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + String(max + 1).padStart(3, "0");
}

function recomputeStatus(booksPaid, booksFee) {
  if (booksPaid <= 0) return "not covered";
  if (booksPaid >= booksFee) return "ready";
  return "waiting";
}

function colLetter(n) {
  let s = "";
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// values: array of arrays (values[0] header). Returns { rowIndex, colLetter }
// where rowIndex is 1-based spreadsheet row number. Null when not found.
function findRowIndex(values, idColumn, id) {
  const header = (values && values[0]) || [];
  const col = header.indexOf(idColumn);
  if (col < 0) throw new Error("Column " + idColumn + " not found in tab");
  for (let i = 1; i < values.length; i++) {
    if (values[i][col] === id) return { rowIndex: i + 1, col: colLetter(col) };
  }
  return null;
}

function validatePaymentPayload(raw) {
  const p = raw || {};
  const amount = Number(p.amount);
  if (!p.student_id || typeof p.student_id !== "string") return { ok: false, error: "student_id is required" };
  if (!(amount > 0)) return { ok: false, error: "amount must be a positive number" };
  if (METHODS.indexOf(p.method) === -1) return { ok: false, error: "method must be Cash, MTN MoMo, or Telecel" };
  return { ok: true, payload: { student_id: p.student_id, amount: amount, method: p.method, date: p.date || todayISO() } };
}

function validateStudentPayload(raw) {
  const p = raw || {};
  const fee = Number(p.books_fee);
  const total = Number(p.books_total);
  if (!p.name || !String(p.name).trim()) return { ok: false, error: "name is required" };
  if (!p.class || !String(p.class).trim()) return { ok: false, error: "class is required" };
  if (GENDERS.indexOf(p.gender) === -1) return { ok: false, error: "gender must be male or female" };
  if (!(fee >= 0) || !(total >= 0)) return { ok: false, error: "books_fee and books_total must be non-negative numbers" };
  return { ok: true, payload: { name: String(p.name).trim(), className: String(p.class).trim(), gender: p.gender, booksFee: fee, booksTotal: total, academicYear: p.academic_year || "2026/2027" } };
}

function validateIssuePayload(raw) {
  const p = raw || {};
  const qty = Number(p.qty);
  if (!p.student_id || typeof p.student_id !== "string") return { ok: false, error: "student_id is required" };
  if (!p.book_id || typeof p.book_id !== "string") return { ok: false, error: "book_id is required" };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "qty must be a positive integer" };
  return { ok: true, payload: { student_id: p.student_id, book_id: p.book_id, qty: qty } };
}

function validateStockPayload(raw) {
  const p = raw || {};
  const delta = Number(p.stock_delta);
  if (!p.book_id || typeof p.book_id !== "string") return { ok: false, error: "book_id is required" };
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: "stock_delta must be a non-zero integer" };
  return { ok: true, payload: { book_id: p.book_id, stockDelta: delta } };
}

module.exports = {
  OAUTH_URL,
  API_BASE,
  todayISO,
  nextId,
  recomputeStatus,
  colLetter,
  findRowIndex,
  validatePaymentPayload,
  validateStudentPayload,
  validateIssuePayload,
  validateStockPayload
};
```

- [x] **Step 4: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: all previous tests PASS plus the ~12 new ones; output ends with `<N> tests passed`.

- [x] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: add pure write-back helpers (nextId, status, validators)"
```

---

### Task 2: Sheets client (token + API calls) in `api/_lib.js`

**Files:**
- Modify: `api/_lib.js` (append `createClient`)
- Modify: `scripts/test.js` (append client tests using a fake `fetch`)

- [x] **Step 1: Write failing tests for the client with a fake fetch**

Append to `scripts/test.js`:

```js
function makeFakeFetch(responses, calls) {
  return async (url, opts) => {
    calls.push({ url, opts });
    const entry = responses.shift();
    return {
      ok: entry.ok,
      status: entry.status,
      json: async () => entry.body
    };
  };
}

test("createClient refreshes and caches the access token", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: true, status: 200, body: {} },
    { ok: true, status: 200, body: {} }
  ], calls);
  const client = lib.createClient(
    { client_id: "cid", client_secret: "cs", refresh_token: "rt" },
    fake
  );
  await client.sheetsGet("spr123", "Students!A:I");
  await client.sheetsGet("spr123", "Students!A:I");
  assert.equal(calls.filter((c) => c.url === lib.OAUTH_URL).length, 1, "token fetched once");
  assert.equal(calls[0].url, lib.OAUTH_URL);
  assert.match(calls[0].opts.body, /grant_type=refresh_token/);
  assert.match(calls[0].opts.body, /client_id=cid/);
});

test("sheetsGet sends bearer token and returns values array", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: true, status: 200, body: { values: [["student_id"], ["S001"]] } }
  ], calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  const values = await client.sheetsGet("spr123", "Students!A:I");
  assert.deepEqual(values, [["student_id"], ["S001"]]);
  const apiCall = calls[1];
  assert.equal(apiCall.opts.method || "GET", "GET");
  assert.match(apiCall.url, /\/spr123\/values\/Students!A%3AI$/);
  assert.equal(apiCall.opts.headers.Authorization, "Bearer tok1");
});

test("sheetsAppend POSTs rows and sheetsUpdate PUTs values", async () => {
  const calls = [];
  const valuesCalls = [
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: true, status: 200, body: {} },
    { ok: true, status: 200, body: {} }
  ];
  const fake = makeFakeFetch(valuesCalls, calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await client.sheetsAppend("spr123", "Payments", [["P009", "S001", "Abena", "BS 1A", "500", "Cash", "2026-09-23", "confirmed"]]);
  await client.sheetsUpdate("spr123", "Students!G3", [["1200"]]);
  assert.match(calls[1].url, /:append\?valueInputOption=RAW/);
  assert.equal(calls[1].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].opts.body).values[0].length, 8);
  assert.match(calls[2].url, /Students!G3\?valueInputOption=RAW/);
  assert.equal(calls[2].opts.method, "PUT");
});

test("createClient throws on missing env", () => {
  assert.throws(() => lib.createClient({}, () => {}), /GOOGLE_CLIENT_ID/);
});

test("createClient surfaces the OAuth error description on refresh failure", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: false, status: 400, body: { error_description: "Token has been expired or revoked." } }
  ], calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await assert.rejects(client.sheetsGet("spr123", "Students!A:I"), /Token has been expired or revoked./);
});

test("sheetsGet reports the Sheets API error message on failure", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: false, status: 404, body: { error: { message: "Requested entity was not found." } } }
  ], calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await assert.rejects(client.sheetsGet("spr123", "BadRange"), /Sheets read failed: Requested entity was not found/);
});
```

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `node scripts/test.js`
Expected: new tests FAIL with `lib.createClient is not a function`.

- [x] **Step 3: Implement `createClient`**

Append to `api/_lib.js` (before `module.exports`):

```js
function createClient(env, fetchImpl) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (!env || !env.client_id || !env.client_secret || !env.refresh_token) {
    throw new Error("Google OAuth env (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN) is not set");
  }
  let cached = null;

  async function getAccessToken() {
    if (cached && cached.expiresAt > Date.now() + 60000) return cached.value;
    const res = await fetcher(OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:
        "client_id=" + encodeURIComponent(env.client_id) +
        "&client_secret=" + encodeURIComponent(env.client_secret) +
        "&refresh_token=" + encodeURIComponent(env.refresh_token) +
        "&grant_type=refresh_token"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error("OAuth refresh failed: " + (data.error_description || res.status));
    }
    cached = { value: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.value;
  }

  async function sheetsGet(spreadsheetId, range) {
    const token = await getAccessToken();
    const res = await fetcher(
      API_BASE + "/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(range),
      { headers: { Authorization: "Bearer " + token } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sheets read failed: " + ((data && data.error && data.error.message) || res.status));
    return data && data.values ? data.values : [];
  }

  async function sheetsAppend(spreadsheetId, tab, rows) {
    const token = await getAccessToken();
    const res = await fetcher(
      API_BASE + "/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(tab + "!A1:J1") + ":append?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ majorDimension: "ROWS", values: rows })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sheets append failed: " + ((data && data.error && data.error.message) || res.status));
    return data;
  }

  async function sheetsUpdate(spreadsheetId, range, values) {
    const token = await getAccessToken();
    const res = await fetcher(
      API_BASE + "/" + encodeURIComponent(spreadsheetId) + "/values/" + encodeURIComponent(range) + "?valueInputOption=RAW",
      {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ majorDimension: "ROWS", values: values })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sheets update failed: " + ((data && data.error && data.error.message) || res.status));
    return data;
  }

  return { getAccessToken, sheetsGet, sheetsAppend, sheetsUpdate };
}
```

- [x] **Step 4: Update `module.exports`**

In `api/_lib.js`, change the `module.exports` object to add `createClient`:

```js
module.exports = {
  OAUTH_URL,
  API_BASE,
  todayISO,
  nextId,
  recomputeStatus,
  colLetter,
  findRowIndex,
  validatePaymentPayload,
  validateStudentPayload,
  validateIssuePayload,
  validateStockPayload,
  createClient
};
```

- [x] **Step 5: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: all tests PASS.

- [x] **Step 6: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: add Sheets API client with cached OAuth token refresh"
```

> **Amendment (code-quality review, Task 2):** four adjudicated test fixes (cache-count via filtered OAuth URL, queue trimmed to 3 with update asserted at `calls[2]`, encoded-URL `%3AI` regex, `opts.method || "GET"`) — all test-only, accepted by spec review. Two error-path tests added. Production also hardened: all four `res.json()` calls are `res.json().catch(() => ({}))` so a non-JSON upstream error body degrades to the `res.status` fallback instead of a `SyntaxError`. Follow-up commit: `fix: guard res.json() against non-JSON upstream error bodies`.

---

### Task 3: Operation runners in `api/_lib.js`

**Files:**
- Modify: `api/_lib.js` (append `runPayment`, `runStudent`, `runIssue`, `runStock`)
- Modify: `scripts/test.js` (append runner tests using a fake client)

- [x] **Step 1: Write failing tests for the runners with a fake client**

Append to `scripts/test.js`:

```js
function makeFakeClient(gets) {
  const calls = [];
  return {
    calls,
    sheetsGet: async (id, range) => (range in gets ? gets[range] : []),
    sheetsAppend: async (id, tab, rows) => { calls.push({ op: "append", tab, rows }); return { ok: true }; },
    sheetsUpdate: async (id, range, values) => { calls.push({ op: "update", range, values }); return { ok: true }; }
  };
}

test("runPayment appends payment, updates student, appends activity", async () => {
  const stats = lib.recomputeStatus;
  const client = makeFakeClient({
    "Students!A:I": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","waiting"]],
    "Payments!A:A": [["payment_id"],["P008"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runPayment(client, "spr", { student_id: "S001", amount: 400, method: "Cash", date: "2026-09-23" });
  assert.equal(r.ok, true);
  assert.equal(r.row.payment_id, "P009");
  const ops = client.calls;
  assert.equal(ops[0].op, "append");
  assert.equal(ops[0].tab, "Payments");
  assert.deepEqual(ops[0].rows[0].slice(0, 8), ["P009","S001","Abena Mensah","BS 1A","400","Cash","2026-09-23","confirmed"]);
  assert.equal(ops[1].op, "update");
  assert.equal(ops[1].range, "Students!G2");
  assert.deepEqual(ops[1].values, [["1200"]]);
  assert.equal(ops[2].op, "update");
  assert.equal(ops[2].range, "Students!I2");
  assert.deepEqual(ops[2].values, [[stats(1200, 1200)]]);
  assert.equal(ops[3].op, "append");
  assert.equal(ops[3].tab, "Activity");
  assert.match(ops[3].rows[0][2], /Payment received from Abena Mensah/);
});

test("runPayment uses partial wording when paid is below fee", async () => {
  const client = makeFakeClient({
    "Students!A:I": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","status"],["S003","Ama Serwaa","JS 1","female","2026/2027","1400","700","10","waiting"]],
    "Payments!A:A": [["payment_id"],["P008"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runPayment(client, "spr", { student_id: "S003", amount: 100, method: "Cash", date: "2026-09-23" });
  assert.equal(r.ok, true);
  assert.match(client.calls[3].rows[0][2], /Partial payment from Ama Serwaa/);
});

test("runPayment rejects missing student", async () => {
  const client = makeFakeClient({ "Students!A:I": [["student_id"]] });
  const r = await lib.runPayment(client, "spr", { student_id: "S999", amount: 100, method: "Cash" });
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runStudent appends student + activity", async () => {
  const client = makeFakeClient({
    "Students!A:A": [["student_id"],["S009"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runStudent(client, "spr", { name: "Araba Quaicoe", className: "BS 4", gender: "female", booksFee: 1350, booksTotal: 9, academicYear: "2026/2027" });
  assert.equal(r.ok, true);
  assert.equal(r.row.student_id, "S010");
  assert.equal(client.calls[0].tab, "Students");
  assert.deepEqual(client.calls[0].rows[0].slice(0, 9), ["S010","Araba Quaicoe","BS 4","female","2026/2027","1350","0","9","not covered"]);
  assert.equal(client.calls[1].tab, "Activity");
  assert.match(client.calls[1].rows[0][2], /New student record created for Araba Quaicoe/);
});

test("runIssue decrements stock and appends activity", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B003","Pearson","Integrated Science","Core","92","12","15"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B003", qty: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.row.stock_qty, 10);
  assert.equal(client.calls[0].op, "update");
  assert.equal(client.calls[0].range, "Books!F2");
  assert.deepEqual(client.calls[0].values, [["10"]]);
  assert.equal(client.calls[1].tab, "Activity");
  assert.match(client.calls[1].rows[0][2], /Books issued to Abena Mensah/);
});

test("runIssue rejects when stock would go negative", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B001","GoldenA","BWP - Mathematics","Core","85","2","10"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B001", qty: 5 });
  assert.equal(r.ok, false);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runStock adjusts stock and appends activity", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B004","Aki-Ola","Social Studies","Elective","70","60","10"]]
  });
  const r = await lib.runStock(client, "spr", { book_id: "B004", stockDelta: -5 });
  assert.equal(r.ok, true);
  assert.equal(r.row.stock_qty, 55);
  assert.equal(client.calls[0].range, "Books!F2");
  assert.deepEqual(client.calls[0].values, [["55"]]);
  assert.match(client.calls[1].rows[0][2], /Stock corrected for Social Studies/);
});

test("runStock rejects when result would be negative", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B005","DL","JHS Science Textbook","Core","88","3","10"]]
  });
  const r = await lib.runStock(client, "spr", { book_id: "B005", stockDelta: -10 });
  assert.equal(r.ok, false);
  assert.match(r.error, /below zero/);
  assert.equal(client.calls.length, 0);
});

test("cellNum returns 0 for blank cells and throws on non-numeric values", async () => {
  assert.equal(lib.cellNum(1200), 1200);
  assert.equal(lib.cellNum("1200"), 1200);
  assert.equal(lib.cellNum("12.5"), 12.5);
  assert.equal(lib.cellNum(""), 0);
  assert.equal(lib.cellNum(undefined), 0);
  assert.equal(lib.cellNum(null), 0);
  assert.throws(() => lib.cellNum("abc"), /non-numeric/);
  assert.throws(() => lib.cellNum("NaN"), /non-numeric/);
});

test("runIssue rejects when the stock cell is non-numeric (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B009","GoldenA","BWP - Creative Arts","Core","95","abc","10"]]
  });
  await assert.rejects(() => lib.runIssue(client, "spr", { student_id: "S001", book_id: "B009", qty: 1 }), /non-numeric/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runStock rejects when the stock cell is non-numeric (no writes)", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B009","GoldenA","BWP - Creative Arts","Core","95","1.2.3","10"]]
  });
  await assert.rejects(() => lib.runStock(client, "spr", { book_id: "B009", stockDelta: 1 }), /non-numeric/);
  assert.equal(client.calls.length, 0, "no writes happened");
});
```

- [x] **Step 2: Run tests to verify the new ones fail**

Run: `node scripts/test.js`
Expected: new tests FAIL with `lib.runPayment is not a function`.

- [x] **Step 3: Implement the runners**

Append to `api/_lib.js` (before `module.exports`):

```js
function cellNum(v) {
  if (v === "" || v === undefined || v === null) return 0;
  const n = Number(v);
  if (isNaN(n)) throw new Error("Sheet contains a non-numeric value");
  return n;
}

async function runPayment(client, spreadsheetId, payload) {
  const students = await client.sheetsGet(spreadsheetId, "Students!A:I");
  const found = findRowIndex(students, "student_id", payload.student_id);
  if (!found) return { ok: false, error: "student_id not found" };
  const row = students[found.rowIndex - 1];
  const fee = cellNum(row[5]);
  const paid = cellNum(row[6]);
  const name = row[1];
  const klass = row[2];
  const newPaid = paid + payload.amount;
  const status = recomputeStatus(newPaid, fee);
  const payments = await client.sheetsGet(spreadsheetId, "Payments!A:A");
  const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
  const paymentId = nextId(payments, "P");
  const activityId = nextId(activity, "A");
  await client.sheetsAppend(spreadsheetId, "Payments", [[
    paymentId, payload.student_id, name, klass, String(payload.amount), payload.method, payload.date, "confirmed"
  ]]);
  await client.sheetsUpdate(spreadsheetId, "Students!" + colLetter(6) + found.rowIndex, [[String(newPaid)]]);
  await client.sheetsUpdate(spreadsheetId, "Students!" + colLetter(8) + found.rowIndex, [[status]]);
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "payment", (newPaid >= fee ? "Payment received from " : "Partial payment from ") + name, String(payload.amount), payload.date
  ]]);
  return { ok: true, row: { payment_id: paymentId, student_id: payload.student_id, amount: payload.amount, status: "confirmed" } };
}

async function runStudent(client, spreadsheetId, payload) {
  const students = await client.sheetsGet(spreadsheetId, "Students!A:A");
  const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
  const studentId = nextId(students, "S");
  const activityId = nextId(activity, "A");
  await client.sheetsAppend(spreadsheetId, "Students", [[
    studentId, payload.name, payload.className, payload.gender, payload.academicYear,
    String(payload.booksFee), "0", String(payload.booksTotal), "not covered"
  ]]);
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "student", "New student record created for " + payload.name, "0", todayISO()
  ]]);
  return { ok: true, row: { student_id: studentId } };
}

async function runIssue(client, spreadsheetId, payload) {
  const students = await client.sheetsGet(spreadsheetId, "Students!A:B");
  const foundStudent = findRowIndex(students, "student_id", payload.student_id);
  if (!foundStudent) return { ok: false, error: "student_id not found" };
  const books = await client.sheetsGet(spreadsheetId, "Books!A:I");
  const foundBook = findRowIndex(books, "book_id", payload.book_id);
  if (!foundBook) return { ok: false, error: "book_id not found" };
  const bookRow = books[foundBook.rowIndex - 1];
  const stockQty = cellNum(bookRow[5]);
  if (payload.qty > stockQty) return { ok: false, error: "insufficient stock: only " + stockQty + " available" };
  const subject = bookRow[2];
  const studentName = students[foundStudent.rowIndex - 1][1];
  const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
  const activityId = nextId(activity, "A");
  await client.sheetsUpdate(spreadsheetId, "Books!" + colLetter(5) + foundBook.rowIndex, [[String(stockQty - payload.qty)]]);
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "issue", "Books issued to " + studentName, "0", todayISO()
  ]]);
  return { ok: true, row: { book_id: payload.book_id, stock_qty: stockQty - payload.qty } };
}

async function runStock(client, spreadsheetId, payload) {
  const books = await client.sheetsGet(spreadsheetId, "Books!A:I");
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

- [x] **Step 4: Update `module.exports`**

Add `createClient` is already there; append the runners:

```js
module.exports = {
  OAUTH_URL,
  API_BASE,
  todayISO,
  nextId,
  recomputeStatus,
  colLetter,
  findRowIndex,
  cellNum,
  validatePaymentPayload,
  validateStudentPayload,
  validateIssuePayload,
  validateStockPayload,
  createClient,
  runPayment,
  runStudent,
  runIssue,
  runStock
};
```

- [x] **Step 5: Run tests to verify they pass**

Run: `node scripts/test.js`
Expected: all tests PASS (previous count + ~11 new) — 50 total (39 baseline + 8 runner tests + 3 cellNum guard tests).

- [x] **Step 6: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat: add write-back operation runners (payment, student, issue, stock)"
```

> **Amendment (adjudicated — adopted from code-quality review):** bare `Number(row[n])` returns `NaN` for blank/absent cells (the Sheets API omits trailing empty cells in a row). Because `NaN` comparisons are always `false`, `NaN` *silently defeated the two stock guards* (`runIssue` `qty > stockQty` and `runStock` `newQty < 0`) and wrote the literal string `"NaN"` into the live sheet. Fix: `cellNum(v)` — blank (`""`/`undefined`/`null`) → `0`, otherwise throw `"Sheet contains a non-numeric value"` on `NaN` — applied at all four read sites; three new tests pin it (`cellNum` unit; `runIssue`/`runStock` reject on non-numeric stock with zero writes); `assert.match(r.error, /below zero/)` added to the `runStock` negative test. Count becomes 50. Applied after Task 3 reviews as its own commit (`fix: guard numeric reads against NaN in write-back runners`).
>
> **Partial-failure semantics (documented — approved, no code change here):** each runner performs 3–4 sequential Sheets calls with no rollback; a mid-flight failure leaves earlier writes persisted, and a retry double-applies money (a second payment row increments `books_paid` again). Acceptable for a single-operator, human-auditable sheet; Vercel does not auto-retry a completed POST. Mitigations adopted into Task 8: `runAndRefresh` repaints the sheet's actual post-attempt state on failure *and* success (clears cache + re-renders before the error surfaces), and dialog submit buttons are disabled for the duration of the POST (submit lock) to kill the double-submit race.
>
> Deferred (may defer): floating-point representation of GHS amounts (`Math.round(x*100)/100` before `String()`) — dataset is integer-valued; `makeFakeClient` write-failure injection for pinning partial-application semantics; `assert.match` on the `runIssue` "insufficient stock" message.

---

### Task 4: Vercel function endpoints

**Files:**
- Create: `api/payment.js`
- Create: `api/student.js`
- Create: `api/issue.js`
- Create: `api/stock.js`

- [x] **Step 1: Create `api/payment.js`**

```js
"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    const parsed = lib.validatePaymentPayload(req.body);
    if (!parsed.ok) return res.status(400).json(parsed);
    const client = lib.createClient({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const result = await lib.runPayment(client, process.env.SPREADSHEET_ID, parsed.payload);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
```

- [x] **Step 2: Create `api/student.js`**

```js
"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    const parsed = lib.validateStudentPayload(req.body);
    if (!parsed.ok) return res.status(400).json(parsed);
    const client = lib.createClient({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const result = await lib.runStudent(client, process.env.SPREADSHEET_ID, parsed.payload);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
```

- [x] **Step 3: Create `api/issue.js`**

```js
"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    const parsed = lib.validateIssuePayload(req.body);
    if (!parsed.ok) return res.status(400).json(parsed);
    const client = lib.createClient({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const result = await lib.runIssue(client, process.env.SPREADSHEET_ID, parsed.payload);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
```

- [x] **Step 4: Create `api/stock.js`**

```js
"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    const parsed = lib.validateStockPayload(req.body);
    if (!parsed.ok) return res.status(400).json(parsed);
    const client = lib.createClient({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const result = await lib.runStock(client, process.env.SPREADSHEET_ID, parsed.payload);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
```

- [x] **Step 5: Syntax-check all four endpoints and `_lib`**

```bash
node --check api/_lib.js
node --check api/payment.js
node --check api/student.js
node --check api/issue.js
node --check api/stock.js
```

Run each as its own command (PowerShell 5.1 has no `&&`). Expected: no output = valid syntax.

- [x] **Step 6: Commit**

```bash
git add api/payment.js api/student.js api/issue.js api/stock.js
git commit -m "feat: add Vercel write-back endpoints"
```

---

### Task 5: Integration test against a scratch spreadsheet

**Files:**
- Create: `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-test.cjs`  (throwaway, NOT committed)

This creates a scratch spreadsheet, seeds minimal tabs, runs all four operations through the real `_lib`/`createClient` (real network, real OAuth), re-reads via the same Sheets API, and asserts the write effects landed.

- [ ] **Step 1: Write the runner script**

Create `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-test.cjs`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const lib = require("D:/Desktop/CEC_Book_System_Stage_01_Frontend_Foundation/api/_lib.js");

const REPO = "D:/Desktop/CEC_Book_System_Stage_01_Frontend_Foundation";
const creds = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "opencode", "cec-client.json"), "utf8"));
const tokens = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "opencode", "tokens.json"), "utf8"));

const env = { client_id: creds.client_id, client_secret: creds.client_secret, refresh_token: tokens.refresh_token };
const fetcher = globalThis.fetch;

async function createSpreadsheet(title) {
  const res = await fetcher("https://sheets.googleapis.com/v4/spreadsheets", {
    method: "POST",
    headers: { Authorization: "Bearer " + tokens.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { title } })
  });
  const data = await res.json();
  if (!res.ok) throw new Error("create failed: " + JSON.stringify(data));
  return data.spreadsheetId;
}

async function main() {
  const client = lib.createClient(env, fetcher);
  const sprId = await createSpreadsheet("CEC Stage 03 write test " + Date.now());
  console.log("scratch spreadsheet", sprId);

  // Compare spend? No: seed via a fresh token synchronously. Use one call.
  const tok = await client.getAccessToken();
  async function seed(sheet, values) {
    const res = await fetcher(
      "https://sheets.googleapis.com/v4/spreadsheets/" + sprId + "/values/" + sheet + "!A1:J50:append?valueInputOption=RAW",
      { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" },
        body: JSON.stringify({ majorDimension: "ROWS", values }) });
    if (!res.ok) throw new Error("seed " + sheet + " failed: " + res.status);
  }

  await seed("Students", [
    ["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","status"],
    ["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","waiting"],
    ["S002","Kofi Owusu","BS 4","male","2026/2027","1350","1350","9","ready"]
  ]);
  await seed("Payments", [["payment_id","student_id","student_name","class","amount","method","date","status"],["P008","S001","Abena Mensah","BS 1A","400","Cash","2026-09-21","confirmed"]]);
  await seed("Activity", [["activity_id","type","description","amount","created_at"],["A006","payment","Partial payment from Akua Sarpong","200","2026-09-21"]]);
  await seed("Books", [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B004","Aki-Ola","Social Studies","Elective","70","60","10"]]);

  // payment: S001 +500 Cash -> books_paid 1300, status ready, P009, A007
  let r = await lib.runPayment(client, sprId, { student_id: "S001", amount: 500, method: "Cash", date: "2026-09-23" });
  assert.equal(r.ok, true);
  assert.equal(r.row.payment_id, "P009");

  // student: -> S003
  r = await lib.runStudent(client, sprId, { name: "Nana Adjei", className: "JS 3", gender: "male", booksFee: 1450, booksTotal: 10, academicYear: "2026/2027" });
  assert.equal(r.ok, true);
  assert.equal(r.row.student_id, "S003");

  // issue: B004 -3 -> 57
  r = await lib.runIssue(client, sprId, { student_id: "S002", book_id: "B004", qty: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.row.stock_qty, 57);

  // stock: B004 +8 -> 65
  r = await lib.runStock(client, sprId, { book_id: "B004", stockDelta: 8 });
  assert.equal(r.ok, true);
  assert.equal(r.row.stock_qty, 65);

  // rejections: no writes
  r = await lib.runIssue(client, sprId, { student_id: "S002", book_id: "B004", qty: 999 });
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient stock/);

  // Re-read via the same Sheets API and verify persisted rows.
  const students = await client.sheetsGet(sprId, "Students!A:I");
  const s1 = students.find(row => row[0] === "S001");
  assert.equal(s1[6], "1300");
  assert.equal(s1[8], "ready");
  const s3 = students.find(row => row[0] === "S003");
  assert.equal(s3[7], "10");
  assert.equal(s3[8], "not covered");

  const books = await client.sheetsGet(sprId, "Books!A:I");
  const b4 = books.find(row => row[0] === "B004");
  assert.equal(b4[5], "65");

  const payments = await client.sheetsGet(sprId, "Payments!A:A");
  assert.ok(payments.some(row => row[0] === "P009"));
  const activity = await client.sheetsGet(sprId, "Activity!A:A");
  assert.ok(activity.some(row => row[0] === "A007"));

  console.log("INTEGRATION OK — spreadsheet " + sprId);
}

main().then(() => process.exit(0), err => { console.error("FAIL", err); process.exit(1); });
```

- [ ] **Step 2: Run the integration test**

Run: `node "C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-test.cjs"`
Expected: prints `INTEGRATION OK — spreadsheet <id>` and exits 0. This proves the real write path (OAuth refresh → Sheets API) works end to end.

- [ ] **Step 3: Confirm the unit suite still passes**

Run: `node scripts/test.js` (in the repo)
Expected: all tests PASS.

- [ ] **Step 4: Commit**

The runner is a throwaway in Temp — nothing to commit. Confirm `git status --short` shows only the prior Task 4 files committed (clean working tree).

---

### Task 6: Expose `CEC.clearCache()` and `CEC.fetchOptions()` in `js/data-access.js`

**Files:**
- Modify: `js/data-access.js` (add three functions + two exports)
- Modify: `scripts/test.js` (NOT possible for browser `sessionStorage` — instead verify via `node --check` and the browser E2E in Task 10)

- [ ] **Step 1: Make the change**

In `js/data-access.js`, inside the IIFE, add these functions after `getDashboardData` (reusing existing `fetchTab` and `loadMeta`):

```js
  function clearCache() {
    Object.keys(sessionCache).forEach(k => delete sessionCache[k]);
  }

  async function fetchOptions() {
    CEC.meta = await loadMeta();
    const [studentsRows, booksRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Books", "books.json")
    ]);
    return {
      students: CEC.derive.normalizeStudents(studentsRows),
      books: CEC.derive.normalizeBooks(booksRows)
    };
  }
```

Then extend the existing `Object.assign(window.CEC, { ... })` block:

```js
  Object.assign(window.CEC, {
    csv: window.CEC.csv,
    derive: window.CEC.derive,
    getDashboardData: getDashboardData,
    clearCache: clearCache,
    fetchOptions: fetchOptions
  });
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/data-access.js`
Expected: no output = valid.

- [ ] **Step 3: Commit**

```bash
git add js/data-access.js
git commit -m "feat: expose CEC.clearCache and CEC.fetchOptions for write refresh"
```

---

### Task 7: Expose `CEC.renderDashboard` in `js/app.js`

**Files:**
- Modify: `js/app.js` (expose `renderDashboard`, leave all other behavior intact)

- [ ] **Step 1: Make the change**

In `js/app.js`, at the end of the IIFE (after the `renderDashboard().catch(...)` block, before the closing `})();`), add:

```js
  window.CEC = window.CEC || {};
  window.CEC.renderDashboard = renderDashboard;
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/app.js`
Expected: no output = valid.

- [ ] **Step 3: Commit**

```bash
git add js/app.js
git commit -m "feat: expose renderDashboard for post-write repaint"
```

---

### Task 8: `js/write.js` — fetch layer + modal wiring

**Files:**
- Create: `js/write.js`
- Modify: `index.html` (add `<script src="js/write.js"></script>` after `app.js`)
- Modify: `css/app.css` (append modal styles — done in Task 9)

- [ ] **Step 1: Create `js/write.js`**

```js
(() => {
  const root = window.CEC = window.CEC || {};

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  const METHODS = ["Cash", "MTN MoMo", "Telecel"];
  const GENDERS = ["male", "female"];

  async function post(op, body) {
    const res = await fetch("api/" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || ("Write failed (HTTP " + res.status + ")"));
    }
    return data;
  }

  async function runAndRefresh(op, body) {
    try {
      await post(op, body);
    } finally {
      root.clearCache();
      await root.renderDashboard();
    }
  }

  root.write = {
    recordPayment: p => runAndRefresh("payment", p),
    registerStudent: s => runAndRefresh("student", s),
    issueBooks: i => runAndRefresh("issue", i),
    adjustStock: s => runAndRefresh("stock", s)
  };

  const dialogs = {
    payment: document.getElementById("dlgPayment"),
    student: document.getElementById("dlgStudent"),
    issue: document.getElementById("dlgIssue"),
    stock: document.getElementById("dlgStock")
  };

  function showError(dlgId, msg) {
    const el = dlgId.querySelector("[data-error]");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function clearError(dlgId) {
    const el = dlgId.querySelector("[data-error]");
    if (el) el.hidden = true;
  }

  function openDialog(name) {
    const dlg = dialogs[name];
    if (!dlg) return;
    clearError(dlg);
    populate(name).then(() => dlg.showModal());
  }

  document.querySelectorAll("[data-action]").forEach(btn => {
    const action = btn.dataset.action;
    if (action in dialogs) {
      btn.addEventListener("click", () => openDialog(action));
    }
  });

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => {
      const dlg = btn.closest("dialog");
      if (dlg) dlg.close();
    });
  });

  async function populate(name) {
    const opts = await root.fetchOptions();
    if (name === "payment" || name === "issue") {
      const studentSel = dialogs[name].querySelector("[data-student]");
      studentSel.innerHTML = '<option value="">Select student…</option>' + opts.students
        .map(s => '<option value="' + esc(s.studentId) + '">' + esc(s.name) + " (" + esc(s.className) + ")</option>")
        .join("");
    }
    if (name === "issue" || name === "stock") {
      const bookSel = dialogs[name].querySelector("[data-book]");
      bookSel.innerHTML = '<option value="">Select book…</option>' + opts.books
        .map(b => '<option value="' + esc(b.bookId) + '">' + esc(b.subject) + " — " + esc(b.publisher) + " (stock " + b.stockQty + ")</option>")
        .join("");
    }
  }

  function readValue(dlg, sel) {
    const el = dlg.querySelector(sel);
    return el ? el.value : "";
  }

  dialogs.payment.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const amount = Number(readValue(dlg, "[data-amount]"));
    if (!(amount > 0)) return showError(dlg, "Amount must be a positive number.");
    const method = readValue(dlg, "[data-method]");
    if (METHODS.indexOf(method) === -1) return showError(dlg, "Select a payment method.");
    const studentId = readValue(dlg, "[data-student]");
    if (!studentId) return showError(dlg, "Select a student.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.recordPayment({ studentId, amount, method });
      dlg.close();
      showToast("Payment recorded.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.student.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const name = readValue(dlg, "[data-name]").trim();
    const klass = readValue(dlg, "[data-class]").trim();
    const gender = readValue(dlg, "[data-gender]");
    const fee = Number(readValue(dlg, "[data-fee]"));
    const total = Number(readValue(dlg, "[data-total]"));
    if (!name) return showError(dlg, "Student name is required.");
    if (!klass) return showError(dlg, "Class is required.");
    if (GENDERS.indexOf(gender) === -1) return showError(dlg, "Select a gender.");
    if (!(fee >= 0) || !(total >= 0)) return showError(dlg, "Books fee and total must be zero or more.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.registerStudent({ name, className: klass, gender, booksFee: fee, booksTotal: total });
      dlg.close();
      showToast("Student registered.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  dialogs.issue.addEventListener("submit", async e => {
    e.preventDefault();
    const dlg = e.currentTarget;
    const studentId = readValue(dlg, "[data-student]");
    const bookId = readValue(dlg, "[data-book]");
    const qty = Number(readValue(dlg, "[data-qty]"));
    if (!studentId) return showError(dlg, "Select a student.");
    if (!bookId) return showError(dlg, "Select a book.");
    if (!Number.isInteger(qty) || qty < 1) return showError(dlg, "Quantity must be a positive whole number.");
    const bookSell = dlg.querySelector("[data-book]");
    if (qty > Number(bookSell.selectedOptions[0].dataset.stock)) return showError(dlg, "Quantity exceeds current stock.");
    const submit = dlg.querySelector("[data-submit]");
    submit.disabled = true;
    try {
      await root.write.issueBooks({ studentId, bookId, qty });
      dlg.close();
      showToast("Books issued.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

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
      await root.write.adjustStock({ bookId, stockDelta: delta });
      dlg.close();
      showToast("Stock adjusted.");
    } catch (err) {
      showError(dlg, err.message);
    } finally {
      submit.disabled = false;
    }
  });

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }
})();
```

Note: the issue dialog wraps its own stock check by reading the book option's `data-stock` attribute (so the server-side insufficient-stock reject is caught client-side too). The book `<option>` must carry `data-stock="<qty>"` — this is added in Task 9's modal HTML.

- [ ] **Step 2: Add the script tag to `index.html`**

In `index.html`, change the script block (lines 197-200) to append `write.js` last:

```html
  <script src="js/csv.js"></script>
  <script src="js/derive.js"></script>
  <script src="js/data-access.js"></script>
  <script src="js/app.js"></script>
  <script src="js/write.js"></script>
```

- [ ] **Step 3: Syntax-check**

Run: `node --check js/write.js`
Expected: no output = valid.

- [ ] **Step 4: Commit**

```bash
git add js/write.js index.html
git commit -m "feat: write.js modal wiring and CEC.write API"
```

---

### Task 9: Modal markup in `index.html` + modal styles in `css/app.css`

**Files:**
- Modify: `index.html` (add four `<dialog>` blocks before the toast div)
- Modify: `css/app.css` (append modal styles)

- [ ] **Step 1: Add the four dialogs**

In `index.html`, between the `</main>` end and `<div class="toast"...>` (i.e. after `</div>` that closes app-shell, before the toast), insert:

```html
  <dialog class="modal" id="dlgPayment">
    <form method="dialog">
      <div class="modal-head"><h3>Record payment</h3><button type="button" class="modal-close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <label>Student<select data-student required></select></label>
        <label>Amount (GHS)<input type="number" data-amount min="0.01" step="0.01" required></label>
        <label>Method<select data-method>
          <option value="Cash">Cash</option>
          <option value="MTN MoMo">MTN MoMo</option>
          <option value="Telecel">Telecel</option>
        </select></label>
        <p class="modal-error" data-error hidden></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" data-submit>Save payment</button>
      </div>
    </form>
  </dialog>

  <dialog class="modal" id="dlgStudent">
    <form method="dialog">
      <div class="modal-head"><h3>Register student</h3><button type="button" class="modal-close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <label>Full name<input type="text" data-name required></label>
        <label>Class<input type="text" data-class placeholder="e.g. JS 1" required></label>
        <label>Gender<select data-gender>
          <option value="">Select…</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
        </select></label>
        <label>Books fee (GHS)<input type="number" data-fee min="0" step="0.01" required></label>
        <label>Books total<sup></sup><input type="number" data-total min="0" step="1" required></label>
        <p class="modal-error" data-error hidden></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" data-submit>Register</button>
      </div>
    </form>
  </dialog>

  <dialog class="modal" id="dlgIssue">
    <form method="dialog">
      <div class="modal-head"><h3>Issue books</h3><button type="button" class="modal-close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <label>Student<select data-student required></select></label>
        <label>Book<select data-book required></select></label>
        <label>Quantity<input type="number" data-qty min="1" step="1" required></label>
        <p class="modal-error" data-error hidden></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" data-submit>Issue</button>
      </div>
    </form>
  </dialog>

  <dialog class="modal" id="dlgStock">
    <form method="dialog">
      <div class="modal-head"><h3>Adjust stock</h3><button type="button" class="modal-close" data-close aria-label="Close">×</button></div>
      <div class="modal-body">
        <label>Book<select data-book required></select></label>
        <label>Adjustment<small>Positive adds stock, negative removes.</small><input type="number" data-delta step="1" required></label>
        <p class="modal-error" data-error hidden></p>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn btn-light" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" data-submit>Apply</button>
      </div>
    </form>
  </dialog>
```

Then, in `js/write.js` Task 8's `populate()` for `issue`/`stock`, the book options need a `data-stock` attribute for the client-side quantity check. Update the `populate()` book `<option>` line in `js/write.js` to:

```js
        .map(b => '<option value="' + esc(b.bookId) + '" data-stock="' + b.stockQty + '">' + esc(b.subject) + " — " + esc(b.publisher) + " (stock " + b.stockQty + ")</option>")
```

- [ ] **Step 2: Append modal styles to `css/app.css`**

Append this block to `css/app.css`:

```css
/* Stage 03 — write modals */
.modal {
  border: 0;
  border-radius: 10px;
  padding: 0;
  width: min(420px, 92vw);
  box-shadow: 0 18px 50px rgba(10, 25, 47, 0.35);
}
.modal::backdrop { background: rgba(10, 25, 47, 0.55); }
.modal[open] { display: grid; }
.modal form { margin: 0; }
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid #e6ecf5;
  background: #0a192f; color: #fff; border-radius: 10px 10px 0 0;
}
.modal-head h3 { margin: 0; font-size: 15px; letter-spacing: 0.02em; }
.modal-close {
  background: none; border: 0; color: #9fb3c8; font-size: 20px; cursor: pointer; line-height: 1;
}
.modal-close:hover { color: #fff; }
.modal-body { padding: 18px; display: grid; gap: 12px; }
.modal-body label { display: grid; gap: 4px; font-size: 13px; font-weight: 600; color: #1c2b44; }
.modal-body label small { font-weight: 400; color: #5a6b85; }
.modal-body input, .modal-body select {
  width: 100%; box-sizing: border-box; padding: 8px 10px;
  border: 1px solid #cfd9e8; border-radius: 6px; font-size: 14px; background: #fff;
}
.modal-body input:focus, .modal-body select:focus {
  outline: 2px solid #2f6fed; outline-offset: -1px; border-color: #2f6fed;
}
.modal-error { margin: 0; color: #b42318; font-size: 13px; font-weight: 500; }
.modal-foot {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 14px 18px; border-top: 1px solid #e6ecf5;
}
```

- [ ] **Step 3: Verify the page has no console errors and dialogs render**

Run: `node --check js/write.js` again (the `data-stock` change), then open `index.html` via the Task 10 harness. Confirm four dialogs exist in the DOM (`document.querySelectorAll("dialog").length === 4`).

- [ ] **Step 4: Commit**

```bash
git add index.html js/write.js css/app.css
git commit -m "feat: add four write modals with dashboard-consistent styling"
```

---

### Task 10: Browser E2E with the CDP harness

**Files:**
- Create: `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs`  (throwaway, NOT committed)

Extends the Stage 02 harness pattern (static server on `localhost:8123` + headless Chrome + CDP). Stubs `fetch` for `/api/*` so the modal flow is tested without real writes, and asserts client validation + cache-clear + repaint.

- [ ] **Step 1: Create the harness**

Create `C:\Users\SANDRA\AppData\Local\Temp\opencode\cec-write-e2e.cjs` modeled on the Stage 02 harness (`cec-browser-e2e.cjs`). Reuse its server/chrome/CDP plumbing exactly, and add:

```js
  // Stub /api/* responses, page-load script (must run before app code):
  // window.fetch returns a canned 200 for api/ paths; also flags CEC.clearCache calls.
  const stub = `
    (function () {
      const real = window.fetch;
      window.CEC = window.CEC || {};
      let cleared = 0;
      Object.defineProperty(window.CEC, '__cleared', { get: function () { return cleared; } });
      const realClear = null;
      window.__patch = function () {};
      window.fetch = function (url, opts) {
        if (typeof url === 'string' && url.indexOf('/api/') !== -1) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
            status: 200, headers: { 'Content-Type': 'application/json' }
          }));
        }
        return real.apply(this, arguments);
      };
      const origClear = window.CEC.clearCache;
      Object.defineProperty(window.CEC, 'clearCache', {
        get: function () { return function () { cleared++; if (origClear) return origClear.apply(this, arguments); }; },
        configurable: true
      });
    })();
  `;
```

- [ ] **Step 2: Run the E2E checks**

The harness should drive, in order, and print `PASS`/`FAIL` per check:
1. Page loads with zero console errors; `document.querySelectorAll("dialog").length === 4`.
2. Click the `+ Record payment` button → `#dlgPayment` opens.
3. Payment dropdown has student options (len > 0).
4. Submit with amount `0` → error text visible, no fetch call recorded for `/api/payment`.
5. Fill amount `500`, method `Cash`, select the first student, submit → dialog closes, `CEC.__cleared === 1`, a toast appears.
6. Open Issue dialog → book option carries `data-stock`; setting qty > data-stock and submitting shows the client-side error and no fetch call.

Expected at the end: `7/7` style PASS summary (count matching your checks) and exit 0.

- [ ] **Step 3: Run the full Stage 02 regression suite**

Re-run the Stage 02 harness (`cec-browser-e2e.cjs`) against the same local server. Expected: 7/7 still PASS (the `app.js`/`data-access.js` changes are additive exports only).

- [ ] **Step 4: Confirm unit suite**

Run: `node scripts/test.js`
Expected: all tests PASS (previous count + new write-back tests).

- [ ] **Step 5: Commit (if any repo file changed during E2E)**

If E2E surfaced a bug and you fixed a repo file, commit it:

```bash
git add <fixed-file>
git commit -m "fix: <what changed during browser E2E>"
```

If no repo changes were needed, confirm `git status --short` is clean.

---

### Task 11: Deploy smoke + documentation

**Files:**
- Modify: `README.md` (Stage 03 section)

- [ ] **Step 1: Deploy to Vercel**

Push the branch, then in the Vercel dashboard for this project add the env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (and confirm `SPREADSHEET_ID`, which the build already uses). Trigger a deploy. Confirm the functions deploy (Vercel auto-detects `api/*.js`).

- [ ] **Step 2: Live smoke test**

On the deployed preview URL:
1. Open the dashboard — existing live read still works (freshness label shows).
2. Use *Record payment* modal with a small real amount against an existing student; confirm the dashboard KPIs repaint and the sheet gains the row + activity entry.
3. Try one *Adjust stock* modal action; confirm the book's stock reflects it on the next load.

- [ ] **Step 3: Add a README Stage 03 section**

Append to `README.md` a concise `## Stage 03 — Write-back` section describing: the four Vercel endpoints + `api/_lib.js`, the `CEC.write.*` / modal surface, the env vars required, and that auth is intentionally deferred (open POSTs) with a pointer to the design doc.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: stage 03 write-back readme section"
```

---

**Self-review summary (from writing-plans):** Spec coverage — every §1-§7 item maps to a task: endpoints (§2/§3) → Tasks 1-4; token/client (§4/§5) → Task 2; integration (§7.2) → Task 5; cache/paint (§6.2) → Tasks 6-7; modals & write.js (§6.1/§6.3) → Tasks 8-9; browser E2E + regression (§7.3) → Task 10; deploy smoke + README (§7.4) → Task 11. Out-of-scope items intentionally omitted (auth, realtime, Issues tab, last_synced semantics). Placeholder scan: clean. Type consistency: `runPayment/client` metre agrees between Tasks 2-5; browser attribute names (`data-student`, `data-book`, `data-stock`, `data-amount`, `data-qty`, `data-delta`, `data-error`, `data-close`) and `CEC.clearCache` / `CEC.fetchOptions` / `CEC.renderDashboard` / `CEC.write.*` match across Tasks 6-9.