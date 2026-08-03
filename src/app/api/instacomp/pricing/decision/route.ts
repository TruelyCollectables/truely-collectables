import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import { getKingmakerPricingByIdentityId } from "../../../../../lib/kingmaker-pricing-server";
import { buildKingmakerPricingDecision } from "../../../../../lib/kingmaker-pricing-decision";
import { resolveKingmakerPricingProfile } from "../../../../../lib/kingmaker-pricing-profile-server";
import { writeKingmakerPricingDecisionReceipt } from "../../../../../lib/kingmaker-pricing-decision-receipt-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 400 });
}

function optionalNumber(value: unknown) {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

    const [pricing, selectedProfile] = await Promise.all([
      getKingmakerPricingByIdentityId(identityId),
      resolveKingmakerPricingProfile({
        actor,
        profileId: body.profileId == null ? null : String(body.profileId),
      }),
    ]);
    const profile = selectedProfile.profile;

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
      targetMarginPct: optionalNumber(body.targetMarginPct) ?? profile.targetMarginPct,
      marketplaceFeePct: optionalNumber(body.marketplaceFeePct) ?? profile.marketplaceFeePct,
      paymentFeePct: optionalNumber(body.paymentFeePct) ?? profile.paymentFeePct,
      paymentFixedFee: optionalNumber(body.paymentFixedFee) ?? profile.paymentFixedFee,
      shippingCost: optionalNumber(body.shippingCost) ?? profile.estimatedShippingCost,
    });

    const receiptId = await writeKingmakerPricingDecisionReceipt({
      actor,
      identityId,
      profileResolution: selectedProfile,
      decision,
    });

    return NextResponse.json({
      ok: true,
      identityId,
      receiptId,
      decision,
      pricingProfile: {
        id: profile.id,
        name: profile.name,
        selection: selectedProfile.selection,
        marketplaceFeePct: profile.marketplaceFeePct,
        paymentFeePct: profile.paymentFeePct,
        paymentFixedFee: profile.paymentFixedFee,
        estimatedShippingCost: profile.estimatedShippingCost,
        targetMarginPct: profile.targetMarginPct,
      },
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
