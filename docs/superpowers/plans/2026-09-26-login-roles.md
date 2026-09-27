# Login, Roles & Panel Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-verified login, three role-based panels (admin / teacher / storekeeper), token-gated write endpoints, and an Issued-books ledger so teachers and storekeepers can see what each student obtained and what is left.

**Architecture:** Stateless HMAC-signed session tokens (`api/_lib.js` helpers) verified by a new `api/check.js`; credentials live in a `Users` tab of a **separate, private** Google spreadsheet (`AUTH_USERS_SPREADSHEET_ID`), seeded via `node scripts/create-user.js`. All four existing write handlers call `lib.requireAuth(req, res, roles)` before touching Sheets. A new `Issued` spreadsheet tab (written by `runIssue`) feeds `issuedSummary` in `js/derive.js`, consumed by the Teacher Students view ("books obtained / left") and the Store Keeper Issuing view ("already issued"). Frontend gating (`js/session.js`, `login.html`, `js/app.js`) is cosmetic; the server token is authoritative.

**Tech Stack:** Node 18+ (Vercel serverless), vanilla JS (UMD browser modules), `node:crypto` (SCrypt, HMAC-SHA256), Google Sheets API v4 via the existing OAuth client, no new dependencies.

**Test baseline:** `node scripts/test.js` = **155 passing**. Target after this plan: **~190**, zero failures.

---

## Scope & handoff notes

- The in-progress Settings CRUD (`api/config.js` + `POST /api/config`) is a **separate feature** (spec `2026-09-26-config-settings-crud-design.md`, not yet built). When it is built it must call `lib.requireAuth(req, res, ["admin"])` exactly like `api/stock.js` here. This plan does not gate a file that does not exist yet.
- Every serverless handler keeps the exact `module.exports = async function handler(req, res)` shape Vercel expects. An optional third `deps` argument is added only where noted (login) so tests can inject a fake Sheets client.
- `process.env` is mutated in `scripts/test.js` so handler gating tests are deterministic (details in Task 2).

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `api/_lib.js` | Auth primitives, `requireAuth`, `sheetsAddTab`, Issued writes in `runIssue` | Modify + new exports |
| `api/payment.js`, `api/issue.js` | Write handlers gated admin+storekeeper | Modify |
| `api/student.js`, `api/stock.js` | Write handlers gated admin | Modify |
| `api/login.js` | Login endpoint | Create |
| `api/check.js` | Session check endpoint | Create |
| `scripts/create-user.js` | CLI user seeder (+ `--init`) | Create |
| `scripts/sync.js` | Snapshot pipeline (Issued tab) | Modify |
| `js/derive.js` | `normalizeIssued`, `issuedSummary` | Modify |
| `js/data-access.js` | Fetch Issued tab, dataset gains `issued` | Modify |
| `js/session.js` | `CEC.session` (load/guard/logout/role helpers) | Create |
| `login.html` | Login page | Create |
| `js/app.js` | Boot guard, nav/route filtering, read-only hardening, issued columns/readouts | Modify |
| `index.html` | Students/Issuing table headers, script tag, logout control | Modify |
| `data/issued.json` | Offline snapshot for Issued tab | Create |
| `data/meta.json` | (auto) gains Issued gid after `npm run sync` | Generated |
| `README.md`, `.env.example` | New env vars + auth note | Modify |
| `scripts/test.js` | ~35 new tests + 2 updated tests | Modify |

---

## Task 1: Auth primitives — `hashPassword`, `verifyPassword`, `signToken`, `verifyToken`

**Files:**
- Modify: `api/_lib.js` (top: add `const crypto = require("node:crypto");`)
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing tests**

Insert the auth primitive test block after the existing `lib` require section in `scripts/test.js` (find the block at the end of the `makeFakeClient`/`runPayment` area — append these tests right after the `"runIssue rejects per-item quantity..."` test, before any later `test(...)` for stock). Exact code:

```js
test("hashPassword produces an N:r:p:salt:hash credential string", () => {
  const c = lib.hashPassword("hunter2");
  const parts = c.split(":");
  assert.equal(parts.length, 5);
  assert.equal(parts[0], "16384");
  assert.equal(parts[1], "8");
  assert.equal(parts[2], "1");
  assert.match(parts[3], /^[0-9a-f]{32}$/);
  assert.match(parts[4], /^[0-9a-f]{128}$/);
});

test("hashPassword uses a random salt per call", () => {
  assert.notEqual(lib.hashPassword("same"), lib.hashPassword("same"));
});

test("verifyPassword accepts the correct password", async () => {
  const c = lib.hashPassword("s1mple-pass");
  assert.equal(await lib.verifyPassword("s1mple-pass", c), true);
});

test("verifyPassword rejects a wrong password", async () => {
  const c = lib.hashPassword("right");
  assert.equal(await lib.verifyPassword("wrong", c), false);
});

test("verifyPassword verifies a literal fixture credential string", async () => {
  const fixtures = [];
  const fixture = lib.hashPassword("fixture-pass");
  fixtures.push(fixture);
  assert.equal(await lib.verifyPassword("fixture-pass", fixture), true);
  assert.equal(await lib.verifyPassword("not-it", fixture), false);
});

test("signToken/verifyToken round-trips username and role", () => {
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "secret-1");
  const p = lib.verifyToken(token, "secret-1");
  assert.deepEqual(
    { username: p.username, role: p.role },
    { username: "ama", role: "admin" }
  );
  assert.ok(p.exp > 0);
});

test("verifyToken rejects a tampered signature", () => {
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "secret-1");
  const dot = token.indexOf(".");
  const tampered = token.slice(0, dot) + "x" + token.slice(dot + 1);
  assert.equal(lib.verifyToken(tampered, "secret-1"), null);
});

test("verifyToken rejects an expired token", () => {
  const token = lib.signToken({ username: "ama", role: "admin" }, -10, "secret-1");
  assert.equal(lib.verifyToken(token, "secret-1"), null);
});

test("verifyToken rejects malformed tokens and wrong secret", () => {
  assert.equal(lib.verifyToken("", "secret-1"), null);
  assert.equal(lib.verifyToken("abc.def", "secret-1"), null);
  assert.equal(lib.verifyToken("not-a-token", "secret-1"), null);
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "secret-1");
  assert.equal(lib.verifyToken(token, "secret-2"), null);
});
```

Also verify the export object is reachable: this task adds `lib.hashPassword` etc. — the tests above will FAIL with "TypeError: lib.hashPassword is not a function" until Step 3.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test.js`
Expected: FAIL on each new test (`lib.hashPassword is not a function`) while the existing 155 tests still PASS.

- [ ] **Step 3: Implement the primitives**

In `api/_lib.js`, add at line 3 (after the existing consts):

```js
const crypto = require("node:crypto");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
```

Add the functions below `colLetter` (after line 45). Complete code:

```js
function scryptParams(credentials) {
  const parts = String(credentials || "").split(":");
  if (parts.length !== 5) throw new Error("Malformed credentials string");
  const N = parseInt(parts[0], 10);
  const r = parseInt(parts[1], 10);
  const p = parseInt(parts[2], 10);
  const saltHex = parts[3];
  const hashHex = parts[4];
  if (!(N > 0) || !(r > 0) || !(p > 0) || !/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(hashHex)) {
    throw new Error("Malformed credentials string");
  }
  return { N: N, r: r, p: p, salt: Buffer.from(saltHex, "hex"), hash: Buffer.from(hashHex, "hex") };
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return String(SCRYPT_N) + ":" + SCRYPT_R + ":" + SCRYPT_P + ":" + salt.toString("hex") + ":" + key.toString("hex");
}

async function verifyPassword(password, credentials, compare) {
  const params = scryptParams(credentials);
  const derived = await crypto.scrypt(String(password), params.salt, params.hash.length, { N: params.N, r: params.r, p: params.p });
  if (derived.length !== params.hash.length) return false;
  const eq = compare || function (a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  return eq(derived, params.hash);
}

function signToken(user, ttlSeconds, secret) {
  const payload = { sub: user.username, role: user.role, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", String(secret)).update(data).digest("base64url");
  return data + "." + sig;
}

function verifyToken(token, secret) {
  if (typeof token !== "string" || !token || !secret) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const expected = crypto.createHmac("sha256", String(secret)).update(data).digest("base64url");
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload || typeof payload !== "object" || typeof payload.sub !== "string" || typeof payload.role !== "string") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { username: payload.sub, role: payload.role, exp: payload.exp };
  } catch (e) {
    return null;
  }
}
```

Add to the `module.exports` object (bottom of `_lib.js`):

```js
  scryptParams,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/test.js`
Expected: all tests PASS (155 existing + 9 new = 164), zero FAIL.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat(auth): add scrypt credential hashing and HMAC session tokens"
```

---

## Task 2: `requireAuth` + gate all four write endpoints

**Files:**
- Modify: `api/_lib.js`, `api/payment.js`, `api/issue.js`, `api/student.js`, `api/stock.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing tests**

Add this block to `scripts/test.js`, directly after the Task 1 tests. First append a tiny handler harness (helpers used by these and Task 3 tests):

```js
function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (payload) { res.body = payload; return res; };
  return res;
}

async function runHandler(mod, req) {
  const res = fakeRes();
  await mod(req, res);
  return res;
}
```

Then the gating tests (they assume `process.env.AUTH_SESSION_SECRET` is set and `GOOGLE_*` env is cleared — wiring is done in Step 2; these tests fail until then):

```js
test("requireAuth returns 401 when the Authorization header is missing", async () => {
  const res = fakeRes();
  const r = lib.requireAuth({ headers: {} }, res, ["admin"]);
  assert.equal(r, null);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /required/i);
});

test("requireAuth returns 401 on a bad token", async () => {
  const res = fakeRes();
  const r = lib.requireAuth({ headers: { authorization: "Bearer nope" } }, res, ["admin"]);
  assert.equal(r, null);
  assert.equal(res.statusCode, 401);
});

test("requireAuth returns 403 when the role is not allowed", async () => {
  const token = lib.signToken({ username: "yaw", role: "teacher" }, 3600, "test-secret");
  const res = fakeRes();
  const r = lib.requireAuth({ headers: { authorization: "Bearer " + token } }, res, ["admin"]);
  assert.equal(r, null);
  assert.equal(res.statusCode, 403);
});

test("requireAuth returns the payload for an allowed role", async () => {
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");
  const res = fakeRes();
  const r = lib.requireAuth({ headers: { authorization: "Bearer " + token } }, res, ["admin", "storekeeper"]);
  assert.deepEqual({ username: r.username, role: r.role }, { username: "ama", role: "admin" });
  assert.equal(res.statusCode, 200);
});

test("api/payment returns 401 without a token (auth runs before createClient)", async () => {
  const payment = require("../api/payment.js");
  const res = await runHandler(payment, { body: { student_id: "S001", amount: 10, method: "Cash" } });
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /required/i);
});

test("api/payment accepts admin and storekeeper, rejects teacher", async () => {
  const payment = require("../api/payment.js");
  const adminTok = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");
  const skTok = lib.signToken({ username: "kofi", role: "storekeeper" }, 3600, "test-secret");
  const teacherTok = lib.signToken({ username: "yaw", role: "teacher" }, 3600, "test-secret");
  const req = tok => ({ headers: { authorization: "Bearer " + tok }, body: { student_id: "S001", amount: 10, method: "Cash" } });

  const adminRes = await runHandler(payment, req(adminTok));
  assert.equal(adminRes.statusCode, 500, "admin passed gating and reached createClient (no GOOGLE env)");

  const skRes = await runHandler(payment, req(skTok));
  assert.equal(skRes.statusCode, 500, "storekeeper passed gating and reached createClient");

  const teacherRes = await runHandler(payment, req(teacherTok));
  assert.equal(teacherRes.statusCode, 403, "teacher is not allowed on /api/payment");
  assert.match(teacherRes.body.error, /permission/i);
});

test("api/issue accepts admin and storekeeper, rejects teacher (403)", async () => {
  const issue = require("../api/issue.js");
  const skTok = lib.signToken({ username: "kofi", role: "storekeeper" }, 3600, "test-secret");
  const teacherTok = lib.signToken({ username: "yaw", role: "teacher" }, 3600, "test-secret");
  const req = tok => ({ headers: { authorization: "Bearer " + tok }, body: { student_id: "S001", book_id: "B003", qty: 1 } });
  const skRes = await runHandler(issue, req(skTok));
  assert.equal(skRes.statusCode, 500, "storekeeper passed gating and reached createClient");
  const teacherRes = await runHandler(issue, req(teacherTok));
  assert.equal(teacherRes.statusCode, 403);
});

test("api/student and api/stock are admin-only (storekeeper gets 403)", async () => {
  const student = require("../api/student.js");
  const stock = require("../api/stock.js");
  const skTok = lib.signToken({ username: "kofi", role: "storekeeper" }, 3600, "test-secret");
  const adminTok = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");

  const skStudent = await runHandler(student, { headers: { authorization: "Bearer " + skTok }, body: { name: "X", class: "BS 1A", gender: "male", books_fee: 1, books_total: 1 } });
  assert.equal(skStudent.statusCode, 403);

  const skStock = await runHandler(stock, { headers: { authorization: "Bearer " + skTok }, body: { book_id: "B001", stock_delta: 1 } });
  assert.equal(skStock.statusCode, 403);

  const adminStock = await runHandler(stock, { headers: { authorization: "Bearer " + adminTok }, body: { book_id: "B001", stock_delta: 1 } });
  assert.equal(adminStock.statusCode, 500, "admin passed gating and reached createClient");

  const noTok = await runHandler(student, { headers: {}, body: {} });
  assert.equal(noTok.statusCode, 401);
});
```

- [ ] **Step 2: Wire the deterministic test env at the top of `scripts/test.js`**

Directly after the `require` lines (line 3) and before `let pass = 0;`, add:

```js
// Deterministic env for auth tests. Other tests pass explicit config objects to
// createClient, so clearing these globals is safe for the whole file.
process.env.AUTH_SESSION_SECRET = "test-secret";
process.env.AUTH_USERS_SPREADSHEET_ID = "users-spr";
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
  delete process.env[k];
}
```

Run: `node scripts/test.js`
Expected: the new gating tests FAIL (e.g. `TypeError: lib.requireAuth is not a function`); the 155 + 9 from Task 1 PASS.

- [ ] **Step 3: Implement `requireAuth` in `api/_lib.js`**

Add below `verifyToken`:

```js
function requireAuth(req, res, allowedRoles) {
  const header = (req && req.headers && req.headers.authorization) || "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  const payload = match ? verifyToken(match[1], process.env.AUTH_SESSION_SECRET) : null;
  if (!payload) {
    res.status(401).json({ ok: false, error: "Authentication required." });
    return null;
  }
  if ((allowedRoles || []).indexOf(payload.role) === -1) {
    res.status(403).json({ ok: false, error: "You do not have permission for this action." });
    return null;
  }
  return payload;
}
```

Add `requireAuth` to the `module.exports` object.

- [ ] **Step 4: Gate the four handlers**

`api/payment.js` — change line 5 to:

```js
module.exports = async function handler(req, res) {
  const auth = lib.requireAuth(req, res, ["admin", "storekeeper"]);
  if (!auth) return;
  try {
```

`api/issue.js` — same change (find `module.exports = async function handler(req, res) {` and insert the two lines right after it; roles `["admin", "storekeeper"]`).

`api/student.js` — same insertion with roles `["admin"]`.

`api/stock.js` — same insertion with roles `["admin"]`.

Each handler's existing `try {` block must remain as the second statement of the handler so the catch still wraps `createClient`.

- [ ] **Step 5: Run the tests**

Run: `node scripts/test.js`
Expected: all PASS (164 + 6 new = **170**), zero FAIL.

- [ ] **Step 6: Commit**

```bash
git add api/_lib.js api/payment.js api/issue.js api/student.js api/stock.js scripts/test.js
git commit -m "feat(auth): gate ALL write endpoints with role-checked session tokens"
```

---

## Task 3: `api/login.js` + `api/check.js`

**Files:**
- Create: `api/login.js`, `api/check.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing tests**

Append after the Task 2 tests:

```js
test("api/login returns a token for valid credentials", async () => {
  const login = require("../api/login.js");
  const fakeUsers = [
    ["username", "credentials", "role", "created_at", "updated_at"],
    ["ama", lib.hashPassword("pw123"), "admin", "2026-09-26", "2026-09-26"]
  ];
  const fakeClient = { sheetsGet: async () => fakeUsers };
  const res = await runHandler(login, { body: { username: "ama", password: "pw123" } }, { createClient: () => fakeClient });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.username, "ama");
  assert.equal(res.body.role, "admin");
  assert.ok(typeof res.body.token === "string" && res.body.token.indexOf(".") !== -1);
});

test("api/login rejects a wrong password with a generic 401", async () => {
  const login = require("../api/login.js");
  const fakeUsers = [
    ["username", "credentials", "role", "created_at", "updated_at"],
    ["ama", lib.hashPassword("pw123"), "admin", "2026-09-26", "2026-09-26"]
  ];
  const fakeClient = { sheetsGet: async () => fakeUsers };
  const res = await runHandler(login, { body: { username: "ama", password: "wrong" } }, { createClient: () => fakeClient });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid username or password.");
});

test("api/login rejects an unknown user with the identical generic 401", async () => {
  const login = require("../api/login.js");
  const fakeUsers = [["username", "credentials", "role", "created_at", "updated_at"]];
  const fakeClient = { sheetsGet: async () => fakeUsers };
  const res = await runHandler(login, { body: { username: "ghost", password: "pw123" } }, { createClient: () => fakeClient });
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "Invalid username or password.");
});

test("api/login requires username and password fields", async () => {
  const login = require("../api/login.js");
  const res = await runHandler(login, { body: {} }, { createClient: () => ({}) });
  assert.equal(res.statusCode, 400);
});

test("api/check returns 200 with role for a valid token", async () => {
  const check = require("../api/check.js");
  const token = lib.signToken({ username: "kofi", role: "storekeeper" }, 3600, "test-secret");
  const res = await runHandler(check, { headers: { authorization: "Bearer " + token } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.username, "kofi");
  assert.equal(res.body.role, "storekeeper");
});

test("api/check returns 401 for a missing or bad token", async () => {
  const check = require("../api/check.js");
  const none = await runHandler(check, { headers: {} });
  assert.equal(none.statusCode, 401);
  const bad = await runHandler(check, { headers: { authorization: "Bearer bad" } });
  assert.equal(bad.statusCode, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/test.js`
Expected: FAIL with "Cannot find module '../api/login.js'" (and check), others PASS.

- [ ] **Step 3: Implement `api/login.js`**

```js
"use strict";

const lib = require("./_lib");

const SESSION_TTL_SECONDS = 12 * 60 * 60;

async function handler(req, res, deps) {
  try {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
      return res.status(400).json({ ok: false, error: "username and password are required" });
    }

    const clientFactory = (deps && deps.createClient) || lib.createClient;
    const client = clientFactory({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const users = await client.sheetsGet(process.env.AUTH_USERS_SPREADSHEET_ID, "Users!A:E");
    const found = lib.findRowIndex(users, "username", username);
    if (!found) {
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    }
    const row = users[found.rowIndex - 1];
    const ok = await lib.verifyPassword(password, row[1]);
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    }
    const role = String(row[2] || "").trim();
    if (!role) return res.status(500).json({ ok: false, error: "User row is missing a role." });

    const token = lib.signToken({ username: username, role: role }, SESSION_TTL_SECONDS, process.env.AUTH_SESSION_SECRET);
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    return res.status(200).json({ ok: true, token: token, username: username, role: role, exp: exp });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
```

- [ ] **Step 4: Implement `api/check.js`**

```js
"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  const header = (req && req.headers && req.headers.authorization) || "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  const payload = match ? lib.verifyToken(match[1], process.env.AUTH_SESSION_SECRET) : null;
  if (!payload) {
    return res.status(401).json({ ok: false, error: "Authentication required." });
  }
  return res.status(200).json({ ok: true, username: payload.username, role: payload.role, exp: payload.exp });
};
```

- [ ] **Step 5: Run the tests**

Run: `node scripts/test.js`
Expected: all PASS (**176**), zero FAIL.

- [ ] **Step 6: Commit**

```bash
git add api/login.js api/check.js scripts/test.js
git commit -m "feat(auth): add login and session-check endpoints"
```

---

## Task 4: Issued-books ledger — `runIssue` writes

**Files:**
- Modify: `api/_lib.js` (`runIssue`)
- Test: `scripts/test.js` (2 existing tests updated + 1 new)

- [ ] **Step 1: Update the existing `runIssue` tests and add the new one**

In `scripts/test.js`, in the existing test `"runIssue decrements stock and appends activity"`, replace the final two assertions (which currently end at `assert.match(client.calls[1].rows[0][2], /Books issued to Abena Mensah/);`) with:

```js
  assert.match(client.calls[1].rows[0][2], /Books issued to Abena Mensah/);
  assert.equal(client.calls[2].tab, "Issued");
  assert.equal(client.calls[2].rows[0][0], "I001");
  assert.equal(client.calls[2].rows[0][1], "S001");
  assert.equal(client.calls[2].rows[0][2], "B003");
  assert.equal(client.calls[2].rows[0][3], "2");
  assert.match(client.calls[2].rows[0][4], /^\d{4}-\d{2}-\d{2}$/);
```

In the existing test `"runIssue applies per-item quantities from a mixed books array"`, replace the last two lines (currently `assert.match(activityRow[2], /Books issued to Abena Mensah \[B001,B075x5\]/);` and its preceding `const activityRow = client.calls[client.calls.length - 1].rows[0];`) with:

```js
  const activityCall = client.calls.find(c => c.tab === "Activity");
  assert.match(activityCall.rows[0][2], /Books issued to Abena Mensah \[B001,B075x5\]/);
  const issuedCalls = client.calls.filter(c => c.tab === "Issued");
  assert.deepEqual(issuedCalls.map(c => c.rows[0].slice(0, 4)), [
    ["I001", "S001", "B001", "1"],
    ["I002", "S001", "B075", "5"]
  ]);
```

Append a new test after those (right before the existing `"runIssue rejects per-item quantity when stock is insufficient (no writes)"` test):

```js
test("runIssue rolls nad appends one Issued row per resolved book", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id", "name"], ["S001", "Abena Mensah"]],
    "Books!A:I": [["book_id", "publisher", "subject", "category", "price", "stock_qty", "low_stock_threshold"],
      ["B001", "GoldenA", "Math", "Core", "85", "40", "10"],
      ["B075", "Exercise Book", "A1 Small", "A1 Small", "2.5", "12", "5"]],
    "Activity!A:A": [["activity_id"], ["A006"]],
    "Issued!A:A": [["issue_id"], ["I009"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001"] });
  assert.equal(r.ok, true);
  const issuedCall = client.calls.find(c => c.tab === "Issued");
  assert.equal(issuedCall.rows[0][0], "I010");
});
```

- [ ] **Step 2: Run to verify the intended failures**

Run: `node scripts/test.js`
Expected: the `runIssue` tests FAIL (no Issued writes yet). Everything else PASS.

- [ ] **Step 3: Implement the Issued writes in `api/_lib.js` `runIssue`**

Inside `runIssue`, after the existing Activity append block (the `await client.sheetsAppend(spreadsheetId, "Activity", [[ ... ]]);` ending at the current line 302) and BEFORE the `if (payload.books) {` return branch, insert:

```js
  const issuedTab = await client.sheetsGet(spreadsheetId, "Issued!A:A");
  let issuedNum = Number(nextId(issuedTab, "I").slice(1));
  for (const x of resolved) {
    await client.sheetsAppend(spreadsheetId, "Issued", [[
      "I" + String(issuedNum++).padStart(3, "0"),
      payload.student_id,
      x.bookRow[0],
      String(x.qty),
      todayISO()
    ]]);
  }
```

(`resolved` already holds `{ foundBook, bookRow, stockQty, qty }`.)

- [ ] **Step 4: Run the tests**

Run: `node scripts/test.js`
Expected: all PASS (**177**), zero FAIL.

- [ ] **Step 5: Commit**

```bash
git add api/_lib.js scripts/test.js
git commit -m "feat(issue): record an Issued-books ledger row per issued book"
```

---

## Task 5: `createClient.sheetsAddTab` + `scripts/create-user.js`

**Files:**
- Modify: `api/_lib.js`
- Create: `scripts/create-user.js`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing test for `sheetsAddTab`**

Append after the last auth test:

```js
test("createClient.sheetsAddTab posts an addSheet batchUpdate request", async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, method: opts.method, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await client.sheetsAddTab("spr123", "Users");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /spr123:batchUpdate$/);
  assert.deepEqual(calls[0].body.requests[0], { addSheet: { properties: { title: "Users" } } });
});

test("createClient.sheetsAddTab surfaces API errors", async () => {
  const fake = async () => ({ ok: false, json: async () => ({ error: { message: "nope" } }) });
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await assert.rejects(client.sheetsAddTab("spr123", "Users"), /nope/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/test.js`
Expected: FAIL (`client.sheetsAddTab is not a function`).

- [ ] **Step 3: Add `sheetsAddTab` to `createClient`**

In `api/_lib.js`, inside `createClient`, after `sheetsMeta` (ends line 220), add:

```js
  async function sheetsAddTab(spreadsheetId, title) {
    const token = await getAccessToken();
    const res = await fetcher(
      API_BASE + "/" + encodeURIComponent(spreadsheetId) + ":batchUpdate",
      {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: title } } }] })
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sheets addTab failed: " + ((data && data.error && data.error.message) || res.status));
    return data;
  }
```

Add `sheetsAddTab` to the `return { ... }` of `createClient`.

- [ ] **Step 4: Run the tests**

Run: `node scripts/test.js`
Expected: all PASS (**179**).

- [ ] **Step 5: Create `scripts/create-user.js`**

```js
#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("../api/_lib.js");

const VALID_ROLES = ["admin", "teacher", "storekeeper"];
const HEADERS = ["username", "credentials", "role", "created_at", "updated_at"];

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : "";
}

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function loadUsersSheetId() {
  const env = loadEnv();
  return (process.env.AUTH_USERS_SPREADSHEET_ID || env.AUTH_USERS_SPREADSHEET_ID || "").trim();
}

function googleEnv() {
  const env = loadEnv();
  return {
    client_id: process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN
  };
}

function headerOk(headerRow) {
  return HEADERS.every((h, i) => String(headerRow[i] || "").trim() === h);
}

async function main() {
  const args = process.argv.slice(2);
  const sheet = arg(args, "--users-sheet") || loadUsersSheetId();
  const username = arg(args, "--username");
  const password = arg(args, "--password");
  const role = arg(args, "--role");
  const init = args.indexOf("--init") !== -1;

  if (!sheet) throw new Error("AUTH_USERS_SPREADSHEET_ID is not set (pass --users-sheet <id> or set the env var).");
  if (!username || !password || !role) throw new Error("--username, --password and --role are all required.");
  if (VALID_ROLES.indexOf(role) === -1) throw new Error("role must be one of: " + VALID_ROLES.join(", "));

  const client = lib.createClient(googleEnv());

  const tabs = await client.sheetsMeta(sheet);
  if (init && !tabs.Users) {
    await client.sheetsAddTab(sheet, "Users");
    console.log("Created Users tab.");
  }

  const users = await client.sheetsGet(sheet, "Users!A1:E1");
  if (!users.length || !headerOk((users[0] || []).slice(0, 5))) {
    if (!init) {
      throw new Error("Users tab is missing or its header row does not match " + HEADERS.join(",") + ". Run with --init to create it.");
    }
    await client.sheetsUpdate(sheet, "Users!A1:E1", [HEADERS]);
    console.log("Wrote Users header row.");
  }

  const credentials = lib.hashPassword(password);
  const nowIso = new Date().toISOString();
  await client.sheetsAppend(sheet, "Users", [[username, credentials, role, nowIso, nowIso]]);
  console.log("Created user " + username + " with role " + role + " in spreadsheet " + sheet);
}

main().catch(err => {
  console.error("create-user failed:", err.message);
  process.exit(1);
});
```

- [ ] **Step 6: Smoke-test the CLI argument validation (no network)**

Run: `node scripts/create-user.js --username ama --password x --role superuser`
Expected: exits 1, prints `create-user failed: role must be one of: admin, teacher, storekeeper`.

- [ ] **Step 7: Commit**

```bash
git add api/_lib.js scripts/create-user.js scripts/test.js
git commit -m "feat(auth): create-user CLI seeds accounts into a private Users sheet"
```

---

## Task 6: Issued data pipeline — `sync.js`, `data-access.js`, `derive.js`

**Files:**
- Modify: `scripts/sync.js`, `js/data-access.js`, `js/derive.js`
- Create: `data/issued.json`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing tests for the derive helpers**

Append after the last Task 5 test:

```js
test("derive.normalizeIssued maps rows to issued records", () => {
  const rows = [
    { issue_id: "I001", student_id: "S001", book_id: "B003", qty: "2", date: "2026-09-23" },
    { issue_id: "I002", student_id: "S001", book_id: "B075", qty: "5", date: "2026-09-23" },
    { issue_id: "I003", student_id: "S002", book_id: "B001", qty: "1", date: "2026-09-24" }
  ];
  const issued = CECJ.derive.normalizeIssued(rows);
  assert.deepEqual(issued[0], { issueId: "I001", studentId: "S001", bookId: "B003", qty: 2, date: "2026-09-23" });
  assert.equal(issued[1].qty, 5);
});

test("derive.issuedSummary aggregates by student and by book", () => {
  const issued = CECJ.derive.normalizeIssued([
    { issue_id: "I001", student_id: "S001", book_id: "B003", qty: "2", date: "2026-09-23" },
    { issue_id: "I002", student_id: "S001", book_id: "B075", qty: "5", date: "2026-09-23" },
    { issue_id: "I003", student_id: "S002", book_id: "B001", qty: "1", date: "2026-09-24" }
  ]);
  const s = CECJ.derive.issuedSummary(issued);
  assert.deepEqual(s.byStudent.S001, { books: 2, qty: 7 });
  assert.deepEqual(s.byStudent.S002, { books: 1, qty: 1 });
  assert.deepEqual(s.byBook, { B003: 2, B075: 5, B001: 1 });
});

test("derive.issuedSummary tolerates empty and unknown rows", () => {
  const s = CECJ.derive.issuedSummary([]);
  assert.deepEqual(s, { byStudent: {}, byBook: {} });
  const s2 = CECJ.derive.issuedSummary(CECJ.derive.normalizeIssued([{ qty: "3" }]));
  assert.deepEqual(s2, { byStudent: {}, byBook: {} });
});
```

Note: the plan uses `CECJ` as the alias for the `require("../js/derive.js")` module. If `test.js` already requires derive under a different alias, reuse that name instead. The tests above FAIL until Task 6 `derive.js` changes land.

- [ ] **Step 2: Run to verify they fail — and confirm the derive alias**

Run: `node scripts/test.js`
- Confirm how derive is required at the top of `test.js` (search for `require("../js/derive.js")`). Adjust the three new tests to use that existing variable name.
- Expected: FAIL on `normalizeIssued`/`issuedSummary` not being functions.

- [ ] **Step 3: Add `normalizeIssued` + `issuedSummary` to `js/derive.js`**

Insert after `normalizeBooks` (ends line 83):

```js
  function normalizeIssued(rows) {
    return (rows || []).map(r => ({
      issueId: r.issue_id,
      studentId: r.student_id,
      bookId: r.book_id,
      qty: num(r.qty),
      date: r.date
    }));
  }

  function issuedSummary(issued) {
    const byStudent = {};
    const byBook = {};
    (issued || []).forEach(i => {
      const sid = String(i.studentId || "");
      const bid = String(i.bookId || "");
      if (sid) {
        byStudent[sid] = byStudent[sid] || { books: 0, qty: 0 };
        byStudent[sid].books += 1;
        byStudent[sid].qty += i.qty || 0;
      }
      if (bid) byBook[bid] = (byBook[bid] || 0) + (i.qty || 0);
    });
    return { byStudent: byStudent, byBook: byBook };
  }
```

Add both to the `return { ... }` export object.

- [ ] **Step 4: Add the Issued tab to `js/data-access.js`**

In `js/data-access.js` `getAllData`, change the destructuring at line 97 to:

```js
    const [studentsRows, paymentsRows, activityRows, booksRows, feesRows, configRows, issuedRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Payments", "payments.json"),
      fetchTab("Activity", "activity.json"),
      fetchTab("Books", "books.json"),
      fetchClassFees(),
      fetchTab("Config", "config.json"),
      fetchTab("Issued", "issued.json")
    ]);
```

and after the `const config = CEC.derive.normalizeConfig(configRows);` line add:

```js
    const issued = CEC.derive.normalizeIssued(issuedRows);
```

and add `issued,` to the `sessionData = { ... }` literal (after `classFees,`).

- [ ] **Step 5: Add the Issued tab to `scripts/sync.js` and create the offline snapshot**

In `scripts/sync.js` `TABS` (line 5), insert:

```js
  Issued: "issued.json",
```

(anywhere in the object; conventionally after `Books`).

Create `data/issued.json` with the single line `[]`.

- [ ] **Step 6: Run the tests + a sync smoke test**

Run: `node scripts/test.js`
Expected: all PASS (**182**).

Run: `node scripts/sync.js`
Expected: either "Synced Issued -> data/issued.json ..." (live sheet with the tab) OR "Skipped Issued: ... Keeping data/issued.json." (offline/tab-missing). Either is correct — the pipeline must never hard-fail on the new tab.

- [ ] **Step 7: Commit**

```bash
git add scripts/sync.js js/data-access.js js/derive.js data/issued.json scripts/test.js
git commit -m "feat(issue): snapshot and derivations for the Issued ledger"
```

---

## Task 7: `js/session.js` + `login.html`

**Files:**
- Create: `js/session.js`, `login.html`
- Test: `scripts/test.js`

- [ ] **Step 1: Write the failing tests for the pure session helpers**

Append after the last Task 6 test:

```js
const session = require("../js/session.js");

test("session.parsePayload decodes username, role and exp from a token", () => {
  const token = lib.signToken({ username: "yaw", role: "teacher" }, 3600, "test-secret");
  const p = session.parsePayload(token);
  assert.equal(p.username, "yaw");
  assert.equal(p.role, "teacher");
  assert.ok(p.exp > 0);
});

test("session.parsePayload returns null for garbage", () => {
  assert.equal(session.parsePayload(""), null);
  assert.equal(session.parsePayload("abc.def"), null);
  assert.equal(session.parsePayload(null), null);
});

test("session.can enforces the role-page matrix", () => {
  assert.equal(session.can("admin", "reports"), true);
  assert.equal(session.can("teacher", "students"), true);
  assert.equal(session.can("teacher", "payments"), false);
  assert.equal(session.can("storekeeper", "issuing"), true);
  assert.equal(session.can("storekeeper", "students"), false);
  assert.equal(session.can("storekeeper", "settings"), false);
  assert.equal(session.can("", "students"), false);
});

test("session.defaultPage returns the role landing page", () => {
  assert.equal(session.defaultPage("admin"), "dashboard");
  assert.equal(session.defaultPage("storekeeper"), "dashboard");
  assert.equal(session.defaultPage("teacher"), "students");
  assert.equal(session.defaultPage("bogus"), "dashboard");
});

test("session.resolvePage redirects unauthorized hashes to the role default", () => {
  assert.equal(session.resolvePage("admin", "#reports"), "reports");
  assert.equal(session.resolvePage("teacher", "#reports"), "students");
  assert.equal(session.resolvePage("teacher", "#students"), "students");
  assert.equal(session.resolvePage("storekeeper", "#settings"), "dashboard");
  assert.equal(session.resolvePage("admin", "#bogus"), "dashboard");
  assert.equal(session.resolvePage("", "#dashboard"), "dashboard");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node scripts/test.js`
Expected: FAIL (`Cannot find module '../js/session.js'`).

- [ ] **Step 3: Create `js/session.js`**

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.session = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "cecSession";
  const ALL_PAGES = ["dashboard", "students", "payments", "books", "inventory", "issuing", "reports", "settings"];
  const ROLE_PAGES = {
    admin: ["dashboard", "students", "payments", "books", "inventory", "issuing", "reports", "settings"],
    teacher: ["students"],
    storekeeper: ["dashboard", "payments", "inventory", "issuing"]
  };
  const ROLE_DEFAULT = { admin: "dashboard", teacher: "students", storekeeper: "dashboard" };

  let authOffline = false;
  let cached = null;

  function decodeBase64Url(data) {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") return atob(b64);
    if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
    throw new Error("no base64 decoder available");
  }

  function parsePayload(token) {
    if (typeof token !== "string" || !token) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    try {
      const p = JSON.parse(decodeBase64Url(token.slice(0, dot)));
      if (!p || typeof p !== "object" || typeof p.sub !== "string" || typeof p.role !== "string") return null;
      return {
        username: p.sub,
        role: p.role,
        exp: typeof p.exp === "number" ? p.exp : 0
      };
    } catch (e) {
      return null;
    }
  }

  function can(role, page) {
    return (ROLE_PAGES[role] || []).indexOf(page) !== -1;
  }

  function defaultPage(role) {
    return ROLE_DEFAULT[role] || "dashboard";
  }

  function resolvePage(role, hash) {
    const raw = String(hash || "").replace(/^#/, "").toLowerCase();
    const page = ALL_PAGES.indexOf(raw) !== -1 ? raw : "dashboard";
    return can(role, page) ? page : defaultPage(role);
  }

  function load() {
    if (cached) return cached;
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object" || typeof s.token !== "string") return null;
      const payload = parsePayload(s.token);
      if (!payload || (payload.exp && payload.exp * 1000 < Date.now())) {
        clear();
        return null;
      }
      cached = { token: s.token, username: payload.username, role: payload.role, exp: payload.exp };
      return cached;
    } catch (e) {
      return null;
    }
  }

  function store(token, username, exp) {
    try {
      if (typeof localStorage !== "undefined" && localStorage) {
        localStorage.setItem(KEY, JSON.stringify({ token: token, username: username, exp: exp }));
      }
    } catch (ignored) {}
    cached = null;
  }

  function clear() {
    cached = null;
    try {
      if (typeof localStorage !== "undefined" && localStorage) localStorage.removeItem(KEY);
    } catch (ignored) {}
  }

  function redirectLogin() {
    if (typeof location !== "undefined" && String(location.pathname).indexOf("login.html") === -1) {
      location.href = "login.html";
    }
  }

  async function guard() {
    const s = load();
    if (!s) {
      redirectLogin();
      return false;
    }
    try {
      const res = await fetch("api/check", { headers: { Authorization: "Bearer " + s.token } });
      if (res.status === 401) {
        clear();
        redirectLogin();
        return false;
      }
      if (!res.ok) {
        authOffline = true;
        return true;
      }
      const body = await res.json().catch(() => null);
      if (!body || body.ok !== true) {
        clear();
        redirectLogin();
        return false;
      }
      return true;
    } catch (e) {
      authOffline = true;
      return true;
    }
  }

  function logout() {
    clear();
    redirectLogin();
  }

  function isOffline() {
    return authOffline;
  }

  return {
    KEY: KEY,
    parsePayload: parsePayload,
    can: can,
    defaultPage: defaultPage,
    resolvePage: resolvePage,
    load: load,
    store: store,
    clear: clear,
    guard: guard,
    logout: logout,
    isOffline: isOffline
  };
});
```

- [ ] **Step 4: Create `login.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>CEC Books — Sign in</title>
  <link rel="stylesheet" href="css/app.css">
  <style>
    .login-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .login-card { width: 100%; max-width: 380px; background: #fff; border: 1px solid #e5e8f0; border-radius: 14px; box-shadow: 0 12px 40px rgba(15, 23, 52, 0.08); padding: 28px; }
    .login-brand { display: flex; gap: 10px; align-items: center; margin-bottom: 20px; }
    .login-brand .brand-mark { width: 40px; height: 40px; border-radius: 10px; background: #0f1734; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
    .login-brand b { display: block; line-height: 1.2; }
    .login-brand small { color: #66708a; display: block; }
    .field { display: block; margin-bottom: 14px; }
    .field input { width: 100%; }
    .login-error { color: #b42318; background: #fef3f2; border: 1px solid #fecdca; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 13px; }
    .login-sub { color: #66708a; font-size: 12.5px; margin-top: 14px; text-align: center; }
  </style>
</head>
<body>
  <div class="login-page">
    <form class="login-card" id="loginForm" novalidate>
      <div class="login-brand">
        <span class="brand-mark">CEC</span>
        <div><b>CEC Books</b><small>Management System</small></div>
      </div>
      <p class="eyebrow">Sign in to continue</p>
      <label class="field">Username<input type="text" id="username" autocomplete="username" required autofocus></label>
      <label class="field">Password<input type="password" id="password" autocomplete="current-password" required></label>
      <p class="login-error" id="loginError" hidden></p>
      <button type="submit" class="btn btn-primary" id="loginBtn" style="width:100%">Sign in</button>
      <div class="login-sub">Sessions expire after 12 hours.</div>
    </form>
  </div>
  <script src="js/session.js"></script>
  <script>
    (function () {
      var form = document.getElementById("loginForm");
      var errEl = document.getElementById("loginError");
      var btn = document.getElementById("loginBtn");
      var username = document.getElementById("username");
      var password = document.getElementById("password");
      var show = function (msg) { errEl.textContent = msg; errEl.hidden = false; };

      var existing = window.CEC.session.load();
      if (existing) window.location.replace("index.html#" + window.CEC.session.defaultPage(existing.role));

      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        errEl.hidden = true;
        btn.disabled = true;
        try {
          var res = await fetch("api/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: username.value.trim(), password: password.value })
          });
          var body = await res.json().catch(function () { return {}; });
          if (!body || body.ok !== true || !body.token) {
            show((body && body.error) || "Invalid username or password.");
            return;
          }
          window.CEC.session.store(body.token, body.username, body.exp);
          window.location.href = "index.html#" + window.CEC.session.defaultPage(body.role);
        } catch (e2) {
          show("Could not reach the server. Check your connection.");
        } finally {
          btn.disabled = false;
        }
      });
    })();
  </script>
</body>
</html>
```

- [ ] **Step 5: Run the tests**

Run: `node scripts/test.js`
Expected: all PASS (**187**), zero FAIL.

- [ ] **Step 6: Commit**

```bash
git add js/session.js login.html scripts/test.js
git commit -m "feat(auth): add session module and login page"
```

---

## Task 8: Frontend gating in `js/app.js` + `index.html`

**Files:**
- Modify: `js/app.js`, `index.html`

Copying the exact existing render logic (from `js/app.js`) is required here. Three render changes plus boot gating.

- [ ] **Step 1: Wire session before the app boots (`js/app.js`)**

Replace the final `route().catch(...)` at the very bottom of `js/app.js` (currently lines 617-620) with:

```js
  async function boot() {
    const ok = await CEC.session.guard();
    if (!ok) return;
    applyRoleAccess();
    route().catch(err => {
      console.error("Dashboard load failed:", err);
      showToast("Could not load dashboard data.");
    });
  }

  function applyRoleAccess() {
    const s = CEC.session.load();
    const role = s ? s.role : "";
    document.querySelectorAll(".nav-item[data-page]").forEach(item => {
      item.hidden = !CEC.session.can(role, item.dataset.page);
    });
    const readOnly = role === "teacher" || CEC.session.isOffline();
    if (readOnly) {
      document.querySelectorAll("button[data-action]").forEach(btn => { btn.hidden = true; });
    }
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn && role) {
      logoutBtn.hidden = false;
      logoutBtn.addEventListener("click", () => CEC.session.logout());
    }
    const profileMini = document.querySelector(".profile-mini");
    if (profileMini && role) {
      const nameEl = profileMini.querySelector("b");
      const roleEl = profileMini.querySelector("small");
      if (nameEl) nameEl.textContent = role === "admin" ? "David Admin" : role === "storekeeper" ? "Store Keeper" : "Yaw Teacher";
      if (roleEl) roleEl.textContent = role === "admin" ? "Administrator" : role === "storekeeper" ? "Inventory & Payments" : "Read-only";
    }
  }

  boot();
```

- [ ] **Step 2: Route through `CEC.session.resolvePage` (`js/app.js`)**

In `route()` replace:

```js
    const page = CEC.viewModels.pageForHash(location.hash);
    setActiveNav(page);
    updateShell(page);
```

with:

```js
    const sessionEntry = CEC.session.load();
    const role = sessionEntry ? sessionEntry.role : "";
    const page = CEC.session.resolvePage(role, location.hash);
    if (page !== CEC.viewModels.pageForHash(location.hash)) {
      location.hash = "#" + page;
      return;
    }
    setActiveNav(page);
    updateShell(page);
```

- [ ] **Step 3: Teacher Students view — "Books obtained / Left to give"**

In `renderStudents`, add the issued summary at the top (after `const cur = ...` line) and two cells per row, and widen the empty row. Replace the current `renderStudents` body with:

```js
  function renderStudents(data) {
    const cur = data.config.currency;
    const q = document.getElementById("studentSearch").value.trim().toLowerCase();
    const byStudent = CEC.derive.issuedSummary(data.issued || []).byStudent;
    const rows = data.students.filter(s =>
      !q ||
      s.name.toLowerCase().indexOf(q) !== -1 ||
      s.studentId.toLowerCase().indexOf(q) !== -1 ||
      s.className.toLowerCase().indexOf(q) !== -1
    );
    document.getElementById("studentsBody").innerHTML = rows.length
      ? rows.map(s => {
          const balance = CEC.viewModels.studentOutstanding(s);
          const obtained = byStudent[s.studentId] ? byStudent[s.studentId].qty : 0;
          const left = Math.max((s.booksTotal || 0) - obtained, 0);
          return `
        <tr>
          <td>${esc(s.studentId)}</td>
          <td><b>${esc(s.name)}</b></td>
          <td>${esc(s.className)}</td>
          <td>${esc(s.gender ? s.gender.charAt(0).toUpperCase() + s.gender.slice(1) : "")}</td>
          <td>${CEC.derive.formatAmount(s.booksPaid, cur)}</td>
          <td>${balance > 0 ? CEC.derive.formatAmount(balance, cur) : '<span class="positive">Paid</span>'}</td>
          <td><span class="pill ${statusPillClass(s.status)}">${esc(s.status)}</span></td>
          <td>${obtained}</td>
          <td>${left}</td>
        </tr>`;
        }).join("")
      : emptyRow(9);
    document.getElementById("studentCount").textContent = rows.length + " of " + data.students.length;
  }
```

- [ ] **Step 4: Store Keeper Issuing view — "Issued already" readout**

In `renderIssuing`, replace the `inv` block (the section that fills `issueBooksBody`) with:

```js
    const inv = CEC.viewModels.stockStatus(data.books);
    const byBook = CEC.derive.issuedSummary(data.issued || []).byBook;
    document.getElementById("issueBooksBody").innerHTML = inv.rows.length
      ? inv.rows.map(r => `
        <tr>
          <td><b>${esc(r.subject)}</b></td>
          <td>${esc(r.category)}</td>
          <td>${r.stockQty}</td>
          <td>${byBook[r.bookId] || 0}</td>
          <td><span class="pill ${stockPillClass(r.status)}">${r.status}</span></td>
        </tr>`).join("")
      : emptyRow(5);
```

Note: `inv.rows` objects include `bookId` (added in a prior stage's `stockStatus`). If `bookId` is absent from those rows, map instead over `data.books` (`data.books.map(b => ({ subject: b.subject, category: b.category, stockQty: b.stockQty, status: ..., bookId: b.bookId }))`). Verify by reading `CEC.viewModels.stockStatus` in `js/view-models.js` first; use whatever field it exposes.

- [ ] **Step 5: Update `index.html` tables, scripts, logout, profile**

a) Students table header (line ~220) — replace:

```html
                <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Gender</th><th>Paid</th><th>Outstanding</th><th>Status</th></tr></thead>
```

with:

```html
                <thead><tr><th>ID</th><th>Name</th><th>Class</th><th>Gender</th><th>Paid</th><th>Outstanding</th><th>Status</th><th>Books obtained</th><th>Left to give</th></tr></thead>
```

b) Issuing stock-availability header (line ~341) — replace:

```html
                  <thead><tr><th>Title</th><th>Category</th><th>In stock</th><th>Status</th></tr></thead>
```

with:

```html
                  <thead><tr><th>Title</th><th>Category</th><th>In stock</th><th>Issued already</th><th>Status</th></tr></thead>
```

c) Sidebar `.sidebar-bottom` (line ~65): add a logout button after the `.profile-mini` button block (after line 78):

```html
        <button id="logoutBtn" type="button" hidden>Sign out</button>
```

d) Script include order — insert session before app. Replace the lines:

```html
  <script src="js/data-access.js"></script>
  <script src="js/app.js"></script>
```

with:

```html
  <script src="js/data-access.js"></script>
  <script src="js/session.js"></script>
  <script src="js/app.js"></script>
```

- [ ] **Step 6: Verify parsing and existing suite**

Run: `node scripts/test.js`
Expected: all PASS (**187**).

Run a JS parse check on the touched modules:

```bash
node --check js/session.js; node --check js/app.js
```

Expected: no output (both parse clean). `login.html` — open `login.html` in a browser (or `node --check` is not applicable to HTML; verify by eye / browser).

- [ ] **Step 7: Commit**

```bash
git add js/app.js index.html
git commit -m "feat(auth): role-scoped navigation, router and issued readouts"
```

---

## Task 9: Env docs — `README.md` + `.env.example`

**Files:**
- Modify: `README.md`, `.env.example`

- [ ] **Step 1: Update `.env.example`**

Replace the file contents with:

```
SPREADSHEET_ID=PASTE_YOUR_PUBLIC_SPREADSHEET_ID_HERE
AUTH_USERS_SPREADSHEET_ID=PASTE_YOUR_PRIVATE_USERS_SPREADSHEET_ID_HERE
AUTH_SESSION_SECRET=PASTE_A_LONG_RANDOM_STRING_HERE
```

(`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` are documented in the README; they are loaded by the Vercel functions and the CLI, and may be added here too.)

- [ ] **Step 2: Update the README security note**

In `README.md`, replace the Stage 03 security note block (lines ~71-72):

```markdown
> **Security note:** authentication for the write endpoints is intentionally deferred — the POST endpoints are open. Restrict access before exposing them publicly. See `docs/superpowers/specs/2026-09-23-stage-03-write-back-google-sheets-design.md`.
```

with:

```markdown
> **Security note (auth):** all write endpoints (`/api/payment`, `/api/student`, `/api/issue`, `/api/stock`) and the new `/api/login` + `/api/check` require a valid HMAC-signed session token (`Authorization: Bearer <token>`). Credentials live in a `Users` tab of a **separate, private** spreadsheet (`AUTH_USERS_SPREADSHEET_ID`) and are seeded with `node scripts/create-user.js --init --username <name> --password <pw> --role {admin|teacher|storekeeper}`. Add `AUTH_SESSION_SECRET` (any long random string) and `AUTH_USERS_SPREADSHEET_ID` to Vercel project settings. Design: `docs/superpowers/specs/2026-09-26-login-roles-design.md`.
```

- [ ] **Step 3: Add a "Stage 04" (auth) write-up section to the README**

Append at the end of the README:

```markdown
## Stage 05 — Authentication & roles

The app now requires a login. New files: `login.html`, `js/session.js`, `api/login.js`, `api/check.js`, `scripts/create-user.js`.

- Seed your private users spreadsheet: `node scripts/create-user.js --init --username admin --password <pw> --role admin` (repeat for `teacher` / `storekeeper`). `--init` creates the tab + header row once.
- Roles: admin (everything), teacher (`#students`, read-only, with "Books obtained / Left to give" from the new Issued ledger), storekeeper (Dashboard / Payments / Inventory / Issuing; can record payments and issue books; sees "Issued already" per book).
- Sessions are stateless 12-hour HMAC tokens; a stored token is validated against `/api/check` on every load. Network failure → offline read-only view with all writes hidden. Any 401 returns you to `login.html`.
- The Issued ledger (`Issued` tab in the public sheet, written by `/api/issue`) is what makes "what has the student obtained / what is left" answerable.
- Requires env vars on Vercel and in `.env` (see `.env.example`): `AUTH_USERS_SPREADSHEET_ID`, `AUTH_SESSION_SECRET`. The read path stays public by design (see spec).
```

- [ ] **Step 4: Run the full suite and commit**

Run: `node scripts/test.js`
Expected: **all PASS (~187)**, zero FAIL.

```bash
git add README.md .env.example
git commit -m "docs: document the auth env vars and role model"
```

---

## Self-review (done at plan time)

**Spec coverage:** every Goals line has a task — login endpoint (T3), role panels (T2/T8), Issued ledger (T4/T6), offline policy (T7/T8), env vars (T9). All 10 acceptance criteria map to explicit tests: AC1 (T3 login + T7 defaults), AC2 (T3 generic 401), AC3 (T2 token expiry + T7 guard), AC4 (T7 guard → login), AC5 (T8 students view + T6 issuedSummary), AC6 (T2 stock/student gating + T8 issuing readout), AC7-8 (T2 requireAuth tests), AC9 (T7 guard offline), AC10 (final `npm test`).

**Placeholder scan:** no TBDs; every code step carries full source.

**Type consistency:** `hashPassword`/`verifyPassword`/`signToken`/`verifyToken`/`requireAuth`/`sheetsAddTab` exported from `_lib.js` exactly as used; `normalizeIssued`/`issuedSummary` shape `{byStudent:{books,qty},byBook}` matched by renderers; `session.*` names (`can`, `defaultPage`, `resolvePage`, `load`, `store`, `guard`, `logout`, `isOffline`, `parsePayload`) used consistently in `login.html`, `app.js`, and tests. `pageForHash` in `view-models.js` remains the low-level mapper; `session.resolvePage` is the role-aware wrapper used by the app router.

**Caveat to check during execution:** `CEC.viewModels.stockStatus` rows — confirm they expose `bookId` (Step 4 Task 8); the plan gives the fallback.