(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.derive = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function toNum(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }

  function deriveDashboard(input) {
    const students = input.students || [];
    const payments = input.payments || [];
    const books = input.books || [];
    const config = input.config || {};

    const withPaid = students.map((s, i) => ({
      student: s,
      paid: toNum(s.books_paid),
      total: toNum(s.books_total)
    }));

    const studentsReady = withPaid.filter(o => o.paid > 0 && o.paid >= o.total).length;
    const studentsWaiting = withPaid.filter(o => o.paid > 0 && o.paid < o.total).length;
    const studentsUncovered = withPaid.filter(o => o.paid <= 0).length;

    const collections = payments.map(p => ({
      amount: toNum(p.amount),
      method: String(p.method || "unknown").trim(),
      date: String(p.date || "").trim()
    }));

    const totalCollected = collections.reduce((sum, c) => sum + c.amount, 0);

    const methodBreakdown = {};
    for (const c of collections) methodBreakdown[c.method] = (methodBreakdown[c.method] || 0) + c.amount;

    const uniquePayers = new Set(payments.map(p => String(p.student_id || ""))).size;
    const daysActive = new Set(collections.map(c => c.date).filter(Boolean)).size;
    const avgPerDay = daysActive > 0 ? totalCollected / daysActive : 0;

    const daily = {};
    for (const c of collections) if (c.date) daily[c.date] = (daily[c.date] || 0) + c.amount;

    // dailyByDay: continuous axis of the current calendar month, zero-filled,
    // so the chart can render a full month without gaps.
    const dailyByDay = {};
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const key = year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      dailyByDay[key] = daily[key] || 0;
    }

    const lowStock = books
      .filter(b => toNum(b.stock_qty) <= toNum(b.low_stock_threshold))
      .map(b => ({ book_id: String(b.book_id || ""), stock: toNum(b.stock_qty) }));

    const dailyTarget = toNum(config.daily_payment_target);
    // Current-day stats use the UTC date so results stay deterministic
    // across timezones (fixture dates are in the past relative to run date).
    const todayKey = now.toISOString().slice(0, 10);
    const collectedToday = daily[todayKey] || 0;
    // Expected so far today equals the daily target only once at least one
    // payment has been recorded today (0 otherwise).
    const expectedByNow = collectedToday > 0 ? dailyTarget : 0;

    const activityLogged = (input.activity || []).map(a => ({
      type: String(a.type || "").trim(),
      description: String(a.description || "").trim(),
      amount: toNum(a.amount),
      created_at: String(a.created_at || "").trim()
    }));

    return {
      totalStudents: students.length,
      studentsReady,
      studentsWaiting,
      studentsUncovered,
      coverage: students.length > 0 ? (studentsReady / students.length) * 100 : 0,
      totalCollected,
      collectionsCount: collections.length,
      avgPerDay,
      methodBreakdown,
      uniquePayers,
      daily,
      dailyByDay,
      lowStock,
      activityLogged,
      dailyTarget,
      daysToTarget: dailyTarget > 0 ? Math.max(0, Math.ceil((dailyTarget - collectedToday) / dailyTarget)) : 0,
      expectedByNow
    };
  }

  return { deriveDashboard };
});
