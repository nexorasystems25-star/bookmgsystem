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
    if (m.indexOf("momo") !== -1) return "momo";
    if (m.indexOf("telecel") !== -1) return "telecel";
    return "cash";
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
    return Math.max(0, (student.booksTotal || 0) - (student.booksPaid || 0));
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

  function bookCategories(books) {
    const set = {};
    (books || []).forEach(b => {
      const c = String(b.category || "").trim();
      if (c) set[c] = true;
    });
    return Object.keys(set).sort();
  }

  function classKey(s) {
    return String(s || "").trim().toLowerCase().replace(/\s+/g, "");
  }

  function bookCountForClass(books, className) {
    const target = classKey(className);
    if (!target) return 0;
    const counts = {};
    (books || []).forEach(b => {
      const key = classKey(b.category);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts[target] || 0;
  }

  function classBookInfo(books, className, classFees) {
    const target = classKey(className);
    const info = { count: 0, fee: 0 };
    if (!target) return info;
    (books || []).forEach(b => {
      if (classKey(b.category) !== target) return;
      info.count += 1;
    });
    (classFees || []).forEach(f => {
      if (classKey(f.className) === target && info.fee === 0) info.fee = f.fee;
    });
    return info;
  }

  function classOptionLabel(className, books, classFees) {
    const info = classBookInfo(books, className, classFees);
    const label = String(className || "").trim();
    const parts = [];
    if (info.fee > 0) parts.push(info.fee + " GHS");
    if (info.count > 0) parts.push(info.count + (info.count === 1 ? " book" : " books"));
    return parts.length ? label + " \u2014 " + parts.join(", ") : label;
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
    bookCountForClass,
    classBookInfo,
    classOptionLabel
  };
});