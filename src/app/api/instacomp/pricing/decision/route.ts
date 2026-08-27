import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";
import { getKingmakerPricingByIdentityId } from "../../../../../lib/kingmaker-pricing-server";
import { buildKingmakerPricingDecision } from "../../../../../lib/kingmaker-pricing-decision";
import { resolveKingmakerPricingProfile } from "../../../../../lib/kingmaker-pricing-profile-server";
import { writeKingmakerPricingDecisionReceipt } from "../../../../../lib/kingmaker-pricing-decision-receipt-server";
import { suppliedInstaCompServerOwnedPricingFields } from "../../../../../lib/instacomp-pricing-request-security";

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

    const serverOwnedFields = suppliedInstaCompServerOwnedPricingFields(body);
    if (serverOwnedFields.length) {
      return badRequest(
        `Pricing evidence and economics are server-owned. Remove: ${serverOwnedFields.join(", ")}.`,
      );
    }

    const identityId = String(body.identityId || "").trim();
    if (!identityId) return badRequest("identityId is required.");

    const [pricing, selectedProfile] = await Promise.all([
      getKingmakerPricingByIdentityId(identityId),
      resolveKingmakerPricingProfile({
        actor,
        profileId: body.profileId == null ? null : String(body.profileId),
      }),
    ]);
    const profile = selectedProfile.profile;

    // Round Three evidence boundary: a browser may select an identity and an
    // actor-owned pricing profile, but it may not manufacture exact identity,
    // completed sales, fees, shipping, or margin evidence. Until a dedicated
    // authoritative completed-sale loader is wired to this route, an otherwise
    // verified price-index reference remains insufficient for a ready decision.
    const decision = buildKingmakerPricingDecision({
      exactIdentity: pricing?.status === "verified",
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
      soldComps: [],
      targetMarginPct: profile.targetMarginPct,
      marketplaceFeePct: profile.marketplaceFeePct,
      paymentFeePct: profile.paymentFeePct,
      paymentFixedFee: profile.paymentFixedFee,
      shippingCost: profile.estimatedShippingCost,
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
      sourceDisclosure: {
        pricingReference: pricing ? "server_owned_price_index" : "missing",
        completedSales: "authoritative_loader_required",
        boundary: "advisory_only",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pricing decision failed.";
    const status = message.includes("AUTH") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
