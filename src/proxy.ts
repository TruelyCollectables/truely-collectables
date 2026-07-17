import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getClientIdentity } from "./lib/client-identity";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  appendAdminSessionCookies,
  isValidAdminSessionValue,
} from "./lib/admin-session";

function applySecurityHeaders(response: NextResponse, req: NextRequest) {
  const isAdminOrApi =
    req.nextUrl.pathname.startsWith("/admin") ||
    req.nextUrl.pathname.startsWith("/api");

  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("X-Permitted-Cross-Domain-Policies", "none");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(self)",
  );
  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://checkout.stripe.com",
    ].join("; "),
  );

  if (process.env.NODE_ENV === "production") {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  if (isAdminOrApi) {
    response.headers.set("Cache-Control", "no-store");
  }

  return response;
}

function isProtectedPath(pathname: string): boolean {
  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    return true;
  }

  if (pathname.startsWith("/ebay")) return true;
  if (
    pathname === "/api/ebay/callback" ||
    pathname === "/api/ebay/notifications"
  ) {
    return false;
  }
  if (pathname.startsWith("/api/ebay")) return true;
  if (pathname.startsWith("/api/orders")) return true;
  if (pathname.startsWith("/api/admin") && pathname !== "/api/admin/login") {
    return true;
  }
  if (pathname === "/api/offers/update-status") return true;
  if (pathname === "/api/offers/counter") return true;

  return false;
}

function isIdentityCheckExempt(pathname: string): boolean {
  return (
    pathname === "/api/webhook" ||
    pathname === "/api/stripe/webhook" ||
    pathname === "/api/ebay/notifications" ||
    pathname.startsWith("/api/cron/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  );
}

function isLocalhostRequest(req: NextRequest): boolean {
  return (
    req.nextUrl.hostname === "localhost" ||
    req.nextUrl.hostname === "127.0.0.1" ||
    req.nextUrl.hostname === "::1"
  );
}

function maskedIdentityResponse(req: NextRequest, reason: string | null) {
  const message = "Sorry, you must turn off your proxy or VPN to use this website.";

  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json(
      {
        error: message,
        reason,
      },
      { status: 403 },
    );
  }

  return new NextResponse(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Proxy or VPN Detected</title>
  <style>
    body {
      align-items: center;
      background: #f8fafc;
      color: #111827;
      display: flex;
      font-family: Arial, Helvetica, sans-serif;
      justify-content: center;
      margin: 0;
      min-height: 100vh;
      padding: 24px;
    }

    main {
      background: #ffffff;
      border: 1px solid #dbe3ef;
      border-radius: 8px;
      max-width: 560px;
      padding: 28px;
    }

    h1 {
      font-size: 24px;
      margin: 0 0 12px;
    }

    p {
      line-height: 1.55;
      margin: 0;
    }
  </style>
</head>
<body>
  <main>
    <h1>Proxy or VPN Detected</h1>
    <p>${message}</p>
  </main>
</body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
      status: 403,
    },
  );
}

function unauthorized(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  const nextPath = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  url.pathname = "/admin/login";
  url.search = "";
  url.searchParams.set("next", nextPath);
  return NextResponse.redirect(url);
}

function canonicalDomainRedirect(req: NextRequest) {
  if (req.nextUrl.hostname.toLowerCase() !== "www.truelycollectables.com") {
    return null;
  }

  const url = req.nextUrl.clone();
  url.hostname = "truelycollectables.com";

  return NextResponse.redirect(url, 308);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const canonicalRedirect = canonicalDomainRedirect(req);

  if (canonicalRedirect) {
    return applySecurityHeaders(canonicalRedirect, req);
  }

  if (!isIdentityCheckExempt(pathname) && !isLocalhostRequest(req)) {
    const clientIdentity = await getClientIdentity(req);

    if (clientIdentity.blocked) {
      return applySecurityHeaders(
        maskedIdentityResponse(req, clientIdentity.blockReason),
        req,
      );
    }
  }

  if (isProtectedPath(pathname)) {
    const adminHandoff = req.nextUrl.searchParams.get("admin_handoff");

    if (adminHandoff && (await isValidAdminSessionValue(adminHandoff))) {
      const url = req.nextUrl.clone();
      url.searchParams.delete("admin_handoff");
      const response = NextResponse.redirect(url, 303);

      appendAdminSessionCookies(
        response.headers,
        req.nextUrl.hostname,
        adminHandoff,
      );

      return applySecurityHeaders(response, req);
    }

    const adminCookies = ADMIN_SESSION_COOKIE_NAMES.flatMap((cookieName) =>
      req.cookies.getAll(cookieName).map((cookie) => cookie.value),
    );
    let isValidSession = false;

    for (const adminCookie of adminCookies) {
      if (await isValidAdminSessionValue(adminCookie)) {
        isValidSession = true;
        break;
      }
    }

    if (!isValidSession) {
      return applySecurityHeaders(unauthorized(req), req);
    }
  }

  return applySecurityHeaders(NextResponse.next(), req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
