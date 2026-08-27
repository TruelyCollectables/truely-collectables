import {
  evaluateInstaCompListingGate,
  type InstaCompListingGateRecord,
  type InstaCompListingGateResult,
} from "./instacomp-listing-gate";

type UnknownRecord = Record<string, unknown>;

export type InstaCompPublicationGateResult = {
  allowed: boolean;
  scanId: string | null;
  listingPrice: number | null;
  gate: InstaCompListingGateResult | null;
  reasons: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : [];
}

export function buildInstaCompScanPayload(params: {
  scanId: unknown;
  rawAiResult: unknown;
  rawCompResults: unknown;
}): InstaCompListingGateRecord {
  return {
    ...record(params.rawCompResults),
    ai: record(params.rawAiResult),
    scanId: text(params.scanId),
  };
}

export function evaluateInstaCompPublicationGate(params: {
  metadata: unknown;
  scanPayload: InstaCompListingGateRecord | null;
}): InstaCompPublicationGateResult {
  const metadata = record(params.metadata);
  const instacomp = record(metadata.instacomp);
  const pendingImport = record(metadata.pendingImport);
  const immutableImportedIdentity = record(pendingImport.originalIdentity);
  const importedIdentity = Object.keys(immutableImportedIdentity).length
    ? immutableImportedIdentity
    : record(metadata.cardIdentity);
  const scanId = text(instacomp.scanId) || null;
  const listingPrice = positiveMoney(instacomp.listingPrice);
  const reasons: string[] = [];

  if (text(instacomp.status) !== "complete") {
    reasons.push("instacomp_scan_not_complete");
  }
  if (!scanId) {
    reasons.push("instacomp_scan_id_missing");
  }
  if (!params.scanPayload) {
    reasons.push("instacomp_scan_record_missing");
    return {
      allowed: false,
      scanId,
      listingPrice,
      gate: null,
      reasons: Array.from(new Set(reasons)),
    };
  }

  const payloadScanId = text(params.scanPayload.scanId);
  if (!payloadScanId || !scanId || payloadScanId !== scanId) {
    reasons.push("instacomp_scan_record_mismatch");
  }

  const gate = evaluateInstaCompListingGate({
    payload: params.scanPayload,
    importedIdentity,
    pendingImport,
  });
  if (!gate.identityApproved) {
    reasons.push(...gate.identityReviewReasons);
  }
  if (!gate.priceApproved) {
    reasons.push(...gate.pricingReviewReasons);
  }
  if (instacomp.catalogConfirmed !== true) {
    reasons.push("stored_catalog_confirmation_missing");
  }
  if (stringList(instacomp.reviewReasons).length) {
    reasons.push("stored_instacomp_review_required");
  }
  if (listingPrice === null) {
    reasons.push("stored_instacomp_listing_price_missing");
  }

  const decision = record(instacomp.decision);
  const decisionPrice = positiveMoney(decision.listPrice);
  if (
    listingPrice !== null &&
    (decisionPrice === null || Math.abs(decisionPrice - listingPrice) > 0.02)
  ) {
    reasons.push("stored_instacomp_price_receipt_mismatch");
  }

  const uniqueReasons = Array.from(new Set(reasons.filter(Boolean)));
  return {
    allowed:
      uniqueReasons.length === 0 &&
      gate.identityApproved &&
      gate.priceApproved &&
      listingPrice !== null,
    scanId,
    listingPrice,
    gate,
    reasons: uniqueReasons,
  };
}
