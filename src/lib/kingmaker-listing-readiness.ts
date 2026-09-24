import {
  checklistRegistryReceiptBlockers,
  readChecklistRegistryReceipt,
} from "./instacomp-registry-receipt";

type UnknownRecord = Record<string, unknown>;

export type KingmakerListingReadinessBlocker =
  | "identity_not_exact"
  | "price_guide_not_checked_1_year"
  | "missing_front_image"
  | "missing_back_image"
  | "duplicate_front_back_image"
  | "missing_condition"
  | "missing_quantity"
  | "missing_acquisition_source"
  | "duplicate_decision_required"
  | "missing_website_price"
  | "missing_ebay_price"
  | "missing_mercari_price"
  | "missing_ebay_card_condition";

export type KingmakerListingReadinessCheck = {
  code: KingmakerListingReadinessBlocker;
  label: string;
  ready: boolean;
};

export type KingmakerListingReadiness = {
  ready: boolean;
  coreReady: boolean;
  websiteReady: boolean;
  ebayReady: boolean;
  mercariReady: boolean;
  blockers: KingmakerListingReadinessBlocker[];
  checks: KingmakerListingReadinessCheck[];
  acquisitionSource: string | null;
  registryIdentityId: string | null;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  const result = String(value ?? "").trim();
  return result || null;
}

function positiveMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function positiveQuantity(value: unknown) {
  const quantity = Math.floor(Number(value || 0));
  return Number.isFinite(quantity) && quantity > 0;
}

function priceGuideOneYearComplete(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const priceGuide = record(instaComp.priceGuide);
  const status = String(instaComp.priceGuideStatus || "").trim().toLowerCase();
  if (status === "no_matches") return Boolean(text(instaComp.priceGuideCheckedAt));
  if (status !== "live") return false;
  const period = String(priceGuide.period || "").trim().toLowerCase();
  return (
    period === "1 year" &&
    priceGuide.identityVerified !== false &&
    Boolean(text(instaComp.priceGuideCheckedAt) || text(priceGuide.capturedAt))
  );
}

export function buildKingmakerListingReadiness(params: {
  metadata: unknown;
  frontImageUrl: unknown;
  backImageUrl: unknown;
  condition: unknown;
  quantity: unknown;
  acquisitionSource?: unknown;
  duplicateDecisionRequired?: boolean;
  websitePrice?: unknown;
  ebayPrice?: unknown;
  mercariPrice?: unknown;
  ebayCardCondition?: unknown;
  graded?: boolean;
}): KingmakerListingReadiness {
  const receipt = readChecklistRegistryReceipt(params.metadata);
  const exactIdentity =
    checklistRegistryReceiptBlockers(params.metadata).length === 0 &&
    ["identified", "exact_match"].includes(receipt.status);
  const frontImage = text(params.frontImageUrl);
  const backImage = text(params.backImageUrl);
  const acquisitionSource = text(params.acquisitionSource);
  const rawEbayConditionReady =
    params.graded === true || Boolean(text(params.ebayCardCondition));

  const checks: KingmakerListingReadinessCheck[] = [
    { code: "identity_not_exact", label: "Exact Registry identity", ready: exactIdentity },
    {
      code: "price_guide_not_checked_1_year",
      label: "1-year eBay Price Guide checked",
      ready: priceGuideOneYearComplete(params.metadata),
    },
    { code: "missing_front_image", label: "Front photo", ready: Boolean(frontImage) },
    { code: "missing_back_image", label: "Back photo", ready: Boolean(backImage) },
    {
      code: "duplicate_front_back_image",
      label: "Distinct front/back photos",
      ready: Boolean(frontImage && backImage && frontImage !== backImage),
    },
    { code: "missing_condition", label: "Condition", ready: Boolean(text(params.condition)) },
    { code: "missing_quantity", label: "Owned quantity", ready: positiveQuantity(params.quantity) },
    {
      code: "missing_acquisition_source",
      label: "Acquisition source",
      ready: Boolean(acquisitionSource),
    },
    {
      code: "duplicate_decision_required",
      label: "Duplicate decision",
      ready: params.duplicateDecisionRequired !== true,
    },
    {
      code: "missing_website_price",
      label: "Website seller price",
      ready: positiveMoney(params.websitePrice),
    },
    {
      code: "missing_ebay_price",
      label: "eBay seller price",
      ready: positiveMoney(params.ebayPrice),
    },
    {
      code: "missing_mercari_price",
      label: "Mercari seller price",
      ready: positiveMoney(params.mercariPrice),
    },
    {
      code: "missing_ebay_card_condition",
      label: "eBay Card Condition",
      ready: rawEbayConditionReady,
    },
  ];

  const coreCodes = new Set<KingmakerListingReadinessBlocker>([
    "identity_not_exact",
    "price_guide_not_checked_1_year",
    "missing_front_image",
    "missing_back_image",
    "duplicate_front_back_image",
    "missing_condition",
    "missing_quantity",
    "missing_acquisition_source",
    "duplicate_decision_required",
  ]);
  const failed = checks.filter((check) => !check.ready);
  const coreReady = failed.every((check) => !coreCodes.has(check.code));
  const websiteReady =
    coreReady && !failed.some((check) => check.code === "missing_website_price");
  const ebayReady =
    coreReady &&
    !failed.some((check) =>
      ["missing_ebay_price", "missing_ebay_card_condition"].includes(check.code),
    );
  const mercariReady =
    coreReady && !failed.some((check) => check.code === "missing_mercari_price");

  return {
    ready: websiteReady && ebayReady,
    coreReady,
    websiteReady,
    ebayReady,
    mercariReady,
    blockers: failed.map((check) => check.code),
    checks,
    acquisitionSource,
    registryIdentityId: receipt.registryIdentityId,
  };
}

export function assertKingmakerListingReadiness(
  readiness: KingmakerListingReadiness,
  channel: "website" | "ebay" | "mercari" | "all",
) {
  const ready =
    channel === "website"
      ? readiness.websiteReady
      : channel === "ebay"
        ? readiness.ebayReady
        : channel === "mercari"
          ? readiness.mercariReady
          : readiness.websiteReady && readiness.ebayReady && readiness.mercariReady;
  if (ready) return readiness;

  const channelBlockers = readiness.checks
    .filter((check) => {
      if (check.ready) return false;
      if (channel === "website") {
        return check.code !== "missing_ebay_price" &&
          check.code !== "missing_mercari_price" &&
          check.code !== "missing_ebay_card_condition";
      }
      if (channel === "ebay") {
        return check.code !== "missing_website_price" &&
          check.code !== "missing_mercari_price";
      }
      if (channel === "mercari") {
        return check.code !== "missing_website_price" &&
          check.code !== "missing_ebay_price" &&
          check.code !== "missing_ebay_card_condition";
      }
      return true;
    })
    .map((check) => check.label);

  const error = new Error(
    `KINGMAKER listing readiness failed: ${channelBlockers.join(", ")}.`,
  ) as Error & {
    code?: string;
    blockers?: KingmakerListingReadinessBlocker[];
  };
  error.code = "KINGMAKER_LISTING_NOT_READY";
  error.blockers = readiness.blockers;
  throw error;
}
