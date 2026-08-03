import type { KingmakerPricingDecision } from "./kingmaker-pricing-decision";

export type KingmakerBulkPricingCandidate = {
  candidateId: string;
  identityId: string;
  acquisitionCost: number | null;
  decision: KingmakerPricingDecision;
};

export type KingmakerBulkPricingPlan = {
  schema: "tcos.kingmaker.pricingBulkPlan.v1";
  totalCandidates: number;
  readyCandidates: number;
  reviewCandidates: number;
  insufficientCandidates: number;
  totalCapitalRequired: number;
  totalExpectedProfit: number;
  averageExpectedRoiPct: number | null;
  rankedOpportunities: Array<{
    candidateId: string;
    identityId: string;
    acquisitionCost: number;
    buyCeiling: number;
    suggestedListPrice: number;
    estimatedProfit: number;
    expectedRoiPct: number;
    confidence: number;
    soldCompCount: number;
  }>;
  excluded: Array<{
    candidateId: string;
    identityId: string;
    reason: "decision_not_ready" | "acquisition_cost_missing" | "above_buy_ceiling";
  }>;
  boundary: "advisory_only";
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function buildKingmakerBulkPricingPlan(
  candidates: KingmakerBulkPricingCandidate[],
): KingmakerBulkPricingPlan {
  const bounded = candidates.slice(0, 100);
  const ranked: KingmakerBulkPricingPlan["rankedOpportunities"] = [];
  const excluded: KingmakerBulkPricingPlan["excluded"] = [];

  for (const candidate of bounded) {
    const decision = candidate.decision;
    if (
      decision.status !== "ready" ||
      decision.buyCeiling == null ||
      decision.suggestedListPrice == null ||
      decision.estimatedNetProceeds == null
    ) {
      excluded.push({
        candidateId: candidate.candidateId,
        identityId: candidate.identityId,
        reason: "decision_not_ready",
      });
      continue;
    }

    if (candidate.acquisitionCost == null || !Number.isFinite(candidate.acquisitionCost)) {
      excluded.push({
        candidateId: candidate.candidateId,
        identityId: candidate.identityId,
        reason: "acquisition_cost_missing",
      });
      continue;
    }

    const acquisitionCost = Math.max(0, candidate.acquisitionCost);
    if (acquisitionCost > decision.buyCeiling) {
      excluded.push({
        candidateId: candidate.candidateId,
        identityId: candidate.identityId,
        reason: "above_buy_ceiling",
      });
      continue;
    }

    const estimatedProfit = money(decision.estimatedNetProceeds - acquisitionCost);
    const expectedRoiPct = acquisitionCost > 0
      ? Math.round((estimatedProfit / acquisitionCost) * 10000) / 100
      : 0;

    ranked.push({
      candidateId: candidate.candidateId,
      identityId: candidate.identityId,
      acquisitionCost: money(acquisitionCost),
      buyCeiling: decision.buyCeiling,
      suggestedListPrice: decision.suggestedListPrice,
      estimatedProfit,
      expectedRoiPct,
      confidence: decision.confidence,
      soldCompCount: decision.soldCompCount,
    });
  }

  ranked.sort((a, b) =>
    b.expectedRoiPct - a.expectedRoiPct ||
    b.estimatedProfit - a.estimatedProfit ||
    b.confidence - a.confidence,
  );

  const totalCapitalRequired = money(ranked.reduce((sum, row) => sum + row.acquisitionCost, 0));
  const totalExpectedProfit = money(ranked.reduce((sum, row) => sum + row.estimatedProfit, 0));
  const averageExpectedRoiPct = ranked.length
    ? Math.round((ranked.reduce((sum, row) => sum + row.expectedRoiPct, 0) / ranked.length) * 100) / 100
    : null;

  return {
    schema: "tcos.kingmaker.pricingBulkPlan.v1",
    totalCandidates: bounded.length,
    readyCandidates: bounded.filter((row) => row.decision.status === "ready").length,
    reviewCandidates: bounded.filter((row) => row.decision.status === "review_required").length,
    insufficientCandidates: bounded.filter((row) => row.decision.status === "insufficient_evidence").length,
    totalCapitalRequired,
    totalExpectedProfit,
    averageExpectedRoiPct,
    rankedOpportunities: ranked,
    excluded,
    boundary: "advisory_only",
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function kingmakerBulkPricingPlanToCsv(plan: KingmakerBulkPricingPlan) {
  const header = [
    "candidate_id",
    "identity_id",
    "acquisition_cost",
    "buy_ceiling",
    "suggested_list_price",
    "estimated_profit",
    "expected_roi_pct",
    "confidence",
    "sold_comp_count",
  ];
  const rows = plan.rankedOpportunities.map((row) => [
    row.candidateId,
    row.identityId,
    row.acquisitionCost,
    row.buyCeiling,
    row.suggestedListPrice,
    row.estimatedProfit,
    row.expectedRoiPct,
    row.confidence,
    row.soldCompCount,
  ].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n");
}
