import { createHash } from "node:crypto";

export type KingmakerHistoricalOutcome = {
  realizedSalePrice: number;
  realizedProfit: number;
  realizedRoiPercent: number;
  daysToExit: number;
};

export type KingmakerPrediction = {
  expectedSalePrice: number;
  expectedProfit: number;
  expectedRoiPercent: number;
  expectedDaysToExit: number;
  probabilityOfProfit: number;
  salePriceInterval: { low: number; high: number };
  profitInterval: { low: number; high: number };
  confidence: number;
  sampleSize: number;
  reasons: string[];
  fingerprint: string;
};

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number) {
  if (values.length < 2) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

export function predictKingmakerOutcome(input: {
  deliveredCost: number;
  marketEstimate: number;
  signalConfidence: number;
  momentumScore?: number | null;
  historicalOutcomes: KingmakerHistoricalOutcome[];
}): KingmakerPrediction {
  if (!Number.isFinite(input.deliveredCost) || input.deliveredCost <= 0) throw new Error("KINGMAKER_INVALID_DELIVERED_COST");
  if (!Number.isFinite(input.marketEstimate) || input.marketEstimate <= 0) throw new Error("KINGMAKER_INVALID_MARKET_ESTIMATE");

  const history = input.historicalOutcomes.filter((outcome) =>
    [outcome.realizedSalePrice, outcome.realizedProfit, outcome.realizedRoiPercent, outcome.daysToExit].every(Number.isFinite),
  );
  const sampleSize = history.length;
  const momentumAdjustment = Math.max(-0.15, Math.min(0.15, ((input.momentumScore ?? 50) - 50) / 200));
  const confidence = Math.max(0, Math.min(1, input.signalConfidence));

  const historicalSale = sampleSize ? mean(history.map((outcome) => outcome.realizedSalePrice)) : input.marketEstimate;
  const expectedSalePrice = input.marketEstimate * 0.65 + historicalSale * 0.35;
  const adjustedSalePrice = expectedSalePrice * (1 + momentumAdjustment);
  const expectedProfit = adjustedSalePrice - input.deliveredCost;
  const expectedRoiPercent = (expectedProfit / input.deliveredCost) * 100;
  const expectedDaysToExit = sampleSize ? mean(history.map((outcome) => outcome.daysToExit)) : 45;

  const saleStd = sampleSize ? standardDeviation(history.map((outcome) => outcome.realizedSalePrice), historicalSale) : input.marketEstimate * 0.2;
  const uncertaintyMultiplier = Math.max(0.75, 1.75 - confidence - Math.min(sampleSize, 20) / 40);
  const saleSpread = Math.max(input.marketEstimate * 0.08, saleStd * uncertaintyMultiplier);
  const profitSpread = saleSpread;
  const historicalProfitWins = sampleSize
    ? history.filter((outcome) => outcome.realizedProfit > 0).length / sampleSize
    : 0.5;
  const marginSignal = Math.max(0, Math.min(1, 0.5 + expectedRoiPercent / 200));
  const probabilityOfProfit = Math.max(0.01, Math.min(0.99,
    historicalProfitWins * 0.45 + confidence * 0.3 + marginSignal * 0.25,
  ));

  const reasons = [
    `Prediction blends current market value with ${sampleSize} historical outcome(s).`,
    `Momentum adjusted the sale estimate by ${(momentumAdjustment * 100).toFixed(1)}%.`,
    `Signal confidence contributes ${(confidence * 100).toFixed(1)}% confidence weight.`,
  ];

  const canonical = {
    deliveredCost: round(input.deliveredCost),
    marketEstimate: round(input.marketEstimate),
    signalConfidence: Number(confidence.toFixed(4)),
    momentumScore: input.momentumScore ?? null,
    history,
    expectedSalePrice: round(adjustedSalePrice),
    expectedProfit: round(expectedProfit),
    expectedRoiPercent: round(expectedRoiPercent),
    expectedDaysToExit: round(expectedDaysToExit),
    probabilityOfProfit: Number(probabilityOfProfit.toFixed(4)),
  };

  return {
    expectedSalePrice: round(adjustedSalePrice),
    expectedProfit: round(expectedProfit),
    expectedRoiPercent: round(expectedRoiPercent),
    expectedDaysToExit: round(expectedDaysToExit),
    probabilityOfProfit: Number(probabilityOfProfit.toFixed(4)),
    salePriceInterval: { low: round(Math.max(0, adjustedSalePrice - saleSpread)), high: round(adjustedSalePrice + saleSpread) },
    profitInterval: { low: round(expectedProfit - profitSpread), high: round(expectedProfit + profitSpread) },
    confidence: Number(confidence.toFixed(4)),
    sampleSize,
    reasons,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
