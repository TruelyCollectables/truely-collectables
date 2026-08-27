import { createHash } from "node:crypto";
import { buildKingmakerAdaptiveWatchlists, type KingmakerWatchlistSeed } from "./kingmaker-adaptive-watchlists";
import { buildKingmakerCapitalPlan, type KingmakerCapitalCandidate } from "./kingmaker-capital-allocation";
import { buildKingmakerCommandCenter, type KingmakerCommandCenterInput } from "./kingmaker-command-center";
import { deriveKingmakerLearningPolicy } from "./kingmaker-learning-policy";
import { calculateKingmakerMomentum, type KingmakerMarketPoint } from "./kingmaker-market-momentum";
import { detectKingmakerMeaningfulChanges, type KingmakerSignalSnapshot } from "./kingmaker-meaningful-changes";
import { analyzeKingmakerPortfolio, type KingmakerPortfolioPosition } from "./kingmaker-portfolio-brain";
import { predictKingmakerOutcome, type KingmakerHistoricalOutcome } from "./kingmaker-prediction-engine";
import { rankKingmakerSellerSweep, type KingmakerSellerProfileInput } from "./kingmaker-seller-sweep-ranking";
import type { KingmakerLearningRecord } from "./kingmaker-performance-profiles";
import { buildKingmakerPerformanceProfiles } from "./kingmaker-performance-profiles";

export type KingmakerPhase4Candidate = KingmakerCapitalCandidate & {
  marketEstimate: number;
  historicalOutcomes: KingmakerHistoricalOutcome[];
  marketPoints?: KingmakerMarketPoint[];
};

export type KingmakerPhase4CycleInput = {
  generatedAt: string;
  availableCapital: number;
  reservedCapital: number;
  previousSignals: KingmakerSignalSnapshot[];
  currentSignals: KingmakerSignalSnapshot[];
  learningRecords: KingmakerLearningRecord[];
  candidates: KingmakerPhase4Candidate[];
  sellerProfiles: KingmakerSellerProfileInput[];
  portfolioPositions: KingmakerPortfolioPosition[];
  watchlistSeeds: KingmakerWatchlistSeed[];
  sourceHealth: KingmakerCommandCenterInput["sourceHealth"];
};

export function runKingmakerPhase4Cycle(input: KingmakerPhase4CycleInput) {
  const generatedAt = new Date(input.generatedAt).toISOString();
  const dimensions = ["seller", "source", "category", "subject", "set", "strategy"] as const;
  const profiles = dimensions.flatMap((dimension) => buildKingmakerPerformanceProfiles(input.learningRecords, dimension));
  const policy = deriveKingmakerLearningPolicy({ profiles });

  const predictions = input.candidates.map((candidate) => {
    const momentum = candidate.marketPoints && candidate.marketPoints.length >= 2
      ? calculateKingmakerMomentum(candidate.marketPoints)
      : null;
    const prediction = predictKingmakerOutcome({
      deliveredCost: candidate.deliveredCost,
      marketEstimate: candidate.marketEstimate,
      signalConfidence: candidate.confidence,
      momentumScore: momentum?.score ?? null,
      historicalOutcomes: candidate.historicalOutcomes,
    });
    return {
      signalFingerprint: candidate.signalFingerprint,
      entityKey: candidate.entityKey,
      momentum,
      prediction,
    };
  });

  const predictionBySignal = new Map(predictions.map((entry) => [entry.signalFingerprint, entry]));
  const learnedCandidates: KingmakerCapitalCandidate[] = input.candidates.map((candidate) => {
    const prediction = predictionBySignal.get(candidate.signalFingerprint)?.prediction;
    return {
      ...candidate,
      expectedProfit: prediction?.expectedProfit ?? candidate.expectedProfit,
      expectedRoiPercent: prediction?.expectedRoiPercent ?? candidate.expectedRoiPercent,
      velocityScore: prediction ? Math.max(0, Math.min(1, 1 - prediction.expectedDaysToExit / 180)) : candidate.velocityScore,
    };
  });

  const capitalPlan = buildKingmakerCapitalPlan({
    budget: input.availableCapital,
    reservePercent: input.availableCapital > 0 ? input.reservedCapital / input.availableCapital : 0,
    candidates: learnedCandidates,
    policy,
  });
  const sellerRanks = rankKingmakerSellerSweep({ sellers: input.sellerProfiles, candidates: learnedCandidates });
  const meaningfulChanges = detectKingmakerMeaningfulChanges({
    previous: input.previousSignals,
    current: input.currentSignals,
  });
  const watchlists = buildKingmakerAdaptiveWatchlists({
    seeds: input.watchlistSeeds,
    profiles,
  });
  const portfolio = analyzeKingmakerPortfolio(input.portfolioPositions, new Date(generatedAt));

  const closed = input.learningRecords.filter((record) => ["won", "lost", "flat"].includes(record.outcome.state));
  const wins = closed.filter((record) => record.outcome.state === "won").length;
  const realizedRoi = closed
    .map((record) => record.outcome.realizedRoiPercent)
    .filter((value): value is number => value !== null);
  const profitErrors = closed
    .map((record) => record.outcome.predictionErrorProfit)
    .filter((value): value is number => value !== null);
  const performance = {
    closedCount: closed.length,
    winRate: closed.length ? Number((wins / closed.length).toFixed(4)) : null,
    averageRealizedRoiPercent: realizedRoi.length
      ? Number((realizedRoi.reduce((sum, value) => sum + value, 0) / realizedRoi.length).toFixed(4))
      : null,
    averageProfitPredictionError: profitErrors.length
      ? Number((profitErrors.reduce((sum, value) => sum + value, 0) / profitErrors.length).toFixed(4))
      : null,
  };
  const commandCenter = buildKingmakerCommandCenter({
    generatedAt,
    availableCapital: input.availableCapital,
    reservedCapital: input.reservedCapital,
    deployedCapital: portfolio.deployedCapital,
    verifiedSignals: input.currentSignals,
    meaningfulChanges,
    sellerRanks: sellerRanks.map((rank) => ({
      sellerKey: rank.sellerKey,
      score: rank.score,
      tier: rank.tier,
      actionableCount: rank.candidateCount,
    })),
    performance,
    sourceHealth: input.sourceHealth,
  });

  const warnings = [...new Set([
    ...commandCenter.riskFlags,
    ...portfolio.warnings,
    ...(policy.status === "tighten" ? ["learning_policy_tightened"] : []),
    ...(capitalPlan.allocations.every((allocation) => allocation.action !== "fund") ? ["no_capital_allocations_approved"] : []),
    ...(watchlists.every((watchlist) => watchlist.status !== "active") ? ["no_adaptive_watchlists_active"] : []),
  ])].sort();

  const canonical = {
    generatedAt,
    policyFingerprint: policy.fingerprint,
    capitalFingerprint: capitalPlan.fingerprint,
    sellerFingerprints: sellerRanks.map((rank) => rank.fingerprint),
    predictionFingerprints: predictions.map((entry) => entry.prediction.fingerprint),
    watchlistFingerprints: watchlists.map((watchlist) => watchlist.fingerprint),
    portfolioFingerprint: portfolio.fingerprint,
    commandCenterFingerprint: commandCenter.fingerprint,
    warnings,
  };

  return {
    generatedAt,
    profiles,
    policy,
    predictions,
    capitalPlan,
    sellerRanks,
    meaningfulChanges,
    watchlists,
    portfolio,
    performance,
    commandCenter,
    warnings,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
