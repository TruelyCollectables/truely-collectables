import type { KingmakerPricingRecord } from "./kingmaker-pricing-server";

export type InstaCompKingmakerPricing = {
  available: boolean;
  low: number | null;
  high: number | null;
  midpoint: number | null;
  currency: string | null;
  confidence: number | null;
  status: "verified" | "review_required" | null;
  editionDate: string | null;
  historyCount: number;
  trendPct: number | null;
  pricingUse: "display_only";
};

export function buildInstaCompKingmakerPricing(
  record: KingmakerPricingRecord | null,
): InstaCompKingmakerPricing {
  if (!record) {
    return {
      available: false,
      low: null,
      high: null,
      midpoint: null,
      currency: null,
      confidence: null,
      status: null,
      editionDate: null,
      historyCount: 0,
      trendPct: null,
      pricingUse: "display_only",
    };
  }

  return {
    available: true,
    low: record.low,
    high: record.high,
    midpoint: record.midpoint,
    currency: record.currency,
    confidence: record.confidence,
    status: record.status,
    editionDate: record.editionDate,
    historyCount: record.historyCount,
    trendPct: record.trendPct,
    pricingUse: "display_only",
  };
}
