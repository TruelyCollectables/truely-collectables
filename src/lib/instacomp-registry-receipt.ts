export type ChecklistRegistryReceipt = {
  status: "identified" | "review_required";
  source: "checklist_registry";
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  checkedAt: string | null;
  reasons: string[];
  lockedFields: Record<string, unknown>;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readChecklistRegistryReceipt(metadataValue: unknown): ChecklistRegistryReceipt {
  const metadata = recordValue(metadataValue);
  const instaComp = recordValue(metadata.instacomp);
  const receipt = recordValue(instaComp.checklistIdentity);
  return {
    status: receipt.status === "identified" ? "identified" : "review_required",
    source: "checklist_registry",
    registryIdentityId: textValue(receipt.registryIdentityId),
    registryFingerprintSha256: textValue(receipt.registryFingerprintSha256),
    checkedAt: textValue(receipt.checkedAt),
    reasons: Array.isArray(receipt.reasons)
      ? receipt.reasons.map((reason) => String(reason)).filter(Boolean).slice(0, 50)
      : [],
    lockedFields: recordValue(receipt.lockedFields),
  };
}

export function checklistRegistryReceiptBlockers(metadataValue: unknown) {
  const receipt = readChecklistRegistryReceipt(metadataValue);
  const blockers: string[] = [];
  if (receipt.status !== "identified") blockers.push("checklist_identity_review_required");
  if (!receipt.registryIdentityId) blockers.push("missing_registry_identity_id");
  if (!receipt.registryFingerprintSha256) blockers.push("missing_registry_fingerprint");
  if (!receipt.checkedAt) blockers.push("missing_registry_checked_at");
  for (const field of ["year", "manufacturer", "cardNumber", "player"] as const) {
    if (!textValue(receipt.lockedFields[field])) blockers.push(`missing_locked_${field}`);
  }
  return Array.from(new Set(blockers));
}

export function assertChecklistRegistryReceipt(metadataValue: unknown) {
  const blockers = checklistRegistryReceiptBlockers(metadataValue);
  if (blockers.length) {
    const error = new Error(
      `Checklist Registry identity must be locked before publishing: ${blockers.join(", ")}.`,
    ) as Error & { code?: string; blockers?: string[] };
    error.code = "CHECKLIST_IDENTITY_REQUIRED";
    error.blockers = blockers;
    throw error;
  }
  return readChecklistRegistryReceipt(metadataValue);
}
