// Vercel Node.js Serverless Function — validates the submitted access code
// and, on success, issues a signed, self-expiring session cookie that
// middleware.js verifies.
//
// Valid codes live in Vercel Global Config (Dashboard -> Storage ->
// Global Config — formerly called "Edge Config"), as a single JSON
// object under the key "access_codes":
//   { "lan": "hoaxinhgai", "minh": "hiencute", "hoa": "anhdeptrai" }
// The object's keys are just labels for YOU to recognize whose entry is
// whose when editing; the actual codes are the values. Adding/removing a
// person = editing that one JSON object in the Dashboard — no redeploy
// needed, changes apply within moments. Linking a Global Config store to
// this project makes Vercel inject the GLOBAL_CONFIG connection string
// automatically; the SDK below reads it from there (falling back to the
// older EDGE_CONFIG variable name for stores connected before the rename).
//
// The cookie never stores the access code itself — only a signed token
// (HMAC-SHA256 over "ok:<expiryTimestamp>" using SESSION_SECRET), so the
// code cannot be recovered from the cookie value, and forging a token
// without knowing SESSION_SECRET is infeasible.

const { webcrypto } = require("crypto");
const { get } = require("@vercel/global-config");
const subtle = webcrypto.subtle;

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

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

async function getValidCodes() {
  var codesObj;
  try {
    codesObj = await get("access_codes");
  } catch (e) {
    return null; // Global Config not linked/configured — caller returns 500
  }
  if (!codesObj || typeof codesObj !== "object") return [];
  return Object.keys(codesObj)
    .map(function (k) { return codesObj[k] ? String(codesObj[k]).trim() : ""; })
    .filter(Boolean);
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
  var validCodes = await getValidCodes();

  if (!secret || validCodes === null || validCodes.length === 0) {
    var missing = [];
    if (!secret) missing.push("SESSION_SECRET (Settings -> Environment Variables)");
    if (validCodes === null) missing.push("Global Config chưa được liên kết với project này (Storage -> login-config -> Connect Project)");
    else if (validCodes.length === 0) missing.push("Global Config \"access_codes\" đang rỗng hoặc chưa lưu (Storage -> login-config -> Items -> Save)");
    res.status(500).json({
      error: "Server chưa được cấu hình đầy đủ. Còn thiếu: " + missing.join("; ") + ".",
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
