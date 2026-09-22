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
      const text = await fetchWithTimeout(gvizUrl(CEC.meta.spreadsheet_id, sheetName), TIMEOUT_MS);
      const objects = CEC.csv.rowsToObjects(CEC.csv.parseCSV(text));
      sessionCache[sheetName] = "live";
      return objects;
    } catch (e) {
      sessionCache[sheetName] = "json";
      return loadLocal(fileName);
    }
  }

  function anyTabLive() {
    return Object.values(sessionCache).indexOf("live") !== -1;
  }

  async function getDashboardData() {
    CEC.meta = await loadMeta();

    const [studentsRows, paymentsRows, activityRows, booksRows, configRows] = await Promise.all([
      fetchTab("Students", "students.json"),
      fetchTab("Payments", "payments.json"),
      fetchTab("Activity", "activity.json"),
      fetchTab("Books", "books.json"),
      fetchTab("Config", "config.json")
    ]);

    const students = CEC.derive.normalizeStudents(studentsRows);
    const payments = CEC.derive.normalizePayments(paymentsRows);
    const activity = CEC.derive.normalizeActivity(activityRows);
    const books = CEC.derive.normalizeBooks(booksRows);
    const config = CEC.derive.normalizeConfig(configRows);

    const dashboard = CEC.derive.buildDashboard(students, payments, activity, books, config);
    dashboard.lastSynced = (CEC.meta && CEC.meta.last_synced) || config.lastSynced;
    dashboard.offline = !anyTabLive();
    return dashboard;
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
    getDashboardData: getDashboardData
  });
  window.CEC.meta = { spreadsheet_id: "", last_synced: "" };
})();