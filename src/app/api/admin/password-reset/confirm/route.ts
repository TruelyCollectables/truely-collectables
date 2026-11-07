import { NextResponse } from "next/server";
import {
  appendAdminSessionCookies,
  appendExpiredAdminSessionCookies,
  createAdminSessionValue,
} from "../../../../../lib/admin-session";
import { consumeAdminPasswordReset } from "../../../../../lib/admin-credentials";
import { safeAdminLoginNextPath } from "../../../../../lib/admin-login-destination";
import { requestHostname, requestOrigin } from "../../../../../lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resetRedirect(
  req: Request,
  token: string,
  nextPath: string,
  error: string,
) {
  const url = new URL("/admin/reset-password", requestOrigin(req));
  if (token) url.searchParams.set("token", token);
  url.searchParams.set("next", nextPath);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const formData = await req.formData().catch(() => null);
  const token = String(formData?.get("token") || "").trim();
  const password = String(formData?.get("password") || "");
  const confirmation = String(formData?.get("confirmation") || "");
  const nextPath = safeAdminLoginNextPath(formData?.get("next"));

  if (!token || !formData) {
    return resetRedirect(req, token, nextPath, "invalid");
  }
  if (password !== confirmation) {
    return resetRedirect(req, token, nextPath, "mismatch");
  }

  try {
    const result = await consumeAdminPasswordReset(token, password);
    if (!result.ok) {
      return resetRedirect(
        req,
        token,
        nextPath,
        result.reason?.includes("at least") ? "policy" : "invalid",
      );
    }

    const sessionValue = await createAdminSessionValue();
    const response = NextResponse.redirect(
      new URL(nextPath, requestOrigin(req)),
      303,
    );
    const hostname = requestHostname(req);
    appendExpiredAdminSessionCookies(response.headers, hostname);
    appendAdminSessionCookies(response.headers, hostname, sessionValue);
    return response;
  } catch (error) {
    console.error("Admin password reset confirmation failed:", error);
    return resetRedirect(req, token, nextPath, "storage_error");
  }
}
