"use strict";

const OAUTH_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const METHODS = ["Cash", "MTN MoMo", "Telecel"];
const GENDERS = ["male", "female"];
const CONFIG_HEADER = ["academic_year", "daily_payment_target", "currency", "last_synced"];
const CLASS_FEE_SIZE_COLUMNS = ["A1 Small", "D1 Small", "C Small", "G Small", "A1 Big", "D1 Big", "Exercise Book"];

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const scryptAsync = promisify(crypto.scrypt);

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

function scryptParams(credentials) {
  const parts = String(credentials || "").split(":");
  if (parts.length !== 5) throw new Error("Malformed credentials string");
  const N = parseInt(parts[0], 10);
  const r = parseInt(parts[1], 10);
  const p = parseInt(parts[2], 10);
  const saltHex = parts[3];
  const hashHex = parts[4];
  if (!/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2])
      || !(N > 0) || !(r > 0) || !(p > 0)
      || !/^[0-9a-f]+$/i.test(saltHex) || (saltHex.length % 2 !== 0)
      || !/^[0-9a-f]+$/i.test(hashHex) || (hashHex.length % 2 !== 0)) {
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
  const derived = await scryptAsync(String(password), params.salt, params.hash.length, { N: params.N, r: params.r, p: params.p });
  if (derived.length !== params.hash.length) return false;
  const eq = compare || function (a, b) {
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  return eq(derived, params.hash);
}

function signToken(user, ttlSeconds, secret) {
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not set");
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
  const exbooks = Number(p.exbooks || 0);
  if (!p.name || !String(p.name).trim()) return { ok: false, error: "name is required" };
  if (!p.class || !String(p.class).trim()) return { ok: false, error: "class is required" };
  if (GENDERS.indexOf(p.gender) === -1) return { ok: false, error: "gender must be male or female" };
  if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return { ok: false, error: "books_fee, books_total and exbooks must be non-negative numbers" };
  return { ok: true, payload: { name: String(p.name).trim(), className: String(p.class).trim(), gender: p.gender, booksFee: fee, booksTotal: total, exbooks: exbooks, academicYear: p.academic_year || "2026/2027" } };
}

function validateIssuePayload(raw) {
  const p = raw || {};
  if (!p.student_id || typeof p.student_id !== "string") return { ok: false, error: "student_id is required" };
  if (Array.isArray(p.books)) {
    const books = [];
    const seen = {};
    for (const it of p.books) {
      if (it != null && typeof it === "object") {
        const bookId = String(it.book_id || "").trim();
        const qty = it.qty;
        if (!bookId) return { ok: false, error: "book_id is required in books" };
        if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "qty must be a positive integer for " + bookId };
        if (seen[bookId]) return { ok: false, error: "duplicate book_id: " + bookId };
        seen[bookId] = true;
        books.push({ book_id: bookId, qty: qty });
      } else {
        const bookId = String(it || "").trim();
        if (!bookId) continue;
        if (seen[bookId]) return { ok: false, error: "duplicate book_id: " + bookId };
        seen[bookId] = true;
        books.push({ book_id: bookId, qty: 1 });
      }
    }
    if (!books.length) return { ok: false, error: "books must contain at least one book_id" };
    return { ok: true, payload: { student_id: p.student_id, books: books } };
  }
  const qty = Number(p.qty);
  if (!p.book_id || typeof p.book_id !== "string") return { ok: false, error: "book_id is required" };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, error: "qty must be a positive integer" };
  return { ok: true, payload: { student_id: p.student_id, book_id: p.book_id, qty: qty } };
}

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

function validateConfigPayload(raw) {
  const p = raw || {};
  const year = typeof p.academic_year === "string" ? p.academic_year.trim() : "";
  const target = Number(p.daily_payment_target);
  if (!/^\d{4}\s*\/\s*\d{2,4}$/.test(year)) return { ok: false, error: "academic_year must look like 2026/2027" };
  // Number(null) and Number("") are both 0, so presence is checked before the numeric range.
  if (p.daily_payment_target == null || p.daily_payment_target === "" ||
      !Number.isFinite(target) || target < 0) {
    return { ok: false, error: "daily_payment_target must be a non-negative number" };
  }
  if (typeof p.currency !== "string" || !p.currency.trim() || p.currency.length > 10) {
    return { ok: false, error: "currency is required and must be 10 characters or fewer" };
  }
  return { ok: true, payload: { academicYear: year, dailyPaymentTarget: target, currency: p.currency } };
}

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

  async function sheetsMeta(spreadsheetId) {
    const token = await getAccessToken();
    const res = await fetcher(
      API_BASE + "/" + encodeURIComponent(spreadsheetId) + "?fields=sheets.properties(sheetId,title)",
      { headers: { Authorization: "Bearer " + token } }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("Sheets metadata failed: " + ((data && data.error && data.error.message) || res.status));
    const tabs = {};
    if (data && Array.isArray(data.sheets)) {
      for (const s of data.sheets) {
        if (s.properties && s.properties.title) {
          tabs[s.properties.title] = s.properties.sheetId;
        }
      }
    }
    return tabs;
  }

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

  return { getAccessToken, sheetsGet, sheetsAppend, sheetsUpdate, sheetsMeta, sheetsAddTab };
}

function cellNum(v) {
  if (v === "" || v === undefined || v === null) return 0;
  const n = Number(v);
  if (isNaN(n)) throw new Error("Sheet contains a non-numeric value");
  return n;
}

async function loadClassFeeSizes(client, spreadsheetId, className) {
  const klass = String(className || "").trim().toLowerCase();
  if (!klass) return {};
  const rows = await client.sheetsGet(spreadsheetId, "ClassFees!A:L");
  const headers = ((rows && rows[0]) || []).map(h => String(h || "").trim());
  const classCol = headers.indexOf("class") >= 0 ? headers.indexOf("class") : headers.indexOf("className");
  if (classCol < 0) return {};
  const colByLower = {};
  headers.forEach((h, i) => { colByLower[h.toLowerCase()] = i; });
  for (let i = 1; i < (rows || []).length; i++) {
    if (String(rows[i][classCol] || "").trim().toLowerCase() !== klass) continue;
    const sizes = {};
    CLASS_FEE_SIZE_COLUMNS.forEach(name => {
      const idx = colByLower[name.toLowerCase()];
      if (idx === undefined) return;
      const v = Number(rows[i][idx]);
      if (v > 0) sizes[name] = v;
    });
    return sizes;
  }
  return {};
}

function issuedQuantityByStudent(rows, studentId) {
  const out = {};
  const headers = ((rows && rows[0]) || []).map(h => String(h || "").trim());
  const sidCol = headers.indexOf("student_id");
  const bidCol = headers.indexOf("book_id");
  const qtyCol = headers.indexOf("qty");
  if (sidCol < 0 || bidCol < 0 || qtyCol < 0) return out;
  for (let i = 1; i < (rows || []).length; i++) {
    if (String(rows[i][sidCol] || "") !== String(studentId)) continue;
    const bid = String(rows[i][bidCol] || "");
    if (!bid) continue;
    const q = Number(rows[i][qtyCol]);
    out[bid] = (out[bid] || 0) + (Number.isFinite(q) && q > 0 ? q : 0);
  }
  return out;
}

async function runPayment(client, spreadsheetId, payload) {
  const students = await client.sheetsGet(spreadsheetId, "Students!A:J");
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
  await client.sheetsUpdate(spreadsheetId, "Students!" + colLetter(9) + found.rowIndex, [[status]]);
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
    String(payload.booksFee), "0", String(payload.booksTotal), String(payload.exbooks), "not covered"
  ]]);
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "student", "New student record created for " + payload.name, "0", todayISO()
  ]]);
  return { ok: true, row: { student_id: studentId } };
}

async function runIssue(client, spreadsheetId, payload) {
  const students = await client.sheetsGet(spreadsheetId, "Students!A:J");
  const foundStudent = findRowIndex(students, "student_id", payload.student_id);
  if (!foundStudent) return { ok: false, error: "student_id not found" };
  const studentRow = students[foundStudent.rowIndex - 1];
  const studentName = studentRow[1];
  if (!(cellNum(studentRow[6]) > 0)) {
    return { ok: false, error: studentName + " has not paid for books yet — record a payment before issuing." };
  }
  const classSizes = await loadClassFeeSizes(client, spreadsheetId, studentRow[2]);
  const issuedRows = await client.sheetsGet(spreadsheetId, "Issued!A:F");
  const alreadyReceived = issuedQuantityByStudent(issuedRows, payload.student_id);

  const requests = payload.books
    ? payload.books.map(b => (typeof b === "string" ? { book_id: b, qty: 1 } : b))
    : [{ book_id: payload.book_id, qty: payload.qty }];

  const books = await client.sheetsGet(spreadsheetId, "Books!A:I");
  const resolved = [];
  for (const req of requests) {
    const foundBook = findRowIndex(books, "book_id", req.book_id);
    if (!foundBook) return { ok: false, error: "book_id not found: " + req.book_id };
    const bookRow = books[foundBook.rowIndex - 1];
    const stockQty = cellNum(bookRow[5]);
    const category = String(bookRow[3] || "").trim();
    const sizeName = CLASS_FEE_SIZE_COLUMNS.find(name => name.toLowerCase() === category.toLowerCase());
    const required = sizeName ? (Number(classSizes[sizeName]) || 0) : 1;
    if (required > 0) {
      const received = alreadyReceived[req.book_id] || 0;
      const remaining = required - received;
      if (remaining <= 0) {
        return { ok: false, error: req.book_id + " was already issued to this student (required " + required + ", received " + received + ")" };
      }
      if (req.qty > remaining) {
        return { ok: false, error: "cannot issue " + req.qty + " of " + bookRow[2] + ": only " + remaining + " of the required " + required + " remains for this student" };
      }
    }
    if (req.qty > stockQty) return { ok: false, error: "insufficient stock for " + bookRow[2] + ": only " + stockQty + " available" };
    resolved.push({ foundBook, bookRow, stockQty, qty: req.qty });
  }

  const activity = await client.sheetsGet(spreadsheetId, "Activity!A:A");
  const activityId = nextId(activity, "A");
  const issuedIds = resolved.map(x => (x.qty > 1 ? x.bookRow[0] + "x" + x.qty : x.bookRow[0])).join(",");
  for (const x of resolved) {
    await client.sheetsUpdate(spreadsheetId, "Books!" + colLetter(5) + x.foundBook.rowIndex, [[String(x.stockQty - x.qty)]]);
  }
  await client.sheetsAppend(spreadsheetId, "Activity", [[
    activityId, "issue", "Books issued to " + studentName + " [" + issuedIds + "]", "0", todayISO()
  ]]);
  let issuedNum = Number(nextId(issuedRows.map(r => [String(r[0] || "")]), "I").slice(1));
  for (const x of resolved) {
    await client.sheetsAppend(spreadsheetId, "Issued", [[
      "I" + String(issuedNum++).padStart(3, "0"),
      payload.student_id,
      x.bookRow[0],
      String(x.qty),
      todayISO()
    ]]);
  }
  if (payload.books) {
    return { ok: true, rows: resolved.map(x => ({ book_id: x.bookRow[0], stock_qty: x.stockQty - x.qty })) };
  }
  const single = resolved[0];
  return { ok: true, row: { book_id: single.bookRow[0], stock_qty: single.stockQty - single.qty } };
}

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

async function runConfig(client, spreadsheetId, payload) {
  let config;
  try {
    config = await client.sheetsGet(spreadsheetId, "Config!A:D");
  } catch (e) {
    // A truly absent tab rejects the read; treat it as the same condition as a bad header.
    return { ok: false, error: "Config tab missing or header mismatch." };
  }
  const header = (config[0] || []).slice(0, 4);
  if (header.join(",") !== CONFIG_HEADER.join(",")) {
    return { ok: false, error: "Config tab missing or header mismatch." };
  }
  const current = (config[1] || []).slice(0, 4);
  while (current.length < 4) current.push("");
  const row = [
    payload.academicYear == null ? current[0] : String(payload.academicYear),
    payload.dailyPaymentTarget == null ? current[1] : String(payload.dailyPaymentTarget),
    payload.currency == null ? current[2] : String(payload.currency),
    current[3]
  ];
  await client.sheetsUpdate(spreadsheetId, "Config!A2:D2", [row]);
  return { ok: true };
}

module.exports = {
  OAUTH_URL,
  API_BASE,
  todayISO,
  nextId,
  recomputeStatus,
  colLetter,
  scryptParams,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  requireAuth,
  findRowIndex,
  cellNum,
  validatePaymentPayload,
  validateStudentPayload,
  validateIssuePayload,
  validateStockPayload,
  validateConfigPayload,
  createClient,
  runPayment,
  runStudent,
  runIssue,
  runStock,
  runConfig
};