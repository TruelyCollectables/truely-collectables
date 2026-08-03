import { createHash } from "node:crypto";
import type { KingmakerCapitalCandidate } from "./kingmaker-capital-allocation";

export type KingmakerSellerProfileInput = {
  sellerKey: string;
  source: string;
  sampleSize: number;
  winRate: number | null;
  averageRealizedRoiPercent: number | null;
  reliabilityScore: number;
  medianDaysToExit: number | null;
  cancellationRate?: number | null;
  issueRate?: number | null;
};

export type KingmakerSellerSweepRank = {
  sellerKey: string;
  source: string;
  score: number;
  tier: "avoid" | "watch" | "developing" | "preferred" | "priority";
  maximumExposureMultiplier: number;
  candidateCount: number;
  reasons: string[];
  fingerprint: string;
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function rankKingmakerSellerSweep(input: {
  sellers: KingmakerSellerProfileInput[];
  candidates: KingmakerCapitalCandidate[];
  minimumSampleSize?: number;
}): KingmakerSellerSweepRank[] {
  const minimumSampleSize = input.minimumSampleSize ?? 5;
  const candidatesBySeller = new Map<string, KingmakerCapitalCandidate[]>();
  for (const candidate of input.candidates) {
    if (!candidate.sellerKey) continue;
    const key = `${candidate.source}:${candidate.sellerKey}`;
    candidatesBySeller.set(key, [...(candidatesBySeller.get(key) ?? []), candidate]);
  }

  return input.sellers.map((seller) => {
    const sellerCandidates = candidatesBySeller.get(`${seller.source}:${seller.sellerKey}`) ?? [];
    const reasons: string[] = [];
    const sampleFactor = clamp(seller.sampleSize / Math.max(minimumSampleSize * 2, 1), 0, 1);
    const reliability = clamp(seller.reliabilityScore / 100, 0, 1);
    const winRate = clamp(seller.winRate ?? 0, 0, 1);
    const roi = clamp((seller.averageRealizedRoiPercent ?? 0) / 100, -1, 1);
    const velocity = seller.medianDaysToExit === null ? 0.4 : clamp(1 - seller.medianDaysToExit / 120, 0, 1);
    const cancellationPenalty = clamp(seller.cancellationRate ?? 0, 0, 1);
    const issuePenalty = clamp(seller.issueRate ?? 0, 0, 1);
    const opportunityBonus = clamp(sellerCandidates.length / 10, 0, 1);

    let score = (
      reliability * 0.3 +
      winRate * 0.2 +
      Math.max(0, roi) * 0.15 +
      velocity * 0.1 +
      sampleFactor * 0.1 +
      opportunityBonus * 0.15 -
      cancellationPenalty * 0.2 -
      issuePenalty * 0.25
    ) * 100;
    score = Number(clamp(score, 0, 100).toFixed(2));

    let tier: KingmakerSellerSweepRank["tier"] = "watch";
    let maximumExposureMultiplier = 0.5;
    if (seller.sampleSize < minimumSampleSize) {
      tier = "developing";
      maximumExposureMultiplier = 0.5;
      reasons.push("seller_sample_below_proven_threshold");
    } else if (score >= 80 && cancellationPenalty <= 0.05 && issuePenalty <= 0.05) {
      tier = "priority";
      maximumExposureMultiplier = 1.25;
      reasons.push("repeatable_profitability_and_low_operational_risk");
    } else if (score >= 65) {
      tier = "preferred";
      maximumExposureMultiplier = 1;
      reasons.push("profitable_and_reliable_seller_history");
    } else if (score < 35 || cancellationPenalty > 0.2 || issuePenalty > 0.2) {
      tier = "avoid";
      maximumExposureMultiplier = 0;
      reasons.push("seller_risk_exceeds_tolerance");
    } else {
      reasons.push("seller_requires_more_or_better_outcomes");
    }

    if (!sellerCandidates.length) reasons.push("no_current_actionable_candidates");
    else reasons.push(`${sellerCandidates.length}_current_candidate(s)`);

    const canonical = {
      sellerKey: seller.sellerKey,
      source: seller.source,
      score,
      tier,
      maximumExposureMultiplier,
      candidateFingerprints: sellerCandidates.map((candidate) => candidate.signalFingerprint).sort(),
      profile: seller,
    };

    return {
      sellerKey: seller.sellerKey,
      source: seller.source,
      score,
      tier,
      maximumExposureMultiplier,
      candidateCount: sellerCandidates.length,
      reasons,
      fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    };
  }).sort((left, right) => right.score - left.score || right.candidateCount - left.candidateCount);
}
