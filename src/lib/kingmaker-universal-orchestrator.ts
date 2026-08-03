import { createHash } from "node:crypto";
import { recommendKingmakerOffer, type KingmakerOfferInput } from "./kingmaker-offer-engine";
import { assessKingmakerRisk, type KingmakerRiskInput } from "./kingmaker-risk-engine";

export type KingmakerOrchestratorCandidate = {
  opportunityKey: string;
  source: string;
  verified: boolean;
  expectedProfit: number;
  expectedRoiPercent: number;
  confidence: number;
  askingPrice: number;
  marketValue: number;
  shippingAndFees?: number;
  risk: KingmakerRiskInput;
  sellerAcceptanceRate?: number | null;
};

export function orchestrateKingmakerCandidate(input: KingmakerOrchestratorCandidate) {
  const risk = assessKingmakerRisk(input.risk);
  const blockers: string[] = [];
  if (!input.verified) blockers.push("signal_not_verified");
  if (input.expectedProfit <= 0) blockers.push("non_positive_expected_profit");
  if (input.expectedRoiPercent <= 0) blockers.push("non_positive_expected_roi");
  if (input.confidence < 0.55) blockers.push("confidence_below_floor");
  if (risk.level === "critical") blockers.push("critical_risk");
  const offerInput: KingmakerOfferInput = {
    askingPrice: input.askingPrice,
    marketValue: input.marketValue,
    minimumProfit: Math.max(5, input.expectedProfit * 0.5),
    minimumRoiPercent: Math.max(20, input.expectedRoiPercent * 0.5),
    sellerAcceptanceRate: input.sellerAcceptanceRate,
    sellerReliability: input.risk.sellerReliability,
    shippingAndFees: input.shippingAndFees,
    riskScore: risk.score,
  };
  const offer = recommendKingmakerOffer(offerInput);
  if (offer.action === "pass") blockers.push("offer_engine_pass");
  const status = blockers.length ? "withheld" : offer.action === "buy_now" ? "buy_now" : "offer";
  const canonical = { input, riskFingerprint: risk.fingerprint, offerFingerprint: offer.fingerprint, blockers: [...new Set(blockers)].sort(), status };
  return {
    opportunityKey: input.opportunityKey,
    source: input.source,
    status,
    risk,
    offer,
    blockers: [...new Set(blockers)],
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
