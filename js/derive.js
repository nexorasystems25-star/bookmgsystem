(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.derive = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function num(v) {
    const n = parseFloat(String(v).replace(/[^\d.-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function formatAmount(value, currency) {
    const c = currency || "GH₵";
    return c + " " + Math.round(value).toLocaleString("en-US");
  }

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function classifyMethod(method) {
    const m = String(method || "").toLowerCase();
    if (m.indexOf("momo") !== -1) return "momo";
    if (m.indexOf("telecel") !== -1) return "telecel";
    return "cash";
  }

  function normalizeStudents(rows) {
    return rows.map(r => ({
      studentId: r.student_id,
      name: r.name,
      className: r.class,
      gender: r.gender,
      academicYear: r.academic_year,
      booksFee: num(r.books_fee),
      booksPaid: num(r.books_paid),
      booksTotal: num(r.books_total),
      exbooks: num(r.exbooks),
      status: String(r.status || "").toLowerCase().trim()
    }));
  }

  function normalizePayments(rows) {
    return rows.map(r => ({
      paymentId: r.payment_id,
      studentId: r.student_id,
      studentName: r.student_name,
      className: r.class,
      amount: num(r.amount),
      method: r.method,
      date: r.date,
      status: r.status
    }));
  }

  function normalizeActivity(rows) {
    return rows.map(r => ({
      activityId: r.activity_id,
      type: r.type,
      description: r.description,
      amount: num(r.amount),
      createdAt: r.created_at
    }));
  }

  function normalizeBooks(rows) {
    return rows.map(r => ({
      bookId: r.book_id,
      publisher: r.publisher,
      subject: r.subject,
      category: r.category,
      price: num(r.price),
      stockQty: num(r.stock_qty),
      lowStockThreshold: num(r.low_stock_threshold)
    }));
  }

  function normalizeClassFees(rows) {
    return (rows || [])
      .filter(r => r && !r.student_id && !r.name && (r.class || r.className) && (r.fee || r.books_fee))
      .map(r => ({
        className: String(r.class || r.className || "").trim(),
        fee: num(r.fee || r.books_fee),
        exbooks: num(r.exbooks)
      }));
  }

  function normalizeConfig(rows) {
    const r = rows[0] || {};
    return {
      activeYear: r.academic_year || "",
      dailyTarget: num(r.daily_payment_target),
      currency: r.currency || "GH₵",
      lastSynced: r.last_synced || ""
    };
  }

  function buildReadiness(students) {
    const ready = students.filter(s => s.status === "ready").length;
    const waiting = students.filter(s => s.status === "waiting").length;
    const uncovered = students.filter(s => s.status === "not covered").length;
    const covered = ready + waiting;
    const coveredPct = students.length > 0 ? Math.round(((ready + waiting) / students.length) * 100) : 0;
    return { ready, waiting, uncovered, covered, coveredPct };
  }

  function buildKpis(students, payments, config) {
    const today = todayISO();
    const readiness = buildReadiness(students);
    const outstanding = students.reduce((acc, s) => {
      const bal = s.booksTotal - s.booksPaid;
      if (bal > 0) {
        acc.count += 1;
        acc.amount += bal;
      }
      return acc;
    }, { count: 0, amount: 0 });
    const paymentsToday = payments.reduce((s, p) => s + (p.date === today ? p.amount : 0), 0);
    const target = config.dailyTarget;
    return {
      totalStudents: students.length,
      enrolledThisTerm: students.length,
      paymentsToday,
      dailyTarget: target,
      dailyPct: target > 0 ? Math.round((paymentsToday / target) * 100) : 0,
      readyToIssue: readiness.ready,
      waiting: readiness.waiting,
      outstandingCount: outstanding.count,
      outstandingAmount: outstanding.amount
    };
  }

  function buildChart7Days(payments) {
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
    payments.forEach(p => {
      const idx = dates.indexOf(p.date);
      if (idx < 0) return;
      const cls = classifyMethod(p.method);
      if (cls === "momo") momo[idx] += p.amount;
      else if (cls === "telecel") telecel[idx] += p.amount;
      else cash[idx] += p.amount;
    });
    const total = dates.map((_, i) => cash[i] + momo[i] + telecel[i]);
    return { labels, cash, momo, telecel, total };
  }

  function buildRecentPayments(payments) {
    return payments
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 5)
      .map(p => ({
        studentName: p.studentName,
        id: p.studentId,
        className: p.className,
        amount: p.amount,
        method: p.method,
        methodClass: classifyMethod(p.method),
        status: p.status || "Recorded"
      }));
  }

  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (isNaN(t)) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
    const days = Math.round(hrs / 24);
    return days + " day" + (days === 1 ? "" : "s") + " ago";
  }

  const ACTIVITY_META = {
    payment: { icon: "₵", color: "green", title: "Payment recorded" },
    issue: { icon: "⇧", color: "blue", title: "Books issued" },
    stock: { icon: "+", color: "amber", title: "Stock received" },
    student: { icon: "♙", color: "purple", title: "Student added" }
  };

  function buildActivityFeed(activity) {
    return activity
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, 6)
      .map(a => {
        const meta = ACTIVITY_META[a.type] || { icon: "•", color: "blue", title: a.type };
        return {
          type: a.type,
          icon: meta.icon,
          color: meta.color,
          title: meta.title,
          description: a.description,
          timeLabel: timeAgo(a.createdAt)
        };
      });
  }

  function buildBooks(books) {
    return {
      stockLowCount: books.filter(b => b.stockQty <= b.lowStockThreshold).length
    };
  }

  function buildDashboard(students, payments, activity, books, config) {
    const kpis = buildKpis(students, payments, config);
    return {
      kpis,
      chart: buildChart7Days(payments),
      readiness: buildReadiness(students),
      recentPayments: buildRecentPayments(payments),
      activityFeed: buildActivityFeed(activity),
      stockLowCount: buildBooks(books).stockLowCount,
      currency: config.currency
    };
  }

  return {
    num,
    formatAmount,
    todayISO,
    normalizeStudents,
    normalizePayments,
    normalizeActivity,
    normalizeBooks,
    normalizeClassFees,
    normalizeConfig,
    buildReadiness,
    buildKpis,
    buildChart7Days,
    buildRecentPayments,
    buildActivityFeed,
    buildBooks,
    buildDashboard
  };
});