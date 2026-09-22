const fs = require("fs");
const path = require("path");
const csv = require("../js/csv.js");

const TABS = {
  Students: "students.json",
  Payments: "payments.json",
  Activity: "activity.json",
  Books: "books.json",
  Config: "config.json"
};

function loadSpreadsheetId() {
  if (process.env.SPREADSHEET_ID) return process.env.SPREADSHEET_ID.trim();
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return "";
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^SPREADSHEET_ID=(.*)$/);
    if (m) return m[1].trim();
  }
  return "";
}

function gvizUrl(sheet) {
  return (
    "https://docs.google.com/spreadsheets/d/" +
    encodeURIComponent(SPREADSHEET_ID) +
    "/gviz/tq?tqx=out:csv&sheet=" +
    encodeURIComponent(sheet)
  );
}

async function fetchCsv(sheet) {
  const res = await fetch(gvizUrl(sheet));
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + sheet);
  return res.text();
}

function ensureDataDir() {
  const dir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJsonSafe(dir, file, value) {
  const target = path.join(dir, file);
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

const SPREADSHEET_ID = loadSpreadsheetId();

async function main() {
  const dir = ensureDataDir();
  const nowIso = new Date().toISOString();
  let offline = false;

  if (!SPREADSHEET_ID) {
    console.warn("No SPREADSHEET_ID found (.env missing). Skipping live sync; keeping committed JSON.");
    offline = true;
    metaFallback(nowIso);
    return;
  }

  for (const [sheet, file] of Object.entries(TABS)) {
    try {
      const text = await fetchCsv(sheet);
      const objects = csv.rowsToObjects(csv.parseCSV(text));
      writeJsonSafe(dir, file, objects);
      console.log("Synced " + sheet + " -> data/" + file + " (" + objects.length + " rows)");
    } catch (err) {
      offline = true;
      console.warn("Skipped " + sheet + ": " + err.message + " Keeping data/" + file + ".");
    }
  }

  writeMeta(nowIso);
  console.log(offline ? "Sync finished in offline mode." : "Sync complete. last_synced=" + nowIso);
}

function writeMeta(nowIso) {
  const dir = ensureDataDir();
  const metaPath = path.join(dir, "meta.json");
  const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  const meta = {
    spreadsheet_id: SPREADSHEET_ID || existing.spreadsheet_id || "",
    last_synced: nowIso
  };
  writeJsonSafe(dir, "meta.json", meta);

  const configPath = path.join(dir, "config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (Array.isArray(config) && config.length > 0) {
      writeJsonSafe(dir, "config.json", config.map(r => ({ ...r, last_synced: nowIso })));
    }
  }
}

function metaFallback(nowIso) {
  const dir = ensureDataDir();
  const metaPath = path.join(dir, "meta.json");
  const existing = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};
  writeJsonSafe(dir, "meta.json", {
    spreadsheet_id: existing.spreadsheet_id || "",
    last_synced: existing.last_synced || nowIso
  });
}

main().catch(err => {
  console.error("Sync failed:", err.message);
  process.exit(0);
});