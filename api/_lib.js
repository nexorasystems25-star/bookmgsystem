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
    const data = await res.json();
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
    const data = await res.json();
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
    const data = await res.json();
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
    const data = await res.json();
    if (!res.ok) throw new Error("Sheets update failed: " + ((data && data.error && data.error.message) || res.status));
    return data;
  }

  return { getAccessToken, sheetsGet, sheetsAppend, sheetsUpdate };
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
  validateStockPayload,
  createClient
};