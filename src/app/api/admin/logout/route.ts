import { NextResponse } from "next/server";
import {
  appendExpiredAdminSessionCookies,
} from "../../../../lib/admin-session";
import { requestHostname } from "../../../../lib/request-origin";

export async function POST(request: Request) {
  const hostname = requestHostname(request);
  const res = NextResponse.json({ success: true });

  appendExpiredAdminSessionCookies(res.headers, hostname);

  return res;
}
