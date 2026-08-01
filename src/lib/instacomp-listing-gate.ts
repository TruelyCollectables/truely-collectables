export type InstaCompListingGateRecord = Record<string, unknown>;

export type InstaCompListingGateResult = {
  identity: InstaCompListingGateRecord;
  identityApproved: boolean;
  priceApproved: boolean;
  confidence: number;
  catalogConfirmed: boolean;
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

function identityConflicts(
  importedIdentity: InstaCompListingGateRecord,
  proposedIdentity: InstaCompListingGateRecord,
) {
  const conflicts: string[] = [];
  if (differs(importedIdentity.player, proposedIdentity.player)) {
    conflicts.push("player_conflicts_with_imported_identity");
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
  return conflicts;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => text(entry)).filter(Boolean)
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
  const reviewReasons = arrayOfStrings(review.identityReviewReasons);

  if (!catalogConfirmed) reviewReasons.push("checklist_identity_not_confirmed");
  if (confidence < 0.92) reviewReasons.push("low_identification_confidence");

  const catalogSerialRun = text(catalogIdentity.serialRun);
  const observedSerialNumber = text(ai.serialNumber);
  if (catalogSerialRun && !observedSerialNumber) {
    reviewReasons.push("serialized_checklist_parallel_without_visible_serial");
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
    reviewReasons.push(...identityConflicts(importedIdentity, identity));
  }

  const uniqueReasons = Array.from(new Set(reviewReasons.filter(Boolean)));
  const identityApproved = uniqueReasons.length === 0;
  const priceApproved =
    identityApproved &&
    review.trustedForPricing === true &&
    actionPermissions.autoPriceAllowed === true;

  return {
    identity,
    identityApproved,
    priceApproved,
    confidence,
    catalogConfirmed,
    reviewReasons: uniqueReasons,
  };
}
