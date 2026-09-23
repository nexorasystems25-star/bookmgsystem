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

test("client contract: write.js sends snake_case payloads (camelCase rejected)", () => {
  assert.equal(lib.validatePaymentPayload({ student_id: "S001", amount: "5", method: "Cash" }).ok, true);
  assert.equal(lib.validatePaymentPayload({ studentId: "S001", amount: "5", method: "Cash" }).ok, false);
  assert.equal(lib.validateStudentPayload({ name: "Ama Serwaa", class: "JS 1", gender: "female", books_fee: "1400", books_total: "10" }).ok, true);
  assert.equal(lib.validateStudentPayload({ name: "Ama Serwaa", className: "JS 1", gender: "female", booksFee: "1400", booksTotal: "10" }).ok, false);
  assert.equal(lib.validateIssuePayload({ student_id: "S001", book_id: "B001", qty: 2 }).ok, true);
  assert.equal(lib.validateIssuePayload({ studentId: "S001", bookId: "B001", qty: 2 }).ok, false);
  assert.equal(lib.validateStockPayload({ book_id: "B001", stock_delta: 20 }).ok, true);
  assert.equal(lib.validateStockPayload({ bookId: "B001", stockDelta: 20 }).ok, false);
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

console.log(pass + " tests passed");
