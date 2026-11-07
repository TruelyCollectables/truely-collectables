function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function hasVerifiedCsvAuthority(value: unknown) {
  const metadata = record(value), verified = record(metadata.verifiedCsv), images = record(verified.images), front = record(images.front), back = record(images.back), ic = record(metadata.instacomp);
  return verified.authority === "seller_verified_csv_v1" && verified.schemaVersion === 1 && typeof verified.contentSha256 === "string" && verified.contentSha256.length === 64 && ic.manualIdentityLocked === true && ic.humanVerified === true && ic.identityComplete === true && ic.trustedForIdentity === true && typeof front.sha256 === "string" && front.sha256.length === 64 && front.sha256 !== back.sha256 && front.sha256 === ic.frontSha256 && back.sha256 === ic.backSha256;
}
