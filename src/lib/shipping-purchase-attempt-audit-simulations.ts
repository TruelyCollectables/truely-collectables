import {
  buildShippingPurchaseAttemptAudit,
  shippingPurchaseAttemptAuditLines,
  shippingPurchaseAttemptAuditSentence,
} from "./shipping-purchase-attempt-audit";

export const SHIPPING_PURCHASE_ATTEMPT_AUDIT_SUITE_VERSION = "2026-07-14.1";
export const SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_KEYS = [
  "live_gate_blocker_evidence_ready",
  "provider_setup_blocker_evidence_blocked",
  "dry_run_purchase_attempt_audit_sentence",
  "empty_purchase_attempt_audit_lines",
  "packet_purchase_attempt_audit_lines",
] as const;
export const SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_COUNT =
  SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_KEYS.length;

export type ShippingPurchaseAttemptAuditSimulationScenario = {
  scenario_key: string;
  scenario_status: "passed" | "failed";
  detail: string;
  assertions: Record<string, unknown>;
};

function pass(condition: boolean) {
  return condition ? "passed" : "failed";
}

function scenario(
  scenarioKey: string,
  detail: string,
  condition: boolean,
  assertions: Record<string, unknown>,
): ShippingPurchaseAttemptAuditSimulationScenario {
  return {
    scenario_key: scenarioKey,
    scenario_status: pass(condition),
    detail,
    assertions,
  };
}

export function runShippingPurchaseAttemptAuditSimulationSuite() {
  const scenarios: ShippingPurchaseAttemptAuditSimulationScenario[] = [];

  const liveGateBlockedPayload = {
    blocker_type: "live_shipping_runtime_gate",
    live_shipping_gate: {
      allowed: false,
      mode: "live",
      reason:
        "Live shipping is blocked by provider setup or approval requirements: Provider Credentials, Coverage Purchase Tests.",
    },
    shipping_adapter_profile: {
      provider: "LetterTrack / USPS IMb",
      carrier: "USPS IMb",
      purchaseMode: "live",
      missingCredentialKeys: ["LETTERTRACK_ACCOUNT_CONFIGURED"],
    },
    standard_envelope_evidence_contract_ready: true,
    standard_envelope_evidence_provider: "LetterTrack / USPS IMb",
    attempted_by_identity: {
      risk: "verified",
      blocked: false,
    },
  };
  const liveGateAudit =
    buildShippingPurchaseAttemptAudit(liveGateBlockedPayload);
  scenarios.push(
    scenario(
      "live_gate_blocker_evidence_ready",
      "Live-gate blocked provider purchases keep the Standard Envelope evidence validator, setup blocker, adapter profile, and admin identity audit text.",
      liveGateAudit.present &&
        liveGateAudit.standardEnvelopeEvidenceContractReady === true &&
        liveGateAudit.evidenceSummary ===
          "Standard Envelope evidence validator: ready (LetterTrack / USPS IMb)." &&
        liveGateAudit.details.some((detail) =>
          detail.includes("live_shipping_runtime_gate"),
        ) &&
        liveGateAudit.details.some((detail) =>
          detail.includes("LETTERTRACK_ACCOUNT_CONFIGURED"),
        ) &&
        liveGateAudit.details.some((detail) => detail.includes("risk=verified")),
      {
        evidenceSummary: liveGateAudit.evidenceSummary,
        details: liveGateAudit.details,
        sentence: liveGateAudit.sentence,
      },
    ),
  );

  const setupBlockedPayload = {
    blockers: [
      "TCOS_STANDARD_ENVELOPE_PROVIDER or LETTERTRACK_ACCOUNT_CONFIGURED",
      "TCOS_SHIPPING_COVERAGE_PROVIDER",
    ],
    shipping_adapter_profile: {
      provider: "Manual provider setup",
      carrier: "USPS",
      purchaseMode: "dry_run",
      missingCoverageCredentialKeys: ["COVERAGE_API_KEY"],
    },
    standard_envelope_evidence_contract_ready: false,
    standard_envelope_evidence_provider: "LetterTrack / USPS IMb",
    attempted_by_identity: {
      risk: "unchecked",
      blocked: true,
      blockReason: "missing verified forwarded IP",
    },
  };
  const setupAudit = buildShippingPurchaseAttemptAudit(setupBlockedPayload);
  scenarios.push(
    scenario(
      "provider_setup_blocker_evidence_blocked",
      "Missing provider setup blockers show blocked Standard Envelope evidence validator state, coverage credential gaps, and identity risk.",
      setupAudit.standardEnvelopeEvidenceContractReady === false &&
        setupAudit.evidenceSummary ===
          "Standard Envelope evidence validator: blocked (LetterTrack / USPS IMb)." &&
        setupAudit.details.some((detail) =>
          detail.includes("TCOS_SHIPPING_COVERAGE_PROVIDER"),
        ) &&
        setupAudit.details.some((detail) => detail.includes("COVERAGE_API_KEY")) &&
        setupAudit.details.some((detail) =>
          detail.includes("missing verified forwarded IP"),
        ),
      {
        evidenceSummary: setupAudit.evidenceSummary,
        details: setupAudit.details,
        sentence: setupAudit.sentence,
      },
    ),
  );

  const dryRunPurchasePayload = {
    status: "dry_run_purchased",
    attempted_at: "2026-07-14T12:34:56.000Z",
    provider_readiness: {
      missingCredentialKeys: ["EASYPOST_API_KEY"],
      missingCoverageCredentialKeys: ["COVERAGE_API_KEY"],
    },
    purchase_result: {
      mode: "dry_run",
    },
  };
  const dryRunSentence = shippingPurchaseAttemptAuditSentence(
    dryRunPurchasePayload,
  );
  scenarios.push(
    scenario(
      "dry_run_purchase_attempt_audit_sentence",
      "Dry-run purchase-attempt audit sentences include status, missing provider readiness, purchase mode, and timestamp.",
      dryRunSentence.includes("Status: dry_run_purchased.") &&
        dryRunSentence.includes(
          "Provider readiness missing: EASYPOST_API_KEY, COVERAGE_API_KEY.",
        ) &&
        dryRunSentence.includes("Purchase mode: dry_run.") &&
        dryRunSentence.includes("Attempted at: 2026-07-14T12:34:56.000Z."),
      {
        sentence: dryRunSentence,
      },
    ),
  );

  const emptyLines = shippingPurchaseAttemptAuditLines(null);
  scenarios.push(
    scenario(
      "empty_purchase_attempt_audit_lines",
      "Empty purchase-attempt packet lines explicitly say no latest provider purchase attempt is saved.",
      emptyLines.length === 1 &&
        emptyLines[0] === "No latest provider purchase attempt is saved.",
      {
        lines: emptyLines,
      },
    ),
  );

  const packetLines = shippingPurchaseAttemptAuditLines(liveGateBlockedPayload);
  scenarios.push(
    scenario(
      "packet_purchase_attempt_audit_lines",
      "Packet purchase-attempt audit lines include the Standard Envelope evidence summary, live gate reason, and provider profile.",
      packetLines[0] ===
        "Standard Envelope evidence validator: ready (LetterTrack / USPS IMb)." &&
        packetLines.some((line) => line.includes("Live gate:")) &&
        packetLines.some((line) => line.includes("Provider profile:")),
      {
        lines: packetLines,
      },
    ),
  );

  const expectedScenarioKeys = [
    ...SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_KEYS,
  ];
  const actualScenarioKeys = scenarios.map((item) => item.scenario_key);
  const missingScenarioKeys = expectedScenarioKeys.filter(
    (key) => !actualScenarioKeys.includes(key),
  );
  const unexpectedScenarioKeys = actualScenarioKeys.filter(
    (key) => !expectedScenarioKeys.includes(key as any),
  );
  const failedScenarios = scenarios.filter(
    (item) => item.scenario_status !== "passed",
  );
  const scenarioCoverageStatus =
    scenarios.length === SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_COUNT
      ? "passed"
      : "failed";
  const scenarioKeyCoverageStatus =
    missingScenarioKeys.length === 0 && unexpectedScenarioKeys.length === 0
      ? "passed"
      : "failed";
  const runStatus =
    failedScenarios.length === 0 &&
    scenarioCoverageStatus === "passed" &&
    scenarioKeyCoverageStatus === "passed"
      ? "passed"
      : "failed";

  return {
    suite_version: SHIPPING_PURCHASE_ATTEMPT_AUDIT_SUITE_VERSION,
    run_status: runStatus,
    scenario_count: scenarios.length,
    expected_scenario_count:
      SHIPPING_PURCHASE_ATTEMPT_AUDIT_EXPECTED_SCENARIO_COUNT,
    scenario_coverage_status: scenarioCoverageStatus,
    scenario_key_coverage_status: scenarioKeyCoverageStatus,
    expected_scenario_keys: expectedScenarioKeys,
    missing_scenario_keys: missingScenarioKeys,
    unexpected_scenario_keys: unexpectedScenarioKeys,
    passed_count: scenarios.length - failedScenarios.length,
    failed_count: failedScenarios.length,
    scenarios,
  };
}
