import { checklistRegistryReceiptBlockers } from "./instacomp-registry-receipt";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
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

  return checklistRegistryReceiptBlockers(metadataValue).length === 0;
}
