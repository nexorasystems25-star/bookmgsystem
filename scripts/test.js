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

console.log(pass + " tests passed");
