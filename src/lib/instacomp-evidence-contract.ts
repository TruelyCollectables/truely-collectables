export const INSTACOMP_EVIDENCE_SCHEMA_VERSION =
  "tcos.instacomp.evidence.v1" as const;

export type InstaCompEvidenceSourceCategory =
  | "central_registry"
  | "marketplace_sold"
  | "marketplace_active"
  | "official_manufacturer"
  | "grading_company"
  | "seller_record"
  | "operator_correction"
  | "local_model"
  | "approved_reference";

export type InstaCompEvidenceKind =
  | "registry_identity"
  | "visible_card_fact"
  | "sold_comp"
  | "active_listing"
  | "official_product_fact"
  | "grader_verification"
  | "seller_correction"
  | "candidate_match"
  | "candidate_rejection"
  | "market_observation";

export type InstaCompEvidenceDisposition =
  | "accepted"
  | "rejected"
  | "unresolved"
  | "expired";

export type InstaCompEvidenceReceiptV1 = {
  schemaVersion: typeof INSTACOMP_EVIDENCE_SCHEMA_VERSION;
  evidenceId: string;
  requestId: string;
  kind: InstaCompEvidenceKind;
  sourceName: string;
  sourceCategory: InstaCompEvidenceSourceCategory;
  sourceIdentifier: string;
  retrievedAt: string;
  observedAt: string | null;
  normalizedValue: unknown;
  rawValueHash: string | null;
  confidence: number;
  matchScore: number | null;
  registryIdentityId: string | null;
  registryFingerprint: string | null;
  disposition: InstaCompEvidenceDisposition;
  rejectionReason: string | null;
  freshnessExpiresAt: string | null;
};

export function assertInstaCompEvidenceReceipt(
  evidence: InstaCompEvidenceReceiptV1,
): InstaCompEvidenceReceiptV1 {
  if (evidence.schemaVersion !== INSTACOMP_EVIDENCE_SCHEMA_VERSION) {
    throw new Error("Unsupported InstaComp evidence schema version.");
  }
  if (!evidence.evidenceId.trim() || !evidence.requestId.trim()) {
    throw new Error("Evidence ID and request ID are required.");
  }
  if (!evidence.sourceName.trim() || !evidence.sourceIdentifier.trim()) {
    throw new Error("Every research fact requires source provenance.");
  }
  if (!evidence.retrievedAt.trim()) {
    throw new Error("Every research fact requires a retrieval timestamp.");
  }
  if (
    !Number.isFinite(evidence.confidence) ||
    evidence.confidence < 0 ||
    evidence.confidence > 1
  ) {
    throw new Error("Evidence confidence must be between zero and one.");
  }
  if (
    evidence.matchScore !== null &&
    (!Number.isFinite(evidence.matchScore) ||
      evidence.matchScore < 0 ||
      evidence.matchScore > 1)
  ) {
    throw new Error("Evidence match score must be between zero and one.");
  }
  if (evidence.disposition === "rejected" && !evidence.rejectionReason?.trim()) {
    throw new Error("Rejected evidence requires a rejection reason.");
  }
  return evidence;
}

export function evidenceHasCanonicalRegistryReceipt(
  evidence: InstaCompEvidenceReceiptV1,
) {
  return Boolean(
    evidence.registryIdentityId?.trim() && evidence.registryFingerprint?.trim(),
  );
}
