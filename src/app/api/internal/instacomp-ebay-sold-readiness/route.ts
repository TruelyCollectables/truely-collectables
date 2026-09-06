import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { probeEbaySoldDataSources } from "../../../../lib/ebay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request) {
  const expected = String(process.env.CRON_SECRET || process.env.TCOS_CRON_SECRET || "").trim();
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "2025 Prizm #72 Kiki Iriafen Silver";
  const startedAt = Date.now();
  const result = await probeEbaySoldDataSources(query, 5);
  const marketplaceInsightsLive = result.marketplaceInsights.status === "live";
  const findingLive = result.findingCompletedItems.status === "live";

  return NextResponse.json({
    ok: marketplaceInsightsLive || findingLive,
    query: result.query,
    marketplaceInsights: result.marketplaceInsights,
    findingCompletedItems: result.findingCompletedItems,
    durationMs: Date.now() - startedAt,
  }, {
    status: marketplaceInsightsLive || findingLive ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
