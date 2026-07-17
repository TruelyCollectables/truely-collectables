import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  expiredAdminSessionCookieOptions,
} from "../../../lib/admin-session";
import { configuredSiteOrigin } from "../../../lib/site-origin";

export async function GET() {
  const res = NextResponse.redirect(
    new URL("/admin/login", configuredSiteOrigin()),
  );

  res.cookies.set(
    ADMIN_SESSION_COOKIE_NAME,
    "",
    expiredAdminSessionCookieOptions(),
  );
  res.cookies.set(
    LEGACY_ADMIN_SESSION_COOKIE_NAME,
    "",
    expiredAdminSessionCookieOptions(),
  );

  return res;
}
