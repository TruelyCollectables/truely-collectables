import { NextResponse } from "next/server";
import { postInstaCompMacAccounting } from "../../../../lib/instacomp-mac-accounting-client";

export const dynamic = "force-dynamic";

/**
 * Real eBay application-credential health check.
 * This does NOT prove seller consent, refresh-token validity, or sync health.
 * Existing request-gate protects this API in production.
 */
export async function GET() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    return NextResponse.json(
      { success: false, applicationAuthenticated: false, userAuthorized: false, reason: "missing_app_credentials" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const sandbox = process.env.EBAY_ENVIRONMENT === "sandbox";
  const origin = sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

  let response: Response;
  try {
    response = await fetch(`${origin}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    return NextResponse.json(
      { success: false, applicationAuthenticated: false, userAuthorized: false, reason: "ebay_unreachable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }

  let authenticated = false;
  if (response.ok) {
    try {
      const json = await response.json() as { access_token?: unknown };
      authenticated = typeof json.access_token === "string" && json.access_token.length > 0;
    } catch {
      authenticated = false;
    }
  }

  let sellerReady = false;
  try {
    const bridge = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/ebay-bridge",
      { mode: "readiness" },
      45_000,
    );
    sellerReady = bridge?.readiness?.ready === true;
  } catch {
    sellerReady = false;
  }

  const healthy = authenticated && sellerReady;
  return NextResponse.json(
    {
      success: healthy,
      applicationAuthenticated: authenticated,
      userAuthorized: sellerReady,
      sellerReadiness: sellerReady,
      message: healthy
        ? "eBay app credentials and the Mac-local KINGMAKER seller authorization are verified."
        : "At least one independent eBay credential or Mac-local seller readiness check failed.",
      upstreamStatus: response.status,
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
