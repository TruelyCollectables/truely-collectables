import { checklistRegistryReceiptBlockers } from "./instacomp-registry-receipt";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function hasMacExactRegistryLock(instaComp: UnknownRecord) {
  const checklist = record(instaComp.checklistIdentity);
  const status = String(checklist.status || "").trim().toLowerCase();
  const identityId = text(checklist.registryIdentityId) || text(checklist.identityId);
  const fingerprint =
    text(checklist.registryFingerprintSha256) || text(checklist.fingerprintSha256);

  return Boolean(
    instaComp.identityComplete === true &&
      instaComp.trustedForIdentity === true &&
      (status === "exact_match" || status === "identified") &&
      identityId &&
      fingerprint,
  );
}

export function isInstaCompPublicationIdentityConfirmed(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const review = record(metadata.seller_review);

  if (
    instaComp.manualIdentityLocked === true ||
    instaComp.humanVerified === true ||
    review.identity_confirmed === true
  ) {
    return true;
  }

  if (checklistRegistryReceiptBlockers(metadataValue).length === 0) return true;

  return hasMacExactRegistryLock(instaComp);
}
