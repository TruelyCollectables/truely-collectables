import {
  finalPublicationBlockers, normalizeDirectIdentity,
} from "./obbfb-intake-rules";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
export function isOBBFBMetadata(metadataValue: unknown) {
  return record(record(metadataValue).instacomp).intakeEngine === "obbfb_direct_vision_v1";
}
export function obbfbPublicationBlockers(params: {
  metadata: unknown;
  title: string;
  description: string;
  price: number;
  front: string | null;
  back: string | null;
}): string[] {
  if (!isOBBFBMetadata(params.metadata)) return [];
  const metadata = record(params.metadata);
  const ic = record(metadata.instacomp);
  const seller = record(metadata.seller_review);
  const workflow = record(metadata.listingWorkflow);
  const issues: string[] = [];
  if (ic.manualIdentityLocked !== true ||
      ic.sellerPriceOverride !== true ||
      ic.humanVerified !== true ||
      ic.manualListingTitleLocked !== true ||
      seller.identity_confirmed !== true) {
    issues.push("seller_physical_identity_and_price_lock_required");
  }
  if (workflow.queue === "need_to_merge" || record(metadata.merge).status === "NEED_TO_MERGE") {
    issues.push("need_to_merge_must_be_resolved");
  }
  if (!Number.isFinite(params.price) || params.price < 2) issues.push("seller_price_at_least_2_usd");
  if (ic.manualListingTitle && String(ic.manualListingTitle).trim() !== params.title.trim()) {
    issues.push("operator_title_lock_mismatch");
  }
  if (ic.listingPrice && Math.abs(Number(ic.listingPrice) - params.price) >= 0.001) {
    issues.push("operator_price_lock_mismatch");
  }
  const identity = normalizeDirectIdentity(record(ic.manualIdentity));
  issues.push(...finalPublicationBlockers(
    { ...identity, confidence: 1 },
    params.title, params.description, params.front, params.back,
  ));
  if (identity.serialNumber) {
    const run = "/" + Number(identity.serialNumber.split("/")[1]);
    if (!params.title.includes(run)) issues.push("print_run_missing_from_title");
  }
  if (/\b(?:Base Set|Base)\b/i.test(params.title)) issues.push("base_forbidden_in_title");
  return Array.from(new Set(issues));
}
