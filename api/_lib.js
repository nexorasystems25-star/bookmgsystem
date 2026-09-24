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
  const exbooks = Number(p.exbooks || 0);
  if (!p.name || !String(p.name).trim()) return { ok: false, error: "name is required" };
  if (!p.class || !String(p.class).trim()) return { ok: false, error: "class is required" };
  if (GENDERS.indexOf(p.gender) === -1) return { ok: false, error: "gender must be male or female" };
  if (!(fee >= 0) || !(total >= 0) || !(exbooks >= 0)) return { ok: false, error: "books_fee, books_total and exbooks must be non-negative numbers" };
  return { ok: true, payload: { name: String(p.name).trim(), className: String(p.class).trim(), gender: p.gender, booksFee: fee, booksTotal: total, exbooks: exbooks, academicYear: p.academic_year || "2026/2027" } };
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

  return { getAccessToken, sheetsGet, sheetsAppend, sheetsUpdate, sheetsMeta };
}

function cellNum(v) {
  if (v === "" || v === undefined || v === null) return 0;
  const n = Number(v);
  if (isNaN(n)) throw new Error("Sheet contains a non-numeric value");
  return n;
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