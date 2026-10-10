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
  return exactTrustedIdentity ? "listings" : "verification";
}
