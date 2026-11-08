import { createHash } from "node:crypto";

export type KingmakerPerformanceProfile = {
  dimension: "seller" | "source" | "category" | "subject" | "set" | "strategy";
  key: string;
  sampleSize: number;
  closedCount: number;
  winRate: number | null;
  averageRealizedProfit: number | null;
  averageRealizedRoiPercent: number | null;
  medianDaysToExit: number | null;
  averageProfitPredictionError: number | null;
  averageRoiPredictionError: number | null;
  confidenceCalibrationError: number | null;
  reliabilityScore: number;
  grade: "unproven" | "weak" | "developing" | "reliable" | "strong" | "elite";
};

export type KingmakerLearningPolicy = {
  status: "insufficient_data" | "tighten" | "hold" | "expand";
  confidenceAdjustment: number;
  maximumPositionMultiplier: number;
  minimumRequiredRoiPercent: number;
  minimumRequiredProfit: number;
  reasons: string[];
  fingerprint: string;
};

function finite(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function deriveKingmakerLearningPolicy(input: {
  profiles: KingmakerPerformanceProfile[];
  baseMinimumRoiPercent?: number;
  baseMinimumProfit?: number;
  minimumClosedOutcomes?: number;
}): KingmakerLearningPolicy {
  const baseMinimumRoiPercent = input.baseMinimumRoiPercent ?? 20;
  const baseMinimumProfit = input.baseMinimumProfit ?? 5;
  const minimumClosedOutcomes = input.minimumClosedOutcomes ?? 5;
  const usable = input.profiles.filter((profile) => profile.closedCount > 0);
  const closedCount = usable.reduce((sum, profile) => sum + profile.closedCount, 0);
  const reasons: string[] = [];

  if (!usable.length || closedCount < minimumClosedOutcomes) {
    reasons.push(`Only ${closedCount} closed outcome(s); ${minimumClosedOutcomes} required before learning changes buying policy.`);
    const canonical = {
      status: "insufficient_data",
      confidenceAdjustment: 0,
      maximumPositionMultiplier: 0.5,
      minimumRequiredRoiPercent: baseMinimumRoiPercent,
      minimumRequiredProfit: baseMinimumProfit,
      reasons,
    } as const;
    return {
      ...canonical,
      fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    };
  }

  const weightTotal = usable.reduce((sum, profile) => sum + profile.closedCount, 0);
  const weighted = (selector: (profile: KingmakerPerformanceProfile) => number | null) => {
    const values = usable
      .map((profile) => ({ value: finite(selector(profile)), weight: profile.closedCount }))
      .filter((entry): entry is { value: number; weight: number } => entry.value !== null);
    const total = values.reduce((sum, entry) => sum + entry.weight, 0);
    return total ? values.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / total : null;
  };

  const reliability = usable.reduce((sum, profile) => sum + profile.reliabilityScore * profile.closedCount, 0) / weightTotal;
  const winRate = weighted((profile) => profile.winRate);
  const realizedRoi = weighted((profile) => profile.averageRealizedRoiPercent);
  const profitError = weighted((profile) => profile.averageProfitPredictionError);
  const roiError = weighted((profile) => profile.averageRoiPredictionError);
  const calibrationError = weighted((profile) => profile.confidenceCalibrationError);

  let status: KingmakerLearningPolicy["status"] = "hold";
  let confidenceAdjustment = 0;
  let maximumPositionMultiplier = 1;
  let minimumRequiredRoiPercent = baseMinimumRoiPercent;
  let minimumRequiredProfit = baseMinimumProfit;

  const weakPerformance =
    reliability < 50 ||
    (winRate !== null && winRate < 0.45) ||
    (realizedRoi !== null && realizedRoi < 5) ||
    (roiError !== null && roiError < -20);
  const strongPerformance =
    reliability >= 75 &&
    (winRate ?? 0) >= 0.65 &&
    (realizedRoi ?? 0) >= 25 &&
    Math.abs(roiError ?? 0) <= 20 &&
    Math.abs(calibrationError ?? 0) <= 0.15;

  if (weakPerformance) {
    status = "tighten";
    confidenceAdjustment = -0.1;
    maximumPositionMultiplier = 0.5;
    minimumRequiredRoiPercent = baseMinimumRoiPercent + 15;
    minimumRequiredProfit = baseMinimumProfit + 5;
    reasons.push("Realized results or prediction accuracy are below policy tolerance.");
  } else if (strongPerformance) {
    status = "expand";
    confidenceAdjustment = 0.05;
    maximumPositionMultiplier = 1.25;
    minimumRequiredRoiPercent = Math.max(10, baseMinimumRoiPercent - 5);
    minimumRequiredProfit = Math.max(2, baseMinimumProfit - 1);
    reasons.push("Closed outcomes show strong, calibrated, repeatable profitability.");
  } else {
    reasons.push("Performance is usable but not strong enough to expand or weak enough to tighten.");
  }

  if (profitError !== null && profitError < -10) {
    minimumRequiredProfit += 3;
    reasons.push("KINGMAKER has been overestimating realized profit.");
  }
  if (roiError !== null && roiError < -15) {
    minimumRequiredRoiPercent += 5;
    reasons.push("KINGMAKER has been overestimating realized ROI.");
  }
  if (calibrationError !== null && Math.abs(calibrationError) > 0.2) {
    confidenceAdjustment -= 0.05;
    maximumPositionMultiplier = Math.min(maximumPositionMultiplier, 0.75);
    reasons.push("Signal confidence is poorly calibrated against actual outcomes.");
  }

  confidenceAdjustment = Number(clamp(confidenceAdjustment, -0.25, 0.1).toFixed(4));
  maximumPositionMultiplier = Number(clamp(maximumPositionMultiplier, 0.25, 1.5).toFixed(4));
  minimumRequiredRoiPercent = Number(clamp(minimumRequiredRoiPercent, 5, 100).toFixed(2));
  minimumRequiredProfit = Number(clamp(minimumRequiredProfit, 1, 1000).toFixed(2));

  const canonical = {
    status,
    confidenceAdjustment,
    maximumPositionMultiplier,
    minimumRequiredRoiPercent,
    minimumRequiredProfit,
    reasons,
    profileKeys: usable.map((profile) => `${profile.dimension}:${profile.key}`).sort(),
    closedCount,
  };

  return {
    status,
    confidenceAdjustment,
    maximumPositionMultiplier,
    minimumRequiredRoiPercent,
    minimumRequiredProfit,
    reasons,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
