export type AssuranceVerdict = "attested" | "watch" | "quarantine" | "blocked";
export type DriftSeverity = "none" | "low" | "high" | "critical";

export interface AssuranceEvidence {
  key: string;
  expectedDigest: string;
  observedDigest: string;
  required: boolean;
  fresh: boolean;
  sourceVerified: boolean;
}

export interface AssuranceControls {
  ownerApprovalVerified: boolean;
  releaseCertified: boolean;
  chaosCertified: boolean;
  auditTrailComplete: boolean;
  capitalLedgerBalanced: boolean;
  idempotencyHealthy: boolean;
  rollbackReady: boolean;
  killSwitchAvailable: boolean;
}

export interface AssuranceDecision {
  verdict: AssuranceVerdict;
  severity: DriftSeverity;
  quarantineWrites: boolean;
  disablePayments: boolean;
  disableShipping: boolean;
  invokeRollback: boolean;
  requireOwnerReview: boolean;
  reasons: string[];
  fingerprint: string;
}

function validDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function stableFingerprint(parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `km15-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function evaluateContinuousAssurance(input: {
  evidence: AssuranceEvidence[];
  requiredEvidenceKeys: string[];
  controls: AssuranceControls;
  previousConsecutiveAttestedWindows: number;
  minimumAttestedWindowsForClear: number;
}): AssuranceDecision {
  const reasons: string[] = [];
  const seen = new Set<string>();
  let highDrift = 0;
  let lowDrift = 0;

  if (!Number.isInteger(input.previousConsecutiveAttestedWindows) || input.previousConsecutiveAttestedWindows < 0) {
    reasons.push("invalid-attested-window-count");
    highDrift += 1;
  }
  if (!Number.isInteger(input.minimumAttestedWindowsForClear) || input.minimumAttestedWindowsForClear < 1) {
    reasons.push("invalid-minimum-attested-windows");
    highDrift += 1;
  }

  const requiredKeys = [...new Set(input.requiredEvidenceKeys)].sort();
  if (requiredKeys.length !== input.requiredEvidenceKeys.length) {
    reasons.push("duplicate-required-evidence-key");
    highDrift += 1;
  }

  for (const evidence of [...input.evidence].sort((a, b) => a.key.localeCompare(b.key))) {
    if (!evidence.key.trim()) {
      reasons.push("blank-evidence-key");
      highDrift += 1;
      continue;
    }
    if (seen.has(evidence.key)) {
      reasons.push(`${evidence.key}:duplicate`);
      highDrift += 1;
      continue;
    }
    seen.add(evidence.key);
    if (!validDigest(evidence.expectedDigest) || !validDigest(evidence.observedDigest)) {
      reasons.push(`${evidence.key}:malformed-digest`);
      highDrift += 1;
      continue;
    }
    if (evidence.required && !evidence.fresh) {
      reasons.push(`${evidence.key}:stale`);
      highDrift += 1;
      continue;
    }
    if (evidence.required && !evidence.sourceVerified) {
      reasons.push(`${evidence.key}:source-unverified`);
      highDrift += 1;
      continue;
    }
    if (evidence.expectedDigest !== evidence.observedDigest) {
      reasons.push(`${evidence.key}:drift`);
      if (evidence.required) highDrift += 1;
      else lowDrift += 1;
    }
  }

  for (const key of requiredKeys) {
    if (!seen.has(key)) {
      reasons.push(`${key}:missing`);
      highDrift += 1;
    }
  }

  const controlFailures: string[] = [];
  if (!input.controls.ownerApprovalVerified) controlFailures.push("owner-approval-unverified");
  if (!input.controls.releaseCertified) controlFailures.push("release-not-certified");
  if (!input.controls.chaosCertified) controlFailures.push("chaos-not-certified");
  if (!input.controls.auditTrailComplete) controlFailures.push("audit-trail-incomplete");
  if (!input.controls.capitalLedgerBalanced) controlFailures.push("capital-ledger-unbalanced");
  if (!input.controls.idempotencyHealthy) controlFailures.push("idempotency-unhealthy");
  if (!input.controls.rollbackReady) controlFailures.push("rollback-not-ready");
  if (!input.controls.killSwitchAvailable) controlFailures.push("kill-switch-unavailable");
  reasons.push(...controlFailures);

  const blocked = controlFailures.length > 0 || highDrift >= 2;
  const quarantine = !blocked && highDrift === 1;
  const watch = !blocked && !quarantine && lowDrift > 0;
  const enoughCleanWindows =
    input.previousConsecutiveAttestedWindows + 1 >= input.minimumAttestedWindowsForClear;
  const verdict: AssuranceVerdict = blocked
    ? "blocked"
    : quarantine
      ? "quarantine"
      : watch || !enoughCleanWindows
        ? "watch"
        : "attested";

  if (!blocked && !quarantine && !watch && !enoughCleanWindows) {
    reasons.push("insufficient-consecutive-attested-windows");
  }

  const severity: DriftSeverity =
    verdict === "blocked" ? "critical" : verdict === "quarantine" ? "high" : verdict === "watch" ? "low" : "none";

  const decision: Omit<AssuranceDecision, "fingerprint"> = {
    verdict,
    severity,
    quarantineWrites: verdict === "blocked" || verdict === "quarantine",
    disablePayments: verdict === "blocked",
    disableShipping: verdict === "blocked",
    invokeRollback: verdict === "blocked" && input.controls.rollbackReady,
    requireOwnerReview: verdict !== "attested",
    reasons: reasons.sort(),
  };

  return {
    ...decision,
    fingerprint: stableFingerprint([
      decision.verdict,
      decision.severity,
      String(decision.quarantineWrites),
      String(decision.disablePayments),
      String(decision.disableShipping),
      String(decision.invokeRollback),
      ...decision.reasons,
    ]),
  };
}
