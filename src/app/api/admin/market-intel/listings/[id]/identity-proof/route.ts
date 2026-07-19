import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { scoreMarketIntelListing } from "../../../../../../../lib/market-intel-deals";
import {
  buildMarketIntelIdentityProofMetadata,
  canVerifyMarketIntelExactIdentity,
  marketIntelIdentityProofMissingEvidence,
  marketIntelIdentityProofStatus,
  type MarketIntelIdentityProofEvidence,
  type MarketIntelIdentityProofRequirements,
  type MarketIntelIdentityProofStatus,
} from "../../../../../../../lib/market-intel-identity-proof";
import { requestOrigin } from "../../../../../../../lib/request-origin";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const allowedDecisions = new Set<MarketIntelIdentityProofStatus>([
  "review_required",
  "probable_exact",
  "verified_exact",
  "conflict_detected",
  "rejected",
]);

function checked(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

function proofEvidence(formData: FormData): MarketIntelIdentityProofEvidence {
  return {
    frontImageConfirmed: checked(formData, "frontImageConfirmed"),
    backImageConfirmed: checked(formData, "backImageConfirmed"),
    slabLabelConfirmed: checked(formData, "slabLabelConfirmed"),
    checklistConfirmed: checked(formData, "checklistConfirmed"),
    cardNumberConfirmed: checked(formData, "cardNumberConfirmed"),
    parallelConfirmed: checked(formData, "parallelConfirmed"),
    serialNumberConfirmed: checked(formData, "serialNumberConfirmed"),
    autographRelicConfirmed: checked(formData, "autographRelicConfirmed"),
    noConflictingEvidence: checked(formData, "noConflictingEvidence"),
  };
}

function proofRequirements(identity: {
  serial_numbered_to?: number | null;
  autograph?: boolean | null;
  memorabilia?: boolean | null;
}): MarketIntelIdentityProofRequirements {
  return {
    serialNumbered: Number(identity.serial_numbered_to || 0) > 0,
    autograph: Boolean(identity.autograph),
    memorabilia: Boolean(identity.memorabilia),
  };
}

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const handoff = adminHandoffFromUrl(url);
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  try {
    const formData = await request.formData();
    const decision = String(formData.get("decision") || "").trim() as MarketIntelIdentityProofStatus;
    const notes = String(formData.get("notes") || "").trim();
    const evidence = proofEvidence(formData);

    if (!allowedDecisions.has(decision)) {
      throw new Error("A valid identity proof decision is required.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: listing, error: listingError } = await supabase
      .from("tcos_mi_listings")
      .select(
        "id,collectible_identity_id,listing_status,metadata,identity_match_confidence,listing_format",
      )
      .eq("id", id)
      .single();
    if (listingError) throw new Error(listingError.message);
    if (!listing.collectible_identity_id) {
      throw new Error("An exact collectible identity must be attached before review.");
    }
    if (String(listing.listing_status) !== "active") {
      throw new Error("Only active Profit Hunter listings may be identity-reviewed.");
    }
    if (decision === "verified_exact" && String(listing.listing_format) === "lot") {
      throw new Error(
        "Lot listings cannot be verified through the single-card Identity Proof Gate.",
      );
    }

    const { data: identity, error: identityError } = await supabase
      .from("tcos_mi_collectible_identities")
      .select("id,serial_numbered_to,autograph,memorabilia,active")
      .eq("id", listing.collectible_identity_id)
      .eq("active", true)
      .single();
    if (identityError) throw new Error(identityError.message);

    const requirements = proofRequirements(identity);
    if (
      decision === "verified_exact" &&
      !canVerifyMarketIntelExactIdentity(evidence, requirements)
    ) {
      const missing = marketIntelIdentityProofMissingEvidence(evidence, requirements);
      throw new Error(
        `VERIFIED EXACT still needs: ${missing.join(", ") || "required evidence"}.`,
      );
    }

    const existingMetadata =
      listing.metadata && typeof listing.metadata === "object" && !Array.isArray(listing.metadata)
        ? (listing.metadata as Record<string, unknown>)
        : {};
    const priorStatus = marketIntelIdentityProofStatus(existingMetadata);
    const reviewedAt = new Date().toISOString();
    const metadata = buildMarketIntelIdentityProofMetadata({
      existingMetadata,
      status: decision,
      evidence,
      requirements,
      notes,
      reviewer: "private_owner",
      reviewedAt,
    });

    const { error: updateError } = await supabase
      .from("tcos_mi_listings")
      .update({
        metadata,
        identity_match_confidence:
          decision === "verified_exact"
            ? 100
            : Number(listing.identity_match_confidence || 0),
      })
      .eq("id", id);
    if (updateError) throw new Error(updateError.message);

    const { error: auditError } = await supabase
      .from("tcos_mi_identity_proof_reviews")
      .insert({
        listing_id: id,
        collectible_identity_id: listing.collectible_identity_id,
        prior_status: priorStatus,
        decision,
        reviewer: "private_owner",
        notes: notes || null,
        evidence: {
          ...(metadata.identity_proof_evidence as Record<string, unknown>),
          requirements: metadata.identity_proof_requirements,
        },
        reviewed_at: reviewedAt,
      });
    if (auditError && auditError.code !== "42P01") {
      throw new Error(auditError.message);
    }

    await scoreMarketIntelListing(id);

    const redirectUrl = adminRedirectUrl(
      `/admin/market-intel/deals/identity-review?saved=${encodeURIComponent(decision)}`,
      origin,
      handoff,
    );
    if (json) {
      return NextResponse.json({
        success: true,
        listingId: id,
        decision,
        redirectUrl: redirectUrl.toString(),
      });
    }
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save identity proof decision.";
    if (json) {
      return NextResponse.json({ success: false, error: message }, { status: 400 });
    }
    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/deals/identity-review?error=${encodeURIComponent(message)}`,
        origin,
        handoff,
      ),
      303,
    );
  }
}
