// Vercel Node.js Serverless Function — validates the submitted access code
// and, on success, issues a signed, self-expiring session cookie that
// middleware.js re-verifies against Global Config on every request (so
// deleting or changing someone's code revokes their session immediately,
// not just at their next login).
//
// Valid codes live directly at the root of the Vercel Global Config store
// (Dashboard -> Storage -> Global Config — formerly called "Edge Config"),
// one key per person:
//   { "hoa": "hoaxinhgai", "hien": "hiencute", "anh": "anhdeptrai" }
// The keys are just labels for YOU to recognize whose entry is whose when
// editing; the actual codes are the values. Adding/removing a person =
// editing that JSON in the Dashboard and clicking Save — no redeploy
// needed, changes apply within moments. Linking a Global Config store to
// this project makes Vercel inject the GLOBAL_CONFIG connection string
// automatically; the SDK below reads it from there (falling back to the
// older EDGE_CONFIG variable name for stores connected before the rename).
//
// Cookie payload: "ok:<expiryMs>:<label>:<codeFingerprint>" + "." + <sig>
//   - <label>           which Global Config key matched at login time
//   - <codeFingerprint> HMAC-SHA256(SESSION_SECRET, "code:" + theActualCode)
//   - <sig>             HMAC-SHA256(SESSION_SECRET, payload) — tamper-proofs
//                       the whole payload
// The raw code is never stored in the cookie, only its fingerprint, so a
// leaked cookie can't be used to recover the code itself. On every request,
// middleware.js looks up <label> in Global Config and recomputes the
// fingerprint of its CURRENT value — if the label was deleted, or its value
// changed, the fingerprint no longer matches and the session is rejected
// immediately, even though the cookie itself hasn't expired.

const { webcrypto } = require("crypto");
const { getAll } = require("@vercel/global-config");
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

async function getCodesMap() {
  var allItems;
  try {
    allItems = await getAll();
  } catch (e) {
    return null; // Global Config not linked/configured — caller returns 500
  }
  if (!allItems || typeof allItems !== "object") return {};
  var map = {};
  Object.keys(allItems).forEach(function (k) {
    var v = allItems[k];
    if (v) map[k] = String(v).trim();
  });
  return map;
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
  var codesMap = await getCodesMap();
  var codeCount = codesMap ? Object.keys(codesMap).length : 0;

  if (!secret || codesMap === null || codeCount === 0) {
    var missing = [];
    if (!secret) missing.push("SESSION_SECRET (Settings -> Environment Variables)");
    if (codesMap === null) missing.push("Global Config chưa được liên kết với project này (Storage -> login-config -> Connect Project)");
    else if (codeCount === 0) missing.push("Global Config đang rỗng hoặc chưa lưu (Storage -> login-config -> Items -> Save)");
    res.status(500).json({
      error: "Server chưa được cấu hình đầy đủ. Còn thiếu: " + missing.join("; ") + ".",
    });
    return;
  }

  var matchedLabel = null;
  if (code) {
    for (var label in codesMap) {
      if (codesMap[label] === code) {
        matchedLabel = label;
        break;
      }
    }
  }

  if (!matchedLabel) {
    res.status(401).json({ error: "Mã không đúng." });
    return;
  }

  var expiry = Date.now() + THIRTY_DAYS_MS;
  var codeFingerprint = await hmacHex(secret, "code:" + code);
  var payload = "ok:" + expiry + ":" + matchedLabel + ":" + codeFingerprint;
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
