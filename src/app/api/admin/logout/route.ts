import { NextResponse } from "next/server";
import {
  appendExpiredAdminSessionCookies,
} from "../../../../lib/admin-session";

export async function POST(request: Request) {
  const hostname = new URL(request.url).hostname;
  const res = NextResponse.json({ success: true });

  appendExpiredAdminSessionCookies(res.headers, hostname);

  return res;
}
