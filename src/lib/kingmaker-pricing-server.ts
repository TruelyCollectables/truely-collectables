import "server-only";

import {
  getKingmakerMacPricingHistory,
  getKingmakerMacPricingReference,
} from "./kingmaker-mac-server";

export type KingmakerPricingStatus = "verified" | "review_required";

export type KingmakerPricingRecord = {
  identityId: string;
  identityKey: string;
  editionDate: string;
  low: number | null;
  high: number | null;
  midpoint: number | null;
  currency: string;
  confidence: number;
  status: KingmakerPricingStatus;
  historyCount: number;
  trendPct: number | null;
  refreshedAt: string;
};

export async function getKingmakerPricingByIdentityId(identityId: string): Promise<KingmakerPricingRecord | null> {
  const normalizedIdentityId = identityId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedIdentityId)) {
    throw new Error("KINGMAKER_PRICING_IDENTITY_ID_INVALID");
  }
  const payload = await getKingmakerMacPricingReference(normalizedIdentityId);
  return payload.record as KingmakerPricingRecord | null;
}

export async function getKingmakerPricingHistory(identityId: string, limit = 24) {
  const payload = await getKingmakerMacPricingHistory(identityId.trim(), limit);
  return payload.history;
}
