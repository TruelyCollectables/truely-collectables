import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../../../../lib/admin-session";
import {
  getProfitHunterConnectorToken,
  maskedSecret,
} from "../../../../../lib/tcos-profit-hunter-secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function requireAdmin(request: NextRequest) {
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(cookieName)?.value;
    if (await isValidAdminSessionValue(value)) return true;
  }
  return false;
}

function response(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) {
    const acceptsHtml = String(request.headers.get("accept") || "").includes(
      "text/html",
    );
    if (acceptsHtml) {
      const loginUrl = new URL("/admin/login", request.nextUrl.origin);
      loginUrl.searchParams.set(
        "next",
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      );
      return NextResponse.redirect(loginUrl, 303);
    }
    return response({ error: "Unauthorized" }, 401);
  }

  const token = getProfitHunterConnectorToken();
  if (!token) {
    return response(
      {
        ok: false,
        error:
          "Profit Hunter connector authentication is unavailable because ADMIN_SESSION_SECRET is not configured.",
      },
      503,
    );
  }

  const reveal = request.nextUrl.searchParams.get("reveal") === "1";
  return response({
    ok: true,
    mcpUrl: `${request.nextUrl.origin}/api/tcos-profit-hunter/mcp`,
    authentication: "Bearer",
    token: reveal ? token : null,
    maskedToken: maskedSecret(token),
    revealed: reveal,
    instructions: reveal
      ? "Copy this bearer token into the ChatGPT MCP app authentication field. Do not share or store it in source code."
      : "Add ?reveal=1 to this admin-only URL to display the connector bearer token.",
  });
}
