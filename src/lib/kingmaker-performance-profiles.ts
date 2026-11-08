import { createHash } from "node:crypto";
import type { KingmakerDecisionOutcomeInput, KingmakerLearningOutcome } from "./kingmaker-learning-engine";

export type KingmakerLearningRecord = {
  input: KingmakerDecisionOutcomeInput;
  outcome: KingmakerLearningOutcome;
  category?: string | null;
  subject?: string | null;
  set?: string | null;
  strategy?: string | null;
};

export type KingmakerPerformanceDimension =
  | "source"
  | "seller"
  | "category"
  | "subject"
  | "set"
  | "strategy";

export type KingmakerPerformanceProfile = {
  dimension: KingmakerPerformanceDimension;
  key: string;
  sampleSize: number;
  closedCount: number;
  openCount: number;
  wins: number;
  losses: number;
  flats: number;
  winRate: number | null;
  averageRealizedProfit: number | null;
  averageRealizedRoiPercent: number | null;
  medianDaysToExit: number | null;
  averageProfitPredictionError: number | null;
  averageRoiPredictionError: number | null;
  confidenceCalibrationError: number | null;
  reliabilityScore: number;
  grade: "elite" | "strong" | "developing" | "weak" | "unproven";
  fingerprint: string;
};

function text(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return normalized || null;
}

function finite(values: Array<number | null | undefined>) {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function average(values: number[]) {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(4));
}

function keyFor(record: KingmakerLearningRecord, dimension: KingmakerPerformanceDimension) {
  if (dimension === "source") return text(record.input.source);
  if (dimension === "seller") return text(record.input.sellerKey);
  if (dimension === "category") return text(record.category);
  if (dimension === "subject") return text(record.subject);
  if (dimension === "set") return text(record.set);
  return text(record.strategy);
}

function grade(score: number, closedCount: number): KingmakerPerformanceProfile["grade"] {
  if (closedCount < 3) return "unproven";
  if (score >= 85) return "elite";
  if (score >= 70) return "strong";
  if (score >= 50) return "developing";
  return "weak";
}

export function buildKingmakerPerformanceProfiles(
  records: KingmakerLearningRecord[],
  dimension: KingmakerPerformanceDimension,
): KingmakerPerformanceProfile[] {
  const groups = new Map<string, KingmakerLearningRecord[]>();
  for (const record of records) {
    const key = keyFor(record, dimension);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  return [...groups.entries()].map(([key, group]) => {
    const closed = group.filter(({ outcome }) => ["won", "lost", "flat"].includes(outcome.state));
    const wins = closed.filter(({ outcome }) => outcome.state === "won").length;
    const losses = closed.filter(({ outcome }) => outcome.state === "lost").length;
    const flats = closed.filter(({ outcome }) => outcome.state === "flat").length;
    const winRate = closed.length ? wins / closed.length : null;
    const realizedProfit = finite(closed.map(({ outcome }) => outcome.realizedProfit));
    const realizedRoi = finite(closed.map(({ outcome }) => outcome.realizedRoiPercent));
    const daysToExit = finite(closed.map(({ outcome }) => outcome.daysToExit));
    const profitErrors = finite(closed.map(({ outcome }) => outcome.predictionErrorProfit));
    const roiErrors = finite(closed.map(({ outcome }) => outcome.predictionErrorRoiPercent));
    const calibrationErrors = finite(closed.map(({ input, outcome }) => {
      if (input.predictedConfidence === null || input.predictedConfidence === undefined) return null;
      const actual = outcome.state === "won" ? 1 : 0;
      return Math.abs(Math.max(0, Math.min(1, input.predictedConfidence)) - actual);
    }));

    const winComponent = (winRate ?? 0.5) * 35;
    const roiComponent = Math.max(0, Math.min(1, ((average(realizedRoi) ?? 0) + 20) / 80)) * 25;
    const calibrationComponent = (1 - Math.min(1, average(calibrationErrors) ?? 0.5)) * 20;
    const speedComponent = (1 - Math.min(1, (median(daysToExit) ?? 90) / 180)) * 10;
    const sampleComponent = Math.min(1, closed.length / 10) * 10;
    const reliabilityScore = Number(Math.max(0, Math.min(100,
      winComponent + roiComponent + calibrationComponent + speedComponent + sampleComponent,
    )).toFixed(2));

    const canonical = {
      dimension,
      key,
      outcomeFingerprints: group.map(({ outcome }) => outcome.outcomeFingerprint).sort(),
    };

    return {
      dimension,
      key,
      sampleSize: group.length,
      closedCount: closed.length,
      openCount: group.filter(({ outcome }) => outcome.state === "open").length,
      wins,
      losses,
      flats,
      winRate: winRate === null ? null : Number(winRate.toFixed(4)),
      averageRealizedProfit: average(realizedProfit),
      averageRealizedRoiPercent: average(realizedRoi),
      medianDaysToExit: median(daysToExit),
      averageProfitPredictionError: average(profitErrors),
      averageRoiPredictionError: average(roiErrors),
      confidenceCalibrationError: average(calibrationErrors),
      reliabilityScore,
      grade: grade(reliabilityScore, closed.length),
      fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    };
  }).sort((left, right) => right.reliabilityScore - left.reliabilityScore || right.closedCount - left.closedCount);
}
