"use strict";

const lib = require("./_lib");

const SESSION_TTL_SECONDS = 12 * 60 * 60;

async function handler(req, res, deps) {
  try {
    const username = req.body && req.body.username;
    const password = req.body && req.body.password;
    if (typeof username !== "string" || !username || typeof password !== "string" || !password) {
      return res.status(400).json({ ok: false, error: "username and password are required" });
    }

    const clientFactory = (deps && deps.createClient) || lib.createClient;
    const client = clientFactory({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const users = await client.sheetsGet(process.env.AUTH_USERS_SPREADSHEET_ID, "Users!A:E");
    const found = lib.findRowIndex(users, "username", username);
    if (!found) {
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    }
    const row = users[found.rowIndex - 1];
    // A blank/corrupt credential cell throws inside scrypt. Swallow it so a known
    // username with bad stored credentials is indistinguishable from an unknown one.
    let ok = false;
    try { ok = await lib.verifyPassword(password, row[1]); } catch (e) { ok = false; }
    if (!ok) {
      return res.status(401).json({ ok: false, error: "Invalid username or password." });
    }
    const role = String(row[2] || "").trim();
    if (!role) return res.status(500).json({ ok: false, error: "User row is missing a role." });

    const token = lib.signToken({ username: username, role: role }, SESSION_TTL_SECONDS, process.env.AUTH_SESSION_SECRET);
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    return res.status(200).json({ ok: true, token: token, username: username, role: role, exp: exp });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = handler;
