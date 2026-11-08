import type { SellerSweepCardCandidate } from "./instacomp-seller-sweep-identify";

export type SellerSweepCandidateReconciliation = {
  method: "max_simultaneously_visible";
  observedCandidateCount: number;
  sourceImageCount: number;
  maxVisibleInSingleImage: number;
  crossImageDuplicatesCollapsed: number;
};

export type SellerSweepReconciledCandidate = SellerSweepCardCandidate & {
  quantity: number;
  sourceImageUrls: string[];
  reconciliation: SellerSweepCandidateReconciliation;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "");
}

function identityKey(card: SellerSweepCardCandidate) {
  return JSON.stringify([
    normalized(card.player),
    normalized(card.year),
    normalized(card.brand),
    normalized(card.setName),
    compact(card.cardNumber).replace(/^#/, ""),
    normalized(card.parallel),
    compact(card.serialNumber),
    card.isRookie,
    card.isAutograph,
    card.isRelic,
    card.isGraded,
    normalized(card.gradingCompany),
    normalized(card.grade),
    card.packagingState,
  ]);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function strongestObservation(cards: SellerSweepCardCandidate[]) {
  return [...cards].sort((left, right) => {
    const reviewDelta = Number(left.reviewRequired) - Number(right.reviewRequired);
    if (reviewDelta !== 0) return reviewDelta;
    const confidenceDelta = right.confidence - left.confidence;
    if (confidenceDelta !== 0) return confidenceDelta;
    return left.reviewReasons.length - right.reviewReasons.length;
  })[0];
}

export function sellerSweepPhysicalCardCount(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.reduce((sum, card) => {
    const quantity =
      card && typeof card === "object" && "quantity" in card
        ? Number((card as { quantity?: unknown }).quantity)
        : 1;
    return sum + Math.max(1, Math.min(100, Math.floor(quantity || 1)));
  }, 0);
}

export function reconcileSellerSweepCandidates(
  cards: SellerSweepCardCandidate[],
): SellerSweepReconciledCandidate[] {
  const groups = new Map<string, SellerSweepCardCandidate[]>();
  for (const card of cards) {
    const key = identityKey(card);
    const group = groups.get(key) || [];
    group.push(card);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const representative = strongestObservation(group);
    const sourceImageUrls = unique(group.map((card) => card.sourceImageUrl));
    const observationsPerImage = new Map<string, number>();
    for (const card of group) {
      observationsPerImage.set(
        card.sourceImageUrl,
        (observationsPerImage.get(card.sourceImageUrl) || 0) + 1,
      );
    }
    const quantity = Math.max(1, ...observationsPerImage.values());
    const duplicateQuantityNeedsReview = quantity > 1;
    const reviewReasons = unique([
      ...representative.reviewReasons,
      ...(duplicateQuantityNeedsReview
        ? ["duplicate_quantity_requires_visual_confirmation"]
        : []),
    ]);

    return {
      ...representative,
      quantity,
      sourceImageUrls,
      visibleEvidence: unique(group.flatMap((card) => card.visibleEvidence)),
      reviewRequired:
        representative.reviewRequired || duplicateQuantityNeedsReview,
      reviewReasons,
      reconciliation: {
        method: "max_simultaneously_visible",
        observedCandidateCount: group.length,
        sourceImageCount: sourceImageUrls.length,
        maxVisibleInSingleImage: quantity,
        crossImageDuplicatesCollapsed: Math.max(0, group.length - quantity),
      },
    };
  });
}
