import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  expiredAdminSessionCookieOptionsForHost,
} from "../../../lib/admin-session";
import { configuredSiteOrigin } from "../../../lib/site-origin";

export async function GET(request: Request) {
  const hostname = new URL(request.url).hostname;
  const res = NextResponse.redirect(
    new URL("/admin/login", configuredSiteOrigin()),
  );

  res.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    "",
    expiredAdminSessionCookieOptionsForHost(hostname),
  );
  res.cookies.set(
    LEGACY_ADMIN_SESSION_COOKIE_NAME,
    "",
    expiredAdminSessionCookieOptionsForHost(hostname),
  );

  return res;
}
