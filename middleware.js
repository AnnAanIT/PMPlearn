// Vercel Edge Middleware — gates every request behind an access-code login.
// Runs before any static file (index.html, app.js, data.js...) is served.
//
// Beyond verifying the session cookie's signature and expiry, this also
// re-checks Global Config on every request: the cookie carries WHICH
// person's entry (label) was used to log in and a fingerprint of the code
// value at that time. If that label is deleted from Global Config, or its
// value is changed, the fingerprint no longer matches and the session is
// rejected immediately — revocation doesn't wait for the cookie to expire.
// See api/login.js for how the cookie is constructed.

import { get } from "@vercel/global-config";

export const config = {
  matcher: ["/((?!login\\.html$|api/login$|favicon\\.ico$).*)"],
};

async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

// payload = "ok:<expiryMs>:<label>:<fingerprint>" — label may itself
// contain ":" (unlikely, but Global Config keys aren't restricted), so
// parse from both ends rather than a naive split(":").
function parseToken(token) {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const payload = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const parts = payload.split(":");
  if (parts.length < 4 || parts[0] !== "ok") return null;

  const expiry = Number(parts[1]);
  const fingerprint = parts[parts.length - 1];
  const label = parts.slice(2, -1).join(":");
  if (!Number.isFinite(expiry) || !label || !fingerprint) return null;

  return { payload, sig, expiry, label, fingerprint };
}

export default async function middleware(request) {
  const url = new URL(request.url);

  // Defense-in-depth: never gate the login page or its API, even if the
  // matcher config above is ever changed/misconfigured.
  if (url.pathname === "/login.html" || url.pathname === "/api/login") {
    return;
  }

  const secret = process.env.SESSION_SECRET;
  const rawToken = getCookie(request, "pmp_auth");

  if (secret && rawToken) {
    const parsed = parseToken(rawToken);
    if (parsed && parsed.expiry > Date.now()) {
      const expectedSig = await hmacHex(secret, parsed.payload);
      if (expectedSig === parsed.sig) {
        // Signature and expiry check out — now confirm this person's code
        // is still valid in Global Config *right now*, so a deleted or
        // rotated code revokes access immediately instead of waiting out
        // the cookie's Max-Age.
        try {
          const currentValue = await get(parsed.label);
          if (currentValue) {
            const expectedFingerprint = await hmacHex(secret, "code:" + String(currentValue).trim());
            if (expectedFingerprint === parsed.fingerprint) {
              return; // still authorized — let the request through
            }
          }
        } catch (e) {
          // Global Config unreachable: fail closed (treat as unauthorized)
          // rather than silently letting a possibly-revoked session through.
        }
      }
    }
  }

  const loginUrl = new URL("/login.html", request.url);
  loginUrl.searchParams.set("redirect", url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}
