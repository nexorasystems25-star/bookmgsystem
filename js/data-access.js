(function () {
  "use strict";

  const TIMEOUT_MS = 5000;

  async function loadMeta() {
    try {
      const res = await fetch("data/meta.json", { cache: "no-store" });
      return await res.json();
    } catch (e) {
      return { spreadsheet_id: "", last_synced: "" };
    }
  }

  function gvizUrl(id, sheet) {
    return (
      "https://docs.google.com/spreadsheets/d/" +
      encodeURIComponent(id) +
      "/gviz/tq?tqx=out:csv&sheet=" +
      encodeURIComponent(sheet)
    );
  }

  function tabUrl(id, sheet, tabs) {
    const gid = tabs && tabs[sheet];
    if (gid !== undefined && gid !== null && gid !== "") {
      return (
        "https://docs.google.com/spreadsheets/d/" +
        encodeURIComponent(id) +
        "/export?format=csv&gid=" +
        encodeURIComponent(String(gid))
      );
    }
    return gvizUrl(id, sheet);
  }

  async function fetchWithTimeout(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  function loadLocal(file) {
    return fetch("data/" + file, { cache: "no-store" })
      .then(res => res.json())
      .catch(() => []);
  }

  const sessionCache = {};

  async function fetchTab(sheetName, fileName) {
    if (CEC.forceOffline) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
    if (!CEC.meta.spreadsheet_id) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
    try {
      const text = await fetchWithTimeout(tabUrl(CEC.meta.spreadsheet_id, sheetName, CEC.meta.tabs), TIMEOUT_MS);
      const objects = CEC.csv.rowsToObjects(CEC.csv.parseCSV(text));
      sessionCache[sheetName] = "live";
      return objects;
    } catch (e) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
  }

  async function fetchClassFees() {
    const rows = await fetchTab("ClassFees", "class-fees.json");
    const usable = (rows || []).some(r => r && (r.class || r.className) && (r.fee || r.books_fee));
    if (sessionCache.ClassFees === "live" && !usable) {
      sessionCache.ClassFees = "json";
      return loadLocal("class-fees.json");
    }
    return rows;
  }

  function anyTabLive() {
    return Object.values(sessionCache).indexOf("live") !== -1;
  }

  let sessionData = null;

  async function getAllData() {
    if (sessionData) return sessionData;
    CEC.meta = await loadMeta();

    const [studentsRows, paymentsRows, activityRows, booksRows, feesRows, configRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Payments", "payments.json"),
      fetchTab("Activity", "activity.json"),
      fetchTab("Books", "books.json"),
      fetchClassFees(),
      fetchTab("Config", "config.json")
    ]);

    const students = CEC.derive.normalizeStudents(studentsRows);
    const payments = CEC.derive.normalizePayments(paymentsRows);
    const activity = CEC.derive.normalizeActivity(activityRows);
    const books = CEC.derive.normalizeBooks(booksRows);
    const classFees = CEC.derive.normalizeClassFees(feesRows);
    const config = CEC.derive.normalizeConfig(configRows);

    sessionData = {
      students,
      payments,
      activity,
      books,
      classFees,
      config,
      lastSynced: (CEC.meta && CEC.meta.last_synced) || config.lastSynced,
      offline: !anyTabLive()
    };
    return sessionData;
  }

  async function getDashboardData() {
    const data = await getAllData();
    const dashboard = CEC.derive.buildDashboard(data.students, data.payments, data.activity, data.books, data.config);
    dashboard.lastSynced = data.lastSynced;
    dashboard.offline = data.offline;
    return dashboard;
  }

  function clearCache() {
    Object.keys(sessionCache).forEach(k => delete sessionCache[k]);
    sessionData = null;
  }

  async function fetchOptions() {
    CEC.meta = await loadMeta();
    const [studentsRows, booksRows, feesRows, activityRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Books", "books.json"),
      fetchClassFees(),
      fetchTab("Activity", "activity.json")
    ]);
    return {
      students: CEC.derive.normalizeStudents(studentsRows),
      books: CEC.derive.normalizeBooks(booksRows),
      classFees: CEC.derive.normalizeClassFees(feesRows),
      activity: CEC.derive.normalizeActivity(activityRows)
    };
  }

  let forceOfflineFlag = false;
  try {
    forceOfflineFlag =
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("cecForceOffline") === "true";
  } catch (ignored) {}

  function setForceOffline(v) {
    forceOfflineFlag = !!v;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (forceOfflineFlag) sessionStorage.setItem("cecForceOffline", "true");
        else sessionStorage.removeItem("cecForceOffline");
      }
    } catch (ignored) {}
  }

  window.CEC = window.CEC || {};
  Object.defineProperty(window.CEC, "forceOffline", {
    get: function () { return forceOfflineFlag; },
    set: function (v) { setForceOffline(v); },
    configurable: true
  });
  Object.assign(window.CEC, {
    csv: window.CEC.csv,
    derive: window.CEC.derive,
    viewModels: window.CEC.viewModels,
    getAllData: getAllData,
    getDashboardData: getDashboardData,
    clearCache: clearCache,
    fetchOptions: fetchOptions
  });
  window.CEC.meta = { spreadsheet_id: "", last_synced: "" };
})();