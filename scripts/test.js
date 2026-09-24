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
  assert.deepEqual(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "B002"] }).payload, { student_id: "S001", books: ["B001", "B002"] });
  assert.deepEqual(lib.validateIssuePayload({ student_id: "S001", books: ["B001", "  ", "B001"] }).payload.books, ["B001"]);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: [] }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", books: "B001" }).ok, false);
  assert.equal(lib.validateIssuePayload({ books: ["B001"] }).ok, false);
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
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
    "Books!A:I": [["book_id","publisher","subject","category","price","stock_qty","low_stock_threshold"],["B009","GoldenA","BWP - Creative Arts","Core","95","abc","10"]]
  });
  await assert.rejects(() => lib.runIssue(client, "spr", { student_id: "S001", book_id: "B009", qty: 1 }), /non-numeric/);
  assert.equal(client.calls.length, 0, "no writes happened");
});

test("runIssue issues multiple books via books array and logs one activity row", async () => {
  const client = makeFakeClient({
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
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
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
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
    "Students!A:B": [["student_id","name"],["S001","Abena Mensah"]],
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
  { bookId: "B1", subject: "English", publisher: "A", stockQty: 20, lowStockThreshold: 5 },
  { bookId: "B2", subject: "Maths", publisher: "B", stockQty: 4, lowStockThreshold: 5 },
  { bookId: "B3", subject: "Science", publisher: "C", stockQty: 0, lowStockThreshold: 3 }
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
    { className: "KG 1", fee: 400, exbooks: 20 },
    { className: "BS 2", fee: 430, exbooks: 15 }
  ]);
});

test("derive.normalizeClassFees defaults exbooks to zero", () => {
  const rows = [
    { class: "KG 1", fee: "400" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 0 }
  ]);
});

test("derive.normalizeClassFees drops rows with empty fee", () => {
  const rows = [
    { class: "Nursery 1", fee: "" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20 }
  ]);
});

test("derive.normalizeClassFees rejects foreign rows (e.g. student sheet)", () => {
  const rows = [
    { class: "N2", fee: "300", student_id: "S001", name: "Richmond" },
    { class: "KG 1", fee: "400", exbooks: "20" }
  ];
  assert.deepEqual(derive.normalizeClassFees(rows), [
    { className: "KG 1", fee: 400, exbooks: 20 }
  ]);
});

test("viewModels.classifyMethod maps method strings", () => {
  assert.equal(vm.classifyMethod("MTN MoMo"), "momo");
  assert.equal(vm.classifyMethod("Telecel"), "telecel");
  assert.equal(vm.classifyMethod("Cash"), "cash");
  assert.equal(vm.classifyMethod(""), "cash");
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

console.log(pass + " tests passed");
