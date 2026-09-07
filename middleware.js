// Vercel Edge Middleware — gates every request behind an access-code login.
// Runs before any static file (index.html, app.js, data.js...) is served.

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

export default async function middleware(request) {
  const url = new URL(request.url);

  // Defense-in-depth: never gate the login page or its API, even if the
  // matcher config above is ever changed/misconfigured. Without this,
  // a broken matcher would redirect /login.html -> /login.html forever.
  if (url.pathname === "/login.html" || url.pathname === "/api/login") {
    return;
  }

  const secret = process.env.SESSION_SECRET;
  const token = getCookie(request, "pmp_auth");

  if (secret && token) {
    const dotIndex = token.lastIndexOf(".");
    if (dotIndex !== -1) {
      const payload = token.slice(0, dotIndex);
      const sig = token.slice(dotIndex + 1);
      const expiry = Number(payload.split(":")[1]);
      if (Number.isFinite(expiry) && expiry > Date.now()) {
        const expected = await hmacHex(secret, payload);
        if (expected === sig) {
          return; // authenticated — let the request through
        }
      }
    }
  }

  const loginUrl = new URL("/login.html", request.url);
  loginUrl.searchParams.set("redirect", url.pathname + url.search);
  return Response.redirect(loginUrl, 302);
}
