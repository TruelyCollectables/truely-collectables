export type KingmakerVerifiedSoldComp = {
  price: number;
  shipping?: number | null;
  soldAt?: string | null;
};

export type KingmakerPricingReference = {
  low: number | null;
  high: number | null;
  midpoint: number | null;
  confidence: number;
  status: "verified" | "review_required";
  trendPct: number | null;
};

export type KingmakerPricingDecision = {
  schema: "tcos.kingmaker.pricingDecision.v1";
  status: "ready" | "review_required" | "insufficient_evidence";
  suggestedListPrice: number | null;
  buyCeiling: number | null;
  marketMedian: number | null;
  referenceMidpoint: number | null;
  confidence: number;
  soldCompCount: number;
  reviewReasons: string[];
  boundary: "advisory_only";
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildKingmakerPricingDecision(params: {
  exactIdentity: boolean;
  pricing: KingmakerPricingReference | null;
  soldComps: KingmakerVerifiedSoldComp[];
  targetMarginPct?: number;
}): KingmakerPricingDecision {
  const reviewReasons: string[] = [];
  const targetMarginPct = Math.max(0.05, Math.min(params.targetMarginPct ?? 0.3, 0.8));

  if (!params.exactIdentity) reviewReasons.push("exact_identity_required");
  if (!params.pricing) reviewReasons.push("pricing_reference_missing");
  if (params.pricing?.status !== "verified") reviewReasons.push("pricing_reference_requires_review");

  const soldTotals = params.soldComps
    .map((comp) => Number(comp.price) + Number(comp.shipping || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const marketMedian = median(soldTotals);

  if (soldTotals.length < 3) reviewReasons.push("three_verified_sold_comps_required");

  const referenceMidpoint =
    params.pricing?.midpoint ??
    (params.pricing?.low != null && params.pricing?.high != null
      ? (params.pricing.low + params.pricing.high) / 2
      : null);

  const status = !params.exactIdentity || params.pricing?.status === "review_required"
    ? "review_required"
    : soldTotals.length < 3 || marketMedian == null
      ? "insufficient_evidence"
      : "ready";

  if (status !== "ready" || marketMedian == null) {
    return {
      schema: "tcos.kingmaker.pricingDecision.v1",
      status,
      suggestedListPrice: null,
      buyCeiling: null,
      marketMedian: marketMedian == null ? null : money(marketMedian),
      referenceMidpoint: referenceMidpoint == null ? null : money(referenceMidpoint),
      confidence: 0,
      soldCompCount: soldTotals.length,
      reviewReasons: Array.from(new Set(reviewReasons)),
      boundary: "advisory_only",
    };
  }

  const blended = referenceMidpoint == null
    ? marketMedian
    : marketMedian * 0.75 + referenceMidpoint * 0.25;
  const trendMultiplier = params.pricing?.trendPct == null
    ? 1
    : Math.max(0.85, Math.min(1 + params.pricing.trendPct / 100, 1.15));
  const suggestedListPrice = money(blended * trendMultiplier);
  const buyCeiling = money(suggestedListPrice * (1 - targetMarginPct));
  const compConfidence = Math.min(1, soldTotals.length / 8);
  const referenceConfidence = Math.max(0, Math.min(params.pricing?.confidence ?? 0, 1));

  return {
    schema: "tcos.kingmaker.pricingDecision.v1",
    status: "ready",
    suggestedListPrice,
    buyCeiling,
    marketMedian: money(marketMedian),
    referenceMidpoint: referenceMidpoint == null ? null : money(referenceMidpoint),
    confidence: Math.round((compConfidence * 0.7 + referenceConfidence * 0.3) * 1000) / 1000,
    soldCompCount: soldTotals.length,
    reviewReasons: [],
    boundary: "advisory_only",
  };
}
