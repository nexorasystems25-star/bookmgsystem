"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  const header = (req && req.headers && req.headers.authorization) || "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  const payload = match ? lib.verifyToken(match[1], process.env.AUTH_SESSION_SECRET) : null;
  if (!payload) {
    return res.status(401).json({ ok: false, error: "Authentication required." });
  }
  return res.status(200).json({ ok: true, username: payload.username, role: payload.role, exp: payload.exp });
};
