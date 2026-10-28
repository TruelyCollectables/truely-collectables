import { hasVerifiedCsvAuthority } from "./kingmaker-verified-csv";
export type InstaCompPendingQueue = "listings" | "verification" | "missing_picture";

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
  const workflow = record(metadata.listingWorkflow);
  // Explicitly restored resale-review cards stay in the seller review queue.
  // Per-card identity/orientation blockers still prevent publication.
  if (workflow.queue === "pending_listings" || workflow.label === "Resale Pending") {
    return "listings";
  }
  const instacomp = record(metadata.instacomp);
  if (instacomp.manualHoldBucket === "missing_picture" &&
      instacomp.listingPublishBlocked === true &&
      metadata.listingReviewRequired === true) return "missing_picture";
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
    text(checklistIdentity.registryIdentityId) ||
    text(checklistIdentity.identityId);
  const registryFingerprintSha256 =
    text(instacomp.registryFingerprintSha256) ||
    text(checklistIdentity.registryFingerprintSha256) ||
    text(checklistIdentity.fingerprintSha256);

  const legacyRegistryReceipt =
    checklistIdentity.source === "checklist_registry" &&
    checklistIdentity.status === "identified" &&
    macReceipt.checklistOutcome === "exact_match";
  const macLocalRegistryReceipt =
    text(instacomp.identitySource) === "mac_checklist_registry_exact" &&
    checklistIdentity.status === "exact_match";

  const exactRegistryIdentity =
    instacomp.identityComplete === true &&
    instacomp.trustedForIdentity === true &&
    checklistDecision.status === "exact_match" &&
    (legacyRegistryReceipt || macLocalRegistryReceipt) &&
    Boolean(registryIdentityId) &&
    Boolean(registryFingerprintSha256);

  // Orientation proves which pixels are front/back. It does NOT prove card identity.
  // Only a seller manual lock or the exact Mac Registry UUID+fingerprint receipt may
  // move a card out of Pending Verification.
  if (!orientationVerified) return "verification";
  if (record(metadata.verifiedCsv).authority === "seller_verified_csv_v1") return hasVerifiedCsvAuthority(metadata) && hasDistinctPair ? "listings" : "verification";
  if (manualIdentityLocked) return "listings";
  if (!exactRegistryIdentity) return "verification";
  return "listings";
}
