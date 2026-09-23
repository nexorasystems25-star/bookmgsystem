"use strict";

const lib = require("./_lib");

module.exports = async function handler(req, res) {
  try {
    const parsed = lib.validatePaymentPayload(req.body);
    if (!parsed.ok) return res.status(400).json(parsed);
    const client = lib.createClient({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    const result = await lib.runPayment(client, process.env.SPREADSHEET_ID, parsed.payload);
    if (!result.ok) return res.status(400).json(result);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};