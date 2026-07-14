import {
  buildShippingPurchaseAttemptAudit,
  shippingPurchaseAttemptAuditLines,
  shippingPurchaseAttemptAuditSentence,
} from "../src/lib/shipping-purchase-attempt-audit";

let failed = 0;
let total = 0;

function check(name: string, condition: boolean, detail = "") {
  total += 1;
  if (!condition) failed += 1;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

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

const liveGateAudit = buildShippingPurchaseAttemptAudit(liveGateBlockedPayload);
check(
  "live gate blocker audit keeps Standard Envelope evidence readiness",
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
  liveGateAudit.sentence,
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
check(
  "provider setup blocker audit flags blocked evidence validator and identity risk",
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
  setupAudit.sentence,
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

const dryRunSentence = shippingPurchaseAttemptAuditSentence(dryRunPurchasePayload);
check(
  "dry-run purchase audit sentence includes provider readiness and purchase mode",
  dryRunSentence.includes("Status: dry_run_purchased.") &&
    dryRunSentence.includes("Provider readiness missing: EASYPOST_API_KEY, COVERAGE_API_KEY.") &&
    dryRunSentence.includes("Purchase mode: dry_run.") &&
    dryRunSentence.includes("Attempted at: 2026-07-14T12:34:56.000Z."),
  dryRunSentence,
);

const emptyLines = shippingPurchaseAttemptAuditLines(null);
check(
  "empty purchase attempt audit lines are explicit for packets",
  emptyLines.length === 1 &&
    emptyLines[0] === "No latest provider purchase attempt is saved.",
  emptyLines.join(" | "),
);

const packetLines = shippingPurchaseAttemptAuditLines(liveGateBlockedPayload);
check(
  "packet purchase attempt audit lines include summary and details",
  packetLines[0] ===
    "Standard Envelope evidence validator: ready (LetterTrack / USPS IMb)." &&
    packetLines.some((line) => line.includes("Live gate:")) &&
    packetLines.some((line) => line.includes("Provider profile:")),
  packetLines.join(" | "),
);

console.log(
  `Shipping purchase audit simulations: ${total - failed}/${total} passed.`,
);

if (failed > 0) process.exitCode = 1;
