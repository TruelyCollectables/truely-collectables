import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import {
  buildMarketIntelIdentityProofMetadata,
  canVerifyMarketIntelExactIdentity,
  marketIntelIdentityProofMissingEvidence,
  type MarketIntelIdentityProofEvidence,
  type MarketIntelIdentityProofRequirements,
  type MarketIntelIdentityProofStatus,
} from "../../../../../../../lib/market-intel-identity-proof";
import { ingestMarketIntelListings } from "../../../../../../../lib/market-intel-ingestion";
import { requestOrigin } from "../../../../../../../lib/request-origin";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type JsonRecord = Record<string, unknown>;

const allowedDecisions = new Set<MarketIntelIdentityProofStatus>([
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

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const origin = requestOrigin(request);
  const json = wantsJson(request);

  try {
    const formData = await request.formData();
    const decision = String(formData.get("decision") || "").trim() as MarketIntelIdentityProofStatus;
    const identityId = String(formData.get("identityId") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const evidence = proofEvidence(formData);

    if (!allowedDecisions.has(decision)) {
      throw new Error("A valid candidate decision is required.");
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const { data: candidate, error: candidateError } = await supabase
      .from("tcos_mi_search_candidates")
      .select("*")
      .eq("id", id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    if (String(candidate.status) === "promoted") {
      throw new Error("This search candidate was already promoted into Profit Hunter.");
    }

    const reviewedAt = new Date().toISOString();
    const candidateEvidence = recordValue(candidate.evidence);

    if (decision !== "verified_exact") {
      const { error: updateError } = await supabase
        .from("tcos_mi_search_candidates")
        .update({
          status: decision,
          collectible_identity_id: identityId || candidate.collectible_identity_id || null,
          reviewed_at: reviewedAt,
          updated_at: reviewedAt,
          evidence: {
            ...candidateEvidence,
            identity_proof_decision: decision,
            identity_proof_notes: notes || null,
            identity_proof_evidence: evidence,
            identity_proof_reviewer: "private_owner",
            identity_proof_reviewed_at: reviewedAt,
          },
        })
        .eq("id", id);
      if (updateError) throw new Error(updateError.message);

      const { error: auditError } = await supabase
        .from("tcos_mi_identity_proof_reviews")
        .insert({
          candidate_id: id,
          collectible_identity_id: identityId || candidate.collectible_identity_id || null,
          prior_status: String(candidate.status || "pending_review"),
          decision,
          reviewer: "private_owner",
          notes: notes || null,
          evidence,
          reviewed_at: reviewedAt,
        });
      if (auditError && auditError.code !== "42P01") {
        throw new Error(auditError.message);
      }

      const redirectUrl = adminRedirectUrl(
        `/admin/market-intel/deals/identity-review?saved=${encodeURIComponent(decision)}`,
        origin,
        handoff,
      );
      if (json) {
        return NextResponse.json({ success: true, candidateId: id, decision });
      }
      return NextResponse.redirect(redirectUrl, 303);
    }

    if (!identityId) throw new Error("Select the exact collectible identity first.");
    if (
      String(candidate.listing_format || "") === "lot" ||
      String(candidate.query_mode || "") === "lot" ||
      candidateEvidence.requires_lot_workflow === true
    ) {
      throw new Error(
        "Lot candidates cannot be promoted as one exact card. Reject this single-card candidate or send it through the lot-composition workflow.",
      );
    }

    const { data: identity, error: identityError } = await supabase
      .from("tcos_mi_collectible_identities")
      .select(
        "id,identity_key,display_name,active,serial_numbered_to,autograph,memorabilia",
      )
      .eq("id", identityId)
      .eq("active", true)
      .single();
    if (identityError) throw new Error(identityError.message);

    const requirements = proofRequirements(identity);
    if (!canVerifyMarketIntelExactIdentity(evidence, requirements)) {
      throw new Error(
        `VERIFIED EXACT still needs: ${marketIntelIdentityProofMissingEvidence(evidence, requirements).join(", ") || "required evidence"}.`,
      );
    }

    let siblingQuery = supabase
      .from("tcos_mi_search_candidates")
      .select("id,collectible_identity_id,status,original_title")
      .eq("source_slug", String(candidate.source_slug))
      .neq("id", id)
      .neq("status", "rejected");
    siblingQuery = candidate.external_listing_id
      ? siblingQuery.eq("external_listing_id", String(candidate.external_listing_id))
      : siblingQuery.eq("direct_url", String(candidate.direct_url));
    const { data: siblingRows, error: siblingError } = await siblingQuery;
    if (siblingError) throw new Error(siblingError.message);
    const conflictingSiblings = (siblingRows || []).filter(
      (row) =>
        row.collectible_identity_id &&
        String(row.collectible_identity_id) !== String(identity.id),
    );
    if (conflictingSiblings.length) {
      throw new Error(
        `Promotion blocked: this marketplace listing is still attached to ${conflictingSiblings.length} different identity candidate${conflictingSiblings.length === 1 ? "" : "s"}. Reject the wrong sibling candidate first.`,
      );
    }

    const { data: marketplace, error: marketplaceError } = await supabase
      .from("tcos_mi_marketplaces")
      .select("id,slug")
      .eq("slug", String(candidate.source_slug))
      .eq("active", true)
      .single();
    if (marketplaceError) throw new Error(marketplaceError.message);

    let existingListingQuery = supabase
      .from("tcos_mi_listings")
      .select("id,collectible_identity_id,listing_status,metadata,identity_match_confidence")
      .eq("marketplace_id", marketplace.id);
    existingListingQuery = candidate.external_listing_id
      ? existingListingQuery.eq("external_listing_id", String(candidate.external_listing_id))
      : existingListingQuery.eq("direct_url", String(candidate.direct_url));
    const { data: existingListingRows, error: existingListingError } =
      await existingListingQuery.limit(1);
    if (existingListingError) throw new Error(existingListingError.message);
    const existingListing = existingListingRows?.[0] || null;
    if (
      existingListing?.collectible_identity_id &&
      String(existingListing.collectible_identity_id) !== String(identity.id)
    ) {
      throw new Error(
        "Promotion blocked: this marketplace listing already exists under a different collectible identity. Resolve that listing before continuing.",
      );
    }

    const proofMetadata = buildMarketIntelIdentityProofMetadata({
      existingMetadata: {
        source_candidate_id: id,
        source_candidate_evidence: candidateEvidence,
      },
      status: "verified_exact",
      evidence,
      requirements,
      notes,
      reviewer: "private_owner",
      reviewedAt,
    });

    const ingest = await ingestMarketIntelListings([
      {
        marketplaceSlug: String(candidate.source_slug),
        collectibleIdentityId: identity.id,
        collectibleIdentityKey: identity.identity_key,
        externalListingId: candidate.external_listing_id
          ? String(candidate.external_listing_id)
          : null,
        directUrl: String(candidate.direct_url),
        originalTitle: String(candidate.original_title),
        description: candidate.description ? String(candidate.description) : null,
        imageUrls: stringArray(candidate.image_urls),
        listingFormat: String(candidate.listing_format || "unknown"),
        askingPrice: Number(candidate.asking_price || 0),
        shippingPrice: Number(candidate.shipping_price || 0),
        buyerFee: Number(candidate.buyer_fee || 0),
        quantity: Math.max(1, Number(candidate.quantity || 1)),
        sellerName: candidate.seller_name ? String(candidate.seller_name) : null,
        sellerRating:
          candidate.seller_rating === null || candidate.seller_rating === undefined
            ? null
            : Number(candidate.seller_rating),
        listedAt: candidate.listed_at ? String(candidate.listed_at) : null,
        lastSeenAt: candidate.last_seen_at ? String(candidate.last_seen_at) : reviewedAt,
        auctionEndAt: candidate.auction_end_at ? String(candidate.auction_end_at) : null,
        identityMatchConfidence: 100,
        identityMatchMethod: "private_owner_identity_proof_gate_v2",
        suspectedMislisting: String(candidate.query_mode || "") !== "exact",
        mislistingReason:
          String(candidate.query_mode || "") !== "exact"
            ? `External worker ${String(candidate.query_mode || "broad").replaceAll("_", " ")} search required owner identity proof.`
            : null,
        metadata: {
          ...proofMetadata,
          external_worker_candidate: true,
          external_worker_query_mode: candidate.query_mode || null,
          external_worker_query_text: candidate.query_text || null,
          external_worker_candidate_confidence: candidate.candidate_confidence || null,
          external_worker_candidate_priority_score:
            candidate.candidate_priority_score || null,
        },
      },
    ]);

    const result = ingest.results[0];
    if (!result?.listingId || result.status === "error" || result.status === "rejected") {
      throw new Error(result?.message || "Candidate could not be promoted into Profit Hunter.");
    }

    const { error: candidateUpdateError } = await supabase
      .from("tcos_mi_search_candidates")
      .update({
        status: "promoted",
        collectible_identity_id: identity.id,
        promoted_listing_id: result.listingId,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
        evidence: {
          ...candidateEvidence,
          identity_proof_decision: "verified_exact",
          identity_proof_notes: notes || null,
          identity_proof_evidence: proofMetadata.identity_proof_evidence,
          identity_proof_requirements: proofMetadata.identity_proof_requirements,
          identity_proof_reviewer: "private_owner",
          identity_proof_reviewed_at: reviewedAt,
          promoted_listing_id: result.listingId,
        },
      })
      .eq("id", id);
    if (candidateUpdateError) {
      if (result.status === "created") {
        await supabase.from("tcos_mi_listings").delete().eq("id", result.listingId);
      }
      throw new Error(candidateUpdateError.message);
    }

    const { error: auditError } = await supabase
      .from("tcos_mi_identity_proof_reviews")
      .insert({
        listing_id: result.listingId,
        candidate_id: id,
        collectible_identity_id: identity.id,
        prior_status: String(candidate.status || "pending_review"),
        decision: "promoted",
        reviewer: "private_owner",
        notes: notes || null,
        evidence: {
          ...recordValue(proofMetadata.identity_proof_evidence),
          requirements: proofMetadata.identity_proof_requirements,
        },
        reviewed_at: reviewedAt,
      });
    if (auditError && auditError.code !== "42P01") {
      await supabase
        .from("tcos_mi_search_candidates")
        .update({
          status: String(candidate.status || "pending_review"),
          collectible_identity_id: candidate.collectible_identity_id || null,
          promoted_listing_id: null,
          reviewed_at: candidate.reviewed_at || null,
          updated_at: new Date().toISOString(),
          evidence: candidateEvidence,
        })
        .eq("id", id);
      if (result.status === "created") {
        await supabase.from("tcos_mi_listings").delete().eq("id", result.listingId);
      } else if (existingListing) {
        await supabase
          .from("tcos_mi_listings")
          .update({
            metadata: existingListing.metadata || {},
            identity_match_confidence: Number(
              existingListing.identity_match_confidence || 0,
            ),
          })
          .eq("id", existingListing.id);
      }
      throw new Error(auditError.message);
    }

    const redirectUrl = adminRedirectUrl(
      "/admin/market-intel/deals/identity-review?saved=promoted",
      origin,
      handoff,
    );
    if (json) {
      return NextResponse.json({
        success: true,
        candidateId: id,
        listingId: result.listingId,
        decision: "promoted",
        redirectUrl: redirectUrl.toString(),
      });
    }
    return NextResponse.redirect(redirectUrl, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save candidate decision.";
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
