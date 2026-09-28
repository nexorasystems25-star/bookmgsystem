const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const csv = require("../js/csv.js");
const xlsx = require("../js/xlsx.js");

// Deterministic env for auth tests. Other tests pass explicit config objects to
// createClient, so clearing these globals is safe for the whole file.
process.env.AUTH_SESSION_SECRET = "test-secret";
process.env.AUTH_USERS_SPREADSHEET_ID = "users-spr";
for (const k of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"]) {
  delete process.env[k];
}

let pass = 0;
const inflight = [];
function test(name, fn) {
  const report = (ok, err) => {
    if (ok) {
      pass++;
      console.log("PASS " + name);
    } else {
      console.error("FAIL " + name);
      console.error("  " + (err && err.message));
      process.exitCode = 1;
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      inflight.push(out.then(() => report(true), (err) => report(false, err)));
    } else {
      report(true);
    }
  } catch (err) {
    report(false, err);
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

test("parseCSV nullish input returns no rows", () => {
  assert.deepEqual(csv.parseCSV(null), []);
  assert.deepEqual(csv.parseCSV(undefined), []);
});

test("parseCSV empty input returns no rows", () => {
  assert.deepEqual(csv.parseCSV(""), []);
});

test("parseCSV preserves explicit empty fields", () => {
  const rows = csv.parseCSV("a,,c");
  assert.deepEqual(rows, [["a", "", "c"]]);
});

test("parseCSV flushes quoted field at EOF", () => {
  const rows = csv.parseCSV('"abc');
  assert.deepEqual(rows, [["abc"]]);
});

test("parseCSV preserves embedded newlines inside quotes", () => {
  const rows = csv.parseCSV('a,"b\nc"');
  assert.deepEqual(rows, [["a", "b\nc"]]);
});

test("rowsToObjects header-only CSV returns no objects", () => {
  const rows = csv.parseCSV("a,b");
  assert.deepEqual(csv.rowsToObjects(rows), []);
});

test("rowsToObjects short rows default missing keys to empty", () => {
  const rows = csv.parseCSV("a,b\n1");
  assert.deepEqual(csv.rowsToObjects(rows), [{ a: "1", b: "" }]);
});

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
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}
function sixDaysAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

test("normalizeStudents casts amounts and keeps fields", () => {
  const rows = derive.normalizeStudents(STUDENTS);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].booksFee, 350);
  assert.equal(rows[0].status, "ready");
  assert.equal(rows[1].booksPaid, 150);
  assert.equal(rows[2].booksTotal, 300);
});

test("normalizeStudents reads exbooks column", () => {
  const rows = derive.normalizeStudents([
    { student_id: "CEC-001", name: "Ama Serwaa", class: "KG 1", gender: "F", academic_year: "2026/2027", books_fee: "400", books_paid: "0", books_total: "6", exbooks: "20", status: "not covered" }
  ]);
  assert.equal(rows[0].booksTotal, 6);
  assert.equal(rows[0].exbooks, 20);
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

test("buildKpis outstanding uses booksFee when booksTotal is a book count", () => {
  const students = derive.normalizeStudents([
    { student_id: "CEC-010", name: "Ten", class: "BS 2", gender: "M", academic_year: "2026/2027", books_fee: "1200", books_paid: "800", books_total: "8", exbooks: "2", status: "waiting" }
  ]);
  const k = derive.buildKpis(students, [], derive.normalizeConfig([CONFIG]));
  assert.equal(k.outstandingCount, 1);
  assert.equal(k.outstandingAmount, 400);
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

test("validateStudentPayload accepts and forwards exbooks", () => {
  const r = lib.validateStudentPayload({ name: "Ama Serwaa", class: "JS 1", gender: "female", books_fee: "1400", books_total: "10", exbooks: "15" });
  assert.equal(r.ok, true);
  assert.equal(r.payload.exbooks, 15);
});

test("validateStudentPayload defaults exbooks to zero", () => {
  const r = lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "female", books_fee: 1, books_total: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.payload.exbooks, 0);
});

test("validateStudentPayload rejects negative exbooks", () => {
  assert.equal(lib.validateStudentPayload({ name: "Ama", class: "JS 1", gender: "female", books_fee: 1, books_total: 1, exbooks: -1 }).ok, false);
});

test("validateIssuePayload accepts valid input and rejects bad", () => {
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 2 }).ok, true);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 0 }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 1.5 }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", qty: 1 }).ok, false);
});

test("validateIssuePayload accepts a books array and rejects empty/bad ones", () => {
  assert.deepEqual(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "B002"] }).payload, { student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B002", qty: 1 }] });
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: "B001" }).ok, false);
  assert.equal(lib.validateIssuePayload({ books: ["B001"] }).ok, false);
});

test("validateIssuePayload accepts mixed books arrays with per-item quantities", () => {
  assert.deepEqual(
    lib.validateIssuePayload({ student_id: "S001", books: ["B001", { book_id: "B075", qty: 5 }] }).payload,
    { student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B075", qty: 5 }] }
  );
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: 0 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: 1.5 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B075", qty: -3 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ qty: 5 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["  ", "B001"] }).payload.books[0].book_id, "B001");
});

test("validateIssuePayload rejects duplicate book ids in a books array", () => {
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "B001"] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: ["B001", { book_id: "B001", qty: 2 }] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [{ book_id: "B001", qty: 1 }, { book_id: "B001", qty: 2 }] }).ok, false);
});

test("validateStockPayload accepts valid input and rejects bad", () => {
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 20 }).ok, true);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 0 }).ok, false);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 1.5 }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_delta: 20 }).ok, false);
});

test("validateStockPayload accepts a stock_adjustments batch array", () => {
  assert.deepEqual(lib.validateStockPayload({
    stock_adjustments: [{ book_id: "B001", stock_delta: 10 }, { book_id: "B002", stock_delta: -5 }]
  }).payload, {
    stock_adjustments: [{ book_id: "B001", stockDelta: 10 }, { book_id: "B002", stockDelta: -5 }]
  });
});

test("validateStockPayload rejects bad batch entries", () => {
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: [] }), { ok: false, error: "stock_adjustments must contain at least one adjustment" });
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: [{ stock_delta: 10 }] }), { ok: false, error: "adjustment 0: book_id is required" });
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 0 }] }), { ok: false, error: "adjustment 0: stock_delta must be a non-zero integer" });
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 1.5 }] }), { ok: false, error: "adjustment 0: stock_delta must be a non-zero integer" });
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 5 }, { book_id: "B001", stock_delta: 5 }] }), { ok: false, error: "adjustment 1: duplicate book_id B001" });
  assert.deepEqual(lib.validateStockPayload({ stock_adjustments: "B001" }), { ok: false, error: "book_id is required" });
});

test("validateConfigPayload accepts valid input", () => {
  const r = lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: 60, currency: "GH₵" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.payload, { academicYear: "2025/2026", dailyPaymentTarget: 60, currency: "GH₵" });
});

test("validateConfigPayload rejects bad input", () => {
  assert.equal(lib.validateConfigPayload({ academic_year: "2025", daily_payment_target: 60, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/6", daily_payment_target: 60, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026/27", daily_payment_target: 60, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "", daily_payment_target: 60, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ daily_payment_target: 60, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: -1, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: "abc", currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: NaN, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: 60, currency: "" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2025/2026", daily_payment_target: 60, currency: "GHS-1234567" }).ok, false);
});

test("validateConfigPayload rejects a null or empty daily_payment_target instead of coercing it to 0", () => {
  // Number(null) and Number("") are both 0, so a bare target check would wave these through and write 0.
  assert.equal(lib.validateConfigPayload({ academic_year: "2026/2027", daily_payment_target: null, currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ academic_year: "2026/2027", daily_payment_target: "", currency: "GH₵" }).ok, false);
  assert.equal(lib.validateConfigPayload({ daily_payment_target: "" }).ok, false);
});

test("client contract: write.js sends snake_case payloads (camelCase rejected)", () => {
  assert.equal(lib.validatePaymentPayload({ student_id: "S001", amount: "5", method: "Cash" }).ok, true);
  assert.equal(lib.validatePaymentPayload({ studentId: "S001", amount: "5", method: "Cash" }).ok, false);
  assert.equal(lib.validateStudentPayload({ name: "Ama Serwaa", class: "JS 1", gender: "female", books_fee: "1400", books_total: "10" }).ok, true);
  assert.equal(lib.validateStudentPayload({ name: "Ama Serwaa", className: "JS 1", gender: "female", booksFee: "1400", booksTotal: "10" }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 2 }).ok, true);
  assert.equal(lib.validateIssuePayload({ studentId: "S001", bookId: "B001", qty: 2 }).ok, false);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 20 }).ok, true);
  assert.equal(lib.validateStockPayload({ bookId: "B001", stockDelta: 20 }).ok, false);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ book_id: "B001", stock_delta: 10 }] }).ok, true);
  assert.equal(lib.validateStockPayload({ stock_adjustments: [{ bookId: "B001", stockDelta: 10 }] }).ok, false);
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

test("sheetsMeta maps sheet titles to their gid and surfaces API errors", async () => {
  const okCalls = [];
  const okFake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: true, status: 200, body: {
      sheets: [
        { properties: { sheetId: 0, title: "Students" } },
        { properties: { sheetId: 1739569805, title: "Payments" } },
        { properties: { sheetId: 442418462, title: "Books" } }
      ]
    } }
  ], okCalls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, okFake);
  const tabs = await client.sheetsMeta("spr123");
  assert.deepEqual(tabs, { Students: 0, Payments: 1739569805, Books: 442418462 });
  assert.match(okCalls[1].url, /\/spr123\?fields=sheets/);

  const badCalls = [];
  const badFake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: false, status: 403, body: { error: { message: "The caller does not have permission." } } }
  ], badCalls);
  const badClient = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, badFake);
  await assert.rejects(badClient.sheetsMeta("spr123"), /Sheets metadata failed: The caller does not have permission/);
});

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
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
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
  assert.equal(ops[2].range, "Students!J2");
  assert.deepEqual(ops[2].values, [[stats(1200, 1200)]]);
  assert.equal(ops[3].op, "append");
  assert.equal(ops[3].tab, "Activity");
  assert.match(ops[3].rows[0][2], /Payment received from Abena Mensah/);
});

test("runPayment uses partial wording when paid is below fee", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S003","Ama Serwaa","JS 1","female","2026/2027","1400","700","10","3","waiting"]],
    "Payments!A:A": [["payment_id"],["P008"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runPayment(client, "spr", { student_id: "S003", amount: 100, method: "Cash", date: "2026-09-23" });
  assert.equal(r.ok, true);
  assert.match(client.calls[3].rows[0][2], /Partial payment from Ama Serwaa/);
});

test("runPayment rejects missing student", async () => {
  const client = makeFakeClient({ "Students!A:J": [["student_id"]] });
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
  const r = await lib.runStudent(client, "spr", { name: "Araba Quaicoe", className: "BS 4", gender: "female", booksFee: 1350, booksTotal: 9, exbooks: 2, academicYear: "2026/2027" });
  assert.equal(r.ok, true);
  assert.equal(r.row.student_id, "S010");
  assert.equal(client.calls[0].tab, "Students");
  assert.deepEqual(client.calls[0].rows[0].slice(0, 10), ["S010","Araba Quaicoe","BS 4","female","2026/2027","1350","0","9","2","not covered"]);
  assert.equal(client.calls[1].tab, "Activity");
  assert.match(client.calls[1].rows[0][2], /New student record created for Araba Quaicoe/);
});

test("runIssue decrements stock and appends activity", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B003","Pearson","Integrated Science","Core","92","12","15"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B003", qty: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.row.stock_qty, 11);
  assert.equal(client.calls[0].op, "update");
  assert.equal(client.calls[0].range, "Books!F2");
  assert.deepEqual(client.calls[0].values, [["11"]]);
  assert.match(client.calls[1].rows[0][2], /Books issued to Abena Mensah/);
  assert.equal(client.calls[2].tab, "Issued");
  assert.equal(client.calls[2].rows[0][0], "I001");
  assert.equal(client.calls[2].rows[0][1], "S001");
  assert.equal(client.calls[2].rows[0][2], "B003");
  assert.equal(client.calls[2].rows[0][3], "1");
  assert.match(client.calls[2].rows[0][4], /^\d{4}-\d{2}-\d{2}$/);
});

test("runIssue rejects re-issuing a textbook past its single copy (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B001","GoldenA","BWP - Mathematics","Core","85","2","10"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B001", qty: 5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /only 1 of the required 1 remains/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue rejects a textbook already issued to the student (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B001","GoldenA","Math","Core","85","40","10"]],
    "Issued!A:F": [["issue_id","student_id","book_id","qty","date"],["I001","S001","B001","1","2026-09-24"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B001", qty: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /already issued/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue rejects an exercise book past its ClassFees requirement (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "ClassFees!A:L": [["class","books_fee","exbooks","A1 Small","D1 Small","C Small","G Small","A1 Big","D1 Big","Exercise Book"],["BS 1A","1200","2","5","5","4","4","12","12","10"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B075","Exercise Book","A1 Small","A1 Small","2.5","12","5"]],
    "Issued!A:F": [["issue_id","student_id","book_id","qty","date"],["I001","S001","B075","5","2026-09-24"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B075", qty: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /already issued/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue caps an issue at the remaining entitlement from ClassFees", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "ClassFees!A:L": [["class","books_fee","exbooks","A1 Small","D1 Small","C Small","G Small","A1 Big","D1 Big","Exercise Book"],["BS 1A","1200","2","5","5","4","4","12","12","10"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B075","Exercise Book","A1 Small","A1 Small","2.5","12","5"]],
    "Issued!A:F": [["issue_id","student_id","book_id","qty","date"],["I001","S001","B075","3","2026-09-24"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const over = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B075", qty: 5 });
  assert.equal(over.ok, false);
  assert.match(over.error, /only 2 of the required 5 remains/);
  assert.equal(client.calls.length, 0, "no writes on over-issue");
  const ok = await lib.runIssue(client, "spr", { student_id: "S001", book_id: "B075", qty: 2 });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.stock_qty, 10);
  const issuedCall = client.calls.find(c => c.tab === "Issued");
  assert.deepEqual(issuedCall.rows[0].slice(0, 4), ["I002", "S001", "B075", "2"]);
});

test("runIssue rejects an exercise book the paid budget cannot cover whole-type (no writes)", async () => {
  const fees = [["class", "books_fee", "exbooks", "A1 Small", "D1 Small", "C Small", "G Small", "A1 Big", "D1 Big", "Exercise Book"], ["BS 1A", "1200", "20", "5", "5", "4", "4", "12", "12", "10"]];
  const books = [["book_id", "publisher", "subject", "category", "price", "stock_qty", "low_stock_threshold"], ["B077", "Exercise Book", "Writing Exercise Book C", "C Small", "2.5", "20", "5"]];
  const unit = (paid) => ({
    "Students!A:J": [["student_id", "name", "class", "gender", "academic_year", "books_fee", "books_paid", "books_total", "exbooks", "status"], ["S001", "Abena Mensah", "BS 1A", "female", "2026/2027", "1200", paid, "8", "20", "waiting"]],
    "ClassFees!A:L": fees,
    "Books!A:I": books,
    "Activity!A:A": [["activity_id"], ["A006"]]
  });
  const poor = makeFakeClient(unit("8"));
  const r = await lib.runIssue(poor, "spr", { student_id: "S001", book_id: "B077", qty: 1 });
  assert.equal(r.ok, false);
  assert.match(r.error, /paid budget/);
  assert.equal(poor.calls.length, 0, "no writes happened");
  const solvent = makeFakeClient(unit("10"));
  const ok = await lib.runIssue(solvent, "spr", { student_id: "S001", book_id: "B077", qty: 1 });
  assert.equal(ok.ok, true);
  assert.equal(ok.row.stock_qty, 19);
});

test("runIssue applies per-item quantities from a mixed books array", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","40","10"],
      ["B075","Exercise Book","A1 Small","A1 Small","2.5","12","5"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001", { book_id: "B075", qty: 5 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [{ book_id: "B001", stock_qty: 39 }, { book_id: "B075", stock_qty: 7 }]);
  const activityCall = client.calls.find(c => c.tab === "Activity");
  assert.match(activityCall.rows[0][2], /Books issued to Abena Mensah \[B001,B075x5\]/);
  const issuedCalls = client.calls.filter(c => c.tab === "Issued");
  assert.deepEqual(issuedCalls.map(c => c.rows[0].slice(0, 4)), [
    ["I001", "S001", "B001", "1"],
    ["I002", "S001", "B075", "5"]
  ]);
});

test("runIssue rolls and appends one Issued row per resolved book", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id", "name", "class", "gender", "academic_year", "books_fee", "books_paid", "books_total", "exbooks", "status"], ["S001", "Abena Mensah", "BS 1A", "female", "2026/2027", "1200", "800", "8", "2", "waiting"]],
    "Books!A:I": [["book_id", "publisher", "subject", "category", "price", "stock_qty", "low_stock_threshold"],
      ["B001", "GoldenA", "Math", "Core", "85", "40", "10"],
      ["B075", "Exercise Book", "A1 Small", "A1 Small", "2.5", "12", "5"]],
    "Activity!A:A": [["activity_id"], ["A006"]],
    "Issued!A:F": [["issue_id", "student_id", "book_id", "qty", "date"], ["I009", "S900", "B999", "1", "2026-09-24"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001"] });
  assert.equal(r.ok, true);
  const issuedCall = client.calls.find(c => c.tab === "Issued");
  assert.equal(issuedCall.rows[0][0], "I010");
});

test("runIssue rejects per-item quantity when stock is insufficient (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B075","Exercise Book","A1 Small","A1 Small","2.5","3","5"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: [{ book_id: "B075", qty: 5 }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient stock for A1 Small/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

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

test("signToken throws when the session secret is missing", () => {
  assert.throws(() => lib.signToken({ username: "ama", role: "admin" }, 3600, undefined), /AUTH_SESSION_SECRET/);
});

test("scryptParams rejects odd-length hex and non-numeric cost fields", () => {
  assert.throws(() => lib.scryptParams("16384:8:1:aab:ccddee"), /Malformed credentials/);         // odd-length salt
  assert.throws(() => lib.scryptParams("16384:8:1:aabbccdd:ccddeef"), /Malformed credentials/);  // odd-length hash
  assert.throws(() => lib.scryptParams("16384abc:8:1:aabbccdd:ccddee"), /Malformed credentials/); // non-numeric N
});

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (payload) { res.body = payload; return res; };
  return res;
}

async function runHandler(mod, req, deps) {
  const res = fakeRes();
  await mod(req, res, deps);
  return res;
}

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

test("api/login returns a token for valid credentials", async () => {
  const login = require("../api/login.js");
  const validCred = await lib.hashPassword("pw123");
  const fakeUsers = [
    ["username", "credentials", "role", "created_at", "updated_at"],
    ["ama", validCred, "admin", "2026-09-26", "2026-09-26"]
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
  const validCred = await lib.hashPassword("pw123");
  const fakeUsers = [
    ["username", "credentials", "role", "created_at", "updated_at"],
    ["ama", validCred, "admin", "2026-09-26", "2026-09-26"]
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

const CFG_BODY = { academic_year: "2026/2027", daily_payment_target: 60, currency: "GH\u20b5" };
const CFG_CURRENT_ROW = [["academic_year", "daily_payment_target", "currency", "last_synced"], ["2000/2001", "10", "USD", "2026-09-20"]];

test("api/config returns 401 without a valid token and never builds a client", async () => {
  const config = require("../api/config.js");
  let built = 0;
  const deps = { createClient: () => { built++; return {}; } };
  const none = await runHandler(config, { headers: {}, body: CFG_BODY }, deps);
  assert.equal(none.statusCode, 401);
  assert.match(none.body.error, /required/i);
  const bad = await runHandler(config, { headers: { authorization: "Bearer bad" }, body: CFG_BODY }, deps);
  assert.equal(bad.statusCode, 401);
  assert.equal(built, 0, "no Google client is built before authentication succeeds");
});

test("api/config is admin-only: teacher and storekeeper get 403", async () => {
  const config = require("../api/config.js");
  let built = 0;
  const deps = { createClient: () => { built++; return {}; } };
  for (const role of ["teacher", "storekeeper"]) {
    const token = lib.signToken({ username: role, role: role }, 3600, "test-secret");
    const res = await runHandler(config, { headers: { authorization: "Bearer " + token }, body: CFG_BODY }, deps);
    assert.equal(res.statusCode, 403, role + " is not allowed on /api/config");
    assert.match(res.body.error, /permission/i);
  }
  assert.equal(built, 0, "no Google client is built for a forbidden role");
});

test("api/config returns 400 for an invalid payload before touching Google", async () => {
  const config = require("../api/config.js");
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");
  let built = 0;
  const res = await runHandler(config, { headers: { authorization: "Bearer " + token }, body: { academic_year: "2026", daily_payment_target: 60, currency: "GH\u20b5" } }, { createClient: () => { built++; return {}; } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /academic_year/);
  assert.equal(built, 0, "validation runs before the Google client is built");
});

test("api/config writes the validated payload with the Google env (auth before createClient)", async () => {
  const config = require("../api/config.js");
  const envKeys = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "SPREADSHEET_ID"];
  const saved = {};
  for (const k of envKeys) { saved[k] = process.env[k]; process.env[k] = "env-" + k; }
  const order = [];
  const inner = makeFakeClient({ "Config!A:D": CFG_CURRENT_ROW });
  const seenIds = [];
  const client = {
    sheetsGet: (id, range) => { seenIds.push([id, range]); return inner.sheetsGet(id, range); },
    sheetsUpdate: (id, range, values) => { seenIds.push([id, range]); return inner.sheetsUpdate(id, range, values); }
  };
  let createArgs = null;
  try {
    const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");
    const res = await runHandler(config, { headers: { authorization: "Bearer " + token }, body: CFG_BODY }, {
      requireAuth: (req, r, roles) => { order.push("requireAuth:" + roles.join(",")); return lib.requireAuth(req, r, roles); },
      createClient: (env) => { order.push("createClient"); createArgs = env; return client; }
    });
    assert.deepEqual(order, ["requireAuth:admin", "createClient"], "requireAuth runs before createClient");
    assert.deepEqual(createArgs, {
      client_id: "env-GOOGLE_CLIENT_ID",
      client_secret: "env-GOOGLE_CLIENT_SECRET",
      refresh_token: "env-GOOGLE_REFRESH_TOKEN"
    });
    assert.deepEqual(seenIds, [["env-SPREADSHEET_ID", "Config!A:D"], ["env-SPREADSHEET_ID", "Config!A2:D2"]], "SPREADSHEET_ID reaches runConfig");
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    // Every editable column comes from parsed.payload (camelCase) and last_synced is preserved.
    assert.deepEqual(inner.calls[0].values, [["2026/2027", "60", "GH\u20b5", "2026-09-20"]]);
  } finally {
    for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test("api/config surfaces the runConfig header guard as a 400 without writing", async () => {
  const config = require("../api/config.js");
  const token = lib.signToken({ username: "ama", role: "admin" }, 3600, "test-secret");
  const client = makeFakeClient({ "Config!A:D": [["year", "target", "currency", "last_synced"], ["2026/2027", "60", "GH\u20b5", "2026-09-20"]] });
  const res = await runHandler(config, { headers: { authorization: "Bearer " + token }, body: CFG_BODY }, { createClient: () => client });
  assert.equal(res.statusCode, 400, "a header-guard refusal is a 400, not a 500");
  assert.deepEqual(res.body, { ok: false, error: "Config tab missing or header mismatch." });
  assert.equal(client.calls.length, 0, "no write was attempted");
});

// js/data-access.js is a browser IIFE with no module.exports, so it is evaluated fresh per
// test against a fake `window` instead of being required (the flag lives in a per-load
// closure). Storage globals are installed only for the block that needs them; names left
// out are deleted, so the "no storage at all" harness path stays honest.
const DATA_ACCESS_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "data-access.js"), "utf8");

function loadDataAccess() {
  const win = {};
  new Function("window", DATA_ACCESS_SRC)(win);
  return win.CEC;
}

function storageShim(initial) {
  const store = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  return Object.assign(store, initial);
}

function withStorage(provided, fn) {
  const names = ["localStorage", "sessionStorage"];
  const saved = {};
  for (const n of names) {
    saved[n] = globalThis[n];
    if (provided[n] === undefined) delete globalThis[n];
    else globalThis[n] = provided[n];
  }
  try {
    return fn();
  } finally {
    for (const n of names) {
      if (saved[n] === undefined) delete globalThis[n];
      else globalThis[n] = saved[n];
    }
  }
}

test("CEC.forceOffline round-trips in memory when no storage globals exist", () => {
  withStorage({}, () => {
    const cec = loadDataAccess();
    assert.equal(cec.forceOffline, false);
    cec.forceOffline = true;
    assert.equal(cec.forceOffline, true, "the in-memory flag drives the getter with no storage");
    cec.forceOffline = false;
    assert.equal(cec.forceOffline, false);
  });
});

test("CEC.forceOffline persists cecForceOffline in localStorage and removes it on false", () => {
  const local = storageShim();
  withStorage({ localStorage: local }, () => {
    const cec = loadDataAccess();
    cec.forceOffline = true;
    assert.equal(local.cecForceOffline, "true", "true is persisted to localStorage");
    cec.forceOffline = false;
    assert.equal(local.cecForceOffline, undefined, "false removes the localStorage key");
  });
});

test("O6: a legacy sessionStorage cecForceOffline migrates into localStorage on init", () => {
  const local = storageShim();
  const session = storageShim({ cecForceOffline: "true" });
  withStorage({ localStorage: local, sessionStorage: session }, () => {
    const cec = loadDataAccess();
    assert.equal(local.cecForceOffline, "true", "legacy offline flag is written through to localStorage");
    assert.equal(cec.forceOffline, true, "the migrated flag is live in this load, not just the next one");
  });
});

test("O6: init writes nothing to localStorage when the legacy sessionStorage key is absent", () => {
  const local = storageShim();
  const session = storageShim();
  withStorage({ localStorage: local, sessionStorage: session }, () => {
    const cec = loadDataAccess();
    assert.equal(cec.forceOffline, false);
    assert.equal(local.cecForceOffline, undefined, "no migration write-through without a legacy key");
  });
});

// ---- Settings dialog (js/write.js) -------------------------------------------------
// js/write.js is a browser IIFE that wires its dialogs while loading, so it is evaluated
// against a structural stub: no real DOM, just recorders for ids, selectors and listeners.
// That keeps every assertion about *what the module binds*, not about browser behaviour.
// setTimeout/clearTimeout are shadowed so a toast timer never holds the suite open.
const WRITE_SRC = fs.readFileSync(path.join(__dirname, "..", "js", "write.js"), "utf8");
const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// Required here (not reused from the view-models section further down) so this block stands alone.
const viewModels = require("../js/view-models.js");

function stubEl(name) {
  const el = {
    name,
    children: {},
    listeners: [],
    queries: [],
    value: "",
    hidden: true,
    textContent: "",
    innerHTML: "",
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, fn) { el.listeners.push({ type, fn }); },
    hasListener(type) { return el.listeners.some(l => l.type === type); },
    querySelector(sel) {
      el.queries.push(sel);
      if (!el.children[sel]) el.children[sel] = stubEl(name + " " + sel);
      return el.children[sel];
    },
    querySelectorAll(sel) { el.queries.push(sel); return el.children[sel] || []; },
    closest() { return null; },
    showModal() { el.opened = true; },
    close() { el.closed = true; }
  };
  return el;
}

// openDialog() populates asynchronously and returns nothing, so a click handler that just
// calls it resolves before showModal runs. Drain the microtask queue before asserting.
const flushAsync = () => new Promise(resolve => setImmediate(resolve));

const CFG_STUDENTS = [{ academicYear: "2026/2027" }, { academicYear: "2025/2026" }];
const CFG_DATA = {
  students: CFG_STUDENTS,
  config: { activeYear: "2026/2027", dailyTarget: 60, currency: "GH\u20b5" }
};

// Loads write.js over a fresh fake window; returns the namespace plus the fake document so
// tests can read what got wired.
function loadWrite(overrides) {
  const opts = overrides || {};
  const doc = {
    ids: {},
    all: {},
    getElementById(id) {
      if (!doc.ids[id]) doc.ids[id] = stubEl("#" + id);
      return doc.ids[id];
    },
    querySelectorAll(sel) { return doc.all[sel] || []; }
  };
  const editButtons = opts.editButtons || [];
  if (editButtons.length) doc.all["[data-edit-config]"] = editButtons;
  const closeButtons = opts.closeButtons || [];
  if (closeButtons.length) doc.all["[data-close]"] = closeButtons;

  const cec = Object.assign({
    viewModels: viewModels,
    session: { load: () => ({ token: "tok-abc" }) },
    getAllData: async () => CFG_DATA,
    refreshAll: async () => { cec.refreshes++; }
  }, opts.cec);
  cec.refreshes = 0;
  const flips = [];
  let offline = false;
  Object.defineProperty(cec, "forceOffline", {
    get: () => offline,
    set: v => { flips.push(!!v); offline = !!v; },
    configurable: true
  });

  const fetchCalls = [];
  const fetchStub = async (url, o) => {
    fetchCalls.push({ url, opts: o });
    const res = opts.fetch ? opts.fetch(url, o) : { ok: true, status: 200, body: { ok: true } };
    return { ok: res.ok, status: res.status, json: async () => res.body };
  };

  const noopTimer = () => 0;
  const win = { CEC: cec, setTimeout: noopTimer, clearTimeout: noopTimer };
  new Function("window", "document", "fetch", "setTimeout", "clearTimeout", WRITE_SRC)(
    win, doc, fetchStub, noopTimer, noopTimer
  );
  return { cec, doc, fetchCalls, flips };
}

function submitConfig(form, overrides) {
  const opts = overrides || {};
  const set = (sel, value) => { form.querySelector(sel).value = value; };
  set("[data-year]", opts.year);
  set("[data-target]", opts.target);
  set("[data-currency]", opts.currency);
  set("[data-source]", opts.source || "live");
  const handler = form.listeners.filter(l => l.type === "submit").map(l => l.fn).pop();
  return handler({ preventDefault() {}, currentTarget: form });
}

test("write.updateConfig POSTs to api/config with the payload passed through", async () => {
  const { cec, fetchCalls } = loadWrite();
  const payload = { academic_year: "2026/2027", daily_payment_target: 60, currency: "GH\u20b5" };
  await cec.write.updateConfig(payload);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "api/config", "the write targets the config endpoint");
  assert.equal(fetchCalls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0].opts.body), payload, "the payload is passed through untouched");
  assert.equal(fetchCalls[0].opts.headers.Authorization, "Bearer tok-abc");
  assert.equal(cec.refreshes, 1, "runAndRefresh repaints from the refreshed snapshot");

  const failing = loadWrite({ fetch: () => ({ ok: false, status: 400, body: { ok: false, error: "Config tab missing or header mismatch." } }) });
  await assert.rejects(failing.cec.write.updateConfig(payload), /header mismatch/);
  assert.equal(failing.cec.refreshes, 1, "O7: the snapshot still repaints after a failed POST");
});

test("O2/AC6: a shape-valid year outside availableYears is rejected before the POST", () => {
  const { cec } = loadWrite();
  const draft = { target: "60", currency: "GH\u20b5", source: "live" };
  const rejected = cec.configForm.validate(Object.assign({}, draft, { year: "2019/2020" }), CFG_DATA);
  assert.equal(rejected.ok, false, "a format-valid but absent year must not be accepted");
  assert.match(rejected.error, /2019\/2020/, "the inline error names the offending year");
  const accepted = cec.configForm.validate(Object.assign({}, draft, { year: "2025/2026" }), CFG_DATA);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.payload, { academic_year: "2025/2026", daily_payment_target: 60, currency: "GH\u20b5" });
  assert.equal(accepted.source, "live");
  assert.equal(cec.configForm.validate(Object.assign({}, draft, { year: "" }), CFG_DATA).ok, false);
  assert.equal(cec.configForm.validate(Object.assign({}, draft, { year: "2026" }), CFG_DATA).ok, false, "a shape-valid year is not the only requirement");
});

test("O2/AC6: an empty, NaN or negative daily target is rejected client-side", () => {
  const { cec } = loadWrite();
  const base = { year: "2026/2027", currency: "GH\u20b5", source: "live" };
  // Number("") and Number(null) are both 0, which would silently write a zero target.
  for (const target of ["", "   ", null, undefined, "abc", NaN, "-1", -1]) {
    const r = cec.configForm.validate(Object.assign({}, base, { target }), CFG_DATA);
    assert.equal(r.ok, false, JSON.stringify(String(target)) + " is not a usable target");
    assert.match(r.error, /target/i);
  }
  assert.equal(cec.configForm.validate(Object.assign({}, base, { target: "0" }), CFG_DATA).ok, true, "0 stays a legal target");
  assert.equal(cec.configForm.validate(Object.assign({}, base, { target: 60, currency: "" }), CFG_DATA).ok, false, "empty currency is rejected");
  assert.equal(cec.configForm.validate(Object.assign({}, base, { target: 60, currency: "GHS-1234567" }), CFG_DATA).ok, false, "currency over 10 chars is rejected");
  assert.equal(cec.configForm.validate(Object.assign({}, base, { target: 60, source: "bogus" }), CFG_DATA).ok, false, "only live/offline are data sources");
});

test("O7: the data-source flag flips only after a successful save", () => {
  const { cec } = loadWrite();
  const failed = cec.configForm.applyResult({ ok: false, error: "Config tab missing or header mismatch." }, "offline", v => cec.forceOffline = v);
  assert.equal(failed.applied, false);
  assert.equal(failed.error, "Config tab missing or header mismatch.");
  let seen = null;
  cec.configForm.applyResult({ ok: false, error: "boom" }, "offline", v => { seen = v; });
  assert.equal(seen, null, "a failed save never calls the local setter");
  cec.configForm.applyResult({ ok: true }, "offline", v => { seen = v; });
  assert.equal(seen, true, "source offline persists an offline browser");
  cec.configForm.applyResult({ ok: true }, "live", v => { seen = v; });
  assert.equal(seen, false, "source live persists a live browser");
  assert.equal(cec.configForm.applyResult(null, "offline", () => { seen = "called"; }).applied, false);
  assert.equal(seen, false, "a missing result is treated as a failure, not a save");
});

test("the Settings Edit buttons open dlgConfig pre-filled from the config row and forceOffline", async () => {
  const editButtons = [stubEl("edit1"), stubEl("edit2"), stubEl("edit3"), stubEl("edit4")];
  const closeButtons = [stubEl("close1")];
  const { cec, doc } = loadWrite({ editButtons, closeButtons });
  for (const btn of editButtons) assert.equal(btn.hasListener("click"), true, "every Edit button is wired");
  assert.equal(closeButtons[0].hasListener("click"), true, "the modal close control is wired");
  assert.ok(doc.ids.dlgConfig, "#dlgConfig is the registered dialog element");
  const form = doc.ids.dlgConfig;

  editButtons[0].listeners.filter(l => l.type === "click").map(l => l.fn).pop()();
  await flushAsync();
  for (const sel of ["[data-year]", "[data-target]", "[data-currency]", "[data-source]", "[data-error]"]) {
    assert.ok(form.queries.indexOf(sel) !== -1, "dlgConfig binds " + sel);
  }
  assert.equal(form.hasListener("submit"), true, "dlgConfig form submits through the module");
  assert.equal(form.opened, true, "the dialog opens");
  assert.equal(form.children["[data-year]"].value, "2026/2027", "year prefilled from config.activeYear");
  assert.equal(form.children["[data-target]"].value, "60", "target prefilled from config.dailyTarget");
  assert.equal(form.children["[data-currency]"].value, "GH\u20b5");
  assert.equal(form.children["[data-source]"].value, "live", "a live browser prefills the live source");
  cec.forceOffline = true;
  editButtons[0].listeners.filter(l => l.type === "click").map(l => l.fn).pop()();
  await flushAsync();
  assert.equal(form.children["[data-source]"].value, "offline", "an offline browser prefills the offline source");
  assert.equal(form.children["[data-error]"].hidden, true, "a stale inline error is cleared on open");
});

test("submitting dlgConfig validates before POST, then saves and applies the source", async () => {
  const editButtons = [stubEl("edit")];
  const { cec, doc, fetchCalls, flips } = loadWrite({ editButtons });
  const form = doc.ids.dlgConfig;

  await submitConfig(form, { year: "2019/2020", target: "60", currency: "GH\u20b5" });
  assert.equal(fetchCalls.length, 0, "an out-of-set year never reaches the network");
  assert.equal(form.children["[data-error]"].hidden, false);
  assert.match(form.children["[data-error]"].textContent, /2019\/2020/);

  await submitConfig(form, { year: "2026/2027", target: "", currency: "GH\u20b5" });
  assert.equal(fetchCalls.length, 0, "an empty target never reaches the network");
  assert.match(form.children["[data-error]"].textContent, /target/i);

  await submitConfig(form, { year: "2026/2027", target: "70", currency: "GH\u20b5", source: "offline" });
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(JSON.parse(fetchCalls[0].opts.body), { academic_year: "2026/2027", daily_payment_target: 70, currency: "GH\u20b5" });
  assert.equal(form.closed, true, "the modal closes after a good save");
  assert.equal(doc.ids.toast.textContent, "Settings updated.");
  assert.deepEqual(flips, [true], "the offline source is applied only after the write succeeded");
  assert.equal(cec.refreshes, 1, "the Settings cards repaint from the refreshed snapshot");
});

test("O7: a failed config POST shows the error, keeps the modal open and flips nothing locally", async () => {
  const { doc, fetchCalls, flips } = loadWrite({
    fetch: () => ({ ok: false, status: 400, body: { ok: false, error: "Config tab missing or header mismatch." } })
  });
  const form = doc.ids.dlgConfig;
  await submitConfig(form, { year: "2026/2027", target: "70", currency: "GH\u20b5", source: "offline" });
  assert.equal(fetchCalls.length, 1, "the write is attempted");
  assert.equal(form.closed, undefined, "the modal stays open on failure");
  assert.equal(form.children["[data-error]"].hidden, false);
  assert.match(form.children["[data-error]"].textContent, /header mismatch/);
  assert.equal(form.children["[data-submit]"].disabled, false, "the submit button is re-enabled");
  assert.deepEqual(flips, [], "no partial save: the local data source never flipped");
});

test("index.html ships four Settings Edit buttons and a hole-free #dlgConfig", () => {
  const settings = INDEX_HTML.slice(
    INDEX_HTML.indexOf('id="page-settings"'),
    INDEX_HTML.indexOf('id="dlgPayment"')
  );
  assert.notEqual(settings, "", "the Settings page still exists");
  assert.equal((settings.match(/data-edit-config/g) || []).length, 4, "one Edit button per Settings panel");
  assert.equal((settings.match(/class="btn btn-light"/g) || []).length, 4, "the Edit buttons use the shared light button style");
  for (const id of ["settingsYear", "settingsTarget", "settingsCurrency", "settingsStatus"]) {
    assert.ok(settings.indexOf('id="' + id + '"') !== -1, id + " panel is still rendered");
  }
  assert.equal(/data-edit-config[^>]*type="button"/.test(settings) || /type="button"[^>]*data-edit-config/.test(settings), true,
    "the Edit buttons declare type=button so they never submit an outer form");

  const dlgStart = INDEX_HTML.indexOf('<dialog class="modal" id="dlgConfig">');
  assert.notEqual(dlgStart, -1, "#dlgConfig exists");
  assert.ok(dlgStart > INDEX_HTML.indexOf('id="dlgStock"'), "#dlgConfig comes after #dlgStock");
  const dlg = INDEX_HTML.slice(dlgStart, INDEX_HTML.indexOf("</dialog>", dlgStart));
  assert.ok(dlg.indexOf("<h3>System settings</h3>") !== -1, "the modal head is titled");
  assert.ok(dlg.indexOf("data-close") !== -1, "the modal can be closed");
  assert.ok(/<input type="text" data-year/.test(dlg), "[data-year] is a text input");
  assert.ok(/<input type="number" data-target min="0"/.test(dlg), "[data-target] is a non-negative number input");
  assert.ok(/<input type="text" data-currency placeholder="GH\u20b5"/.test(dlg), "[data-currency] is a text input with the GH\u20b5 placeholder");
  assert.ok(/<select data-source>/.test(dlg) && /<option value="live">/.test(dlg) && /<option value="offline">/.test(dlg),
    "[data-source] offers exactly live and offline");
  assert.ok(/data-submit/.test(dlg), "the modal has a submit control");
  assert.ok(/data-error hidden/.test(dlg), "the modal has an inline error slot");
  assert.equal(/required/.test(dlg), false, "no native validation: the dialog's own inline errors are the feedback path");
});

test("createClient.sheetsAddTab posts an addSheet batchUpdate request", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: true, status: 200, body: {} }
  ], calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await client.sheetsAddTab("spr123", "Users");
  const apiCall = calls[1];
  assert.equal(apiCall.opts.method, "POST");
  assert.match(apiCall.url, /spr123:batchUpdate$/);
  assert.equal(apiCall.opts.headers.Authorization, "Bearer tok1");
  assert.deepEqual(JSON.parse(apiCall.opts.body).requests[0], { addSheet: { properties: { title: "Users" } } });
});

test("createClient.sheetsAddTab surfaces API errors", async () => {
  const calls = [];
  const fake = makeFakeFetch([
    { ok: true, status: 200, body: { access_token: "tok1", expires_in: 3600 } },
    { ok: false, status: 403, body: { error: { message: "nope" } } }
  ], calls);
  const client = lib.createClient({ client_id: "cid", client_secret: "cs", refresh_token: "rt" }, fake);
  await assert.rejects(client.sheetsAddTab("spr123", "Users"), /Sheets addTab failed: nope/);
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
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B009","GoldenA","BWP - Creative Arts","Core","95","abc","10"]]
  });
  await assert.rejects(() => lib.runIssue(client, "spr", { student_id: "S001", book_id: "B009", qty: 1 }), /non-numeric/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue issues multiple books via books array and logs one activity row", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","40","10"],["B002","GoldenA","English","Core","78","25","10"]],
    "Activity!A:A": [["activity_id"],["A006"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001", "B002"] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [{ book_id: "B001", stock_qty: 39 }, { book_id: "B002", stock_qty: 24 }]);
  assert.equal(client.calls[0].range, "Books!F2");
  assert.deepEqual(client.calls[0].values, [["39"]]);
  assert.equal(client.calls[1].range, "Books!F3");
  assert.deepEqual(client.calls[1].values, [["24"]]);
  assert.equal(client.calls[2].tab, "Activity");
  assert.match(client.calls[2].rows[0][2], /Books issued to Abena Mensah \[B001,B002\]/);
});

test("runIssue multi-book rejects when any book lacks stock (no writes)", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],
      ["B001","GoldenA","Math","Core","85","0","10"],["B002","GoldenA","English","Core","78","25","10"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001", "B002"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient stock for Math/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue multi-book reports unknown book ids", async () => {
  const client = makeFakeClient({
    "Students!A:J": [["student_id","name","class","gender","academic_year","books_fee","books_paid","books_total","exbooks","status"],["S001","Abena Mensah","BS 1A","female","2026/2027","1200","800","8","2","waiting"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B001","GoldenA","Math","Core","85","40","10"]]
  });
  const r = await lib.runIssue(client, "spr", { student_id: "S001", books: ["B001", "B999"] });
  assert.equal(r.ok, false);
  assert.match(r.error, /book_id not found: B999/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runStock rejects when the stock cell is non-numeric (no writes)", async () => {
  const client = makeFakeClient({
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B009","GoldenA","BWP - Creative Arts","Core","95","1.2.3","10"]]
  });
  await assert.rejects(() => lib.runStock(client, "spr", { book_id: "B009", stockDelta: 1 }), /non-numeric/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runConfig merges provided fields over the current row", async () => {
  const client = makeFakeClient({
    "Config!A:D": [["academic_year","daily_payment_target","currency","last_synced"],["2026/2027","60","GH₵","2026-09-20"]]
  });
  const r = await lib.runConfig(client, "spr", { academicYear: "2025/2026" });
  assert.equal(r.ok, true);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].op, "update");
  assert.equal(client.calls[0].range, "Config!A2:D2");
  assert.deepEqual(client.calls[0].values, [["2025/2026","60","GH₵","2026-09-20"]]);
});

test("runConfig refuses to write when the Config header mismatches or the tab is empty", async () => {
  const expected = { ok: false, error: "Config tab missing or header mismatch." };
  const mismatched = makeFakeClient({
    "Config!A:D": [["year","target","currency","last_synced"],["2026/2027","60","GH₵","2026-09-20"]]
  });
  assert.deepEqual(await lib.runConfig(mismatched, "spr", { academicYear: "2025/2026" }), expected);
  assert.equal(mismatched.calls.length, 0, "no writes happened");
  const empty = makeFakeClient({});
  assert.deepEqual(await lib.runConfig(empty, "spr", { academicYear: "2025/2026" }), expected);
  assert.equal(empty.calls.length, 0, "no writes happened");
});

test("runConfig turns a missing Config tab into a header-mismatch failure without writing", async () => {
  const client = makeFakeClient({});
  client.sheetsGet = async () => { throw new Error("Unable to parse range: Config!A:D"); };
  const r = await lib.runConfig(client, "spr", { academicYear: "2025/2026" });
  assert.equal(r.ok, false);
  assert.match(r.error, /\bConfig tab missing or header mismatch\./);
  assert.equal(client.calls.length, 0, "no writes happened");
});

const vm = require("../js/view-models.js");

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
  { bookId: "B1", subject: "English", category: "KG 1", publisher: "A", stockQty: 20, lowStockThreshold: 5 },
  { bookId: "B2", subject: "Maths", category: "KG 1", publisher: "B", stockQty: 4, lowStockThreshold: 5 },
  { bookId: "B3", subject: "Science", category: "Class 1", publisher: "C", stockQty: 0, lowStockThreshold: 3 }
];

test("viewModels.issuedBookIds parses issue tokens per student", () => {
  const activity = [
    { type: "issue", description: "Books issued to Abena Mensah [B001,B002]" },
    { type: "issue", description: "Books issued to Kwabena Yaw [B003]" },
    { type: "payment", description: "Books issued to Abena Mensah [B999]" },
    { type: "issue", description: "Books issued to Abena Mensah" }
  ];
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Abena Mensah" }), ["B001", "B002"]);
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Kwabena Yaw" }), ["B003"]);
  assert.deepEqual(vm.issuedBookIds(activity, { name: "No One" }), []);
  assert.deepEqual(vm.issuedBookIds([], { name: "Abena Mensah" }), []);
});

test("viewModels.issueEligibleBooks filters by class, price <= paid, stock, and issued", () => {
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 200 };
  const books = [
    { bookId: "B1", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" },
    { bookId: "B2", category: "KG 1", price: 220, stockQty: 5, publisher: "GES" },
    { bookId: "B3", category: "KG 1", price: 70, stockQty: 0, publisher: "GES" },
    { bookId: "B4", category: "KG 2", price: 60, stockQty: 5, publisher: "GES" },
    { bookId: "B5", category: "KG 1", price: 60, stockQty: 5, publisher: "Exercise Book" },
    { bookId: "B6", category: "KG 1", price: 60, stockQty: 5, publisher: "GES" }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B6]" }];
  const got = vm.issueEligibleBooks(books, student, activity);
  assert.deepEqual(got.map(b => b.bookId), ["B1"]);
});

test("viewModels.issueEligibleBooks returns empty for missing class or zero paid", () => {
  const books = [{ bookId: "B1", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" }];
  assert.deepEqual(vm.issueEligibleBooks(books, { className: "", booksPaid: 200 }, []), []);
  assert.deepEqual(vm.issueEligibleBooks(books, { className: "KG 1", booksPaid: 0 }, []), []);
  assert.deepEqual(vm.issueEligibleBooks([], { className: "KG 1", booksPaid: 200 }, []), []);
});

test("viewModels.issuedBookIds strips quantity suffixes from tokens", () => {
  const activity = [
    { type: "issue", description: "Books issued to Abena Mensah [B001,B075x5,B076x3]" },
    { type: "issue", description: "Books issued to Abena Mensah [B077x2]" },
    { type: "payment", description: "Books issued to Abena Mensah [B999]" },
    { type: "issue", description: "Books issued to Kwabena Yaw [B003x4]" }
  ];
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Abena Mensah" }), ["B001", "B075", "B076", "B077"]);
  assert.deepEqual(vm.issuedBookIds(activity, { name: "Kwabena Yaw" }), ["B003"]);
});

test("viewModels.issueEligibleExBooks returns per-size issues with qty and stock", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5, "D1 Small": 5 } }];
  const student = { studentId: "S1", name: "Ama", className: "Nursery 1", exbooks: 10, booksPaid: 25 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 4, price: 2.5 },
    { bookId: "B001", subject: "Math", category: "Nursery 1", publisher: "GES", stockQty: 20, price: 300 }
  ];
  const got = vm.issueEligibleExBooks(books, student, [], classFees);
  assert.deepEqual(got.map(x => ({ id: x.book.bookId, qty: x.qty, stock: x.stock })), [{ id: "B075", qty: 5, stock: 12 }]);
});

test("viewModels.issueEligibleExBooks requires exbooks>0, class match, and hides issued books", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5 } }];
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B076", subject: "Writing Exercise Book", category: "D1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }
  ];
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "Nursery 1", exbooks: 0 }, [], classFees), []);
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "BS 2", exbooks: 10, booksPaid: 12.5 }, [], classFees), []);
  assert.deepEqual(vm.issueEligibleExBooks(books, { className: "Nursery 1", exbooks: 10, booksPaid: 12.5 }, [], []), []);
  const activity = [{ type: "issue", description: "Books issued to Ama [B075x5]" }];
  assert.deepEqual(vm.issueEligibleExBooks(books, { name: "Ama", className: "Nursery 1", exbooks: 10, booksPaid: 12.5 }, activity, classFees), []);
});

test("viewModels.issueEligibleExBooks offers the remaining qty and hides a met requirement", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5 } }];
  const books = [{ bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }];
  const student = { studentId: "S1", name: "Ama", className: "Nursery 1", exbooks: 10, booksPaid: 12.5 };
  const partial = [{ type: "issue", description: "Books issued to Ama [B075x3]" }];
  const got = vm.issueEligibleExBooks(books, student, partial, classFees);
  assert.equal(got.length, 1);
  assert.equal(got[0].qty, 2);
  assert.equal(got[0].required, 5);
  const full = [{ type: "issue", description: "Books issued to Ama [B075x5]" }];
  assert.deepEqual(vm.issueEligibleExBooks(books, student, full, classFees), []);
});

test("viewModels.issueEligibleExBooks matches abbreviated Nursery class labels (N1)", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5 } }];
  const books = [{ bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }];
  const got = vm.issueEligibleExBooks(books, { studentId: "S1", name: "Ama", className: "N1", exbooks: 10, booksPaid: 12.5 }, [], classFees);
  assert.deepEqual(got.map(x => x.book.bookId), ["B075"]);
});

test("viewModels.issueEligibleExBooks spends the paid budget on in-stock sizes whole-type in class order", () => {
  const classFees = [{ className: "Nursery 1", fee: 300, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5, "C Small": 5, "G Small": 5 } }];
  const books = [
    { bookId: "B075", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B078", category: "D1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B077", category: "C Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B079", category: "G Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }
  ];
  const base = { className: "Nursery 1", exbooks: 20 };
  assert.deepEqual(vm.issueEligibleExBooks(books, Object.assign({}, base, { booksPaid: 0 }), [], classFees), []);
  assert.deepEqual(vm.issueEligibleExBooks(books, Object.assign({}, base, { booksPaid: 12.5 }), [], classFees).map(x => x.book.bookId), ["B075"]);
  assert.deepEqual(vm.issueEligibleExBooks(books, Object.assign({}, base, { booksPaid: 25 }), [], classFees).map(x => x.book.bookId), ["B075", "B078"]);
  assert.deepEqual(vm.issueEligibleExBooks(books, Object.assign({}, base, { booksPaid: 50 }), [], classFees).map(x => x.book.bookId), ["B075", "B078", "B077", "B079"]);
});

test("viewModels.issuedBooks sums xN quantities across issue entries", () => {
  const activity = [
    { type: "issue", description: "Books issued to Abena Mensah [B001,B075x5,B076x3]" },
    { type: "issue", description: "Books issued to Abena Mensah [B075x2]" },
    { type: "payment", description: "Books issued to Abena Mensah [B999]" },
    { type: "issue", description: "Books issued to Kwabena Yaw [B003x4]" }
  ];
  assert.deepEqual(vm.issuedBooks(activity, { name: "Abena Mensah" }), { B001: 1, B075: 7, B076: 3 });
  assert.deepEqual(vm.issuedBooks(activity, { name: "Kwabena Yaw" }), { B003: 4 });
  assert.deepEqual(vm.issuedBooks(activity, { name: "No One" }), {});
  assert.deepEqual(vm.issuedBooks([], { name: "Abena Mensah" }), {});
});

test("viewModels.issuedBooks matches student name case-insensitively", () => {
  const activity = [{ type: "issue", description: "Books issued to ABENA MENSAH [B001x2]" }];
  assert.deepEqual(vm.issuedBooks(activity, { name: "abena mensah" }), { B001: 2 });
});

test("viewModels.studentCollection derives mode from books_total and exbooks columns", () => {
  const student = { studentId: "S1", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 0 };
  assert.equal(vm.studentCollection(student, [], [], []).mode, "Textbooks");
  student.booksTotal = 0; student.exbooks = 20;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "ExBooks");
  student.booksTotal = 6;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "Both");
  student.booksTotal = 0; student.exbooks = 0;
  assert.equal(vm.studentCollection(student, [], [], []).mode, "None");
});

test("viewModels.studentCollection collected resolves textbook and exbook items with qty", () => {
  const books = [
    { bookId: "B001", subject: "Literacy", category: "KG 1", publisher: "GES", price: 55, stockQty: 5 },
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", price: 2.5, stockQty: 12 },
    { bookId: "B079", subject: "Writing Exercise Book C", category: "C Small", publisher: "Exercise Book", price: 2.5, stockQty: 10 }
  ];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 20 };
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B001x1,B075x5,B999x2]" }];
  const got = vm.studentCollection(student, books, [], activity);
  assert.deepEqual(got.collected.map(x => ({ id: x.book.bookId, qty: x.qty, kind: x.kind })), [
    { id: "B001", qty: 1, kind: "textbook" },
    { id: "B075", qty: 5, kind: "exbook" }
  ]);
});

test("viewModels.studentCollection remaining keeps every class textbook owed regardless of paid amount or stock", () => {
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 120, booksTotal: 6, exbooks: 0 };
  const books = [
    { bookId: "B1", subject: "Literacy", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" },
    { bookId: "B2", subject: "Numeracy", category: "KG 1", price: 220, stockQty: 5, publisher: "GES" },
    { bookId: "B3", subject: "Colouring", category: "KG 1", price: 70, stockQty: 0, publisher: "GES" },
    { bookId: "B4", subject: "Science", category: "KG 2", price: 60, stockQty: 5, publisher: "GES" },
    { bookId: "B5", subject: "Drawing", category: "KG 1", price: 60, stockQty: 5, publisher: "Exercise Book" }
  ];
  const got = vm.studentCollection(student, books, [], []);
  assert.deepEqual(got.remaining.map(x => x.book.bookId), ["B1", "B2", "B3"]);
});

test("viewModels.studentCollection remaining excludes textbooks already collected", () => {
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 200, booksTotal: 6, exbooks: 0 };
  const books = [
    { bookId: "B1", subject: "Literacy", category: "KG 1", price: 70, stockQty: 5, publisher: "GES" },
    { bookId: "B6", subject: "Creative Arts", category: "KG 1", price: 60, stockQty: 5, publisher: "GES" }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B1]" }];
  const got = vm.studentCollection(student, books, [], activity);
  assert.deepEqual(got.remaining.map(x => x.book.bookId), ["B6"]);
});

test("viewModels.studentCollection remaining subtracts collected exbook quantities per size", () => {
  const classFees = [{ className: "KG 1", fee: 400, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5 } }];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 25, booksTotal: 0, exbooks: 10 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B075x2]" }];
  const got = vm.studentCollection(student, books, classFees, activity);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, stockShort: x.stockShort })), [
    { id: "B075", qty: 3, stockShort: false },
    { id: "B078", qty: 5, stockShort: false }
  ]);
});

test("viewModels.studentCollection remaining drops a met size and flags a stock-short size instead of hiding it", () => {
  const classFees = [{ className: "KG 1", fee: 400, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5, "C Small": 5 } }];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 40, booksTotal: 0, exbooks: 15 };
  const books = [
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 },
    { bookId: "B078", subject: "Writing Exercise Book D1", category: "D1 Small", publisher: "Exercise Book", stockQty: 3, price: 2.5 },
    { bookId: "B077", subject: "Writing Exercise Book C", category: "C Small", publisher: "Exercise Book", stockQty: 12, price: 2.5 }
  ];
  const activity = [{ type: "issue", description: "Books issued to Abena Mensah [B075x5,B078x1]" }];
  const got = vm.studentCollection(student, books, classFees, activity);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, stockShort: x.stockShort })), [
    { id: "B078", qty: 4, stockShort: true },
    { id: "B077", qty: 5, stockShort: false }
  ]);
});

test("viewModels.studentCollection real Nursery 2 sheet: students owed books still see them even with empty/zero stock", () => {
  const classFees = [{ className: "Nursery 2", fee: 300, exbooks: 20, sizes: { "A1 Small": 5, "D1 Small": 5, "C Small": 5, "G Small": 5 } }];
  const books = [
    { bookId: "10", subject: "Literacy", category: "Nursery 2", publisher: "Golden Publication", price: 35, stockQty: 0 },
    { bookId: "11", subject: "Numeracy", category: "Nursery 2", publisher: "Goodman Series", price: 55, stockQty: 0 },
    { bookId: "12", subject: "Colouring", category: "Nursery 2", publisher: "Excellence Publication", price: 45, stockQty: 0 },
    { bookId: "13", subject: "Pre-Writing Activities", category: "Nursery 2", publisher: "Goodman Series", price: 45, stockQty: 0 },
    { bookId: "14", subject: "Phonics", category: "Nursery 2", publisher: "Excellence Publication", price: 45, stockQty: 0 },
    { bookId: "75", subject: "Writing Lines", category: "A1 Small", publisher: "Exercise Book", price: 2.5, stockQty: 0 },
    { bookId: "76", subject: "Maths Boxes", category: "D1 Small", publisher: "Exercise Book", price: 2.5, stockQty: 0 },
    { bookId: "77", subject: "Normal Writing", category: "C Small", publisher: "Exercise Book", price: 2.5, stockQty: 0 },
    { bookId: "78", subject: "Drawing", category: "G Small", publisher: "Exercise Book", price: 2.5, stockQty: 0 }
  ];
  const base = { name: "Unused", className: "Nursery 2", booksTotal: 5, exbooks: 20, status: "waiting" };

  const shape = xs => ({
    exbooks: xs.filter(x => x.kind === "exbook").map(x => ({ id: x.book.bookId, qty: x.qty, stockShort: x.stockShort })),
    textbooks: xs.filter(x => x.kind === "textbook").map(x => ({ id: x.book.bookId, qty: x.qty }))
  });

  const richmond = Object.assign({}, base, { studentId: "S001", name: "Richmond Mensah", booksPaid: 300 });
  const rGot = vm.studentCollection(richmond, books, classFees, []);
  assert.deepEqual(shape(rGot.remaining), {
    exbooks: [
      { id: "75", qty: 5, stockShort: true },
      { id: "76", qty: 5, stockShort: true },
      { id: "77", qty: 5, stockShort: true },
      { id: "78", qty: 5, stockShort: true }
    ],
    textbooks: [
      { id: "10", qty: 1 },
      { id: "11", qty: 1 },
      { id: "12", qty: 1 },
      { id: "13", qty: 1 },
      { id: "14", qty: 1 }
    ]
  });
  assert.ok(rGot.remaining.length > 0, "a fully paid student is never 'All collected' while books remain owed");

  const andrew = Object.assign({}, base, { studentId: "S002", name: "Andrew Donkor", booksPaid: 250 });
  const activity = [{ type: "issue", description: "Books issued to Andrew Donkor [14,75x5,76x5]" }];
  const aGot = vm.studentCollection(andrew, books, classFees, activity);
  assert.deepEqual(shape(aGot.remaining), {
    exbooks: [
      { id: "77", qty: 5, stockShort: true },
      { id: "78", qty: 5, stockShort: true }
    ],
    textbooks: [
      { id: "10", qty: 1 },
      { id: "11", qty: 1 },
      { id: "12", qty: 1 },
      { id: "13", qty: 1 }
    ]
  });
  assert.ok(aGot.remaining.length > 0, "a partially collected student is never 'All collected' while books remain owed");
});

test("viewModels.studentCollection remaining lists the exbook size and class textbooks without any paid gate", () => {
  const classFees = [{ className: "KG 1", fee: 400, exbooks: 20, sizes: { "A1 Small": 5 } }];
  const student = { studentId: "S1", name: "Abena Mensah", className: "KG 1", booksPaid: 0, booksTotal: 6, exbooks: 20 };
  const books = [
    { bookId: "B001", subject: "Literacy", category: "KG 1", publisher: "GES", price: 70, stockQty: 5 },
    { bookId: "B075", subject: "Writing Exercise Book A1", category: "A1 Small", publisher: "Exercise Book", price: 2.5, stockQty: 12 }
  ];
  const got = vm.studentCollection(student, books, classFees, []);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, kind: x.kind })), [
    { id: "B075", qty: 5, kind: "exbook" },
    { id: "B001", qty: 1, kind: "textbook" }
  ]);
});

test("viewModels.studentCollection real BS 1 sheet: a student issued more than they paid still sees the missing textbook", () => {
  const classFees = [{ className: "BS 1", fee: 550, exbooks: 15, sizes: { "Exercise Book": 15 } }];
  const books = [
    { bookId: "27", subject: "English", category: "BS 1", publisher: "Golden Publication", price: 70, stockQty: 0 },
    { bookId: "28", subject: "Mathematics", category: "BS 1", publisher: "Excellence Publication", price: 60, stockQty: 0 },
    { bookId: "29", subject: "Science", category: "BS 1", publisher: "Excellence Publication", price: 60, stockQty: 0 },
    { bookId: "30", subject: "Computing", category: "BS 1", publisher: "EBS Publication", price: 60, stockQty: 0 },
    { bookId: "31", subject: "R. M. E", category: "BS 1", publisher: "Excellence Publication", price: 50, stockQty: 0 },
    { bookId: "32", subject: "Twi", category: "BS 1", publisher: "Excellence Publication", price: 50, stockQty: 0 },
    { bookId: "33", subject: "History", category: "BS 1", publisher: "Excellence Publication", price: 50, stockQty: 0 },
    { bookId: "34", subject: "Creative Arts", category: "BS 1", publisher: "Excellence Publication", price: 60, stockQty: 0 },
    { bookId: "81", subject: "Normal Ex. Book", category: "Exercise Book", publisher: "Exercise Book", price: 3, stockQty: 0 }
  ];
  const student = { studentId: "S009", name: "Samuel Sefa Antwi", className: "BS 1", booksPaid: 250, booksTotal: 8, exbooks: 15, status: "waiting" };
  const activity = [
    { type: "issue", description: "Books issued to Samuel Sefa Antwi [27,28,29,31,32,33,34,81x15]" }
  ];
  const got = vm.studentCollection(student, books, classFees, activity);
  assert.deepEqual(got.remaining.map(x => ({ id: x.book.bookId, qty: x.qty, kind: x.kind })), [
    { id: "30", qty: 1, kind: "textbook" }
  ]);
  assert.ok(got.remaining.length > 0, "a student with books still owed is never 'All collected' even after being issued more than they have paid");
});

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
  assert.deepEqual(inv.rows.map(r => r.category), ["KG 1", "KG 1", "Class 1"]);
});

test("viewModels.bookCategories returns sorted distinct categories", () => {
  const books = [
    { category: "KG 1" },
    { category: "BS 2" },
    { category: "KG 1" },
    { category: "" }
  ];
  assert.deepEqual(vm.bookCategories(books), ["BS 2", "KG 1"]);
});

test("viewModels.bookCategories returns empty for no books", () => {
  assert.deepEqual(vm.bookCategories([]), []);
  assert.deepEqual(vm.bookCategories(null), []);
});

test("viewModels.bookCountForClass counts books in a category", () => {
  const books = [
    { category: "KG 1" },
    { category: "KG 1" },
    { category: "BS 2" }
  ];
  assert.equal(vm.bookCountForClass(books, "KG 1"), 2);
  assert.equal(vm.bookCountForClass(books, "BS 2"), 1);
});

test("viewModels.bookCountForClass matches tolerantly (KG1 vs KG 1)", () => {
  const books = [{ category: "KG 1" }, { category: "BS 2" }];
  assert.equal(vm.bookCountForClass(books, "KG1"), 1);
  assert.equal(vm.bookCountForClass(books, "kg 1"), 1);
  assert.equal(vm.bookCountForClass(books, "BS2"), 1);
});

test("viewModels.bookCountForClass returns 0 for unknown/empty class", () => {
  const books = [{ category: "KG 1" }];
  assert.equal(vm.bookCountForClass(books, "JS 1"), 0);
  assert.equal(vm.bookCountForClass(books, ""), 0);
  assert.equal(vm.bookCountForClass([], "KG 1"), 0);
});

test("viewModels.classBookInfo returns textbook count, fee, and exbooks", () => {
  const books = [
    { category: "KG 1" },
    { category: "KG 1" },
    { category: "BS 2" }
  ];
  const fees = [
    { className: "KG 1", fee: 400, exbooks: 20 },
    { className: "BS 2", fee: 430, exbooks: 15 }
  ];
  assert.deepEqual(vm.classBookInfo(books, "KG 1", fees), { count: 2, fee: 400, exbooks: 20 });
  assert.deepEqual(vm.classBookInfo(books, "BS 2", fees), { count: 1, fee: 430, exbooks: 15 });
});

test("viewModels.classBookInfo matches fees tolerantly (KG1 vs KG 1)", () => {
  const books = [{ category: "KG 1" }, { category: "BS 2" }];
  const fees = [{ className: "KG 1", fee: 400, exbooks: 20 }, { className: "BS 2", fee: 430 }];
  assert.deepEqual(vm.classBookInfo(books, "KG1", fees), { count: 1, fee: 400, exbooks: 20 });
  assert.deepEqual(vm.classBookInfo(books, "bs 2", fees), { count: 1, fee: 430, exbooks: 0 });
});

test("viewModels.classBookInfo fee fallback when no fee row", () => {
  const books = [{ category: "KG 1" }];
  assert.deepEqual(vm.classBookInfo(books, "KG 1", []), { count: 1, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo(books, "KG 1"), { count: 1, fee: 0, exbooks: 0 });
});

test("viewModels.classBookInfo returns zeroed info for unknown/empty", () => {
  const books = [{ category: "KG 1" }];
  const fees = [{ className: "KG 1", fee: 400, exbooks: 20 }];
  assert.deepEqual(vm.classBookInfo(books, "JS 1", fees), { count: 0, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo(books, "", fees), { count: 0, fee: 0, exbooks: 0 });
  assert.deepEqual(vm.classBookInfo([], "KG 1", [{ className: "BS 1", fee: 420, exbooks: 15 }]), { count: 0, fee: 0, exbooks: 0 });
});

test("viewModels.classOptionLabel renders textbook count and fee inline", () => {
  const books = [{ category: "KG 1" }, { category: "KG 1" }];
  const fees = [{ className: "KG 1", fee: 400 }];
  assert.equal(vm.classOptionLabel("KG 1", books, fees), "KG 1 \u2014 2 textbooks \u2014 400 GHS");
  assert.equal(vm.classOptionLabel("KG 1", [{ category: "KG 1" }], fees), "KG 1 \u2014 1 textbook \u2014 400 GHS");
});

test("viewModels.classOptionLabel degrades gracefully", () => {
  assert.equal(vm.classOptionLabel("BS 9", [], []), "BS 9");
  assert.equal(vm.classOptionLabel("", [], []), "");
});

test("viewModels.isExerciseBook classifies by publisher", () => {
  assert.equal(vm.isExerciseBook({ publisher: "Exercise Book" }), true);
  assert.equal(vm.isExerciseBook({ publisher: "GES Press" }), false);
  assert.equal(vm.isExerciseBook({}), false);
  assert.equal(vm.isExerciseBook(null), false);
});

test("viewModels.bookCategories excludes exercise-book categories", () => {
  const books = [
    { category: "KG 1", publisher: "GES Press" },
    { category: "BS 2", publisher: "GES Press" },
    { category: "A1 Small", publisher: "Exercise Book" }
  ];
  assert.deepEqual(vm.bookCategories(books), ["BS 2", "KG 1"]);
});

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

test("viewModels.bookCountForClass counts textbooks only", () => {
  const books = [
    { category: "KG 1", publisher: "GES Press" },
    { category: "KG 1", publisher: "GES Press" },
    { category: "A1 Small", publisher: "Exercise Book" }
  ];
  assert.equal(vm.bookCountForClass(books, "KG 1"), 2);
});

test("derive.normalizeClassFees reads class/fee/exbooks columns", () => {
  const rows = [
    { class: "KG 1", fee: "400", exbooks: "20" },
    { class: "BS 2", fee: "430", exbooks: "15" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} },
    { className: "BS 2", fee: 430, exbooks: 15, sizes: {} }
  ]);
});

test("derive.normalizeClassFees defaults exbooks to zero", () => {
  const rows = [
    { class: "KG 1", fee: "400" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 0, sizes: {} }
  ]);
});

test("derive.normalizeClassFees drops rows with empty fee", () => {
  const rows = [
    { class: "Nursery 1", fee: "" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} }
  ]);
});

test("derive.normalizeClassFees rejects foreign rows (e.g. student sheet)", () => {
  const rows = [
    { class: "N2", fee: "300", student_id: "S001", name: "Richmond" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20, sizes: {} }
  ]);
});

test("derive.normalizeClassFees reads per-size exercise counts into sizes", () => {
  const rows = [
    { class: "Nursery 1", fee: "300", exbooks: "10", "A1 Small": "5", "D1 Small": "5" },
    { class: "BS 1", fee: "450", exbooks: "15", "Exercise Book": "15" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "A1 Small": 5, "D1 Small": 5 } },
    { className: "BS 1", fee: 450, exbooks: 15, sizes: { "Exercise Book": 15 } }
  ]);
});

test("derive.normalizeClassFees ignores non-positive size cells", () => {
  const rows = [
    { class: "Nursery 1", fee: "300", exbooks: "10", "A1 Small": "0", "D1 Small": "-2", "C Small": "3" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "Nursery 1", fee: 300, exbooks: 10, sizes: { "C Small": 3 } }
  ]);
});

test("viewModels.classifyMethod maps method strings", () => {
  assert.equal(vm.classifyMethod("MTN MoMo"), "momo");
  assert.equal(vm.classifyMethod("Mtn"), "momo");
  assert.equal(vm.classifyMethod("MTN"), "momo");
  assert.equal(vm.classifyMethod("Telecel"), "telecel");
  assert.equal(vm.classifyMethod("Cash"), "cash");
  assert.equal(vm.classifyMethod(""), "cash");
});

test("viewModels.methodLabel maps raw entries to canonical names", () => {
  assert.equal(vm.methodLabel("Mtn"), "MTN MoMo");
  assert.equal(vm.methodLabel("MTN"), "MTN MoMo");
  assert.equal(vm.methodLabel("MTN MoMo"), "MTN MoMo");
  assert.equal(vm.methodLabel("mtn momo"), "MTN MoMo");
  assert.equal(vm.methodLabel("Telecel"), "Telecel");
  assert.equal(vm.methodLabel("Cash"), "Cash");
  assert.equal(vm.methodLabel(" Cash "), "Cash");
  assert.equal(vm.methodLabel(""), "");
});

test("viewModels.studentOutstanding is never negative", () => {
  assert.equal(vm.studentOutstanding({ booksTotal: 1200, booksPaid: 500 }), 700);
  assert.equal(vm.studentOutstanding({ booksTotal: 1200, booksPaid: 1400 }), 0);
  assert.equal(vm.studentOutstanding({ booksTotal: undefined, booksPaid: 0 }), 0);
});

test("viewModels.studentOutstanding uses booksFee when booksTotal is a book count", () => {
  assert.equal(vm.studentOutstanding({ booksFee: 1200, booksTotal: 8, booksPaid: 800 }), 400);
  assert.equal(vm.studentOutstanding({ booksFee: 1200, booksTotal: 8, booksPaid: 1400 }), 0);
  assert.equal(vm.studentOutstanding({ booksFee: 0, booksTotal: 700, booksPaid: 500 }), 200);
});

test("viewModels.outstandingList filters and sorts desc", () => {
  assert.deepEqual(vm.outstandingList(FIXTURE_STUDENTS).map(r => r.studentId), ["S3", "S2"]);
  assert.deepEqual(
    vm.outstandingList(FIXTURE_STUDENTS).map(r => r.balance),
    [1400, 700]
  );
});

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

test("viewModels.filterYear keeps the issued passthrough", () => {
  const data = makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS);
  data.issued = [{ studentId: "26-1", bookId: "B1", qty: 1 }];
  const out = vm.filterYear(data, "2025/2026");
  assert.equal(out.issued.length, 1);
  assert.equal(out.issued[0].bookId, "B1");
});

test("viewModels.filterYear attaches academicYear to each filtered payment", () => {
  const out = vm.filterYear(makeDataset(YEAR_STUDENTS, YEAR_PAYMENTS), "2026/2027");
  const p = out.payments.find(x => x.paymentId === "P1");
  assert.equal(p.academicYear, "2026/2027");
});

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
  assert.equal(r.payments.length, 1);
  assert.equal(r.payments[0].paymentId, "P001");
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

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function notificationFixture() {
  const today = todayStr();
  return vm.filterYear({
    students: [
      { studentId: "S1", name: "Ama", className: "JS 1", academicYear: "2026/2027", status: "ready" },
      { studentId: "S2", name: "Kofi", className: "JS 1", academicYear: "2026/2027", status: "waiting" },
      { studentId: "S3", name: "Efua", className: "BS 2", academicYear: "2026/2027", status: "waiting" }
    ],
    payments: [
      { paymentId: "P1", studentId: "S1", amount: 500, date: today, method: "Cash", status: "confirmed" }
    ],
    activity: [
      { activityId: "A1", type: "payment", description: "Payment received from Ama", amount: 500, createdAt: today }
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

test("viewModels.purchasePayload posts fee and total in textbook mode, zeroes exbooks", () => {
  const p = vm.purchasePayload("textbook", { fee: "120", total: "5", exbooks: "2" });
  assert.equal(p.fee, 120);
  assert.equal(p.total, 5);
  assert.equal(p.exbooks, 0);
});

test("viewModels.purchasePayload zeroes fee and total in exbooks mode, keeps exbooks", () => {
  const p = vm.purchasePayload("exbooks", { fee: "120", total: "5", exbooks: "2" });
  assert.equal(p.fee, 0);
  assert.equal(p.total, 0);
  assert.equal(p.exbooks, 2);
});

test("viewModels.purchasePayload passes all values through in both mode", () => {
  const p = vm.purchasePayload("both", { fee: 120, total: 5, exbooks: 2 });
  assert.deepEqual(p, { fee: 120, total: 5, exbooks: 2 });
});

test("viewModels.purchasePayload treats an unknown mode like both", () => {
  const p = vm.purchasePayload("unknown", { fee: 120, total: 5, exbooks: 2 });
  assert.deepEqual(p, { fee: 120, total: 5, exbooks: 2 });
});

test("viewModels.purchasePayload defaults missing values to zero", () => {
  const p = vm.purchasePayload("both", {});
  assert.deepEqual(p, { fee: 0, total: 0, exbooks: 0 });
});

test("xlsx.toCSV writes header and rows with trailing newline", () => {
  assert.equal(xlsx.toCSV([["Day", "Total"], ["Mon", 100]]), 'Day,Total\nMon,100\n');
  assert.equal(xlsx.toCSV([["A"]]), 'A\n');
});

test("xlsx.toCSV quotes fields with commas quotes and newlines", () => {
  const out = xlsx.toCSV([
    ["name", "note"],
    ["Owusu, Emma", 'say "hi"'],
    ["multi", "line1\nline2"]
  ]);
  assert.equal(out, 'name,note\n"Owusu, Emma","say ""hi"""\nmulti,"line1\nline2"\n');
});

test("xlsx.toCSV empty or null input returns empty string", () => {
  assert.equal(xlsx.toCSV([]), "");
  assert.equal(xlsx.toCSV(null), "");
  assert.equal(xlsx.toCSV(undefined), "");
});

test("xlsx.toXLSX produces a stored ZIP with required OOXML parts", () => {
  const out = xlsx.toXLSX([["Day", "Total"], ["Mon", 100]]);
  const buf = Buffer.from(out);
  assert.ok(buf.slice(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "zip local header magic PK\\x03\\x04");
  assert.ok(buf.includes(Buffer.from("[Content_Types].xml", "ascii")), "[Content_Types].xml part present");
  assert.ok(buf.includes(Buffer.from("xl/workbook.xml", "ascii")), "workbook part present");
  assert.ok(buf.includes(Buffer.from("xl/worksheets/sheet1.xml", "ascii")), "sheet part present");
});

test("xlsx.toXLSX embeds values as inline strings and numbers", () => {
  const out = xlsx.toXLSX([["Day", "Total"], ["Mon", 100]]);
  const text = Buffer.from(out).toString("utf8");
  assert.ok(text.indexOf("<v>100</v>") !== -1, "numeric cell <v>100</v>");
  assert.ok(text.indexOf("<is><t>Day</t></is>") !== -1, "inline string cell");
  assert.ok(text.indexOf('t="inlineStr"') !== -1, "inlineStr type used for strings");
});

test("viewModels.exportCollectionOverview reports 7 day rows with method buckets", () => {
  const today = todayISO();
  const got = vm.exportCollectionOverview([
    { date: today, amount: 100, method: "Cash" },
    { date: today, amount: 200, method: "MTN MoMo" },
    { date: today, amount: 50, method: "Telecel" }
  ]);
  assert.deepEqual(got.headers, ["Day", "Cash", "Mobile Money", "Telecel", "Total"]);
  assert.equal(got.rows.length, 7);
  assert.deepEqual(got.rows[6].slice(1), [100, 200, 50, 350]);
  assert.equal(got.rows[6][0], new Date().toLocaleDateString("en-US", { weekday: "short" }));
});

test("viewModels.exportCollectionOverview empty payments yields zero buckets", () => {
  const got = vm.exportCollectionOverview([]);
  assert.equal(got.rows.length, 7);
  assert.deepEqual(got.rows[3].slice(1), [0, 0, 0, 0]);
});

test("viewModels.exportPayments sorts newest first and canonicalizes method", () => {
  const got = vm.exportPayments([
    { paymentId: "P1", studentName: "Ama", className: "JS 1", amount: 1000, method: "cash", date: "2026-09-20", status: "Recorded" },
    { paymentId: "P2", studentName: "Kojo", className: "BS 2", amount: 2000, method: "MTN MoMo", date: "2026-09-21", status: "Recorded" }
  ]);
  assert.deepEqual(got.headers, ["Ref", "Student", "Class", "Amount", "Method", "Date", "Status"]);
  assert.equal(got.rows[0][0], "P2");
  assert.equal(got.rows[0][4], "MTN MoMo");
  assert.equal(got.rows[1][0], "P1");
  assert.equal(got.rows[1][4], "Cash");
  assert.equal(got.rows[1][6], "Recorded");
});

test("viewModels.exportStudents lists paid and outstanding amounts", () => {
  const got = vm.exportStudents(FIXTURE_STUDENTS);
  assert.deepEqual(got.headers, ["ID", "Name", "Class", "Gender", "Fee", "Paid", "Outstanding", "Status"]);
  assert.equal(got.rows.length, 3);
  assert.equal(got.rows[1][6], 700);   // Kwame: 1200 - 500
  assert.equal(got.rows[2][6], 1400);  // Efua: 1400 - 0
  assert.equal(got.rows[0][4], 1200);  // Fee from booksTotal when booksFee absent
});

test("viewModels.exportIssued expands collected books with qty and kind", () => {
  const students = [{ studentId: "S1", name: "Ama", className: "JS 1", booksTotal: 1200, booksPaid: 1200, exbooks: 0 }];
  const books = [
    { bookId: "B1", subject: "Maths", category: "JS 1", publisher: "A", price: 100, stockQty: 5, lowStockThreshold: 1 },
    { bookId: "B2", subject: "English", category: "JS 1", publisher: "B", price: 100, stockQty: 5, lowStockThreshold: 1 }
  ];
  const activity = [{ type: "issue", description: "Books issued to Ama [B1,B2x2]" }];
  const got = vm.exportIssued(students, books, [], activity);
  assert.deepEqual(got.headers, ["Student ID", "Name", "Class", "Mode", "Book ID", "Title", "Category", "Qty", "Kind"]);
  assert.equal(got.rows.length, 2);
  assert.deepEqual(got.rows[0].slice(0, 4), ["S1", "Ama", "JS 1", "Textbooks"]);
  assert.deepEqual(got.rows[0].slice(4), ["B1", "Maths", "JS 1", 1, "textbook"]);
  assert.deepEqual(got.rows[1].slice(4), ["B2", "English", "JS 1", 2, "textbook"]);
});

test("viewModels.exportIssued empty activity yields no rows", () => {
  const got = vm.exportIssued(FIXTURE_STUDENTS, FIXTURE_BOOKS, [], []);
  assert.equal(got.rows.length, 0);
});

test("viewModels.exportStock exports stock rows with price and status", () => {
  const got = vm.exportStock(FIXTURE_BOOKS);
  assert.deepEqual(got.headers, ["Book ID", "Title", "Publisher", "Category", "Price", "In Stock", "Threshold", "Status"]);
  assert.equal(got.rows.length, 3);
  assert.deepEqual(got.rows[0], ["B1", "English", "A", "KG 1", 0, 20, 5, "OK"]);
  assert.deepEqual(got.rows[2], ["B3", "Science", "C", "Class 1", 0, 0, 3, "Out"]);
});

test("viewModels.exportReports emits method, class and outstanding sections", () => {
  const got = vm.exportReports(FIXTURE_PAYMENTS, FIXTURE_STUDENTS);
  assert.equal(got.headers[0], "Report");
  assert.ok(got.rows.some(r => r[0] === "Cash" && r[1] === 1500));
  assert.ok(got.rows.some(r => r[0] === "MTN MoMo" && r[1] === 2000));
  assert.ok(got.rows.some(r => r[0] === "JS 1" && r[1] === 3500));
  assert.ok(got.rows.some(r => r[0] && r[0].indexOf("Kwame") !== -1 && r[1] === 700));
});

test("derive.normalizeIssued maps rows to issued records", () => {
  const rows = [
    { issue_id: "I001", student_id: "S001", book_id: "B003", qty: "2", date: "2026-09-23" },
    { issue_id: "I002", student_id: "S001", book_id: "B075", qty: "5", date: "2026-09-23" },
    { issue_id: "I003", student_id: "S002", book_id: "B001", qty: "1", date: "2026-09-24" }
  ];
  const issued = derive.normalizeIssued(rows);
  assert.deepEqual(issued[0], { issueId: "I001", studentId: "S001", bookId: "B003", qty: 2, date: "2026-09-23" });
  assert.equal(issued[1].qty, 5);
});

test("derive.issuedSummary aggregates by student and by book", () => {
  const issued = derive.normalizeIssued([
    { issue_id: "I001", student_id: "S001", book_id: "B003", qty: "2", date: "2026-09-23" },
    { issue_id: "I002", student_id: "S001", book_id: "B075", qty: "5", date: "2026-09-23" },
    { issue_id: "I003", student_id: "S002", book_id: "B001", qty: "1", date: "2026-09-24" }
  ]);
  const s = derive.issuedSummary(issued);
  assert.deepEqual(s.byStudent.S001, { books: 2, qty: 7 });
  assert.deepEqual(s.byStudent.S002, { books: 1, qty: 1 });
  assert.deepEqual(s.byBook, { B003: 2, B075: 5, B001: 1 });
});

test("derive.issuedSummary tolerates empty and unknown rows", () => {
  const s = derive.issuedSummary([]);
  assert.deepEqual(s, { byStudent: {}, byBook: {} });
  const s2 = derive.issuedSummary(derive.normalizeIssued([{ qty: "3" }]));
  assert.deepEqual(s2, { byStudent: {}, byBook: {} });
});

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
  assert.equal(session.can("teacher", "payments"), false);
  assert.equal(session.can("teacher", "students"), true);
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

const watchdog = setTimeout(() => {
  console.error("suite timed out with " + inflight.length + " tests not settled");
  process.exit(1);
}, 60000);
Promise.allSettled(inflight).then(() => {
  clearTimeout(watchdog);
  console.log(pass + " tests passed");
});
