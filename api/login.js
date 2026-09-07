// Vercel Node.js Serverless Function — validates the submitted access code
// and, on success, issues a signed, self-expiring session cookie that
// middleware.js verifies.
//
// Each person gets their OWN environment variable, named with the
// ACCESS_CODE_ prefix, e.g.:
//   ACCESS_CODE_LAN   = hoaxinhgai
//   ACCESS_CODE_MINH  = hiencute
//   ACCESS_CODE_HOA   = anhdeptrai
// The part after the prefix is just a label for YOU to recognize whose
// entry is whose in the Vercel Dashboard list — the code itself is only
// ever the variable's value. To revoke one person, delete their single
// variable; nobody else's code is affected, and you never need to know
// (or reconstruct) anyone else's code to do it.
//
// The cookie never stores the access code itself — only a signed token
// (HMAC-SHA256 over "ok:<expiryTimestamp>" using SESSION_SECRET), so the
// code cannot be recovered from the cookie value, and forging a token
// without knowing SESSION_SECRET is infeasible.

const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_VAR_PREFIX = "ACCESS_CODE_";

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

function getValidCodes() {
  var codes = [];
  for (var key in process.env) {
    if (key.indexOf(CODE_VAR_PREFIX) === 0) {
      var val = process.env[key];
      if (val && String(val).trim()) codes.push(String(val).trim());
    }
  }
  return codes;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  var code = body && body.code ? String(body.code).trim() : "";

  var secret = process.env.SESSION_SECRET;
  var validCodes = getValidCodes();

  if (!secret || validCodes.length === 0) {
    res.status(500).json({
      error: "Server chưa được cấu hình (thiếu biến ACCESS_CODE_* hoặc SESSION_SECRET trên Vercel Dashboard).",
    });
    return;
  }

  if (!code || validCodes.indexOf(code) === -1) {
    res.status(401).json({ error: "Mã không đúng." });
    return;
  }

  var expiry = Date.now() + THIRTY_DAYS_MS;
  var payload = "ok:" + expiry;
  var sig = await hmacHex(secret, payload);
  var token = payload + "." + sig;

  res.setHeader(
    "Set-Cookie",
    "pmp_auth=" + encodeURIComponent(token) +
      "; Path=/; Max-Age=" + (THIRTY_DAYS_MS / 1000) +
      "; HttpOnly; Secure; SameSite=Lax"
  );
  res.status(200).json({ ok: true });
};
