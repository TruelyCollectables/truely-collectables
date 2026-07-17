import { NextResponse } from "next/server";
import {
  appendExpiredAdminSessionCookies,
} from "../../../lib/admin-session";
import { configuredSiteOrigin } from "../../../lib/site-origin";

export async function GET(request: Request) {
  const hostname = new URL(request.url).hostname;
  const res = NextResponse.redirect(
    new URL("/admin/login", configuredSiteOrigin()),
  );

  appendExpiredAdminSessionCookies(res.headers, hostname);

  return res;
}
