import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import { getKingmakerPricingByIdentityId } from "../../../../../lib/kingmaker-pricing-server";
import { buildKingmakerPricingDecision } from "../../../../../lib/kingmaker-pricing-decision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return badRequest("A JSON request body is required.");

    const identityId = String(body.identityId || "").trim();
    if (!identityId) return badRequest("identityId is required.");

    const exactIdentity = body.exactIdentity === true;
    const rawSoldComps = Array.isArray(body.soldComps) ? body.soldComps : [];
    const soldComps = rawSoldComps.slice(0, 100).map((value) => {
      const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return {
        price: Number(row.price),
        shipping: row.shipping == null ? null : Number(row.shipping),
        soldAt: row.soldAt == null ? null : String(row.soldAt),
      };
    });

    const pricing = await getKingmakerPricingByIdentityId(identityId);
    const decision = buildKingmakerPricingDecision({
      exactIdentity,
      pricing: pricing
        ? {
            low: pricing.low,
            high: pricing.high,
            midpoint: pricing.midpoint,
            confidence: pricing.confidence,
            status: pricing.status,
            trendPct: pricing.trendPct,
          }
        : null,
      soldComps,
      targetMarginPct: body.targetMarginPct == null ? undefined : Number(body.targetMarginPct),
    });

    return NextResponse.json({
      ok: true,
      identityId,
      decision,
      pricing: pricing
        ? {
            low: pricing.low,
            high: pricing.high,
            midpoint: pricing.midpoint,
            currency: pricing.currency,
            confidence: pricing.confidence,
            status: pricing.status,
            trendPct: pricing.trendPct,
          }
        : null,
      sourceDisclosure: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pricing decision failed.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
