import { NextResponse } from "next/server";
import {
  appendExpiredAdminSessionCookies,
} from "../../../lib/admin-session";
import { requestHostname, requestOrigin } from "../../../lib/request-origin";

export async function GET(request: Request) {
  const hostname = requestHostname(request);
  const res = NextResponse.redirect(
    new URL("/admin/login", requestOrigin(request)),
  );

  appendExpiredAdminSessionCookies(res.headers, hostname);

  return res;
}
