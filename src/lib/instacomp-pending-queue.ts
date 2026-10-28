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
  // Legacy KINGMAKER resale-review restores are explicitly staged for the
  // seller's Pending Listings review. Preserve that operator queue even when
  // the newer physical-orientation or identity gates are incomplete; those
  // gates remain visible on each card and still block publication.
  if (workflow.queue === "pending_listings" || workflow.label === "Resale Pending") {
    return "listings";
  }
  const instacomp = record(metadata.instacomp);
  // Manual deferral wins over AI classification and stays out of Verification.
  if (instacomp.manualHoldBucket === "missing_picture" &&
      instacomp.listingPublishBlocked === true &&
      metadata.listingReviewRequired === true) return "missing_picture";
  const imageOrientation = record(instacomp.imageOrientation);
  const frontImageUrl = text(instacomp.frontImageUrl);
  const backImageUrl = text(instacomp.backImageUrl);
  const hasDistinctMacPair = Boolean(
    frontImageUrl && backImageUrl && frontImageUrl !== backImageUrl,
  );
  const identityComplete =
    instacomp.identityComplete === true ||
    text(instacomp.lastStatus) === "identity_complete";
  const checklistIdentity = record(instacomp.checklistIdentity);
  const exactTrustedIdentity =
    identityComplete &&
    instacomp.trustedForIdentity === true &&
    text(checklistIdentity.status) === "exact_match" &&
    Boolean(text(checklistIdentity.identityId)) &&
    Boolean(text(checklistIdentity.fingerprintSha256)) &&
    hasDistinctMacPair;
  const orientationVerified =
    text(imageOrientation.status) === "completed" &&
    instacomp.imageOrientationPersisted === true &&
    (instacomp.imagePersistenceVerified === true || hasDistinctMacPair);

  // Identity and physical orientation are independent gates. A distinct
  // front/back pair does not establish that either image is upright.
  if (!orientationVerified) return "verification";
  if (hasVerifiedCsvAuthority(metadata) && hasDistinctMacPair) return "listings";
  return exactTrustedIdentity ? "listings" : "verification";
}
