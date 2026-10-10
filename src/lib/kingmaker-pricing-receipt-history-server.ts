import "server-only";

import type { requireInstaCompJobActor } from "./instacomp-job-server";
import { getKingmakerMacPricingReceipts } from "./kingmaker-mac-server";

type InstaCompActor = Awaited<ReturnType<typeof requireInstaCompJobActor>>;

export function kingmakerPricingReceiptOwner(actor: InstaCompActor) {
  return { storeId: actor.storeId, sellerAccountId: actor.type === "seller" ? actor.sellerAccountId || null : null };
}

export function mapKingmakerPricingReceipt(row: Record<string, any>) {
  return {
    id: String(row.id), identityId: String(row.identityId),
    pricingProfile: { name: String(row.profileName), selection: row.profileSelection },
    status: row.status, suggestedListPrice: row.suggestedListPrice ?? null, buyCeiling: row.buyCeiling ?? null,
    estimatedNetProceeds: row.estimatedNetProceeds ?? null, estimatedProfitAtCeiling: row.expectedProfit ?? null,
    confidence: Number(row.confidence || 0), soldCompCount: Number(row.soldCompCount || 0),
    reviewReasons: Array.isArray(row.reviewReasons) ? row.reviewReasons : [], createdAt: row.createdAt,
    boundary: "advisory_only" as const,
  };
}

export async function getKingmakerPricingReceiptHistory(params: { actor: InstaCompActor; receiptId?: string | null; limit?: number }) {
  const owner = kingmakerPricingReceiptOwner(params.actor);
  const payload = await getKingmakerMacPricingReceipts(owner.storeId, owner.sellerAccountId, params.limit || 25);
  const receiptId = String(params.receiptId || "").trim();
  return payload.receipts.filter((row) => !receiptId || String(row.id) === receiptId).slice(0, receiptId ? 1 : undefined).map(mapKingmakerPricingReceipt);
}
