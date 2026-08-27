import { createHash } from "node:crypto";

export type KingmakerDecisionOutcomeInput = {
  signalFingerprint: string;
  entityKey: string;
  decision: "buy" | "offer" | "watch" | "pass" | "dismiss" | "research";
  decidedAt: string;
  source?: string | null;
  sellerKey?: string | null;
  predictedProfit?: number | null;
  predictedRoiPercent?: number | null;
  predictedConfidence?: number | null;
  offerAmount?: number | null;
  paidAmount?: number | null;
  landedCost?: number | null;
  soldAmount?: number | null;
  soldAt?: string | null;
};

export type KingmakerLearningOutcome = {
  outcomeFingerprint: string;
  realizedProfit: number | null;
  realizedRoiPercent: number | null;
  predictionErrorProfit: number | null;
  predictionErrorRoiPercent: number | null;
  daysToExit: number | null;
  state: "open" | "won" | "lost" | "flat" | "non_purchase";
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}

export function evaluateKingmakerOutcome(input: KingmakerDecisionOutcomeInput): KingmakerLearningOutcome {
  const purchaseDecision = input.decision === "buy" || input.decision === "offer";
  const cost = finite(input.landedCost ?? input.paidAmount ?? input.offerAmount);
  const sold = finite(input.soldAmount);
  const realizedProfit = purchaseDecision && cost !== null && sold !== null ? finite(sold - cost) : null;
  const realizedRoiPercent = realizedProfit !== null && cost !== null && cost > 0
    ? finite((realizedProfit / cost) * 100)
    : null;
  const predictionErrorProfit = realizedProfit !== null && finite(input.predictedProfit) !== null
    ? finite(realizedProfit - Number(input.predictedProfit))
    : null;
  const predictionErrorRoiPercent = realizedRoiPercent !== null && finite(input.predictedRoiPercent) !== null
    ? finite(realizedRoiPercent - Number(input.predictedRoiPercent))
    : null;
  const decidedAt = Date.parse(input.decidedAt);
  const soldAt = input.soldAt ? Date.parse(input.soldAt) : Number.NaN;
  const daysToExit = Number.isFinite(decidedAt) && Number.isFinite(soldAt) && soldAt >= decidedAt
    ? finite((soldAt - decidedAt) / 86_400_000)
    : null;

  let state: KingmakerLearningOutcome["state"] = "open";
  if (!purchaseDecision) state = "non_purchase";
  else if (realizedProfit !== null) state = realizedProfit > 0 ? "won" : realizedProfit < 0 ? "lost" : "flat";

  const canonical = {
    signalFingerprint: input.signalFingerprint.trim(),
    entityKey: input.entityKey.trim(),
    decision: input.decision,
    decidedAt: new Date(input.decidedAt).toISOString(),
    source: input.source?.trim() || null,
    sellerKey: input.sellerKey?.trim() || null,
    predictedProfit: finite(input.predictedProfit),
    predictedRoiPercent: finite(input.predictedRoiPercent),
    predictedConfidence: finite(input.predictedConfidence),
    offerAmount: finite(input.offerAmount),
    paidAmount: finite(input.paidAmount),
    landedCost: cost,
    soldAmount: sold,
    soldAt: input.soldAt ? new Date(input.soldAt).toISOString() : null,
  };

  return {
    outcomeFingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    realizedProfit,
    realizedRoiPercent,
    predictionErrorProfit,
    predictionErrorRoiPercent,
    daysToExit,
    state,
  };
}

export function summarizeKingmakerLearning(outcomes: KingmakerLearningOutcome[]) {
  const closed = outcomes.filter((outcome) => ["won", "lost", "flat"].includes(outcome.state));
  const wins = closed.filter((outcome) => outcome.state === "won");
  const roiValues = closed.map((outcome) => outcome.realizedRoiPercent).filter((value): value is number => value !== null);
  const profitErrors = closed.map((outcome) => outcome.predictionErrorProfit).filter((value): value is number => value !== null);
  return {
    closedCount: closed.length,
    winRate: closed.length ? Number((wins.length / closed.length).toFixed(4)) : null,
    averageRealizedRoiPercent: roiValues.length ? Number((roiValues.reduce((sum, value) => sum + value, 0) / roiValues.length).toFixed(4)) : null,
    averageProfitPredictionError: profitErrors.length ? Number((profitErrors.reduce((sum, value) => sum + value, 0) / profitErrors.length).toFixed(4)) : null,
  };
}
