import { createHash } from "node:crypto";

export type MarketplaceRunState = "ready" | "running" | "degraded" | "failed" | "completed";
export type ReservationState = "reserved" | "released" | "consumed" | "expired";
export type ExecutionVerdict = "execute" | "approval_required" | "throttled" | "blocked";

export type AdapterTask = {
  marketplace: string;
  tenantId: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  timeoutMs: number;
  rateLimitRemaining: number;
  circuitOpen: boolean;
};

export type CapitalCandidate = {
  decisionFingerprint: string;
  tenantId: string;
  marketplace: string;
  amount: number;
  confidence: number;
  risk: number;
  expectedProfit: number;
  authorizationVerified: boolean;
  ownerApprovalRequired: boolean;
};

export type PortfolioOutcome = {
  decisionFingerprint: string;
  predictedProfit: number;
  realizedProfit: number;
  predictedHoldDays: number;
  realizedHoldDays: number;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function finite(value: number, code: string) {
  if (!Number.isFinite(value)) throw new Error(code);
  return value;
}

function bounded(value: number, min: number, max: number, code: string) {
  finite(value, code);
  if (value < min || value > max) throw new Error(code);
  return value;
}

export function planKingmakerAdapterFleet(input: {
  tasks: AdapterTask[];
  workerSlots: number;
}) {
  if (!Number.isInteger(input.workerSlots) || input.workerSlots < 1 || input.workerSlots > 1000) throw new Error("invalid_worker_slots");
  const normalized = input.tasks.map((task) => {
    if (!task.marketplace.trim() || !task.tenantId.trim()) throw new Error("invalid_adapter_identity");
    bounded(task.priority, 0, 100, "invalid_adapter_priority");
    if (!Number.isInteger(task.attempts) || task.attempts < 0) throw new Error("invalid_adapter_attempts");
    if (!Number.isInteger(task.maxAttempts) || task.maxAttempts < 1 || task.maxAttempts > 20) throw new Error("invalid_adapter_max_attempts");
    bounded(task.timeoutMs, 100, 300_000, "invalid_adapter_timeout");
    bounded(task.rateLimitRemaining, 0, 1_000_000, "invalid_rate_limit");
    const blocked = task.circuitOpen || task.attempts >= task.maxAttempts || task.rateLimitRemaining === 0;
    const score = task.priority - task.attempts * 8 + Math.min(20, Math.log10(task.rateLimitRemaining + 1) * 5);
    return { ...task, blocked, score: Math.round(score * 100) / 100 };
  }).sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score || a.marketplace.localeCompare(b.marketplace));
  const scheduled = normalized.filter((task) => !task.blocked).slice(0, input.workerSlots);
  const deferred = normalized.filter((task) => !scheduled.some((selected) => selected.marketplace === task.marketplace && selected.tenantId === task.tenantId));
  const canonical = { workerSlots: input.workerSlots, scheduled, deferred };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function reserveKingmakerCapital(input: {
  candidate: CapitalCandidate;
  availableCapital: number;
  alreadyReserved: number;
  dailyDeployed: number;
  maxDailyDeployment: number;
  maxSingleExposure: number;
}) {
  const candidate = input.candidate;
  if (!candidate.decisionFingerprint.trim() || !candidate.tenantId.trim() || !candidate.marketplace.trim()) throw new Error("invalid_candidate_identity");
  bounded(candidate.amount, 0.01, 100_000_000, "invalid_candidate_amount");
  bounded(candidate.confidence, 0, 1, "invalid_candidate_confidence");
  bounded(candidate.risk, 0, 100, "invalid_candidate_risk");
  finite(candidate.expectedProfit, "invalid_expected_profit");
  bounded(input.availableCapital, 0, 100_000_000, "invalid_available_capital");
  bounded(input.alreadyReserved, 0, 100_000_000, "invalid_reserved_capital");
  bounded(input.dailyDeployed, 0, 100_000_000, "invalid_daily_deployed");
  bounded(input.maxDailyDeployment, 0, 100_000_000, "invalid_daily_limit");
  bounded(input.maxSingleExposure, 0.01, 100_000_000, "invalid_single_exposure");

  const reasons: string[] = [];
  if (!candidate.authorizationVerified) reasons.push("authorization_unverified");
  if (candidate.expectedProfit <= 0) reasons.push("non_positive_profit");
  if (candidate.confidence < 0.7) reasons.push("confidence_below_floor");
  if (candidate.risk >= 70) reasons.push("risk_above_ceiling");
  if (candidate.amount > input.maxSingleExposure) reasons.push("single_exposure_exceeded");
  if (input.dailyDeployed + candidate.amount > input.maxDailyDeployment) reasons.push("daily_capital_exceeded");
  if (input.availableCapital - input.alreadyReserved < candidate.amount) reasons.push("insufficient_free_capital");

  const verdict: ExecutionVerdict = reasons.length
    ? "blocked"
    : candidate.ownerApprovalRequired
      ? "approval_required"
      : "execute";
  const canonical = {
    decisionFingerprint: candidate.decisionFingerprint,
    amount: candidate.amount,
    verdict,
    reasons: reasons.sort(),
    reservationState: verdict === "execute" || verdict === "approval_required" ? "reserved" as ReservationState : null,
    freeCapitalAfter: Math.max(0, input.availableCapital - input.alreadyReserved - (reasons.length ? 0 : candidate.amount)),
  };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function evaluateKingmakerExecutionAttempt(input: {
  adapterState: MarketplaceRunState;
  reservationState: ReservationState;
  authorizationVerified: boolean;
  idempotencySeen: boolean;
  circuitOpen: boolean;
  rateLimitRemaining: number;
}) {
  bounded(input.rateLimitRemaining, 0, 1_000_000, "invalid_rate_limit");
  const reasons: string[] = [];
  if (input.adapterState !== "ready" && input.adapterState !== "completed") reasons.push("adapter_not_ready");
  if (input.reservationState !== "reserved") reasons.push("capital_not_reserved");
  if (!input.authorizationVerified) reasons.push("authorization_unverified");
  if (input.idempotencySeen) reasons.push("duplicate_execution");
  if (input.circuitOpen) reasons.push("circuit_open");
  if (input.rateLimitRemaining === 0) reasons.push("rate_limited");
  const verdict: ExecutionVerdict = reasons.includes("rate_limited") ? "throttled" : reasons.length ? "blocked" : "execute";
  const canonical = { verdict, reasons: reasons.sort() };
  return { ...canonical, fingerprint: hash(canonical) };
}

export function reconcileKingmakerPredictionOutcomes(input: { outcomes: PortfolioOutcome[] }) {
  const outcomes = [...input.outcomes].map((outcome) => {
    if (!outcome.decisionFingerprint.trim()) throw new Error("missing_decision_fingerprint");
    finite(outcome.predictedProfit, "invalid_predicted_profit");
    finite(outcome.realizedProfit, "invalid_realized_profit");
    bounded(outcome.predictedHoldDays, 0, 3650, "invalid_predicted_hold");
    bounded(outcome.realizedHoldDays, 0, 3650, "invalid_realized_hold");
    return outcome;
  }).sort((a, b) => a.decisionFingerprint.localeCompare(b.decisionFingerprint));
  const count = outcomes.length;
  const profitError = count ? outcomes.reduce((sum, item) => sum + Math.abs(item.realizedProfit - item.predictedProfit), 0) / count : 0;
  const holdError = count ? outcomes.reduce((sum, item) => sum + Math.abs(item.realizedHoldDays - item.predictedHoldDays), 0) / count : 0;
  const profitableAccuracy = count ? outcomes.filter((item) => (item.predictedProfit > 0) === (item.realizedProfit > 0)).length / count : 0;
  const canonical = {
    count,
    meanAbsoluteProfitError: Math.round(profitError * 100) / 100,
    meanAbsoluteHoldErrorDays: Math.round(holdError * 100) / 100,
    profitableDirectionAccuracy: Math.round(profitableAccuracy * 10_000) / 10_000,
    outcomes,
  };
  return { ...canonical, fingerprint: hash(canonical) };
}
