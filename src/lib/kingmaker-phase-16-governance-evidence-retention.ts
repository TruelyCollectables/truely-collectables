export type GovernanceVerdict = "compliant" | "review" | "quarantine" | "blocked";

export interface EvidenceRecord {
  id: string;
  category: string;
  digest: string;
  sourceVerified: boolean;
  immutable: boolean;
  retainedUntilEpochMs: number;
  createdAtEpochMs: number;
}

export interface GovernanceControls {
  ownerApprovalVerified: boolean;
  releaseCertified: boolean;
  auditTrailComplete: boolean;
  legalHoldActive: boolean;
  deletionAuthorized: boolean;
  capitalLedgerBalanced: boolean;
  idempotencyHealthy: boolean;
}

export interface GovernanceCommand {
  verdict: GovernanceVerdict;
  quarantineWrites: boolean;
  blockDeletion: boolean;
  requireOwnerReview: boolean;
  reasons: string[];
  fingerprint: string;
}

function fingerprint(parts: string[]): string {
  let hash = 2166136261;
  for (const char of parts.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `km16-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function evaluateGovernance(input: {
  evidence: EvidenceRecord[];
  requiredCategories: string[];
  nowEpochMs: number;
  minimumRetentionMs: number;
  controls: GovernanceControls;
}): GovernanceCommand {
  const reasons: string[] = [];
  const seenIds = new Set<string>();
  const seenCategories = new Set<string>();

  if (!Number.isFinite(input.nowEpochMs) || !Number.isFinite(input.minimumRetentionMs) || input.minimumRetentionMs < 0) {
    reasons.push("invalid-governance-window");
  }

  for (const record of input.evidence) {
    if (!record.id || seenIds.has(record.id)) reasons.push(`duplicate-or-missing-id:${record.id || "empty"}`);
    seenIds.add(record.id);
    if (!record.category) reasons.push(`missing-category:${record.id}`);
    else seenCategories.add(record.category);
    if (!/^[a-f0-9]{64}$/i.test(record.digest)) reasons.push(`malformed-digest:${record.id}`);
    if (!record.sourceVerified) reasons.push(`unverified-source:${record.id}`);
    if (!record.immutable) reasons.push(`mutable-evidence:${record.id}`);
    if (!Number.isFinite(record.createdAtEpochMs) || !Number.isFinite(record.retainedUntilEpochMs)) {
      reasons.push(`invalid-timestamp:${record.id}`);
    } else if (record.retainedUntilEpochMs - record.createdAtEpochMs < input.minimumRetentionMs) {
      reasons.push(`retention-too-short:${record.id}`);
    }
    if (input.controls.legalHoldActive && record.retainedUntilEpochMs < input.nowEpochMs) {
      reasons.push(`legal-hold-expired:${record.id}`);
    }
  }

  for (const category of [...new Set(input.requiredCategories)].sort()) {
    if (!seenCategories.has(category)) reasons.push(`missing-required-category:${category}`);
  }

  if (!input.controls.ownerApprovalVerified) reasons.push("owner-approval-unverified");
  if (!input.controls.releaseCertified) reasons.push("release-not-certified");
  if (!input.controls.auditTrailComplete) reasons.push("audit-trail-incomplete");
  if (!input.controls.capitalLedgerBalanced) reasons.push("capital-ledger-unbalanced");
  if (!input.controls.idempotencyHealthy) reasons.push("idempotency-unhealthy");
  if (input.controls.legalHoldActive && input.controls.deletionAuthorized) reasons.push("deletion-authorized-during-legal-hold");

  const sorted = [...new Set(reasons)].sort();
  const blocked = sorted.some((reason) =>
    reason.startsWith("legal-hold-expired") ||
    reason === "deletion-authorized-during-legal-hold" ||
    reason === "capital-ledger-unbalanced" ||
    reason === "idempotency-unhealthy" ||
    reason === "owner-approval-unverified"
  );
  const quarantine = !blocked && sorted.some((reason) =>
    reason.startsWith("missing-required-category") ||
    reason.startsWith("mutable-evidence") ||
    reason.startsWith("unverified-source") ||
    reason === "audit-trail-incomplete" ||
    reason === "release-not-certified"
  );
  const review = !blocked && !quarantine && sorted.length > 0;
  const verdict: GovernanceVerdict = blocked ? "blocked" : quarantine ? "quarantine" : review ? "review" : "compliant";
  const command = {
    verdict,
    quarantineWrites: verdict === "quarantine" || verdict === "blocked",
    blockDeletion: input.controls.legalHoldActive || verdict !== "compliant" || !input.controls.deletionAuthorized,
    requireOwnerReview: verdict !== "compliant",
    reasons: sorted,
  };
  return { ...command, fingerprint: fingerprint([command.verdict, String(command.quarantineWrites), String(command.blockDeletion), ...sorted]) };
}
