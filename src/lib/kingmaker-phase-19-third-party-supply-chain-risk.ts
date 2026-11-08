export type SupplyChainVerdict = "trusted" | "review" | "quarantine" | "blocked";

export type SupplierEvidence = {
  supplierId: string;
  artifactId: string;
  digest: string;
  signed: boolean;
  provenanceVerified: boolean;
  sbomPresent: boolean;
  accessScoped: boolean;
  incidentOpen: boolean;
  lastReviewedAt: string;
};

export type SupplyChainControls = {
  now: string;
  maxReviewAgeDays: number;
  ownerApproved: boolean;
  releaseCertified: boolean;
  killSwitchReady: boolean;
};

export type SupplyChainDecision = {
  verdict: SupplyChainVerdict;
  reasons: string[];
  commands: string[];
  fingerprint: string;
};

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluateSupplyChain(
  evidence: SupplierEvidence[],
  controls: SupplyChainControls,
): SupplyChainDecision {
  const reasons = new Set<string>();
  const commands = new Set<string>();
  const nowMs = Date.parse(controls.now);

  if (!Number.isFinite(nowMs) || !Number.isFinite(controls.maxReviewAgeDays) || controls.maxReviewAgeDays < 0) {
    reasons.add("invalid_controls");
  }

  const supplierIds = new Set<string>();
  const artifactIds = new Set<string>();
  const digests = new Set<string>();

  for (const item of evidence) {
    if (!item.supplierId.trim() || !item.artifactId.trim() || !/^[a-f0-9]{64}$/i.test(item.digest)) reasons.add("invalid_evidence_identity");
    if (supplierIds.has(item.supplierId)) reasons.add("duplicate_supplier");
    if (artifactIds.has(item.artifactId)) reasons.add("duplicate_artifact");
    if (digests.has(item.digest)) reasons.add("duplicate_digest");
    supplierIds.add(item.supplierId);
    artifactIds.add(item.artifactId);
    digests.add(item.digest);

    if (!item.signed) reasons.add("unsigned_artifact");
    if (!item.provenanceVerified) reasons.add("unverified_provenance");
    if (!item.sbomPresent) reasons.add("missing_sbom");
    if (!item.accessScoped) reasons.add("supplier_access_not_scoped");
    if (item.incidentOpen) reasons.add("supplier_incident_open");

    const reviewedMs = Date.parse(item.lastReviewedAt);
    if (!Number.isFinite(reviewedMs) || reviewedMs > nowMs || (nowMs - reviewedMs) / 86400000 > controls.maxReviewAgeDays) {
      reasons.add("stale_or_invalid_review");
    }
  }

  if (evidence.length === 0) reasons.add("missing_supplier_evidence");
  if (!controls.ownerApproved) reasons.add("owner_approval_missing");
  if (!controls.releaseCertified) reasons.add("release_not_certified");
  if (!controls.killSwitchReady) reasons.add("kill_switch_not_ready");

  const blocking = [
    "invalid_controls",
    "invalid_evidence_identity",
    "duplicate_supplier",
    "duplicate_artifact",
    "duplicate_digest",
    "unsigned_artifact",
    "unverified_provenance",
    "supplier_incident_open",
    "owner_approval_missing",
    "release_not_certified",
    "kill_switch_not_ready",
    "missing_supplier_evidence",
  ];
  const quarantine = ["missing_sbom", "supplier_access_not_scoped", "stale_or_invalid_review"];

  let verdict: SupplyChainVerdict = "trusted";
  if (blocking.some((reason) => reasons.has(reason))) verdict = "blocked";
  else if (quarantine.some((reason) => reasons.has(reason))) verdict = "quarantine";
  else if (reasons.size > 0) verdict = "review";

  if (verdict !== "trusted") {
    commands.add("freeze_supplier_ingestion");
    commands.add("disable_supplier_credentials");
    commands.add("require_owner_review");
  }
  if (reasons.has("supplier_incident_open") || reasons.has("unverified_provenance")) {
    commands.add("quarantine_supplier_artifacts");
  }

  const canonical = JSON.stringify({
    controls: {
      killSwitchReady: controls.killSwitchReady,
      maxReviewAgeDays: controls.maxReviewAgeDays,
      now: controls.now,
      ownerApproved: controls.ownerApproved,
      releaseCertified: controls.releaseCertified,
    },
    evidence: [...evidence].sort((a, b) => a.supplierId.localeCompare(b.supplierId)),
    reasons: [...reasons].sort(),
    commands: [...commands].sort(),
    verdict,
  });

  return { verdict, reasons: [...reasons].sort(), commands: [...commands].sort(), fingerprint: stableHash(canonical) };
}
