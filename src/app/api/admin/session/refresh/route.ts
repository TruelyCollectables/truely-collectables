import { NextResponse } from "next/server";
import {
  appendAdminSessionCookies,
  createAdminSessionValue,
} from "../../../../../lib/admin-session";
import { requestHostname } from "../../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const sessionValue = await createAdminSessionValue();
    const response = NextResponse.json({ success: true });

    appendAdminSessionCookies(
      response.headers,
      requestHostname(req),
      sessionValue,
    );

    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Unable to refresh the admin session." },
      { status: 500 },
    );
  }
}
