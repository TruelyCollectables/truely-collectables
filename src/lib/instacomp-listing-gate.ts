import {
  independentVerifiedInstaCompSaleCount,
  verifiedInstaCompCompletedSales,
  type InstaCompMarketComp,
} from "./instacomp-market-evidence";

export type InstaCompListingGateRecord = Record<string, unknown>;

export type InstaCompListingGateResult = {
  identity: InstaCompListingGateRecord;
  identityApproved: boolean;
  priceApproved: boolean;
  confidence: number;
  catalogConfirmed: boolean;
  verifiedSaleCount: number;
  identityReviewReasons: string[];
  pricingReviewReasons: string[];
  reviewReasons: string[];
};

function record(value: unknown): InstaCompListingGateRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as InstaCompListingGateRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function booleanValue(value: unknown) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function normalizedText(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

export function canonicalInstaCompParallel(value: unknown) {
  return normalizedText(value)
    .replace(/\bcracked\s+ice\b/g, "ice")
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\bvariation\b/g, " ")
    .replace(/\bbase\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function differs(left: unknown, right: unknown, normalizer = normalizedText) {
  const a = normalizer(left);
  const b = normalizer(right);
  return Boolean(a && b && a !== b);
}

function booleanDiffers(left: unknown, right: unknown) {
  if (typeof left !== "boolean" || typeof right !== "boolean") return false;
  return left !== right;
}

function identityConflicts(
  importedIdentity: InstaCompListingGateRecord,
  proposedIdentity: InstaCompListingGateRecord,
) {
  const conflicts: string[] = [];
  if (differs(importedIdentity.player, proposedIdentity.player)) {
    conflicts.push("player_conflicts_with_imported_identity");
  }
  if (differs(importedIdentity.year, proposedIdentity.year)) {
    conflicts.push("year_conflicts_with_imported_identity");
  }
  if (differs(importedIdentity.brand, proposedIdentity.brand)) {
    conflicts.push("brand_conflicts_with_imported_identity");
  }
  if (differs(importedIdentity.setName, proposedIdentity.setName)) {
    conflicts.push("set_conflicts_with_imported_identity");
  }
  if (
    differs(
      importedIdentity.cardNumber,
      proposedIdentity.cardNumber,
      normalizedCardNumber,
    )
  ) {
    conflicts.push("card_number_conflicts_with_imported_identity");
  }
  if (
    differs(
      importedIdentity.parallel,
      proposedIdentity.parallel,
      canonicalInstaCompParallel,
    )
  ) {
    conflicts.push("parallel_conflicts_with_imported_identity");
  }
  if (differs(importedIdentity.variation, proposedIdentity.variation)) {
    conflicts.push("variation_conflicts_with_imported_identity");
  }
  if (booleanDiffers(importedIdentity.isAuto, proposedIdentity.isAuto)) {
    conflicts.push("autograph_status_conflicts_with_imported_identity");
  }
  if (booleanDiffers(importedIdentity.isRelic, proposedIdentity.isRelic)) {
    conflicts.push("relic_status_conflicts_with_imported_identity");
  }
  return conflicts;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry)).filter(Boolean)
    : [];
}

function arrayOfRecords(value: unknown) {
  return Array.isArray(value)
    ? value.map(record) as InstaCompMarketComp[]
    : [];
}

export function evaluateInstaCompListingGate(params: {
  payload: InstaCompListingGateRecord;
  importedIdentity?: InstaCompListingGateRecord | null;
  pendingImport?: InstaCompListingGateRecord | null;
}): InstaCompListingGateResult {
  const ai = record(params.payload.ai);
  const review = record(params.payload.review);
  const catalogEvidence = record(params.payload.catalogEvidence);
  const actionPermissions = record(catalogEvidence.actionPermissions);
  const catalogIdentity = record(catalogEvidence.compIdentity);
  const knowledge = record(params.payload.knowledge);
  const marketEvidence = record(params.payload.marketEvidence);
  const importedIdentity = record(params.importedIdentity);
  const pendingImport = record(params.pendingImport);

  const identity: InstaCompListingGateRecord = {
    ...ai,
    player: text(catalogIdentity.player) || ai.player || null,
    year: text(catalogIdentity.year) || ai.year || null,
    brand: text(catalogIdentity.brand) || ai.brand || null,
    setName: text(catalogIdentity.setName) || ai.setName || null,
    cardNumber: text(catalogIdentity.cardNumber) || ai.cardNumber || null,
    parallel:
      text(catalogIdentity.parallel) ||
      text(catalogIdentity.variation) ||
      ai.parallel ||
      null,
    variation: text(catalogIdentity.variation) || ai.variation || null,
    serialNumber:
      text(ai.serialNumber) ||
      text(catalogIdentity.serialNumber) ||
      text(catalogIdentity.serialRun) ||
      null,
    team: text(catalogIdentity.team) || ai.team || null,
    sport: text(catalogIdentity.sport) || ai.sport || null,
    isAuto:
      typeof catalogIdentity.isAuto === "boolean"
        ? catalogIdentity.isAuto
        : ai.isAuto === true,
    isRelic:
      typeof catalogIdentity.isRelic === "boolean"
        ? catalogIdentity.isRelic
        : ai.isRelic === true,
  };

  const confidence = Math.max(
    0,
    Math.min(
      1,
      numberValue(ai.confidence) || numberValue(knowledge.identityConfidence),
    ),
  );
  const catalogConfirmed =
    text(catalogEvidence.status) === "catalog_confirmed" &&
    booleanValue(catalogEvidence.catalogConfirmed) &&
    booleanValue(actionPermissions.publicListingClaimAllowed);
  const identityReviewReasons = arrayOfStrings(review.identityReviewReasons);
  const pricingReviewReasons = arrayOfStrings(review.pricingReviewReasons);

  if (!catalogConfirmed) {
    identityReviewReasons.push("checklist_identity_not_confirmed");
  }
  if (confidence < 0.92) {
    identityReviewReasons.push("low_identification_confidence");
  }

  const catalogSerialRun = text(catalogIdentity.serialRun);
  const observedSerialNumber = text(ai.serialNumber);
  if (catalogSerialRun && !observedSerialNumber) {
    identityReviewReasons.push(
      "serialized_checklist_parallel_without_visible_serial",
    );
  }

  const importedConfidence = normalizedText(
    importedIdentity.identificationConfidence,
  );
  const importedIsHighConfidence =
    ["high", "verified", "manual confirmed", "manual_confirmed"].includes(
      importedConfidence,
    ) &&
    text(pendingImport.source) === "truely_collectables_scan_package";
  if (importedIsHighConfidence) {
    identityReviewReasons.push(...identityConflicts(importedIdentity, identity));
  }

  const saleRows = [
    ...arrayOfRecords(params.payload.soldComps),
    ...arrayOfRecords(marketEvidence.verifiedSoldComps),
  ];
  const verifiedSales = verifiedInstaCompCompletedSales(saleRows);
  const verifiedSaleCount = Math.max(
    independentVerifiedInstaCompSaleCount(verifiedSales),
    numberValue(marketEvidence.verifiedSaleCount),
  );

  if (verifiedSaleCount < 2) {
    pricingReviewReasons.push("insufficient_independent_verified_sales");
  }
  if (review.trustedForPricing !== true) {
    pricingReviewReasons.push("scan_pricing_not_trusted");
  }
  if (actionPermissions.autoPriceAllowed !== true) {
    pricingReviewReasons.push("catalog_does_not_allow_auto_price");
  }

  const uniqueIdentityReasons = Array.from(
    new Set(identityReviewReasons.filter(Boolean)),
  );
  const uniquePricingReasons = Array.from(
    new Set(pricingReviewReasons.filter(Boolean)),
  );
  const identityApproved = uniqueIdentityReasons.length === 0;
  const priceApproved =
    identityApproved && uniquePricingReasons.length === 0 && verifiedSaleCount >= 2;
  const reviewReasons = Array.from(
    new Set([...uniqueIdentityReasons, ...uniquePricingReasons]),
  );

  return {
    identity,
    identityApproved,
    priceApproved,
    confidence,
    catalogConfirmed,
    verifiedSaleCount,
    identityReviewReasons: uniqueIdentityReasons,
    pricingReviewReasons: uniquePricingReasons,
    reviewReasons,
  };
}
