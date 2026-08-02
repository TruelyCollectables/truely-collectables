import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 3;
const MAX_IMAGES_PER_LISTING = 8;
const LISTING_TIMEOUT_MS = 180_000;

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
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(parsed)))
    : DEFAULT_BATCH_SIZE;
}

async function processListing(listing: any) {
  const imageUrls = list(listing.image_urls).slice(0, MAX_IMAGES_PER_LISTING);
  if (!imageUrls.length) throw new Error("Listing has no staged images.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LISTING_TIMEOUT_MS);
  try {
    const candidates: SellerSweepCardCandidate[] = [];
    const imageErrors: Array<{ imageUrl: string; error: string }> = [];

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
      .select("id,sweep_id,ebay_item_id,title,item_url,image_urls,status")
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
        ["comping", "ranked", "review"].includes(String(row.status))
      ).length;
      return NextResponse.json({
        ok: true,
        sweepId,
        processedThisRun: 0,
        remaining: 0,
        completed,
        status: "candidate_extraction_complete",
        nextStep:
          "Run exact-card validation and verified completed-sale comps for candidates that cleared extraction.",
      });
    }

    await supabase
      .from("instacomp_seller_sweeps")
      .update({ status: "identifying", updated_at: new Date().toISOString() })
      .eq("id", sweepId);

    const outcomes = [];
    for (const listing of listings) {
      await supabase
        .from("instacomp_seller_sweep_listings")
        .update({ status: "identifying", error_message: null, updated_at: new Date().toISOString() })
        .eq("id", listing.id);

      try {
        const result = await processListing(listing);
        const { error: updateError } = await supabase
          .from("instacomp_seller_sweep_listings")
          .update({
            status: result.status,
            target_players: result.targetPlayers,
            identified_cards: result.cards,
            confidence: result.averageConfidence,
            error_message: result.imageErrors.length
              ? `${result.imageErrors.length} image analysis failure(s); listing requires review.`
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", listing.id);
        if (updateError) throw updateError;
        outcomes.push({
          listingId: listing.id,
          ebayItemId: listing.ebay_item_id,
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
          .eq("id", listing.id);
        outcomes.push({
          listingId: listing.id,
          ebayItemId: listing.ebay_item_id,
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
      ["comping", "ranked", "review"].includes(String(row.status))
    ).length;
    const remaining = rows.filter((row) => row.status === "photos").length;
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
      nextStep:
        remaining > 0
          ? "Process the next bounded batch."
          : "Validate extracted candidates through the trusted InstaComp identity and comp gates.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Seller Sweep processing failed." },
      { status: 400 }
    );
  }
}
