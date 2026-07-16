import type { InstaCompAiResult, InstaCompComp, InstaCompStats } from "./instacomp";

export type InstaCompScanReviewInput = {
  ai: InstaCompAiResult;
  stats: InstaCompStats;
  marketValueComps: InstaCompComp[];
  hasBackImage: boolean;
  pairingConfidence: number | null;
  externalOcrText?: string | null;
};

export type InstaCompScanReview = {
  status: "trusted_for_pricing" | "review_required";
  trustedForPricing: boolean;
  reviewReasons: string[];
  identityReviewReasons: string[];
  pricingReviewReasons: string[];
};

const TRUSTED_IDENTITY_CONFIDENCE = 0.92;
const MIN_PAIRING_CONFIDENCE = 0.75;
const MIN_EXACT_COMP_COUNT_FOR_AUTOPRICE = 2;

function compactText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBaseParallel(value: string | null | undefined) {
  const normalized = compactText(value);
  return normalized === "base" || normalized === "base card";
}

function hasUncertainText(value: string | null | undefined) {
  return /\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly)\b/i.test(
    String(value || ""),
  );
}

function hasPrintedVariantSignal(text: string) {
  return /\b(limited\s+(red|blue|green|gold|orange|purple|black|silver)|clear\s*cut|acetate|canvas|dazzlers?|young\s+guns?|portraits?|rookie\s+materials?|honou?r\s+roll|insert|subset|parallel|refractor|prizm|prism|holo|foil|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic|sparkle|atomic|x-fractor|sepia|numbered\s+(to|\/)|\d{1,4}\s*\/\s*\d{1,4})\b/i.test(
    text,
  );
}

function exactCompEvidenceCount(comps: InstaCompComp[]) {
  return comps.filter((comp) => {
    if (comp.flags.includes("not used for pricing")) return false;
    if (comp.flags.includes("guidance comp")) return false;

    return comp.sourceCategory === "sold" || comp.sourceCategory === "marketplace";
  }).length;
}

export function buildInstaCompScanReview(
  input: InstaCompScanReviewInput,
): InstaCompScanReview {
  const ai = input.ai;
  const identityReviewReasons: string[] = [];
  const pricingReviewReasons: string[] = [];
  const ocrText = compactText(input.externalOcrText);

  if ((ai.confidence || 0) < TRUSTED_IDENTITY_CONFIDENCE) {
    identityReviewReasons.push("low_identification_confidence");
  }
  if (!ai.player) identityReviewReasons.push("missing_player_or_subject");
  if (!ai.year) identityReviewReasons.push("missing_year");
  if (!ai.brand && !ai.setName) identityReviewReasons.push("missing_brand_and_set");
  if (!ai.cardNumber) identityReviewReasons.push("missing_card_number");
  if (!ai.parallel || hasUncertainText(ai.parallel)) {
    identityReviewReasons.push("parallel_needs_review");
  }
  if (hasUncertainText(ai.notes)) {
    identityReviewReasons.push("identity_notes_need_review");
  }
  if (!input.hasBackImage) identityReviewReasons.push("front_only_scan");
  if (
    input.hasBackImage &&
    input.pairingConfidence !== null &&
    input.pairingConfidence < MIN_PAIRING_CONFIDENCE
  ) {
    identityReviewReasons.push("front_back_pairing_needs_review");
  }
  if (hasPrintedVariantSignal(ocrText) && (!ai.parallel || isBaseParallel(ai.parallel))) {
    identityReviewReasons.push("ocr_variant_signal_not_resolved");
  }

  const exactCompCount = exactCompEvidenceCount(input.marketValueComps);

  if (!input.marketValueComps.length || !input.stats.suggestedPrice) {
    pricingReviewReasons.push("missing_usable_comps");
  } else if (exactCompCount < MIN_EXACT_COMP_COUNT_FOR_AUTOPRICE) {
    pricingReviewReasons.push("insufficient_exact_comp_evidence");
  }

  const reviewReasons = Array.from(
    new Set([...identityReviewReasons, ...pricingReviewReasons]),
  );
  const trustedForPricing =
    identityReviewReasons.length === 0 && pricingReviewReasons.length === 0;

  return {
    status: trustedForPricing ? "trusted_for_pricing" : "review_required",
    trustedForPricing,
    reviewReasons,
    identityReviewReasons: Array.from(new Set(identityReviewReasons)),
    pricingReviewReasons: Array.from(new Set(pricingReviewReasons)),
  };
}
