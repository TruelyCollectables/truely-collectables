export const MARKET_INTEL_IDENTITY_PROOF_STATUSES = [
  "review_required",
  "probable_exact",
  "verified_exact",
  "conflict_detected",
  "rejected",
] as const;

export type MarketIntelIdentityProofStatus =
  (typeof MARKET_INTEL_IDENTITY_PROOF_STATUSES)[number];

export type MarketIntelIdentityProofEvidence = {
  frontImageConfirmed: boolean;
  backImageConfirmed: boolean;
  slabLabelConfirmed: boolean;
  checklistConfirmed: boolean;
  cardNumberConfirmed: boolean;
  parallelConfirmed: boolean;
  serialNumberConfirmed: boolean;
  autographRelicConfirmed: boolean;
  noConflictingEvidence: boolean;
};

type JsonRecord = Record<string, unknown>;

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "on" || value === 1;
}

export function marketIntelIdentityProofStatus(
  metadata: JsonRecord | null | undefined,
): MarketIntelIdentityProofStatus {
  const raw = String(metadata?.identity_proof_status || "review_required");
  return MARKET_INTEL_IDENTITY_PROOF_STATUSES.includes(
    raw as MarketIntelIdentityProofStatus,
  )
    ? (raw as MarketIntelIdentityProofStatus)
    : "review_required";
}

export function marketIntelIdentityProofEvidence(
  metadata: JsonRecord | null | undefined,
): MarketIntelIdentityProofEvidence {
  const evidence = recordValue(metadata?.identity_proof_evidence);
  return {
    frontImageConfirmed: booleanValue(evidence.front_image_confirmed),
    backImageConfirmed: booleanValue(evidence.back_image_confirmed),
    slabLabelConfirmed: booleanValue(evidence.slab_label_confirmed),
    checklistConfirmed: booleanValue(evidence.checklist_confirmed),
    cardNumberConfirmed: booleanValue(evidence.card_number_confirmed),
    parallelConfirmed: booleanValue(evidence.parallel_confirmed),
    serialNumberConfirmed: booleanValue(evidence.serial_number_confirmed),
    autographRelicConfirmed: booleanValue(evidence.autograph_relic_confirmed),
    noConflictingEvidence: booleanValue(evidence.no_conflicting_evidence),
  };
}

export function canVerifyMarketIntelExactIdentity(
  evidence: MarketIntelIdentityProofEvidence,
) {
  return Boolean(
    evidence.frontImageConfirmed &&
      evidence.checklistConfirmed &&
      (evidence.backImageConfirmed || evidence.slabLabelConfirmed) &&
      evidence.cardNumberConfirmed &&
      evidence.parallelConfirmed &&
      evidence.noConflictingEvidence,
  );
}

export function marketIntelIdentityProofMissingEvidence(
  evidence: MarketIntelIdentityProofEvidence,
) {
  return [
    !evidence.frontImageConfirmed ? "front image" : null,
    !evidence.backImageConfirmed && !evidence.slabLabelConfirmed
      ? "back image or slab label"
      : null,
    !evidence.checklistConfirmed ? "checklist/catalog match" : null,
    !evidence.cardNumberConfirmed ? "card number" : null,
    !evidence.parallelConfirmed ? "parallel/variation" : null,
    !evidence.noConflictingEvidence ? "no conflicting evidence" : null,
  ].filter((value): value is string => Boolean(value));
}

export function isMarketIntelIdentityProofVerified(
  metadata: JsonRecord | null | undefined,
) {
  const status = marketIntelIdentityProofStatus(metadata);
  const operatorConfirmed = booleanValue(metadata?.identity_proof_operator_confirmed);
  const evidence = marketIntelIdentityProofEvidence(metadata);
  return (
    status === "verified_exact" &&
    operatorConfirmed &&
    canVerifyMarketIntelExactIdentity(evidence)
  );
}

export function assertMarketIntelIdentityProofVerified(
  metadata: JsonRecord | null | undefined,
) {
  if (isMarketIntelIdentityProofVerified(metadata)) return;
  const status = marketIntelIdentityProofStatus(metadata);
  const missing = marketIntelIdentityProofMissingEvidence(
    marketIntelIdentityProofEvidence(metadata),
  );
  throw new Error(
    `Identity Proof Gate blocked this purchase. Status: ${status.replaceAll("_", " ")}${
      missing.length ? `; still needs ${missing.join(", ")}` : ""
    }.`,
  );
}

export function buildMarketIntelIdentityProofMetadata(input: {
  existingMetadata?: JsonRecord | null;
  status: MarketIntelIdentityProofStatus;
  evidence: MarketIntelIdentityProofEvidence;
  notes?: string | null;
  reviewer?: string | null;
  reviewedAt?: string | null;
}) {
  const reviewedAt = input.reviewedAt || new Date().toISOString();
  const verified =
    input.status === "verified_exact" &&
    canVerifyMarketIntelExactIdentity(input.evidence);
  return {
    ...(input.existingMetadata || {}),
    identity_proof_version: "tcos.identityProofGate.v1",
    identity_proof_status: verified ? "verified_exact" : input.status,
    identity_proof_operator_confirmed: verified,
    identity_proof_reviewer: input.reviewer || "private_owner",
    identity_proof_reviewed_at: reviewedAt,
    identity_proof_notes: String(input.notes || "").trim() || null,
    identity_proof_evidence: {
      front_image_confirmed: input.evidence.frontImageConfirmed,
      back_image_confirmed: input.evidence.backImageConfirmed,
      slab_label_confirmed: input.evidence.slabLabelConfirmed,
      checklist_confirmed: input.evidence.checklistConfirmed,
      card_number_confirmed: input.evidence.cardNumberConfirmed,
      parallel_confirmed: input.evidence.parallelConfirmed,
      serial_number_confirmed: input.evidence.serialNumberConfirmed,
      autograph_relic_confirmed: input.evidence.autographRelicConfirmed,
      no_conflicting_evidence: input.evidence.noConflictingEvidence,
    },
  } satisfies JsonRecord;
}

export function marketIntelIdentityProofLabel(
  status: MarketIntelIdentityProofStatus,
) {
  if (status === "verified_exact") return "VERIFIED EXACT";
  if (status === "probable_exact") return "PROBABLE EXACT";
  if (status === "conflict_detected") return "CONFLICT DETECTED";
  if (status === "rejected") return "REJECTED";
  return "REVIEW REQUIRED";
}
