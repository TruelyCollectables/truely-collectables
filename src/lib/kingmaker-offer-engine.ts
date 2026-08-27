import { createHash } from "node:crypto";

export type KingmakerOfferInput = {
  askingPrice: number;
  marketValue: number;
  minimumProfit: number;
  minimumRoiPercent: number;
  sellerAcceptanceRate?: number | null;
  sellerReliability?: number | null;
  shippingAndFees?: number;
  riskScore?: number;
};

export function recommendKingmakerOffer(input: KingmakerOfferInput) {
  const shippingAndFees = Math.max(0, input.shippingAndFees ?? 0);
  const riskScore = Math.max(0, Math.min(100, input.riskScore ?? 25));
  const sellerAcceptance = Math.max(0, Math.min(1, input.sellerAcceptanceRate ?? 0.5));
  const sellerReliability = Math.max(0, Math.min(1, input.sellerReliability ?? 0.5));
  const maxByProfit = input.marketValue - input.minimumProfit - shippingAndFees;
  const maxByRoi = input.marketValue / (1 + input.minimumRoiPercent / 100) - shippingAndFees;
  const walkAway = Math.max(0, Math.min(input.askingPrice, maxByProfit, maxByRoi));
  const riskDiscount = 1 - riskScore / 250;
  const openingFactor = 0.72 + sellerAcceptance * 0.08 + sellerReliability * 0.05;
  const recommendedOffer = Math.max(0, Math.min(walkAway, input.askingPrice * openingFactor * riskDiscount));
  const expectedAcceptanceProbability = Math.max(0.05, Math.min(0.95, sellerAcceptance * 0.55 + (recommendedOffer / Math.max(input.askingPrice, 0.01)) * 0.35 + sellerReliability * 0.1));
  const landedCost = recommendedOffer + shippingAndFees;
  const expectedProfit = input.marketValue - landedCost;
  const expectedRoiPercent = landedCost > 0 ? (expectedProfit / landedCost) * 100 : 0;
  const action = walkAway <= 0 || expectedProfit < input.minimumProfit || expectedRoiPercent < input.minimumRoiPercent ? "pass" : recommendedOffer >= input.askingPrice * 0.98 ? "buy_now" : "offer";
  const canonical = { ...input, shippingAndFees, riskScore, recommendedOffer, walkAway, action };
  return {
    action,
    recommendedOffer: Number(recommendedOffer.toFixed(2)),
    walkAwayPrice: Number(walkAway.toFixed(2)),
    expectedAcceptanceProbability: Number(expectedAcceptanceProbability.toFixed(4)),
    expectedProfit: Number(expectedProfit.toFixed(2)),
    expectedRoiPercent: Number(expectedRoiPercent.toFixed(2)),
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
