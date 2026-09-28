# Export Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every "Export report" button functional and add CSV + Excel (.xlsx) downloads for students' paid amounts, issued books, and current book stock — all dependency-free (offline-capable).

**Architecture:** Pure, Node-testable serializers (`js/xlsx.js`) and row builders (`js/view-models.js`) feed a shared `array-of-arrays` row contract. `js/app.js` owns browser-only concerns: a per-page format menu (CSV/Excel), `Blob` download, toast feedback. Buttons are marked with `data-export="<page>"` attributes in `index.html`.

**Tech Stack:** Vanilla JS (no libraries, no CDN), UMD modules (`CEC.*` in browser, `module.exports` in Node), sync-only test runner (`scripts/test.js`), hand-rolled ZIP (stored, uncompressed entries) + minimal OOXML parts for `.xlsx`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `js/xlsx.js` | `toCSV(rows)` and `toXLSX(rows)` (UMD: `CEC.xlsx` / `module.exports`) | **Create** |
| `js/view-models.js` | Six pure export row builders (`exportCollectionOverview`, `exportPayments`, `exportStudents`, `exportIssued`, `exportStock`, `exportReports`) | **Modify** |
| `index.html` | `data-export` attrs on 3 existing buttons + 3 new buttons + script tag | **Modify** |
| `js/app.js` | Export format menu, download helper, narrow placeholder selector | **Modify** |
| `scripts/test.js` | Tests for xlsx + builders | **Modify** |

---

## Task 1: Create `js/xlsx.js` — CSV and XLSX serializers (TDD)

**Files:**
- Create: `js/xlsx.js`
- Test: `scripts/test.js` (add `const xlsx = require("../js/xlsx.js");` at the top, right after the `csv` require on line 2)

### Step 1: Write the failing tests

Insert the `xlsx` require after line 2 (`const csv = require("../js/csv.js");`):

```js
const xlsx = require("../js/xlsx.js");
```

Append the following tests to the end of `scripts/test.js` (after line 1413, before `console.log(pass + " tests passed");`):

```js
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
```

### Step 2: Run tests to verify they fail

Run: `node scripts/test.js`
Expected: process crashes on `Cannot find module '../js/xlsx.js'` (require throws at top of file).

### Step 3: Implement minimal `js/xlsx.js`

```js
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.xlsx = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function toCSV(rows) {
    if (!rows || !rows.length) return "";
    const escape = cell => {
      const s = cell === null || cell === undefined ? "" : String(cell);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(escape).join(",")).join("\n") + "\n";
  }

  function crc32(bytes) {
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    return {
      time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() & 0x3e) >> 1),
      date: (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
    };
  }

  function buildZip(entries) {
    const now = dosDateTime(new Date());
    const local = [];
    const central = [];
    let offset = 0;
    const enc = new TextEncoder();
    entries.forEach(entry => {
      const nameBytes = enc.encode(entry.name);
      const dataBytes = entry.bytes;
      const crc = crc32(dataBytes);
      const len = dataBytes.length;
      local.push([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0,
        now.time & 0xff, now.time >>> 8, now.date & 0xff, now.date >>> 8,
        crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        nameBytes.length & 0xff, nameBytes.length >>> 8, 0, 0],
        Array.from(nameBytes), Array.from(dataBytes));
      central.push([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 20, 0, 0, 0, 0, 0,
        now.time & 0xff, now.time >>> 8, now.date & 0xff, now.date >>> 8,
        crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        nameBytes.length & 0xff, nameBytes.length >>> 8, 0, 0, 0, 0, 0, 0, 0, 0,
        offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff],
        Array.from(nameBytes));
      offset += 30 + nameBytes.length + dataBytes.length;
    });
    const centralSize = central.reduce((n, arr) => n + arr.length, 0);
    const end = [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0,
      entries.length & 0xff, entries.length >>> 8, entries.length & 0xff, entries.length >>> 8,
      centralSize & 0xff, (centralSize >>> 8) & 0xff, (centralSize >>> 16) & 0xff, (centralSize >>> 24) & 0xff,
      offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff,
      0, 0];
    const all = local.concat(central, [end]);
    const total = all.reduce((n, arr) => n + arr.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach(arr => { out.set(arr, p); p += arr.length; });
    return out;
  }

  function xmlEscape(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function colName(i) {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function buildSheetXml(rows) {
    const cellXml = (ref, cell) => {
      if (typeof cell === "number" && isFinite(cell)) {
        return '<c r="' + ref + '"><v>' + cell + "</v></c>";
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + xmlEscape(cell === null || cell === undefined ? "" : cell) + "</t></is></c>";
    };
    const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    rows.forEach((row, i) => {
      lines.push('<row r="' + (i + 1) + '">');
      row.forEach((cell, j) => lines.push(cellXml(colName(j) + (i + 1), cell)));
      lines.push("</row>");
    });
    lines.push("</sheetData></worksheet>");
    return lines.join("");
  }

  function toXLSX(rows) {
    const data = (rows || []).map(r => r.map(c => (c === null || c === undefined ? "" : c)));
    const enc = new TextEncoder();
    const sheetXml = buildSheetXml(data);
    return buildZip([
      { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>") },
      { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>") },
      { name: "xl/workbook.xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>") },
      { name: "xl/worksheets/sheet1.xml", bytes: enc.encode(sheetXml) }
    ]);
  }

  return { toCSV, toXLSX };
});
```

### Step 4: Run tests to verify they pass

Run: `node scripts/test.js`
Expected: all previous tests pass plus `PASS xlsx.toCSV ...` (4 new tests), ends with `147 tests passed`.

### Step 5: Commit

```bash
git add js/xlsx.js scripts/test.js
git commit -m "feat: exports - add csv and xlsx serializers"
```

---

## Task 2: Add export row builders to `js/view-models.js` (TDD)

**Files:**
- Modify: `js/view-models.js` (add 6 builders + a private `chart7Days` helper, export them in the return object)
- Test: `scripts/test.js`

### Step 1: Write the failing tests

Append to the end of `scripts/test.js` (before the `tests passed` line):

```js
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
  assert.equal(got.headers[0], "Method");
  assert.ok(got.rows.some(r => r[0] === "Cash" && r[1] === 1500));
  assert.ok(got.rows.some(r => r[0] === "MTN MoMo" && r[1] === 2000));
  assert.ok(got.rows.some(r => r[0] === "JS 1" && r[1] === 3500));
  assert.ok(got.rows.some(r => r[0].indexOf("Kwame") !== -1 && r[1] === 700));
});
```

### Step 2: Run tests to verify they fail

Run: `node scripts/test.js`
Expected: FAIL with `vm.exportCollectionOverview is not a function` (and similar for the other builders). `exportIssued empty activity` test FAILs with `got.rows.length !== 0` because `got` is undefined.

### Step 3: Implement the builders in `js/view-models.js`

Add a private `chart7Days` helper (place it after `classifyMethod`, around line 42):

```js
  function chart7Days(payments) {
    const dates = [];
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dates.push(d.getFullYear() + "-" + m + "-" + day);
      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
    }
    const cash = dates.map(() => 0);
    const momo = dates.map(() => 0);
    const telecel = dates.map(() => 0);
    (payments || []).forEach(p => {
      const idx = dates.indexOf(p.date);
      if (idx < 0) return;
      const cls = classifyMethod(p.method);
      if (cls === "momo") momo[idx] += p.amount;
      else if (cls === "telecel") telecel[idx] += p.amount;
      else cash[idx] += p.amount;
    });
    return { labels, cash, momo, telecel, total: cash.map((c, i) => c + momo[i] + telecel[i]) };
  }
```

Add the six builders (place them after `outstandingList`, around line 107):

```js
  function exportCollectionOverview(payments) {
    const c = chart7Days(payments);
    const headers = ["Day", "Cash", "Mobile Money", "Telecel", "Total"];
    const rows = c.labels.map((label, i) => [label, c.cash[i], c.momo[i], c.telecel[i], c.total[i]]);
    return { headers, rows };
  }

  function exportPayments(payments) {
    const headers = ["Ref", "Student", "Class", "Amount", "Method", "Date", "Status"];
    const rows = (payments || [])
      .slice()
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.paymentId || "").localeCompare(String(a.paymentId || "")))
      .map(p => [p.paymentId, p.studentName, p.className, p.amount, methodLabel(p.method), p.date, p.status || "Recorded"]);
    return { headers, rows };
  }

  function exportStudents(students) {
    const headers = ["ID", "Name", "Class", "Gender", "Fee", "Paid", "Outstanding", "Status"];
    const rows = (students || []).map(s => [
      s.studentId,
      s.name,
      s.className,
      s.gender || "",
      s.booksFee || s.booksTotal || 0,
      s.booksPaid || 0,
      studentOutstanding(s),
      s.status || ""
    ]);
    return { headers, rows };
  }

  function exportIssued(students, books, classFees, activity) {
    const headers = ["Student ID", "Name", "Class", "Mode", "Book ID", "Title", "Category", "Qty", "Kind"];
    const rows = [];
    (students || []).forEach(s => {
      const coll = studentCollection(s, books, classFees, activity);
      (coll.collected || []).forEach(item => {
        rows.push([
          s.studentId,
          s.name,
          s.className,
          coll.mode,
          item.book.bookId,
          item.book.subject,
          item.book.category,
          item.qty,
          item.kind
        ]);
      });
    });
    return { headers, rows };
  }

  function exportStock(books) {
    const inv = stockStatus(books);
    const byId = {};
    (books || []).forEach(b => { byId[b.bookId] = b; });
    const headers = ["Book ID", "Title", "Publisher", "Category", "Price", "In Stock", "Threshold", "Status"];
    const rows = inv.rows.map(r => [
      r.bookId,
      r.subject,
      r.publisher,
      r.category,
      (byId[r.bookId] || {}).price || 0,
      r.stockQty,
      r.lowStockThreshold,
      r.status
    ]);
    return { headers, rows };
  }

  function exportReports(payments, students) {
    const headers = ["Report", "Value"];
    const rows = [["Method", "Amount"]];
    methodSummary(payments).forEach(m => rows.push([m.label, m.total]));
    rows.push([]);
    rows.push(["Class", "Amount"]);
    classTotals(payments).forEach(c => rows.push([c.className, c.total]));
    rows.push([]);
    rows.push(["Student", "Balance"]);
    outstandingList(students).forEach(o => rows.push([o.studentId + " - " + o.name, o.balance]));
    return { headers, rows };
  }
```

Note: `exportReports` returns `headers = ["Report", "Value"]` for the column count; the actual per-section headers (`Method/Amount`, `Class/Amount`, `Student/Balance`) are embedded as row 0 of each section. `toCSV`/`toXLSX` only use `[headers].concat(rows)`, so the extra two header rows are cosmetic in the file — acceptable, self-describing output.

Add the six names to the return object (lines 416-442):

```js
    exportCollectionOverview,
    exportPayments,
    exportStudents,
    exportIssued,
    exportStock,
    exportReports,
```

### Step 4: Run tests to verify they pass

Run: `node scripts/test.js`
Expected: all pass, ends with `174 tests passed` (7 new test() registrations).

### Step 5: Commit

```bash
git add js/view-models.js scripts/test.js
git commit -m "feat: exports - add per-page export row builders"
```

---

## Task 3: Wire export buttons in `index.html`

**Files:**
- Modify: `index.html`

### Step 1: Add `data-export` to the 3 existing buttons

`index.html:104` (Dashboard):

```html
<button class="btn btn-light" type="button" data-export="dashboard">Export report</button>
```

`index.html:234` (Payments):

```html
<button class="btn btn-light" type="button" data-export="payments">Export report</button>
```

`index.html:354` (Reports):

```html
<button class="btn btn-light" type="button" data-export="reports">Export report</button>
```

### Step 2: Add 3 new export buttons to Students, Issuing, Inventory

Students head-actions (`index.html:203-207`) — add the Export button BEFORE the Register button:

```html
            <div class="head-actions">
              <button class="btn btn-light" type="button" data-export="students">Export report</button>
              <button class="btn btn-primary" type="button" data-action="student">+ Register student</button>
              <button class="btn btn-light" type="button" data-action="student-txt">+ Textbooks</button>
              <button class="btn btn-light" type="button" data-action="student-ex">+ ExBooks</button>
            </div>
```

Issuing head-actions (`index.html:306-308`) — add the Export button BEFORE the Issue button:

```html
            <div class="head-actions">
              <button class="btn btn-light" type="button" data-export="issuing">Export report</button>
              <button class="btn btn-primary" type="button" data-action="issue">Issue books</button>
            </div>
```

Inventory head-actions (`index.html:280-283`) — add the Export button FIRST (before the two stock buttons):

```html
            <div class="head-actions">
              <button class="btn btn-light" type="button" data-export="inventory">Export report</button>
              <button class="btn btn-primary" type="button" data-action="stock">+Stock Textbook</button>
              <button class="btn btn-primary" type="button" data-action="stock-ex">+Stock ExBooks</button>
            </div>
```

### Step 3: Load `js/xlsx.js`

`index.html:509` — insert the xlsx script between view-models and data-access (per the mandatory load order in the spec):

```html
  <script src="js/csv.js"></script>
  <script src="js/derive.js"></script>
  <script src="js/view-models.js"></script>
  <script src="js/xlsx.js"></script>
  <script src="js/data-access.js"></script>
  <script src="js/app.js"></script>
  <script src="js/write.js"></script>
```

### Step 4: Verify

Run: `node --check js/app.js` (no syntax errors needed yet)

Manual: open `index.html` locally. The 6 Export buttons now exist. They still fire the placeholder toast until Task 4 (expected at this stage).

### Step 5: Commit

```bash
git add index.html
git commit -m "feat: exports - add per-page export buttons"
```

---

## Task 4: Wire the format menu and downloads in `js/app.js`

**Files:**
- Modify: `js/app.js`

### Step 1: Narrow the placeholder selector

`js/app.js:69-71` — exclude `[data-export]` buttons so they no longer show the placeholder toast:

```js
  document.querySelectorAll(".more-btn, .btn.btn-light:not([data-close]):not([data-export]), .profile-mini").forEach(button => {
    button.addEventListener("click", () => showToast("This control is wired in the Controls stage (export, menus, profile)."));
  });
```

### Step 2: Add export plumbing after the placeholder binding (after line 71)

```js
  const exportRows = {
    dashboard: data => CEC.viewModels.exportCollectionOverview(data.payments),
    payments: data => CEC.viewModels.exportPayments(data.payments),
    students: data => CEC.viewModels.exportStudents(data.students),
    issuing: data => CEC.viewModels.exportIssued(data.students, data.books, data.classFees, data.activity),
    inventory: data => CEC.viewModels.exportStock(data.books),
    reports: data => CEC.viewModels.exportReports(data.payments, data.students)
  };

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadExport(page, format) {
    try {
      const builder = exportRows[page];
      if (!builder) { showToast("Unknown export."); return; }
      const data = viewData();
      const built = builder(data);
      const all = [built.headers].concat(built.rows);
      const ymd = new Date().toISOString().slice(0, 10);
      const filename = "cec-" + page + "-" + ymd + "." + (format === "csv" ? "csv" : "xlsx");
      if (format === "csv") {
        downloadBlob(new Blob([CEC.xlsx.toCSV(all)], { type: "text/csv;charset=utf-8" }), filename);
      } else {
        downloadBlob(new Blob([CEC.xlsx.toXLSX(all)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
      }
      showToast("Exported " + page + " report.");
    } catch (err) {
      console.error("Export failed:", err);
      showToast("Could not export the report.");
    }
  }

  document.querySelectorAll("[data-export]").forEach(button => {
    button.addEventListener("click", ev => {
      ev.stopPropagation();
      ev.preventDefault();
      if (openMenuEl) closeMenu();
      if (!currentData) { showToast("Data not loaded yet."); return; }
      openMenu(button, [
        '<button class="menu-item" role="menuitem" data-format="csv">CSV (.csv)</button>',
        '<button class="menu-item" role="menuitem" data-format="xlsx">Excel (.xlsx)</button>'
      ].join(""));
      const panel = openMenuEl;
      panel.addEventListener("click", () => {});
      menuRoot.addEventListener("click", ev2 => {
        const item = ev2.target.closest("[data-format]");
        if (!item) return;
        ev2.stopPropagation();
        closeMenu();
        downloadExport(button.dataset.export, item.dataset.format);
      });
    });
  });
```

Note: the `panel.addEventListener("click", () => {})` mirrors `openMenu`'s existing anchor pattern; the real handler is a delegated listener on `menuRoot` for `[data-format]` clicks, matching the `[data-year]` / `[data-href]` delegation style used elsewhere in the file.

### Step 3: Verify

Run: `node --check js/app.js`
Expected: no syntax errors.

Manual smoke test in browser:
1. Open `index.html`.
2. Students page → Export report → CSV → file `cec-students-<date>.csv` downloads; open it: header `ID,Name,Class,Gender,Fee,Paid,Outstanding,Status` + rows with paid/outstanding math, no `<small>`/HTML remnants.
3. Inventory → Export report → Excel → `cec-inventory-<date>.xlsx` opens in Excel/Sheets/LibreOffice with `In Stock`, `Threshold`, `Status` columns.
4. Issuing → Export → CSV: one row per (student, book) with `Qty` and `Kind`.
5. Dashboard → Export → CSV: `Day,Cash,Mobile Money,Telecel,Total` with 7 rows matching the chart.
6. Payments → Export: canonical method labels (Cash / MTN MoMo / Telecel).
7. Reports → Export: three sections (Method / Class / Student) separated by blank rows.
8. Clicking "+ Textbooks", "+ ExBooks" on Students page opens their dialogs WITHOUT a stray toast, and the topbar `•••` / profile-mini still show the placeholder toast.

### Step 4: Commit

```bash
git add js/app.js
git commit -m "feat: exports - menu, downloads and per-page mapping"
```

---

## Task 5: Full verification

**Files:** none (verification only)

### Step 1: Run the full suite

Run: `node scripts/test.js`
Expected: `PASS` for every test, ends with `174 tests passed`, exit code 0.

### Step 2: Syntax-check all touched JS

Run the following three commands; each must produce no output:

```bash
node --check js/xlsx.js
node --check js/view-models.js
node --check js/app.js
```

### Step 3: Confirm clean working tree and show the log

```bash
git status
git log --oneline -8
```

Expected: no uncommitted changes; the last 4 commits are the export-fix commits from Tasks 1-4.

---

## Self-Review

**Spec coverage:**
- Format menu (CSV + Excel): Task 3 buttons + Task 4 menu/download — Task 2 headers → Task 1 `toCSV`/`toXLSX`.
- 3 existing buttons fixed + 3 new buttons: Task 3 Steps 1-2.
- 6 datasets: Task 2 builders (overview, payments, students, issued, stock, reports).
- Dependency-free xlsx: Task 1 hand-rolled stored ZIP + inline-string OOXML.
- Placeholder selector narrowed + stray toast on "+ Textbooks"/"+ ExBooks" fixed: Task 4 Step 1.
- Error/empty handling: Task 4 `downloadExport` try/catch + `Data not loaded yet.` guard; empty datasets export header-only rows (toCSV/toXLSX of `[[headers]]`).
- Offline capability: no network calls in any new code.
- Filenames `cec-<page>-<yyyy-mm-dd>.<ext>`: Task 4 `downloadExport`.

**Placeholder scan:** every step contains concrete code or commands; no TBD/TODO.

**Type consistency:** `export*` builders all return `{ headers, rows }`; `toCSV`/`toXLSX` both accept `array-of-arrays`; `app.js` builds `[headers].concat(rows)`. Method labels go through the existing `methodLabel`. Issued rows resolve `item.book.*` from the existing `studentCollection` `collected` shape (`{ book, qty, kind }`). Stock price resolves via `byId` lookup because `stockStatus` rows omit `price`.