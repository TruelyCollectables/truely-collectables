import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  expiredAdminSessionCookieOptionsForHost,
} from "../../../../lib/admin-session";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  const res = NextResponse.json({ success: true });

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
