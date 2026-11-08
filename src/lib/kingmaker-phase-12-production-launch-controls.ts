export type LaunchVerdict = "go" | "hold" | "rollback";

export interface LaunchSignal {
  name: string;
  ok: boolean;
  critical?: boolean;
  detail?: string;
}

export interface CanaryWindow {
  trafficPercent: number;
  durationMinutes: number;
  maxErrorRatePercent: number;
  maxP95LatencyMs: number;
  maxCapitalVariancePercent: number;
}

export interface LaunchControlInput {
  releaseCertified: boolean;
  ownerApproved: boolean;
  migrationsVerified: boolean;
  rollbackVerified: boolean;
  livePaymentsEnabled: boolean;
  liveShippingEnabled: boolean;
  canary: CanaryWindow;
  observedErrorRatePercent: number;
  observedP95LatencyMs: number;
  observedCapitalVariancePercent: number;
  signals: LaunchSignal[];
}

export interface LaunchControlDecision {
  verdict: LaunchVerdict;
  score: number;
  reasons: string[];
  nextTrafficPercent: number;
  fingerprint: string;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluateProductionLaunch(input: LaunchControlInput): LaunchControlDecision {
  const reasons: string[] = [];
  const criticalSignalFailure = input.signals.some((signal) => signal.critical && !signal.ok);

  if (!input.releaseCertified) reasons.push("release-not-certified");
  if (!input.ownerApproved) reasons.push("owner-approval-missing");
  if (!input.migrationsVerified) reasons.push("migrations-unverified");
  if (!input.rollbackVerified) reasons.push("rollback-unverified");
  if (criticalSignalFailure) reasons.push("critical-signal-failed");

  const rollbackTriggered =
    input.observedErrorRatePercent > input.canary.maxErrorRatePercent ||
    input.observedP95LatencyMs > input.canary.maxP95LatencyMs ||
    input.observedCapitalVariancePercent > input.canary.maxCapitalVariancePercent;

  if (rollbackTriggered) reasons.push("canary-threshold-breached");

  let verdict: LaunchVerdict = "go";
  if (rollbackTriggered) verdict = "rollback";
  else if (reasons.length > 0) verdict = "hold";

  const healthySignals = input.signals.filter((signal) => signal.ok).length;
  const signalScore = input.signals.length === 0 ? 100 : (healthySignals / input.signals.length) * 100;
  const score = Math.max(
    0,
    Math.min(
      100,
      Number((signalScore - reasons.length * 15 - (input.livePaymentsEnabled || input.liveShippingEnabled ? 0 : 5)).toFixed(2)),
    ),
  );

  const nextTrafficPercent = verdict === "go" ? Math.min(100, Math.max(1, input.canary.trafficPercent * 2)) : 0;
  const fingerprint = stableHash(JSON.stringify({ verdict, score, reasons, nextTrafficPercent }));

  return { verdict, score, reasons, nextTrafficPercent, fingerprint };
}
