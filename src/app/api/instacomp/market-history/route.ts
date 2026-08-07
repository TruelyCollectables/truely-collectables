import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getInstaCompServiceToken } from "../../../../lib/tcos-profit-hunter-secrets";
import {
  loadExactCardMarketHistory,
  persistExactCardMarketHistory,
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
  const expected = getInstaCompServiceToken();
  const provided = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  return Boolean(expected && provided && safeEqual(expected, provided));
}

type TargetListing = {
  title?: string | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  deliveredPrice?: number | null;
  currency?: string | null;
  url?: string | null;
  imageUrl?: string | null;
  marketplace?: string | null;
  observedAt?: string | null;
  conditionText?: string | null;
};

function targetAsComp(value: TargetListing): InstaCompComp | null {
  const url = String(value.url || "").trim();
  const title = String(value.title || "").trim();
  if (!url || !title) return null;
  const item = Number(value.itemPrice);
  const shipping = Number(value.shippingPrice || 0);
  const explicitDelivered = Number(value.deliveredPrice);
  const delivered = Number.isFinite(explicitDelivered)
    ? explicitDelivered
    : Number.isFinite(item)
      ? item + (Number.isFinite(shipping) ? shipping : 0)
      : NaN;
  if (!Number.isFinite(delivered) || delivered < 0) return null;
  return {
    title,
    price: Number(delivered.toFixed(2)),
    itemPrice: Number.isFinite(item) ? Number(item.toFixed(2)) : null,
    shippingPrice: Number.isFinite(shipping) ? Number(shipping.toFixed(2)) : null,
    priceIncludesShipping: true,
    currency: String(value.currency || "USD").trim() || "USD",
    url,
    imageUrl: value.imageUrl || null,
    source: "deal_hunter_target",
    sourceLabel: String(value.marketplace || "Deal Hunter Listing").trim() || "Deal Hunter Listing",
    sourceCategory: "marketplace",
    matchScore: 1,
    flags: ["deal hunter target", "registry-confirmed exact card"],
    observedAt: value.observedAt || new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false, error: "Invalid InstaComp service credential." }, 401);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const registry = body.registry as InstaCompRegistryTruth | undefined;
    const ai = body.ai as InstaCompAiResult | undefined;
    if (!ai || typeof ai !== "object") return json({ ok: false, error: "ai identity is required." }, 400);
    const sold = Array.isArray(body.sold) ? (body.sold as InstaCompComp[]) : [];
    const active = Array.isArray(body.active) ? (body.active as InstaCompComp[]) : [];
    const target = body.targetListing && typeof body.targetListing === "object"
      ? targetAsComp(body.targetListing as TargetListing)
      : null;
    if (target) active.unshift(target);

    const result = await persistExactCardMarketHistory({
      registry,
      ai,
      sold,
      active,
      scanId: String(body.scanId || "").trim() || null,
      observedAt: String(body.observedAt || "").trim() || undefined,
    });
    return json({ ok: result.status !== "blocked", ...result }, result.status === "blocked" ? 409 : 200);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return json({ ok: false, error: "Invalid InstaComp service credential." }, 401);
  const identityId = String(request.nextUrl.searchParams.get("registryIdentityId") || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId)) {
    return json({ ok: false, error: "A valid registryIdentityId is required." }, 400);
  }
  try {
    return json({ ok: true, ...(await loadExactCardMarketHistory(identityId)) });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
