import {
  buildLetterTrackSellerProtectionEvidenceReview,
  buildLetterTrackDeliveryEvidenceSummary,
  evaluateLetterTrackSellerProtectionPaymentGate,
  shouldRecordLetterTrackSellerProtectionEvidenceReview,
} from "../src/lib/lettertrack-delivery-evidence.ts";

let failed = 0;
let total = 0;

function check(name, condition, detail = "") {
  total += 1;
  if (!condition) failed += 1;
  console.log(`${condition ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
}

function letterTrackEvent(status, occurredAt, overrides = {}) {
  return {
    provider: "LetterTrack / USPS IMb",
    carrier: "USPS IMb",
    tracking_number: "IMB123456789",
    event_type: `lettertrack_${status}`,
    event_status: status,
    message: `Fixture LetterTrack status ${status}`,
    occurred_at: occurredAt,
    ...overrides,
  };
}

const deliveredEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("accepted", "2026-07-12T12:00:00.000Z"),
  letterTrackEvent("delivered", "2026-07-13T12:00:00.000Z"),
]);
const deliveredGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: deliveredEvidence,
});
check(
  "delivered evidence blocks seller-protection payout without override",
  deliveredEvidence.deliveredEvidencePresent &&
    !deliveredEvidence.claimReviewSupported &&
    !deliveredGate.allowed,
  deliveredGate.reason,
);

const notDeliveredEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("accepted", "2026-07-12T12:00:00.000Z"),
  letterTrackEvent("not_delivered", "2026-07-13T12:00:00.000Z"),
]);
const notDeliveredGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: notDeliveredEvidence,
});
check(
  "not-delivered evidence supports seller-protection payout review",
  !notDeliveredEvidence.deliveredEvidencePresent &&
    notDeliveredEvidence.claimReviewSupported &&
    notDeliveredGate.allowed,
  notDeliveredGate.reason,
);

const exceptionEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("delivery_exception", "2026-07-13T12:00:00.000Z"),
]);
const exceptionGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: exceptionEvidence,
});
check(
  "delivery exception evidence supports claim review",
  exceptionEvidence.claimReviewSupported && exceptionGate.allowed,
  exceptionGate.reason,
);

const returnedEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("returned", "2026-07-13T12:00:00.000Z"),
]);
const returnedGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: returnedEvidence,
});
check(
  "returned evidence supports claim review",
  returnedEvidence.claimReviewSupported && returnedGate.allowed,
  returnedGate.reason,
);

const missingOutcomeEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("in_transit", "2026-07-13T12:00:00.000Z"),
]);
const missingOutcomeGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: missingOutcomeEvidence,
});
check(
  "in-transit-only evidence blocks payout without override",
  missingOutcomeEvidence.eventCount === 1 &&
    !missingOutcomeEvidence.deliveredEvidencePresent &&
    !missingOutcomeEvidence.claimReviewSupported &&
    !missingOutcomeGate.allowed,
  missingOutcomeGate.reason,
);

const overrideGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: deliveredEvidence,
  overrideNote:
    "Override: buyer refund required after operator reviewed conflicting LetterTrack evidence.",
});
check(
  "explicit override note can allow exceptional payout",
  overrideGate.allowed && overrideGate.overrideAccepted,
  overrideGate.reason,
);

const weakOverrideGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: deliveredEvidence,
  overrideNote: "ok",
});
check(
  "weak override note does not bypass delivered evidence",
  !weakOverrideGate.allowed && !weakOverrideGate.overrideAccepted,
  weakOverrideGate.reason,
);

const mixedEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("not_delivered", "2026-07-13T12:00:00.000Z"),
  letterTrackEvent("delivered", "2026-07-14T12:00:00.000Z"),
]);
const mixedGate = evaluateLetterTrackSellerProtectionPaymentGate({
  evidence: mixedEvidence,
});
check(
  "delivered evidence wins over earlier not-delivered evidence",
  mixedEvidence.deliveredEvidencePresent &&
    !mixedEvidence.claimReviewSupported &&
    !mixedGate.allowed &&
    mixedEvidence.latestStatus === "delivered",
  mixedGate.reason,
);

const ignoredEvidence = buildLetterTrackDeliveryEvidenceSummary([
  letterTrackEvent("delivered", "2026-07-13T12:00:00.000Z", {
    provider: "Other Provider",
    carrier: "Other Carrier",
    event_type: "carrier_delivered",
  }),
]);
check(
  "non-LetterTrack events are ignored by the LetterTrack summary",
  ignoredEvidence.eventCount === 0 &&
    !ignoredEvidence.deliveredEvidencePresent &&
    !ignoredEvidence.claimReviewSupported,
  ignoredEvidence.claimReviewReason,
);

const reviewableStatuses = [
  "submitted",
  "under_review",
  "approved",
  "paid",
  "denied",
];
check(
  "seller-protection evidence reviews are recorded on claim review statuses only",
  reviewableStatuses.every((status) =>
    shouldRecordLetterTrackSellerProtectionEvidenceReview({
      status,
      eligible: true,
    }),
  ) &&
    !shouldRecordLetterTrackSellerProtectionEvidenceReview({
      status: "draft",
      eligible: true,
    }) &&
    !shouldRecordLetterTrackSellerProtectionEvidenceReview({
      status: "cancelled",
      eligible: true,
    }) &&
    !shouldRecordLetterTrackSellerProtectionEvidenceReview({
      status: "paid",
      eligible: false,
    }),
  "submitted, under_review, approved, paid, and denied create audit reviews for eligible under-$20 claims.",
);

const savedReview = buildLetterTrackSellerProtectionEvidenceReview({
  status: "approved",
  reviewedAt: "2026-07-13T18:00:00.000Z",
  reviewedByIdentity: { type: "admin", id: "sim" },
  note: "Ready for final payout review.",
  summary: notDeliveredEvidence,
  gate: notDeliveredGate,
});
check(
  "seller-protection evidence review stores status, note, evidence, and gate",
  savedReview.status === "approved" &&
    savedReview.note === "Ready for final payout review." &&
    savedReview.summary.claimReviewSupported &&
    savedReview.gate.allowed,
  savedReview.gate.reason,
);

console.log(`LetterTrack evidence simulations: ${total - failed}/${total} passed.`);

if (failed > 0) process.exitCode = 1;
