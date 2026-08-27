import type { KingmakerPricingDecision } from "./kingmaker-pricing-decision";

export type KingmakerPricingScenario = {
  profileId: string;
  profileName: string;
  decision: KingmakerPricingDecision;
};

export function compareKingmakerPricingScenarios(scenarios: KingmakerPricingScenario[]) {
  const bounded = scenarios.slice(0, 10);
  const ready = bounded
    .filter((row) => row.decision.status === "ready")
    .map((row) => ({
      profileId: row.profileId,
      profileName: row.profileName,
      suggestedListPrice: row.decision.suggestedListPrice,
      buyCeiling: row.decision.buyCeiling,
      estimatedNetProceeds: row.decision.estimatedNetProceeds,
      estimatedProfitAtCeiling: row.decision.estimatedProfitAtCeiling,
      confidence: row.decision.confidence,
    }))
    .sort((a, b) =>
      Number(b.estimatedProfitAtCeiling || 0) - Number(a.estimatedProfitAtCeiling || 0) ||
      b.confidence - a.confidence,
    );

  return {
    scenariosEvaluated: bounded.length,
    readyScenarios: ready.length,
    bestScenario: ready[0] || null,
    scenarios: ready,
    boundary: "advisory_only" as const,
  };
}
