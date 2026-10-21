import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authorized(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeError(payload: Record<string, unknown> | null) {
  const errors = Array.isArray(payload?.errors) ? payload?.errors : [];
  const first = errors[0] && typeof errors[0] === "object" ? (errors[0] as Record<string, unknown>) : null;
  return first
    ? {
        errorId: first.errorId ?? null,
        domain: first.domain ?? null,
        category: first.category ?? null,
        message: String(first.message || "").slice(0, 300) || null,
        longMessage: String(first.longMessage || "").slice(0, 500) || null,
      }
    : null;
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return Response.json(
      { success: false, configured: false, error: "Production eBay client credentials are not configured." },
      { status: 500 },
    );
  }

  const scope = "https://api.ebay.com/oauth/api_scope/commerce.marketplace.insights.readonly";
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenResponse = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const tokenRaw = await tokenResponse.text();
  const tokenPayload = safeJson(tokenRaw);
  const accessToken = String(tokenPayload?.access_token || "").trim();
  if (!tokenResponse.ok || !accessToken) {
    return Response.json({
      success: true,
      configured: true,
      accessGranted: false,
      stage: "oauth_scope",
      tokenHttpStatus: tokenResponse.status,
      tokenError: {
        error: String(tokenPayload?.error || "").slice(0, 200) || null,
        errorDescription: String(tokenPayload?.error_description || "").slice(0, 500) || null,
      },
      scope,
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const endpoint = new URL("https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search");
  endpoint.searchParams.set("q", "2025 Panini Prizm WNBA");
  endpoint.searchParams.set("category_ids", "261328");
  endpoint.searchParams.set("limit", "1");

  const insightResponse = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const insightRaw = await insightResponse.text();
  const insightPayload = safeJson(insightRaw);
  const sales = Array.isArray(insightPayload?.itemSales) ? insightPayload?.itemSales : [];

  return Response.json({
    success: true,
    configured: true,
    accessGranted: insightResponse.ok,
    stage: "marketplace_insights",
    tokenHttpStatus: tokenResponse.status,
    insightHttpStatus: insightResponse.status,
    endpoint: "/buy/marketplace_insights/v1_beta/item_sales/search",
    marketplace: "EBAY_US",
    total: Number(insightPayload?.total || 0),
    returnedSales: sales.length,
    insightError: safeError(insightPayload),
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
