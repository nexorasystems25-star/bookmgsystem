(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.viewModels = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PAGES = {
    dashboard: { title: "Dashboard", eyebrow: "Overview" },
    students: { title: "Students", eyebrow: "Operations" },
    payments: { title: "Payments", eyebrow: "Operations" },
    books: { title: "Books & Packages", eyebrow: "Operations" },
    inventory: { title: "Inventory", eyebrow: "Operations" },
    issuing: { title: "Issue Books", eyebrow: "Operations" },
    reports: { title: "Reports", eyebrow: "Insights" },
    settings: { title: "Settings", eyebrow: "Insights" }
  };

  function pageForHash(hash) {
    const raw = String(hash || "").replace(/^#/, "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(PAGES, raw) ? raw : "dashboard";
  }

  function classifyMethod(method) {
    const m = String(method || "").toLowerCase();
    if (m.indexOf("momo") !== -1 || m.indexOf("mtn") !== -1) return "momo";
    if (m.indexOf("telecel") !== -1) return "telecel";
    return "cash";
  }

  function methodLabel(method) {
    const raw = String(method || "").trim();
    const m = raw.toLowerCase();
    if (!m) return "";
    if (m.indexOf("momo") !== -1 || m.indexOf("mtn") !== -1) return "MTN MoMo";
    if (m.indexOf("telecel") !== -1) return "Telecel";
    if (m.indexOf("cash") !== -1) return "Cash";
    return raw;
  }

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

  function methodSummary(payments) {
    const bucket = { cash: 0, momo: 0, telecel: 0 };
    let grand = 0;
    (payments || []).forEach(p => {
      bucket[classifyMethod(p.method)] += p.amount;
      grand += p.amount;
    });
    return Object.keys(bucket).map(key => ({
      key,
      label: key === "cash" ? "Cash" : key === "momo" ? "MTN MoMo" : "Telecel",
      total: bucket[key],
      share: grand > 0 ? Math.round((bucket[key] / grand) * 100) : 0
    }));
  }

  function classTotals(payments) {
    const map = {};
    (payments || []).forEach(p => {
      const k = p.className || "\u2014";
      map[k] = (map[k] || 0) + p.amount;
    });
    return Object.keys(map)
      .map(k => ({ className: k, total: map[k] }))
      .sort((a, b) => b.total - a.total);
  }

  function stockStatus(books) {
    const rows = (books || []).map(b => {
      const status = b.stockQty <= 0 ? "Out" : b.stockQty <= b.lowStockThreshold ? "Low" : "OK";
      return {
        bookId: b.bookId,
        subject: b.subject,
        category: b.category,
        publisher: b.publisher,
        stockQty: b.stockQty,
        lowStockThreshold: b.lowStockThreshold,
        status
      };
    });
    return {
      rows,
      totalTitles: rows.length,
      okCount: rows.filter(r => r.status === "OK").length,
      lowCount: rows.filter(r => r.status === "Low").length,
      outCount: rows.filter(r => r.status === "Out").length
    };
  }

  function studentOutstanding(student) {
    const fee = student.booksFee || student.booksTotal || 0;
    return Math.max(0, fee - (student.booksPaid || 0));
  }

  function outstandingList(students) {
    return (students || [])
      .map(s => ({
        studentId: s.studentId,
        name: s.name,
        className: s.className,
        balance: studentOutstanding(s)
      }))
      .filter(r => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }

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

  function isExerciseBook(book) {
    return String((book && book.publisher) || "").trim() === "Exercise Book";
  }

  function bookCategories(books) {
    const set = {};
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      const c = String(b.category || "").trim();
      if (c) set[c] = true;
    });
    return Object.keys(set).sort();
  }

  function exerciseBookCategories(books) {
    const set = {};
    (books || []).forEach(b => {
      if (!isExerciseBook(b)) return;
      const c = String(b.category || "").trim();
      if (c) set[c] = true;
    });
    return Object.keys(set).sort();
  }

  function classKey(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^n(\d.*)$/, "nursery$1");
  }

  function issuedBookIds(activity, student) {
    const name = String((student && student.name) || "").trim().toLowerCase();
    const ids = [];
    (activity || []).forEach(a => {
      if (String((a && a.type) || "").trim() !== "issue") return;
      const m = String((a && a.description) || "").match(/^Books issued to (.+?)\s*\[([^\]]*)\]$/i);
      if (!m) return;
      if (String(m[1]).trim().toLowerCase() !== name) return;
      String(m[2]).split(",").forEach(part => {
        const id = part.trim().replace(/x\d+$/, "");
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
    });
    return ids;
  }

  function issueEligibleBooks(books, student, activity) {
    const target = classKey(student && student.className);
    const paid = Number((student && student.booksPaid) || 0);
    if (!target || !(paid > 0)) return [];
    const issued = issuedBookIds(activity, student);
    return (books || []).filter(b => {
      if (isExerciseBook(b)) return false;
      if (classKey(b.category) !== target) return false;
      if (!(Number(b.price) > 0) || Number(b.price) > paid) return false;
      if (!(Number(b.stockQty) > 0)) return false;
      return issued.indexOf(b.bookId) === -1;
    });
  }

  function issueEligibleExBooks(books, student, activity, classFees) {
    if (!student || !(Number(student.exbooks) > 0)) return [];
    const target = classKey(student.className);
    if (!target) return [];
    const feesRow = (classFees || []).find(f => classKey(f.className) === target);
    if (!feesRow || !feesRow.sizes) return [];
    const issued = issuedBookIds(activity, student);
    const out = [];
    Object.keys(feesRow.sizes).forEach(sizeName => {
      const qty = feesRow.sizes[sizeName];
      if (!(qty > 0)) return;
      const book = (books || []).find(b => isExerciseBook(b) && classKey(b.category) === classKey(sizeName));
      if (!book) return;
      if (issued.indexOf(book.bookId) !== -1) return;
      const stock = Number(book.stockQty) || 0;
      if (stock < qty) return;
      out.push({ book: book, qty: qty, stock: stock });
    });
    return out;
  }

  function issuedBooks(activity, student) {
    const name = String((student && student.name) || "").trim().toLowerCase();
    const out = {};
    (activity || []).forEach(a => {
      if (String((a && a.type) || "").trim() !== "issue") return;
      const m = String((a && a.description) || "").match(/^Books issued to (.+?)\s*\[([^\]]*)\]$/i);
      if (!m) return;
      if (String(m[1]).trim().toLowerCase() !== name) return;
      String(m[2]).split(",").forEach(part => {
        const token = part.trim();
        if (!token) return;
        const x = token.match(/^(.+?)x(\d+)$/);
        const id = x ? x[1] : token;
        const qty = x ? Number(x[2]) : 1;
        if (!id) return;
        out[id] = (out[id] || 0) + qty;
      });
    });
    return out;
  }

  function registrationMode(student) {
    const hasTextbooks = Number((student && student.booksTotal) || 0) > 0;
    const hasExbooks = Number((student && student.exbooks) || 0) > 0;
    if (hasTextbooks && hasExbooks) return "Both";
    if (hasTextbooks) return "Textbooks";
    if (hasExbooks) return "ExBooks";
    return "None";
  }

  function studentCollection(student, books, classFees, activity) {
    const mode = registrationMode(student);
    const paid = Number((student && student.booksPaid) || 0);
    const target = classKey(student && student.className);
    const issued = issuedBooks(activity, student);
    const catalog = {};
    (books || []).forEach(b => { catalog[b.bookId] = b; });

    const collected = Object.keys(issued).map(id => {
      const book = catalog[id];
      if (!book) return null;
      return { book: book, qty: issued[id], kind: isExerciseBook(book) ? "exbook" : "textbook" };
    }).filter(Boolean);

    const remaining = [];
    if (mode === "Textbooks" || mode === "Both") {
      (books || []).forEach(b => {
        if (isExerciseBook(b)) return;
        if (classKey(b.category) !== target) return;
        if (!(Number(b.price) > 0) || Number(b.price) > paid) return;
        if (!(Number(b.stockQty) > 0)) return;
        if (issued[b.bookId]) return;
        remaining.push({ book: b, qty: 1, kind: "textbook" });
      });
    }
    if ((mode === "ExBooks" || mode === "Both") && target) {
      const feesRow = (classFees || []).find(f => classKey(f.className) === target);
      if (feesRow && feesRow.sizes) {
        Object.keys(feesRow.sizes).forEach(sizeName => {
          const sizeQty = Number(feesRow.sizes[sizeName] || 0);
          if (!(sizeQty > 0)) return;
          const book = (books || []).find(b => isExerciseBook(b) && classKey(b.category) === classKey(sizeName));
          if (!book) return;
          const got = Number(issued[book.bookId] || 0);
          const qty = sizeQty - got;
          if (qty <= 0) return;
          const stock = Number(book.stockQty) || 0;
          remaining.push({ book: book, qty: qty, kind: "exbook", stockShort: stock < qty });
        });
      }
    }

    return { mode: mode, collected: collected, remaining: remaining };
  }

  function bookCountForClass(books, className) {
    const target = classKey(className);
    if (!target) return 0;
    const counts = {};
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      const key = classKey(b.category);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts[target] || 0;
  }

  function classBookInfo(books, className, classFees) {
    const target = classKey(className);
    const info = { count: 0, fee: 0, exbooks: 0 };
    if (!target) return info;
    (books || []).forEach(b => {
      if (isExerciseBook(b)) return;
      if (classKey(b.category) !== target) return;
      info.count += 1;
    });
    (classFees || []).forEach(f => {
      if (classKey(f.className) !== target) return;
      info.fee = f.fee;
      info.exbooks = f.exbooks || 0;
    });
    return info;
  }

  function classOptionLabel(className, books, classFees) {
    const info = classBookInfo(books, className, classFees);
    const label = String(className || "").trim();
    const parts = [];
    if (info.count > 0) parts.push(info.count + (info.count === 1 ? " textbook" : " textbooks"));
    if (info.fee > 0) parts.push(info.fee + " GHS");
    return parts.length ? label + " \u2014 " + parts.join(" \u2014 ") : label;
  }

  function purchasePayload(mode, values) {
    const fee = mode === "exbooks" ? 0 : Number(values.fee || 0);
    const total = mode === "exbooks" ? 0 : Number(values.total || 0);
    const exbooks = mode === "textbook" ? 0 : Number(values.exbooks || 0);
    return { fee, total, exbooks };
  }

  function availableYears(students, config) {
    const set = {};
    (students || []).forEach(s => {
      const y = String(s.academicYear || "").trim();
      if (y) set[y] = true;
    });
    const active = String((config && config.activeYear) || "").trim();
    if (active) set[active] = true;
    const years = Object.keys(set);
    if (!active) return years;
    const rest = years.filter(y => y !== active).sort();
    return [active].concat(rest);
  }

  function filterYear(dataset, year, opts) {
    const target = String(year || "").trim();
    const active = String(((opts && opts.activeYear) || (dataset.config && dataset.config.activeYear)) || "").trim();
    const students = (dataset.students || []).filter(s => String(s.academicYear || "").trim() === target);
    const byId = {};
    students.forEach(s => { byId[String(s.studentId)] = true; });
    const yearOf = p => (byId[String(p.studentId)] ? target : active);
    const payments = (dataset.payments || [])
      .map(pid => {
        const p = Object.assign({}, pid);
        p.academicYear = yearOf(p);
        return p;
      })
      .filter(p => p.academicYear === target);
    return {
      students,
      payments,
      activity: dataset.activity || [],
      books: dataset.books || [],
      classFees: dataset.classFees || [],
      config: dataset.config || {},
      offline: dataset.offline,
      lastSynced: dataset.lastSynced
    };
  }

  function searchHits(items, q, fnMask) {
    return (items || []).filter(it => fnMask(it).toLowerCase().indexOf(q) !== -1);
  }

  function globalSearch(data, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return { students: [], books: [], payments: [] };
    const students = searchHits(data.students, q, s => [s.name, s.studentId, s.className].join(" "));
    const books = searchHits(data.books, q, b => [b.subject, b.publisher, b.category].join(" "));
    const payments = searchHits(data.payments, q, p => [p.studentName, p.paymentId].join(" "));
    return {
      students: students.slice(0, 6),
      books: books.slice(0, 6),
      payments: payments.slice(0, 6)
    };
  }

  function timeAgo(iso) {
    const t = new Date(String(iso || "")).getTime();
    if (isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
    const days = Math.round(hrs / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  function notifications(dataset) {
    const out = [];
    const books = dataset.books || [];
    const low = books.filter(b => b.stockQty <= b.lowStockThreshold).length;
    if (low > 0) out.push({ id: "low-stock", kind: "inventory", icon: "!", color: "amber", title: low + (low === 1 ? " title low on stock" : " titles low on stock"), desc: "Below or at the restock threshold.", href: "#inventory" });

    const students = dataset.students || [];
    const waiting = students.filter(s => s.status === "waiting").length;
    if (waiting > 0) out.push({ id: "waiting", kind: "issuing", icon: "!", color: "warn", title: waiting + (waiting === 1 ? " student waiting for stock" : " students waiting for stock"), desc: "Review stock before the next issuing session.", href: "#issuing" });

    const ready = students.filter(s => s.status === "ready").length;
    if (ready > 0) out.push({ id: "ready", kind: "issuing", icon: "⇧", color: "green", title: ready + (ready === 1 ? " student ready to issue" : " students ready to issue"), desc: "Cleared to collect their book package.", href: "#issuing" });

    const payments = dataset.payments || [];
    if (payments.length > 0) {
      const todayISO = (function () {
        const d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      })();
      const todayPay = payments.reduce((s, p) => s + (p.date === todayISO ? p.amount : 0), 0);
      const target = dataset.config.dailyTarget || 0;
      const pct = target > 0 ? Math.round((todayPay / target) * 100) : 0;
      out.push({ id: "target", kind: "payments", icon: "₵", color: pct >= 100 ? "green" : "blue", title: pct >= 100 ? "Daily target reached" : "Daily target " + pct + "% reached", desc: payments.length + " payments recorded in the active year.", href: "#payments" });
    }

    const activity = (dataset.activity || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const latest = activity[0];
    if (latest) {
      out.push({ id: "activity", kind: "activity", icon: "•", color: "blue", title: "Latest activity", desc: latest.description || "", href: "#payments", timeLabel: timeAgo(latest.createdAt) });
    }

    return out;
  }

  return {
    PAGES,
    pageForHash,
    classifyMethod,
    methodLabel,
    methodSummary,
    classTotals,
    stockStatus,
    studentOutstanding,
    outstandingList,
    filterYear,
    globalSearch,
    notifications,
    availableYears,
    bookCategories,
    exerciseBookCategories,
    bookCountForClass,
    classBookInfo,
    classOptionLabel,
    isExerciseBook,
    issuedBookIds,
    issuedBooks,
    issueEligibleBooks,
    issueEligibleExBooks,
    studentCollection,
    purchasePayload,
    exportCollectionOverview,
    exportPayments,
    exportStudents,
    exportIssued,
    exportStock,
    exportReports
  };
});