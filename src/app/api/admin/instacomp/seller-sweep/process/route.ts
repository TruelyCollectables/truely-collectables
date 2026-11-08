import { NextResponse } from "next/server";
import {
  AdminMutationSecurityError,
  assertTrustedAdminMutationRequest,
} from "../../../../../../lib/admin-request-security";
import {
  identifySellerSweepLotPhoto,
  sellerSweepTargetPlayers,
  type SellerSweepCardCandidate,
} from "../../../../../../lib/instacomp-seller-sweep-identify";
import { verifySellerSweepCandidates } from "../../../../../../lib/instacomp-seller-sweep-proof";
import {
  reconcileSellerSweepCandidates,
  sellerSweepPhysicalCardCount,
} from "../../../../../../lib/instacomp-seller-sweep-reconcile";
import { trustedSellerSweepImageUrls } from "../../../../../../lib/instacomp-seller-sweep-security";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 2;
const MAX_IMAGES_PER_LISTING = 6;
const MAX_VISION_CALLS_PER_REQUEST = 12;
const LISTING_TIMEOUT_MS = 150_000;

function requireUuid(value: unknown, label: string) {
  const text = String(value ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
  return text;
}

function list(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function clampBatchSize(value: unknown) {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  const requested = Number.isFinite(parsed)
    ? Math.max(1, Math.floor(parsed))
    : DEFAULT_BATCH_SIZE;
  const costBound = Math.max(
    1,
    Math.floor(MAX_VISION_CALLS_PER_REQUEST / MAX_IMAGES_PER_LISTING),
  );
  return Math.min(requested, MAX_BATCH_SIZE, costBound);
}

async function processListing(listing: any) {
  const stagedImageUrls = list(listing.image_urls).slice(0, MAX_IMAGES_PER_LISTING);
  const imageUrls = trustedSellerSweepImageUrls(
    stagedImageUrls,
    MAX_IMAGES_PER_LISTING,
  );
  const rejectedImageCount = Math.max(0, stagedImageUrls.length - imageUrls.length);
  if (!imageUrls.length) {
    throw new Error(
      rejectedImageCount
        ? "Listing has no trusted HTTPS eBay images after security validation."
        : "Listing has no staged images.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LISTING_TIMEOUT_MS);
  try {
    const candidates: SellerSweepCardCandidate[] = [];
    const imageErrors: Array<{ imageUrl: string | null; error: string }> = [];

    for (let index = 0; index < rejectedImageCount; index += 1) {
      imageErrors.push({
        imageUrl: null,
        error: "Rejected an untrusted staged image URL before provider processing.",
      });
    }

    for (const imageUrl of imageUrls) {
      try {
        candidates.push(
          ...(await identifySellerSweepLotPhoto({
            imageUrl,
            listingTitle: String(listing.title || ""),
            signal: controller.signal,
          }))
        );
      } catch (error) {
        imageErrors.push({
          imageUrl,
          error: error instanceof Error ? error.message : "Image analysis failed.",
        });
      }
    }

    const extractedCards = reconcileSellerSweepCandidates(candidates);
    if (!extractedCards.length) {
      throw new Error(
        imageErrors.length
          ? `No cards extracted. ${imageErrors[0].error}`
          : "No visible cards were extracted from the staged images."
      );
    }

    const cards = await verifySellerSweepCandidates(extractedCards);

    const targetPlayers = sellerSweepTargetPlayers(cards);
    const exactCandidateCount = cards.filter(
      (card) =>
        card.identityProof.status === "verified_exact" &&
        card.identityProof.exactIdentityConfirmed === true &&
        card.identityProof.checklistConfirmed === true &&
        card.identityProof.noConflictingEvidence === true
    ).length;
    const averageConfidence =
      cards.reduce((sum, card) => sum + card.confidence, 0) / cards.length;
    const reviewRequired =
      imageErrors.length > 0 || exactCandidateCount !== cards.length;

    return {
      cards,
      targetPlayers,
      averageConfidence,
      reviewRequired,
      exactCandidateCount,
      imageErrors,
      status: reviewRequired ? "review" : "comping",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedAdminMutationRequest(request);
    const body = await request.json();
    const sweepId = requireUuid(body?.sweepId, "sweepId");
    const batchSize = clampBatchSize(body?.batchSize);
    const supabase = createSupabaseServerClient({ admin: true });

    const { data: sweep, error: sweepError } = await supabase
      .from("instacomp_seller_sweeps")
      .select("id,status,listing_count,cards_identified,listings_ranked")
      .eq("id", sweepId)
      .maybeSingle();
    if (sweepError) throw sweepError;
    if (!sweep) throw new Error("Seller Sweep job was not found.");

    const { data: listings, error: listingError } = await supabase
      .from("instacomp_seller_sweep_listings")
      .select("id")
      .eq("sweep_id", sweepId)
      .eq("status", "photos")
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (listingError) throw listingError;

    if (!listings?.length) {
      const { data: allRows, error: allError } = await supabase
        .from("instacomp_seller_sweep_listings")
        .select("id,status,identified_cards")
        .eq("sweep_id", sweepId);
      if (allError) throw allError;
      const completed = (allRows || []).filter((row) =>
        ["comping", "ranked", "review", "failed"].includes(String(row.status))
      ).length;
      const remaining = (allRows || []).filter((row) =>
        ["photos", "identifying"].includes(String(row.status))
      ).length;
      return NextResponse.json({
        ok: true,
        sweepId,
        processedThisRun: 0,
        remaining,
        completed,
        status:
          remaining > 0 ? "candidate_extraction_in_progress" : "candidate_extraction_complete",
        nextStep:
          remaining > 0
            ? "Another worker owns the remaining bounded listing claim."
            : "Run exact-card validation and verified completed-sale comps for candidates that cleared extraction.",
      });
    }

    await supabase
      .from("instacomp_seller_sweeps")
      .update({ status: "identifying", updated_at: new Date().toISOString() })
      .eq("id", sweepId);

    const outcomes = [];
    for (const listing of listings) {
      const { data: claimed, error: claimError } = await supabase
        .from("instacomp_seller_sweep_listings")
        .update({
          status: "identifying",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listing.id)
        .eq("sweep_id", sweepId)
        .eq("status", "photos")
        .select("id,sweep_id,ebay_item_id,title,item_url,image_urls,status")
        .maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) continue;

      try {
        const result = await processListing(claimed);
        const { data: updated, error: updateError } = await supabase
          .from("instacomp_seller_sweep_listings")
          .update({
            status: result.status,
            target_players: result.targetPlayers,
            identified_cards: result.cards,
            confidence: result.averageConfidence,
            error_message: result.imageErrors.length
              ? `${result.imageErrors.length} image analysis or validation failure(s); listing requires review.`
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimed.id)
          .eq("status", "identifying")
          .select("id")
          .maybeSingle();
        if (updateError) throw updateError;
        if (!updated) {
          throw new Error("Seller Sweep listing claim was lost before result persistence.");
        }
        outcomes.push({
          listingId: claimed.id,
          ebayItemId: claimed.ebay_item_id,
          status: result.status,
          candidateCount: result.cards.length,
          exactCandidateCount: result.exactCandidateCount,
          targetPlayers: result.targetPlayers,
          confidence: result.averageConfidence,
          imageErrors: result.imageErrors,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Candidate extraction failed.";
        await supabase
          .from("instacomp_seller_sweep_listings")
          .update({
            status: "failed",
            error_message: message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", claimed.id)
          .eq("status", "identifying");
        outcomes.push({
          listingId: claimed.id,
          ebayItemId: claimed.ebay_item_id,
          status: "failed",
          candidateCount: 0,
          exactCandidateCount: 0,
          targetPlayers: [],
          confidence: 0,
          imageErrors: [{ imageUrl: null, error: message }],
        });
      }
    }

    const { data: allRows, error: countError } = await supabase
      .from("instacomp_seller_sweep_listings")
      .select("status,identified_cards")
      .eq("sweep_id", sweepId);
    if (countError) throw countError;

    const rows = allRows || [];
    const candidatesIdentified = rows.reduce(
      (sum, row) => sum + sellerSweepPhysicalCardCount(row.identified_cards),
      0,
    );
    const processedListings = rows.filter((row) =>
      ["comping", "ranked", "review", "failed"].includes(String(row.status))
    ).length;
    const remaining = rows.filter((row) =>
      ["photos", "identifying"].includes(String(row.status))
    ).length;
    const progress = rows.length
      ? Math.min(80, 55 + Math.round((processedListings / rows.length) * 25))
      : 55;

    await supabase
      .from("instacomp_seller_sweeps")
      .update({
        status: remaining > 0 ? "identifying" : "ranking",
        cards_identified: candidatesIdentified,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sweepId);

    return NextResponse.json({
      ok: true,
      sweepId,
      processedThisRun: outcomes.length,
      processedListings,
      remaining,
      cardsIdentified: candidatesIdentified,
      progress,
      outcomes,
      status: remaining > 0 ? "identifying" : "candidate_extraction_complete",
      providerCallBudget: {
        maximumListingsPerRequest: MAX_BATCH_SIZE,
        maximumImagesPerListing: MAX_IMAGES_PER_LISTING,
        maximumVisionCallsPerRequest: MAX_VISION_CALLS_PER_REQUEST,
      },
      nextStep:
        remaining > 0
          ? "Process the next bounded, atomically claimed batch."
          : "Validate extracted candidates through the trusted InstaComp identity and comp gates.",
    });
  } catch (error) {
    const status = error instanceof AdminMutationSecurityError ? error.status : 400;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seller Sweep processing failed.",
        ...(error instanceof AdminMutationSecurityError ? { code: error.code } : {}),
      },
      { status }
    );
  }
}
