import { createHash } from "node:crypto";
import type { KingmakerDecisionOutcomeInput } from "./kingmaker-learning-engine";

export type KingmakerPurchaseLedgerRecord = {
  purchaseId: string;
  signalFingerprint: string;
  entityKey: string;
  purchasedAt: string;
  marketplace: string;
  sellerKey?: string | null;
  strategy?: string | null;
  askingPrice?: number | null;
  offerAmount?: number | null;
  itemPrice: number;
  shipping: number;
  tax: number;
  fees: number;
  quantity?: number | null;
  predictedProfit?: number | null;
  predictedRoiPercent?: number | null;
  predictedConfidence?: number | null;
  soldAmount?: number | null;
  soldAt?: string | null;
};

export type KingmakerPurchaseLedgerBridgeResult = {
  accepted: KingmakerDecisionOutcomeInput[];
  rejected: Array<{ purchaseId: string; code: string }>;
  totalLandedCost: number;
  fingerprint: string;
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function bridgePurchaseLedgerToKingmaker(records: KingmakerPurchaseLedgerRecord[]): KingmakerPurchaseLedgerBridgeResult {
  const accepted: KingmakerDecisionOutcomeInput[] = [];
  const rejected: Array<{ purchaseId: string; code: string }> = [];
  const seen = new Set<string>();

  for (const record of records) {
    const purchaseId = record.purchaseId.trim();
    if (!purchaseId || seen.has(purchaseId)) {
      rejected.push({ purchaseId, code: seen.has(purchaseId) ? "duplicate_purchase_id" : "missing_purchase_id" });
      continue;
    }
    seen.add(purchaseId);

    const itemPrice = finite(record.itemPrice);
    const shipping = finite(record.shipping);
    const tax = finite(record.tax);
    const fees = finite(record.fees);
    const quantity = Math.max(1, Math.floor(finite(record.quantity) ?? 1));
    const purchasedAt = Date.parse(record.purchasedAt);
    const soldAt = record.soldAt ? Date.parse(record.soldAt) : null;

    if (!record.signalFingerprint.trim() || !record.entityKey.trim()) {
      rejected.push({ purchaseId, code: "missing_identity" });
      continue;
    }
    if (itemPrice === null || itemPrice < 0 || shipping === null || shipping < 0 || tax === null || tax < 0 || fees === null || fees < 0) {
      rejected.push({ purchaseId, code: "invalid_money" });
      continue;
    }
    if (!Number.isFinite(purchasedAt)) {
      rejected.push({ purchaseId, code: "invalid_purchase_time" });
      continue;
    }
    if (soldAt !== null && (!Number.isFinite(soldAt) || soldAt < purchasedAt)) {
      rejected.push({ purchaseId, code: "invalid_sale_time" });
      continue;
    }

    const landedCost = Number((itemPrice + shipping + tax + fees).toFixed(2));
    const soldAmount = finite(record.soldAmount);
    if (soldAmount !== null && soldAmount < 0) {
      rejected.push({ purchaseId, code: "invalid_sale_amount" });
      continue;
    }

    accepted.push({
      signalFingerprint: record.signalFingerprint.trim(),
      entityKey: record.entityKey.trim(),
      decision: "buy",
      decidedAt: new Date(purchasedAt).toISOString(),
      source: record.marketplace.trim().toLowerCase(),
      sellerKey: record.sellerKey?.trim() || null,
      predictedProfit: finite(record.predictedProfit),
      predictedRoiPercent: finite(record.predictedRoiPercent),
      predictedConfidence: finite(record.predictedConfidence),
      offerAmount: finite(record.offerAmount),
      paidAmount: Number((itemPrice / quantity).toFixed(4)),
      landedCost: Number((landedCost / quantity).toFixed(4)),
      soldAmount: soldAmount === null ? null : Number((soldAmount / quantity).toFixed(4)),
      soldAt: soldAt === null ? null : new Date(soldAt).toISOString(),
    });
  }

  const totalLandedCost = Number(accepted.reduce((sum, record) => sum + (record.landedCost ?? 0), 0).toFixed(2));
  const canonical = {
    accepted: accepted.map((record) => ({ signalFingerprint: record.signalFingerprint, entityKey: record.entityKey, landedCost: record.landedCost, soldAmount: record.soldAmount })).sort((a, b) => a.signalFingerprint.localeCompare(b.signalFingerprint)),
    rejected: [...rejected].sort((a, b) => a.purchaseId.localeCompare(b.purchaseId)),
    totalLandedCost,
  };

  return {
    accepted,
    rejected,
    totalLandedCost,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
