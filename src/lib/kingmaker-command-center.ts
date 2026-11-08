import { createHash } from "node:crypto";
import type { KingmakerMeaningfulChange, KingmakerSignalSnapshot } from "./kingmaker-meaningful-changes";

export type KingmakerCommandCenterInput = {
  generatedAt: string;
  availableCapital: number;
  reservedCapital: number;
  deployedCapital: number;
  verifiedSignals: KingmakerSignalSnapshot[];
  meaningfulChanges: KingmakerMeaningfulChange[];
  sellerRanks: Array<{ sellerKey: string; score: number; tier: string; actionableCount: number }>;
  performance: {
    closedCount: number;
    winRate: number | null;
    averageRealizedRoiPercent: number | null;
    averageProfitPredictionError: number | null;
  };
  sourceHealth: Array<{ source: string; accepted: number; rejected: number; lastSuccessfulAt: string | null }>;
};

export type KingmakerCommandCenterSnapshot = {
  generatedAt: string;
  capital: {
    available: number;
    reserved: number;
    deployed: number;
    deployable: number;
    utilizationPercent: number;
  };
  opportunityQueue: KingmakerSignalSnapshot[];
  urgentChanges: KingmakerMeaningfulChange[];
  sellerLeaders: Array<{ sellerKey: string; score: number; tier: string; actionableCount: number }>;
  riskFlags: string[];
  sourceCoverage: number;
  performance: KingmakerCommandCenterInput["performance"];
  fingerprint: string;
};

function money(value: number) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

export function buildKingmakerCommandCenter(input: KingmakerCommandCenterInput): KingmakerCommandCenterSnapshot {
  const generatedAt = new Date(input.generatedAt).toISOString();
  const available = Math.max(0, money(input.availableCapital));
  const reserved = Math.max(0, money(input.reservedCapital));
  const deployed = Math.max(0, money(input.deployedCapital));
  const deployable = Math.max(0, money(available - reserved));
  const utilizationPercent = available > 0 ? Number(((deployed / available) * 100).toFixed(2)) : 0;

  const opportunityQueue = input.verifiedSignals
    .filter((signal) => signal.status === "verified")
    .sort((left, right) => right.score - left.score || (right.expectedProfit ?? 0) - (left.expectedProfit ?? 0))
    .slice(0, 25);
  const urgentChanges = input.meaningfulChanges
    .filter((item) => item.severity === "critical" || item.severity === "important")
    .slice(0, 20);
  const sellerLeaders = [...input.sellerRanks]
    .filter((seller) => seller.tier !== "avoid")
    .sort((left, right) => right.score - left.score || right.actionableCount - left.actionableCount)
    .slice(0, 10);

  const riskFlags: string[] = [];
  if (utilizationPercent > 85) riskFlags.push("capital_utilization_high");
  if (deployable <= 0) riskFlags.push("no_deployable_capital");
  if ((input.performance.winRate ?? 1) < 0.45 && input.performance.closedCount >= 5) riskFlags.push("win_rate_below_tolerance");
  if ((input.performance.averageProfitPredictionError ?? 0) < -10) riskFlags.push("profit_predictions_overstated");
  if (urgentChanges.some((item) => item.type === "opportunity_lost")) riskFlags.push("verified_opportunities_disappearing");

  const healthySources = input.sourceHealth.filter((source) => source.lastSuccessfulAt && source.accepted > 0).length;
  const sourceCoverage = input.sourceHealth.length ? Number((healthySources / input.sourceHealth.length).toFixed(4)) : 0;
  if (sourceCoverage < 0.5) riskFlags.push("source_coverage_degraded");

  const canonical = {
    generatedAt,
    capital: { available, reserved, deployed, deployable, utilizationPercent },
    opportunities: opportunityQueue.map((signal) => signal.signalFingerprint),
    changes: urgentChanges.map((item) => item.fingerprint),
    sellers: sellerLeaders.map((seller) => `${seller.sellerKey}:${seller.score}`),
    riskFlags: [...new Set(riskFlags)].sort(),
    sourceCoverage,
    performance: input.performance,
  };

  return {
    generatedAt,
    capital: canonical.capital,
    opportunityQueue,
    urgentChanges,
    sellerLeaders,
    riskFlags: canonical.riskFlags,
    sourceCoverage,
    performance: input.performance,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
