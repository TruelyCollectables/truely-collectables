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
      matchedEvidence: match.matchedEvidence,
    },
    verifiedCompletedSales: [],
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
    return match
      ? verifiedCard(card, match)
      : reviewCard(card, "checklist_registry_exact_match_not_found");
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
