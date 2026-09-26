#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("../api/_lib.js");

const VALID_ROLES = ["admin", "teacher", "storekeeper"];
const HEADERS = ["username", "credentials", "role", "created_at", "updated_at"];

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : "";
}

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function loadUsersSheetId() {
  const env = loadEnv();
  return (process.env.AUTH_USERS_SPREADSHEET_ID || env.AUTH_USERS_SPREADSHEET_ID || "").trim();
}

function googleEnv() {
  const env = loadEnv();
  return {
    client_id: process.env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN
  };
}

function headerOk(headerRow) {
  return HEADERS.every((h, i) => String(headerRow[i] || "").trim() === h);
}

async function main() {
  const args = process.argv.slice(2);
  const sheet = arg(args, "--users-sheet") || loadUsersSheetId();
  const username = arg(args, "--username");
  const password = arg(args, "--password");
  const role = arg(args, "--role");
  const init = args.indexOf("--init") !== -1;

  if (!sheet) throw new Error("AUTH_USERS_SPREADSHEET_ID is not set (pass --users-sheet <id> or set the env var).");
  if (!username || !password || !role) throw new Error("--username, --password and --role are all required.");
  if (VALID_ROLES.indexOf(role) === -1) throw new Error("role must be one of: " + VALID_ROLES.join(", "));

  const client = lib.createClient(googleEnv());

  const tabs = await client.sheetsMeta(sheet);
  if (init && !tabs.Users) {
    await client.sheetsAddTab(sheet, "Users");
    console.log("Created Users tab.");
  }

  const users = await client.sheetsGet(sheet, "Users!A1:E1");
  if (!users.length || !headerOk((users[0] || []).slice(0, 5))) {
    if (!init) {
      throw new Error("Users tab is missing or its header row does not match " + HEADERS.join(",") + ". Run with --init to create it.");
    }
    await client.sheetsUpdate(sheet, "Users!A1:E1", [HEADERS]);
    console.log("Wrote Users header row.");
  }

  const credentials = lib.hashPassword(password);
  const nowIso = new Date().toISOString();
  await client.sheetsAppend(sheet, "Users", [[username, credentials, role, nowIso, nowIso]]);
  console.log("Created user " + username + " with role " + role + " in spreadsheet " + sheet);
}

main().catch(err => {
  console.error("create-user failed:", err.message);
  process.exit(1);
});
