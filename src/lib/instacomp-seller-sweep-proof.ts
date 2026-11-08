import "server-only";

import {
  findChecklistRegistryMatch,
  type RegistryMatch,
} from "./instacomp-learning-server";
import type { SellerSweepCardCandidate } from "./instacomp-seller-sweep-identify";
import type {
  SellerSweepValuedCard,
  SellerSweepVerifiedSale,
} from "./instacomp-seller-sweep-economics";
import {
  findExactSellerSweepMarketIdentity,
  sellerSweepVerifiedReceiptSales,
  type MarketIdentityRow,
  type ReceiptCompRow,
} from "./instacomp-seller-sweep-proof-core";
import { createSupabaseServerClient } from "./supabase-server";

export type SellerSweepProofCard = SellerSweepCardCandidate & {
  identityProof: NonNullable<SellerSweepValuedCard["identityProof"]>;
  verifiedCompletedSales: SellerSweepVerifiedSale[];
};

const MAX_IDENTITY_LOOKUPS_PER_LISTING = 200;
const IDENTITY_LOOKUP_CONCURRENCY = 4;

function reviewCard(
  card: SellerSweepCardCandidate,
  reason: string,
): SellerSweepProofCard {
  return {
    ...card,
    reviewRequired: true,
    reviewReasons: [...new Set([...card.reviewReasons, reason])],
    identityProof: {
      status: "review_required",
      exactIdentityConfirmed: false,
      checklistConfirmed: false,
      noConflictingEvidence: false,
      source: "instacomp_checklist_registry",
      checklistIdentityId: null,
      matchedEvidence: [],
    },
    verifiedCompletedSales: [],
  };
}

function verifiedCard(
  card: SellerSweepCardCandidate,
  match: RegistryMatch,
  marketIdentityId: string | null,
  verifiedCompletedSales: SellerSweepVerifiedSale[],
): SellerSweepProofCard {
  return {
    ...card,
    identityProof: {
      status: "verified_exact",
      exactIdentityConfirmed: true,
      checklistConfirmed: true,
      noConflictingEvidence: true,
      source: "instacomp_checklist_registry",
      checklistIdentityId: match.identityId,
      marketIdentityId,
      matchedEvidence: match.matchedEvidence,
      pricingEvidenceStatus:
        verifiedCompletedSales.length >= 2
          ? "verified_completed_sales_ready"
          : "insufficient_verified_completed_sales",
    },
    verifiedCompletedSales,
  };
}

async function loadVerifiedReceiptSales(
  card: SellerSweepCardCandidate,
  registryMatch: RegistryMatch,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: subjectRows, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name")
    .eq("active", true)
    .ilike("name", String(card.player))
    .limit(3);
  if (subjectError || !subjectRows || subjectRows.length !== 1) {
    return { marketIdentityId: null, sales: [] as SellerSweepVerifiedSale[] };
  }

  const { data: identityRows, error: identityError } = await supabase
    .from("tcos_mi_collectible_identities")
    .select(
      "id,collectible_type,season_year,manufacturer,brand,product_line,set_name,insert_name,card_number,parallel_name,variation_name,serial_numbered_to,autograph,memorabilia,condition_type,grading_company,grade,identity_confidence",
    )
    .eq("active", true)
    .eq("subject_id", subjectRows[0].id)
    .ilike("card_number", String(card.cardNumber))
    .limit(100);
  if (identityError) {
    return { marketIdentityId: null, sales: [] as SellerSweepVerifiedSale[] };
  }

  const identity = findExactSellerSweepMarketIdentity({
    card,
    registryMatch,
    rows: (identityRows || []) as MarketIdentityRow[],
  });
  if (!identity) {
    return { marketIdentityId: null, sales: [] as SellerSweepVerifiedSale[] };
  }

  const { data: compRows, error: compError } = await supabase
    .from("tcos_mi_sold_comps")
    .select(
      "id,marketplace_id,external_sale_id,source_url,sold_at,sold_price,shipping_price,quantity,verified,match_confidence,excluded,outlier_flag,metadata",
    )
    .eq("collectible_identity_id", identity.id)
    .eq("verified", true)
    .eq("excluded", false)
    .eq("outlier_flag", false)
    .order("sold_at", { ascending: false })
    .limit(100);
  return {
    marketIdentityId: String(identity.id),
    sales: compError
      ? []
      : sellerSweepVerifiedReceiptSales((compRows || []) as ReceiptCompRow[]),
  };
}

async function verifyCandidate(
  card: SellerSweepCardCandidate,
): Promise<SellerSweepProofCard> {
  if (card.reviewRequired) return reviewCard(card, "candidate_extraction_requires_review");
  if (
    !card.player ||
    !card.year ||
    !card.brand ||
    !card.setName ||
    !card.cardNumber ||
    !card.parallel
  ) {
    return reviewCard(card, "exact_identity_fields_incomplete");
  }
  if (card.isAutograph === null || card.isRelic === null || card.isGraded === null) {
    return reviewCard(card, "exact_identity_states_incomplete");
  }
  if (card.packagingState !== "raw_card" || card.isGraded) {
    return reviewCard(
      card,
      card.isGraded
        ? "graded_identity_requires_certification_verification"
        : "raw_card_packaging_not_confirmed",
    );
  }

  try {
    const match = await findChecklistRegistryMatch({
      player: card.player,
      year: card.year,
      brand: card.brand,
      setName: card.setName,
      cardNumber: card.cardNumber,
      parallel: card.parallel,
      serialNumber: card.serialNumber,
      isAuto: card.isAutograph,
      isRelic: card.isRelic,
    });
    if (!match) return reviewCard(card, "checklist_registry_exact_match_not_found");
    const pricing = await loadVerifiedReceiptSales(card, match).catch(() => ({
      marketIdentityId: null,
      sales: [] as SellerSweepVerifiedSale[],
    }));
    return verifiedCard(
      card,
      match,
      pricing.marketIdentityId,
      pricing.sales,
    );
  } catch {
    return reviewCard(card, "checklist_registry_lookup_failed");
  }
}

export async function verifySellerSweepCandidates(
  cards: SellerSweepCardCandidate[],
): Promise<SellerSweepProofCard[]> {
  const results = new Array<SellerSweepProofCard>(cards.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= cards.length) return;
      results[index] =
        index < MAX_IDENTITY_LOOKUPS_PER_LISTING
          ? await verifyCandidate(cards[index])
          : reviewCard(cards[index], "listing_candidate_limit_exceeded");
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(IDENTITY_LOOKUP_CONCURRENCY, cards.length) },
      worker,
    ),
  );
  return results;
}
