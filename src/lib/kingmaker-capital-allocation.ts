import { createHash } from "node:crypto";
import type { KingmakerLearningPolicy } from "./kingmaker-learning-policy";

export type KingmakerCapitalCandidate = {
  signalFingerprint: string;
  entityKey: string;
  source: string;
  sellerKey?: string | null;
  category: string;
  strategy: string;
  deliveredCost: number;
  expectedProfit: number;
  expectedRoiPercent: number;
  confidence: number;
  reliabilityScore?: number | null;
  velocityScore?: number | null;
  concentrationKey?: string | null;
};

export type KingmakerCapitalAllocation = {
  signalFingerprint: string;
  entityKey: string;
  approvedAmount: number;
  allocationPercent: number;
  rankScore: number;
  action: "fund" | "watch" | "reject";
  reasons: string[];
};

export type KingmakerCapitalPlan = {
  budget: number;
  reserveAmount: number;
  deployableAmount: number;
  allocatedAmount: number;
  unusedAmount: number;
  allocations: KingmakerCapitalAllocation[];
  fingerprint: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
}

export function buildKingmakerCapitalPlan(input: {
  budget: number;
  candidates: KingmakerCapitalCandidate[];
  policy: KingmakerLearningPolicy;
  reservePercent?: number;
  maximumSinglePositionPercent?: number;
  maximumConcentrationPercent?: number;
}): KingmakerCapitalPlan {
  const budget = Math.max(0, finite(input.budget));
  const reservePercent = clamp(input.reservePercent ?? 0.15, 0, 0.75);
  const maximumSinglePositionPercent = clamp(input.maximumSinglePositionPercent ?? 0.2, 0.01, 1);
  const maximumConcentrationPercent = clamp(input.maximumConcentrationPercent ?? 0.35, 0.05, 1);
  const reserveAmount = Number((budget * reservePercent).toFixed(2));
  const deployableAmount = Number((budget - reserveAmount).toFixed(2));
  const maxSingle = deployableAmount * maximumSinglePositionPercent * input.policy.maximumPositionMultiplier;
  const maxConcentration = deployableAmount * maximumConcentrationPercent;

  const eligible = input.candidates
    .map((candidate) => {
      const reasons: string[] = [];
      if (!Number.isFinite(candidate.deliveredCost) || candidate.deliveredCost <= 0) reasons.push("invalid_cost");
      if (candidate.expectedProfit < input.policy.minimumRequiredProfit) reasons.push("profit_below_learned_threshold");
      if (candidate.expectedRoiPercent < input.policy.minimumRequiredRoiPercent) reasons.push("roi_below_learned_threshold");
      const adjustedConfidence = clamp(candidate.confidence + input.policy.confidenceAdjustment, 0, 1);
      if (adjustedConfidence < 0.55) reasons.push("confidence_below_threshold");
      const reliability = clamp((candidate.reliabilityScore ?? 50) / 100, 0, 1);
      const velocity = clamp(candidate.velocityScore ?? 0.5, 0, 1);
      const profitEfficiency = clamp(candidate.expectedProfit / Math.max(candidate.deliveredCost, 1) / 2, 0, 1);
      const roiQuality = clamp(candidate.expectedRoiPercent / 100, 0, 1);
      const rankScore = finite((adjustedConfidence * 0.3 + reliability * 0.25 + velocity * 0.15 + profitEfficiency * 0.15 + roiQuality * 0.15) * 100);
      return { candidate, reasons, adjustedConfidence, rankScore };
    })
    .sort((left, right) => right.rankScore - left.rankScore || right.candidate.expectedProfit - left.candidate.expectedProfit);

  let remaining = deployableAmount;
  const concentrationTotals = new Map<string, number>();
  const allocations: KingmakerCapitalAllocation[] = [];

  for (const entry of eligible) {
    const reasons = [...entry.reasons];
    const key = entry.candidate.concentrationKey?.trim() || `${entry.candidate.category}:${entry.candidate.strategy}`;
    const concentrationUsed = concentrationTotals.get(key) ?? 0;
    const concentrationRemaining = Math.max(0, maxConcentration - concentrationUsed);
    const positionCap = Math.max(0, Math.min(maxSingle, concentrationRemaining, remaining));
    let approvedAmount = 0;
    let action: KingmakerCapitalAllocation["action"] = "reject";

    if (!reasons.length && positionCap >= entry.candidate.deliveredCost) {
      approvedAmount = Number(entry.candidate.deliveredCost.toFixed(2));
      action = "fund";
      remaining = Number((remaining - approvedAmount).toFixed(2));
      concentrationTotals.set(key, concentrationUsed + approvedAmount);
      reasons.push("passed_learned_policy_and_capital_constraints");
    } else if (!reasons.length) {
      action = "watch";
      reasons.push(positionCap < entry.candidate.deliveredCost ? "insufficient_position_or_concentration_capacity" : "insufficient_budget");
    }

    allocations.push({
      signalFingerprint: entry.candidate.signalFingerprint,
      entityKey: entry.candidate.entityKey,
      approvedAmount,
      allocationPercent: deployableAmount > 0 ? Number(((approvedAmount / deployableAmount) * 100).toFixed(2)) : 0,
      rankScore: Number(entry.rankScore.toFixed(2)),
      action,
      reasons,
    });
  }

  const allocatedAmount = Number(allocations.reduce((sum, allocation) => sum + allocation.approvedAmount, 0).toFixed(2));
  const canonical = {
    budget,
    reserveAmount,
    deployableAmount,
    allocatedAmount,
    policyFingerprint: input.policy.fingerprint,
    allocations: allocations.map(({ signalFingerprint, approvedAmount, action, rankScore }) => ({ signalFingerprint, approvedAmount, action, rankScore })),
  };

  return {
    budget,
    reserveAmount,
    deployableAmount,
    allocatedAmount,
    unusedAmount: Number((deployableAmount - allocatedAmount).toFixed(2)),
    allocations,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
