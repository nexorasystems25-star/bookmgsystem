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

test("deriveDashboard computes core stats", () => {
  const derive = require("../js/derive.js");
  const input = {
    students: [
      { books_paid: "50", books_total: "50" },
      { books_paid: "40", books_total: "40" },
      { books_paid: "0", books_total: "45" },
      { books_paid: "20", books_total: "80" }
    ],
    payments: [
      { amount: "100.00", method: "Cash", date: "2026-09-01" },
      { amount: "50.50", method: "Cash", date: "2026-09-01" },
      { amount: "30.00", method: "MTN MoMo", date: "2026-09-02" }
    ],
    books: [
      { book_id: "B1", price: "10", stock_qty: "20", low_stock_threshold: "5" },
      { book_id: "B2", price: "40", stock_qty: "3", low_stock_threshold: "5" }
    ],
    activity: [
      { type: "payment", description: "fees", amount: "50", created_at: "2026-09-01" }
    ],
    config: { daily_payment_target: "200" }
  };
  const d = derive.deriveDashboard(input);
  assert.equal(d.totalStudents, 4);
  assert.equal(d.studentsReady, 2);
  assert.equal(d.studentsWaiting, 1);
  assert.equal(d.studentsUncovered, 1);
  assert.equal(d.totalCollected, 180.5);
  assert.equal(d.collectionsCount, 3);
  assert.equal(d.avgPerDay, 90.25);
  assert.equal(d.methodBreakdown.Cash, 150.5);
  assert.equal(d.methodBreakdown["MTN MoMo"], 30);
  assert.equal(d.uniquePayers, 1);
  assert.equal(d.activityLogged[0].type, "payment");
  assert.equal(d.lowStock.length, 1);
  assert.equal(d.lowStock[0].book_id, "B2");
  assert.equal(d.coverage, (2 / 4) * 100);
  assert.equal(d.dailyTarget, 200);
  assert.equal(d.daysToTarget, 1);
  assert.equal(d.expectedByNow, 0);
});

test("deriveDashboard handles empty collections daily breakdown", () => {
  const derive = require("../js/derive.js");
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const inMonth = `${year}-${month}-05`;
  const input = {
    students: [{ books_paid: "0", books_total: "50" }],
    payments: [{ amount: "100", method: "Cash", date: inMonth }],
    books: [],
    activity: [],
    config: { daily_payment_target: "100" }
  };
  const d = derive.deriveDashboard(input);
  assert.equal(d.totalCollected, 100);
  assert.equal(typeof d.daily, "object");
  assert.equal(d.dailyByDay[inMonth], 100);
  const otherDay = `${year}-${month}-01`;
  if (otherDay !== inMonth) assert.equal(d.dailyByDay[otherDay] || 0, 0);
});

console.log(pass + " tests passed");
