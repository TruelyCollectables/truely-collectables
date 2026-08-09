import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getInstaCompServiceToken } from "../../../../lib/tcos-profit-hunter-secrets";
import { filterExactEbayPriceInsightsRows } from "../../../../lib/instacomp-ebay-price-insights";
import {
  loadExactCardMarketHistory,
  persistExactCardMarketHistory,
  type ExactMarketTargetListing,
  type InstaCompRegistryTruth,
} from "../../../../lib/instacomp-market-history";
import type { InstaCompAiResult, InstaCompComp } from "../../../../lib/instacomp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: NextRequest) {
  const serviceExpected = getInstaCompServiceToken();
  const serviceProvided = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (serviceExpected && serviceProvided && safeEqual(serviceExpected, serviceProvided)) return true;

  const macExpected = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  const macProvided = String(request.headers.get("x-instacomp-ai-key") || "").trim();
  return Boolean(macExpected && macProvided && safeEqual(macExpected, macProvided));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return json({ ok: false, error: "Invalid InstaComp service credential." }, 401);
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const registry = body.registry as InstaCompRegistryTruth | undefined;
    const ai = body.ai as InstaCompAiResult | undefined;
    if (!ai || typeof ai !== "object") {
      return json({ ok: false, error: "ai identity is required." }, 400);
    }

    const suppliedSold = Array.isArray(body.sold) ? (body.sold as InstaCompComp[]) : [];
    const priceInsights = filterExactEbayPriceInsightsRows(body.priceInsights, ai, 50);
    const sold = [...suppliedSold, ...priceInsights.accepted];
    const active = Array.isArray(body.active) ? (body.active as InstaCompComp[]) : [];
    const targetListing =
      body.targetListing && typeof body.targetListing === "object"
        ? (body.targetListing as ExactMarketTargetListing)
        : null;

    const result = await persistExactCardMarketHistory({
      registry,
      ai,
      sold,
      active,
      targetListing,
      scanId: String(body.scanId || "").trim() || null,
      observedAt: String(body.observedAt || "").trim() || undefined,
    });
    return json(
      {
        ok: result.status !== "blocked",
        ...result,
        priceInsights: {
          source: "ebay_price_insights_owner_capture",
          received: priceInsights.received,
          normalized: priceInsights.normalized,
          acceptedExactSold: priceInsights.accepted.length,
          rejected: priceInsights.rejected,
          identityMutated: false,
          pricingAuthority: false,
        },
      },
      result.status === "blocked" ? 409 : 200,
    );
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return json({ ok: false, error: "Invalid InstaComp service credential." }, 401);
  }
  const identityId = String(
    request.nextUrl.searchParams.get("registryIdentityId") || "",
  ).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId)) {
    return json({ ok: false, error: "A valid registryIdentityId is required." }, 400);
  }
  try {
    return json({ ok: true, ...(await loadExactCardMarketHistory(identityId)) });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
}
