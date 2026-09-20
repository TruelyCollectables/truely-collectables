export type InstaCompPendingQueue = "listings" | "verification";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function instaCompPendingQueueFromMetadata(
  metadataValue: unknown,
): InstaCompPendingQueue {
  const metadata = record(metadataValue);
  const instacomp = record(metadata.instacomp);
  const imageOrientation = record(instacomp.imageOrientation);
  const checklistDecision = record(instacomp.checklistDecision);
  const checklistIdentity = record(instacomp.checklistIdentity);
  const macReceipt = record(instacomp.macReceipt);

  const frontImageUrl = text(instacomp.frontImageUrl);
  const backImageUrl = text(instacomp.backImageUrl);
  const hasDistinctPair = Boolean(
    frontImageUrl && backImageUrl && frontImageUrl !== backImageUrl,
  );

  const orientationVerified =
    text(imageOrientation.status) === "completed" &&
    instacomp.imageOrientationPersisted === true &&
    (instacomp.imagePersistenceVerified === true || hasDistinctPair);

  const manualIdentityLocked =
    instacomp.manualIdentityLocked === true &&
    instacomp.identityComplete === true;

  const registryIdentityId =
    text(instacomp.registryIdentityId) ||
    text(checklistIdentity.registryIdentityId);
  const registryFingerprintSha256 =
    text(instacomp.registryFingerprintSha256) ||
    text(checklistIdentity.registryFingerprintSha256);

  const exactRegistryIdentity =
    instacomp.identityComplete === true &&
    instacomp.trustedForIdentity === true &&
    checklistDecision.status === "exact_match" &&
    checklistIdentity.source === "checklist_registry" &&
    checklistIdentity.status === "identified" &&
    macReceipt.checklistOutcome === "exact_match" &&
    Boolean(registryIdentityId) &&
    Boolean(registryFingerprintSha256);

  // Orientation proves which pixels are front/back. It does NOT prove card identity.
  // Only a seller manual lock or the exact Mac Registry UUID+fingerprint receipt may
  // move a card out of Pending Verification.
  if (!orientationVerified) return "verification";
  if (manualIdentityLocked) return "listings";
  if (!exactRegistryIdentity) return "verification";
  return "listings";
}
