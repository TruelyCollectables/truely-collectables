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

function hasStrictExactChecklistDecision(instaComp: UnknownRecord) {
  const checklistIdentity = record(instaComp.checklistIdentity);
  const checklistDecision = record(instaComp.checklistDecision);
  const lockedFields = record(checklistIdentity.lockedFields);
  const candidateIdentityIds = Array.isArray(checklistDecision.candidateIdentityIds)
    ? checklistDecision.candidateIdentityIds.map(text).filter(Boolean)
    : [];
  const requiredLockedFields = [
    text(lockedFields.year),
    text(lockedFields.manufacturer),
    text(lockedFields.cardNumber),
    text(lockedFields.player),
  ];

  return Boolean(
    instaComp.identityComplete === true &&
      instaComp.trustedForIdentity === true &&
      String(checklistIdentity.status || "").trim().toLowerCase() === "identified" &&
      String(checklistDecision.status || "").trim().toLowerCase() === "exact_match" &&
      Number(checklistDecision.candidateCount) === 1 &&
      candidateIdentityIds.length === 1 &&
      requiredLockedFields.every(Boolean),
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

  return hasMacExactRegistryLock(instaComp) || hasStrictExactChecklistDecision(instaComp);
}
