import { createHash } from "node:crypto";

export type KingmakerMarketPoint = {
  observedAt: string;
  medianSoldPrice: number;
  activeListings: number;
  soldCount: number;
  averageDaysToSell?: number | null;
};

export type KingmakerMomentum = {
  score: number;
  direction: "heating" | "stable" | "cooling";
  priceChangePercent: number;
  supplyChangePercent: number;
  sellThroughChangePercent: number;
  velocityChangePercent: number | null;
  reasons: string[];
  fingerprint: string;
};

function pct(previous: number, current: number) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) return 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function calculateKingmakerMomentum(points: KingmakerMarketPoint[]): KingmakerMomentum {
  const ordered = [...points]
    .filter((point) => Number.isFinite(Date.parse(point.observedAt)))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  if (ordered.length < 2) throw new Error("KINGMAKER_MOMENTUM_REQUIRES_TWO_POINTS");

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const firstSellThrough = first.activeListings + first.soldCount > 0
    ? first.soldCount / (first.activeListings + first.soldCount)
    : 0;
  const lastSellThrough = last.activeListings + last.soldCount > 0
    ? last.soldCount / (last.activeListings + last.soldCount)
    : 0;

  const priceChangePercent = pct(first.medianSoldPrice, last.medianSoldPrice);
  const supplyChangePercent = pct(first.activeListings, last.activeListings);
  const sellThroughChangePercent = pct(firstSellThrough, lastSellThrough);
  const velocityChangePercent = first.averageDaysToSell && last.averageDaysToSell
    ? -pct(first.averageDaysToSell, last.averageDaysToSell)
    : null;

  const score = clamp(
    50 +
    clamp(priceChangePercent, -50, 50) * 0.6 -
    clamp(supplyChangePercent, -50, 50) * 0.25 +
    clamp(sellThroughChangePercent, -100, 100) * 0.2 +
    clamp(velocityChangePercent ?? 0, -100, 100) * 0.15,
    0,
    100,
  );

  const direction = score >= 62 ? "heating" : score <= 38 ? "cooling" : "stable";
  const reasons: string[] = [];
  if (priceChangePercent >= 10) reasons.push("Median sold price is rising materially.");
  if (priceChangePercent <= -10) reasons.push("Median sold price is falling materially.");
  if (supplyChangePercent <= -15) reasons.push("Available supply is tightening.");
  if (supplyChangePercent >= 20) reasons.push("Available supply is expanding.");
  if (sellThroughChangePercent >= 15) reasons.push("Sell-through is improving.");
  if (sellThroughChangePercent <= -15) reasons.push("Sell-through is weakening.");
  if ((velocityChangePercent ?? 0) >= 15) reasons.push("Items are selling faster.");
  if ((velocityChangePercent ?? 0) <= -15) reasons.push("Items are taking longer to sell.");
  if (!reasons.length) reasons.push("Market movement remains inside normal tolerance.");

  const canonical = {
    points: ordered,
    priceChangePercent: Number(priceChangePercent.toFixed(4)),
    supplyChangePercent: Number(supplyChangePercent.toFixed(4)),
    sellThroughChangePercent: Number(sellThroughChangePercent.toFixed(4)),
    velocityChangePercent: velocityChangePercent === null ? null : Number(velocityChangePercent.toFixed(4)),
    score: Number(score.toFixed(4)),
    direction,
  };

  return {
    score: Number(score.toFixed(2)),
    direction,
    priceChangePercent: Number(priceChangePercent.toFixed(2)),
    supplyChangePercent: Number(supplyChangePercent.toFixed(2)),
    sellThroughChangePercent: Number(sellThroughChangePercent.toFixed(2)),
    velocityChangePercent: velocityChangePercent === null ? null : Number(velocityChangePercent.toFixed(2)),
    reasons,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
