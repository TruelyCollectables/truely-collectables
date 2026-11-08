export type OperationalVerdict = "healthy" | "degraded" | "incident" | "shutdown";
export type IncidentSeverity = "sev1" | "sev2" | "sev3" | "sev4";

export interface LiveSignal {
  name: string;
  observed: number;
  warning: number;
  critical: number;
  direction: "higher_is_worse" | "lower_is_worse";
  required: boolean;
  fresh: boolean;
}

export interface ControlState {
  ownerApprovalVerified: boolean;
  releaseCertified: boolean;
  rollbackReady: boolean;
  livePaymentsEnabled: boolean;
  liveShippingEnabled: boolean;
  killSwitchAvailable: boolean;
  capitalLedgerBalanced: boolean;
  idempotencyHealthy: boolean;
}

export interface IncidentCommand {
  verdict: OperationalVerdict;
  severity: IncidentSeverity | null;
  trafficPercent: number;
  freezeNewCapital: boolean;
  disablePayments: boolean;
  disableShipping: boolean;
  invokeRollback: boolean;
  openIncident: boolean;
  reasons: string[];
  fingerprint: string;
}

function breached(signal: LiveSignal, threshold: number): boolean {
  return signal.direction === "higher_is_worse"
    ? signal.observed >= threshold
    : signal.observed <= threshold;
}

function validThresholdOrder(signal: LiveSignal): boolean {
  return signal.direction === "higher_is_worse"
    ? signal.warning < signal.critical
    : signal.warning > signal.critical;
}

function validSignal(signal: LiveSignal): boolean {
  return signal.name.trim().length > 0
    && Number.isFinite(signal.observed)
    && Number.isFinite(signal.warning)
    && Number.isFinite(signal.critical)
    && validThresholdOrder(signal);
}

function stableFingerprint(parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `km13-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function signalInventoryFailures(signals: LiveSignal[], requiredSignalNames: string[]): string[] {
  const failures: string[] = [];
  const counts = new Map<string, number>();
  for (const signal of signals) {
    const name = signal.name.trim();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) failures.push(`${name || "unnamed"}:duplicate-signal`);
  }
  for (const requiredName of [...new Set(requiredSignalNames)].sort()) {
    if (!counts.has(requiredName)) failures.push(`${requiredName}:required-signal-missing`);
  }
  return failures;
}

export function commandLiveOperations(input: {
  signals: LiveSignal[];
  controls: ControlState;
  currentTrafficPercent: number;
  requiredSignalNames?: string[];
}): IncidentCommand {
  const reasons: string[] = [];
  let criticalCount = 0;
  let warningCount = 0;

  const inventoryFailures = signalInventoryFailures(input.signals, input.requiredSignalNames ?? []);
  criticalCount += inventoryFailures.length;
  reasons.push(...inventoryFailures);

  if (!Number.isFinite(input.currentTrafficPercent) || input.currentTrafficPercent < 0 || input.currentTrafficPercent > 100) {
    criticalCount += 1;
    reasons.push("traffic-percent-invalid");
  }

  for (const signal of input.signals) {
    const name = signal.name.trim() || "unnamed";
    if (!validSignal(signal)) {
      criticalCount += 1;
      reasons.push(`${name}:invalid-signal-contract`);
      continue;
    }
    if (signal.required && !signal.fresh) {
      criticalCount += 1;
      reasons.push(`${name}:required-signal-stale`);
      continue;
    }
    if (!signal.fresh) continue;
    if (breached(signal, signal.critical)) {
      criticalCount += 1;
      reasons.push(`${name}:critical`);
    } else if (breached(signal, signal.warning)) {
      warningCount += 1;
      reasons.push(`${name}:warning`);
    }
  }

  const controlFailures: string[] = [];
  if (!input.controls.ownerApprovalVerified) controlFailures.push("owner-approval-unverified");
  if (!input.controls.releaseCertified) controlFailures.push("release-not-certified");
  if (!input.controls.rollbackReady) controlFailures.push("rollback-not-ready");
  if (!input.controls.killSwitchAvailable) controlFailures.push("kill-switch-unavailable");
  if (!input.controls.capitalLedgerBalanced) controlFailures.push("capital-ledger-unbalanced");
  if (!input.controls.idempotencyHealthy) controlFailures.push("idempotency-unhealthy");
  reasons.push(...controlFailures);

  const shutdown =
    !input.controls.ownerApprovalVerified ||
    !input.controls.releaseCertified ||
    !input.controls.killSwitchAvailable ||
    !input.controls.capitalLedgerBalanced ||
    !input.controls.idempotencyHealthy ||
    criticalCount >= 2;

  const incident = !shutdown && (criticalCount === 1 || !input.controls.rollbackReady);
  const degraded = !shutdown && !incident && warningCount > 0;
  const verdict: OperationalVerdict = shutdown
    ? "shutdown"
    : incident
      ? "incident"
      : degraded
        ? "degraded"
        : "healthy";

  const severity: IncidentSeverity | null =
    verdict === "shutdown" ? "sev1" : verdict === "incident" ? "sev2" : verdict === "degraded" ? "sev3" : null;

  const safeCurrentTraffic = Number.isFinite(input.currentTrafficPercent)
    ? Math.min(100, Math.max(0, input.currentTrafficPercent))
    : 0;
  const trafficPercent = verdict === "healthy"
    ? safeCurrentTraffic
    : verdict === "degraded"
      ? Math.min(25, safeCurrentTraffic)
      : 0;

  const command: Omit<IncidentCommand, "fingerprint"> = {
    verdict,
    severity,
    trafficPercent,
    freezeNewCapital: verdict !== "healthy",
    disablePayments: verdict === "shutdown" || (verdict === "incident" && input.controls.livePaymentsEnabled),
    disableShipping: verdict === "shutdown" || (verdict === "incident" && input.controls.liveShippingEnabled),
    invokeRollback: verdict === "shutdown" && input.controls.rollbackReady,
    openIncident: verdict === "incident" || verdict === "shutdown",
    reasons: [...new Set(reasons)].sort(),
  };

  return {
    ...command,
    fingerprint: stableFingerprint([
      command.verdict,
      command.severity ?? "none",
      String(command.trafficPercent),
      String(command.freezeNewCapital),
      String(command.disablePayments),
      String(command.disableShipping),
      String(command.invokeRollback),
      ...command.reasons,
    ]),
  };
}

export function evaluateRecovery(input: {
  incidentOpen: boolean;
  ownerApprovalVerified: boolean;
  rollbackVerified: boolean;
  signals: LiveSignal[];
  consecutiveHealthyWindows: number;
  minimumHealthyWindows: number;
  requiredSignalNames?: string[];
}): { recoverable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.incidentOpen) reasons.push("no-open-incident");
  if (!input.ownerApprovalVerified) reasons.push("owner-approval-unverified");
  if (!input.rollbackVerified) reasons.push("rollback-not-verified");
  if (!Number.isInteger(input.minimumHealthyWindows) || input.minimumHealthyWindows < 1) reasons.push("minimum-healthy-windows-invalid");
  if (!Number.isInteger(input.consecutiveHealthyWindows) || input.consecutiveHealthyWindows < 0) reasons.push("healthy-window-count-invalid");
  if (input.consecutiveHealthyWindows < input.minimumHealthyWindows) reasons.push("insufficient-healthy-windows");
  reasons.push(...signalInventoryFailures(input.signals, input.requiredSignalNames ?? []));
  for (const signal of input.signals) {
    const name = signal.name.trim() || "unnamed";
    if (!validSignal(signal)) {
      reasons.push(`${name}:invalid-signal-contract`);
      continue;
    }
    if (signal.required && !signal.fresh) reasons.push(`${name}:stale`);
    if (signal.fresh && breached(signal, signal.warning)) reasons.push(`${name}:not-recovered`);
  }
  const uniqueReasons = [...new Set(reasons)].sort();
  return { recoverable: uniqueReasons.length === 0, reasons: uniqueReasons };
}
