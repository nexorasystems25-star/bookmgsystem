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
      config: dataset.config || {},
      offline: dataset.offline,
      lastSynced: dataset.lastSynced
    };
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
    availableYears
  };
});