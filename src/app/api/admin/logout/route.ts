import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  LEGACY_ADMIN_SESSION_COOKIE_NAME,
  expiredAdminSessionCookieOptions,
} from "../../../../lib/admin-session";

export async function POST() {
  const res = NextResponse.json({ success: true });

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
