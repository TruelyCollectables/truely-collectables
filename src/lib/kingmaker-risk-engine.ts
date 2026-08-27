import { createHash } from "node:crypto";

export type KingmakerRiskInput = {
  sellerReliability?: number | null;
  cancellationRate?: number | null;
  issueRate?: number | null;
  imageQuality?: number | null;
  descriptionCompleteness?: number | null;
  priceDeviationPercent?: number | null;
  volatility?: number | null;
  counterfeitSignals?: number;
  identityMismatchSignals?: number;
  gradingMismatchSignals?: number;
  returnRisk?: number | null;
};

export type KingmakerRiskAssessment = {
  score: number;
  level: "low" | "moderate" | "high" | "critical";
  blockers: string[];
  warnings: string[];
  fingerprint: string;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const safe = (value: number | null | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value) : fallback;

export function assessKingmakerRisk(input: KingmakerRiskInput): KingmakerRiskAssessment {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sellerRisk = 1 - safe(input.sellerReliability, 0.5);
  const cancellation = safe(input.cancellationRate, 0);
  const issues = safe(input.issueRate, 0);
  const imageRisk = 1 - safe(input.imageQuality, 0.5);
  const descriptionRisk = 1 - safe(input.descriptionCompleteness, 0.5);
  const volatility = safe(input.volatility, 0.5);
  const returnRisk = safe(input.returnRisk, 0.25);
  const priceDeviation = Math.min(Math.abs(input.priceDeviationPercent ?? 0) / 100, 1);
  const counterfeit = Math.max(0, input.counterfeitSignals ?? 0);
  const identityMismatch = Math.max(0, input.identityMismatchSignals ?? 0);
  const gradingMismatch = Math.max(0, input.gradingMismatchSignals ?? 0);

  if (counterfeit > 0) blockers.push("counterfeit_signal");
  if (identityMismatch > 0) blockers.push("identity_mismatch");
  if (gradingMismatch > 0) blockers.push("grading_mismatch");
  if (cancellation >= 0.25) blockers.push("seller_cancellation_rate");
  if (issues >= 0.2) blockers.push("seller_issue_rate");
  if (imageRisk >= 0.7) warnings.push("poor_image_quality");
  if (descriptionRisk >= 0.7) warnings.push("incomplete_description");
  if (priceDeviation >= 0.5) warnings.push("suspicious_price_deviation");
  if (volatility >= 0.7) warnings.push("high_market_volatility");

  const raw =
    sellerRisk * 0.18 + cancellation * 0.12 + issues * 0.14 + imageRisk * 0.1 +
    descriptionRisk * 0.08 + priceDeviation * 0.08 + volatility * 0.1 + returnRisk * 0.05 +
    Math.min(counterfeit, 1) * 0.2 + Math.min(identityMismatch, 1) * 0.2 + Math.min(gradingMismatch, 1) * 0.15;
  const score = Number((clamp(raw) * 100).toFixed(2));
  const level = blockers.length || score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  const canonical = { ...input, score, level, blockers: [...blockers].sort(), warnings: [...warnings].sort() };
  return { score, level, blockers, warnings, fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}
