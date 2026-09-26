import "server-only";

import { createHash } from "node:crypto";
import {
  analyzeWithInstaCompAiLocal,
  archiveInstaCompAiLocalSupervisedScan,
  type InstaCompAiLocalScan,
} from "./instacomp-ai-local";
import { normalizeInstaCompSideImages } from "./instacomp-image-orientation";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
} from "./instacomp-mac-credentials";
import { postInstaCompMacRegistry } from "./instacomp-mac-registry-client";

type JsonRecord = Record<string, unknown>;

type MacCommercialItem = {
  inventoryItemId: string;
  legacyProductId?: number | null;
  cardUuid?: string | null;
  title: string;
  sku: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  status: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
  player?: string | null;
  sport?: string | null;
  metadata?: JsonRecord;
  createdAt?: string | null;
  updatedAt?: string | null;
};
function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown, maximum = 500) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function sha256File(file: File) {
  return createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
}

function macBaseUrl() {
  return getConfiguredInstaCompMacUrl() || "http://127.0.0.1:8787";
}

function macHeaders(json = false) {
  const result = new Headers({ Accept: "application/json" });
  const key = getConfiguredInstaCompMacKey();
  if (!key) throw new Error("InstaComp Mac API key is not configured.");
  result.set("X-InstaComp-AI-Key", key);
  if (json) result.set("Content-Type", "application/json");
  return result;
}

export function kingmakerScanImageUrl(scanId: string, side: "front" | "back") {
  return `/api/kingmaker/scan-image?scanId=${encodeURIComponent(scanId)}&side=${side}`;
}

function checklistIdentity(scan: InstaCompAiLocalScan) {
  const checklist = record(scan.checklist);
  return record(checklist.identity);
}

function identityValue(identity: JsonRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = text(identity[key], 240);
    if (value) return value;
  }
  return null;
}

export function scanIdentity(scan: InstaCompAiLocalScan) {
  const checklist = checklistIdentity(scan);
  const trusted = record(scan.trusted_identity);
  const localVision = record(scan.local_vision);
  const hints = record(localVision.identity_hints);
  const suggestion = record(scan.local_suggestion);
  const suggestionIdentity = record(suggestion.identity);
  const checklistOutcome = text(scan.checklist?.outcome, 80)?.toLowerCase();
  const scanStatus = text(scan.status, 80)?.toLowerCase();
  const trustedByMac =
    scanStatus === "trusted_memory_match" ||
    scanStatus === "autonomy_auto_accept" ||
    Object.keys(trusted).length > 0;
  const exact =
    checklistOutcome === "exact_match" &&
    Boolean(text(scan.checklist?.identity_id, 200)) &&
    trustedByMac;

  // Exact Registry truth always wins. Review-required scans still retain every
  // physical identity fact that Apple Vision/local parsing actually read,
  // instead of collapsing the draft to an empty anonymous card.
  const identity = exact
    ? { ...suggestionIdentity, ...hints, ...trusted, ...checklist }
    : { ...suggestionIdentity, ...hints, ...trusted, ...checklist };
  const parallelRaw = identityValue(identity, "parallel", "checklistParallel");
  const parallel = /^base$/i.test(parallelRaw || "") ? null : parallelRaw;
  const checklistParallel = exact ? parallelRaw || "Base" : parallelRaw;
  return {
    exact,
    registryIdentityId: text(scan.checklist?.identity_id, 200),
    year: identityValue(identity, "year"),
    manufacturer: identityValue(identity, "manufacturer", "brand"),
    brand: identityValue(identity, "brand", "manufacturer"),
    product: identityValue(identity, "product", "set_name", "setName"),
    setName: identityValue(identity, "set_name", "setName", "product"),
    subset: identityValue(identity, "subset"),
    player: identityValue(identity, "player", "player_name", "playerName"),
    cardNumber: identityValue(identity, "card_number", "cardNumber"),
    parallel,
    checklistParallel,
    variation: identityValue(identity, "variation"),
    serialNumber: identityValue(identity, "serial_number", "serialNumber"),
    serialRun: numberValue(identity.serial_run ?? identity.serialRun),
    team: identityValue(identity, "team"),
    sport: identityValue(identity, "sport"),
    league: identityValue(identity, "league"),
    isAuto:
      identity.autograph === true ||
      identity.isAuto === true ||
      identity.is_auto === true,
    isRelic:
      identity.memorabilia === true ||
      identity.isRelic === true ||
      identity.is_relic === true,
  };
}

export function scanTitle(scan: InstaCompAiLocalScan) {
  const identity = scanIdentity(scan);
  const readable = [
    identity.year,
    identity.manufacturer || identity.brand,
    identity.setName || identity.product,
    identity.cardNumber ? `#${identity.cardNumber}` : null,
    identity.player,
    identity.checklistParallel,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (identity.exact) return readable;
  return readable
    ? `${readable} — identity review`
    : "InstaComp card — identity review required";
}
export async function searchMacMarketForIdentity(params: {
  identity: JsonRecord;
  exactTitle: string;
  scanId?: string | null;
  registryIdentityId?: string | null;
  registryFingerprintSha256?: string | null;
  operatorCertifiedIdentity?: boolean;
}) {
  const identity = params.identity;
  const year = text(identity.year, 20);
  const player = text(identity.player || identity.playerName, 180);
  const cardNumber = text(identity.cardNumber || identity.card_number, 80);
  if (!year || !player || !cardNumber || !params.registryIdentityId) return null;

  const response = await fetch(`${macBaseUrl()}/v1/market-comp/search`, {
    method: "POST",
    headers: macHeaders(true),
    body: JSON.stringify({
      exact_title: params.exactTitle,
      identity,
      scan_id: params.scanId || null,
      registry_identity_id: params.registryIdentityId,
      registry_fingerprint_sha256: params.registryFingerprintSha256 || null,
      operator_certified_identity: params.operatorCertifiedIdentity === true,
      include_130point: false,
      include_active: true,
      include_price_guide: true,
      include_fanatics: false,
      max_sold: 50,
      max_active: 30,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(150_000),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    throw new Error(String(payload.detail || payload.error || `Mac market search HTTP ${response.status}.`));
  }
  return payload;
}

export async function searchMacMarketForScan(scan: InstaCompAiLocalScan) {
  const identity = scanIdentity(scan);
  if (!identity.exact) return null;
  return searchMacMarketForIdentity({
    identity,
    exactTitle: scanTitle(scan),
    scanId: scan.scan_id,
    registryIdentityId: identity.registryIdentityId,
    registryFingerprintSha256: registryFingerprint(scan),
    operatorCertifiedIdentity: false,
  });
}
function macMasterProjectionRow(value: JsonRecord) {
  const inventoryItemId = text(value.inventoryItemId, 200);
  if (!inventoryItemId) return null;
  return {
    id: inventoryItemId,
    legacy_product_id: numberValue(value.legacyProductId),
    card_uuid: text(value.cardUuid, 200),
    sku: text(value.sku, 200),
    title: text(value.title, 1000) || "InstaComp scan pending",
    description: text(value.description, 100_000),
    category: text(value.category, 500),
    condition: text(value.condition, 500),
    status: text(value.status, 80) || "draft",
    quantity: Math.max(0, Math.floor(numberValue(value.quantity) || 0)),
    price: Math.max(0, numberValue(value.price) || 0),
    metadata: record(value.metadata),
    created_at: text(value.createdAt, 100),
    updated_at: text(value.updatedAt, 100) || new Date().toISOString(),
  };
}

async function projectMacMasterListingRows(values: JsonRecord[]) {
  const items = values
    .map(macMasterProjectionRow)
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  if (!items.length) return;
  await postInstaCompMacRegistry(
    "/v1/kingmaker/accounting/commercial-inventory",
    { action: "project_master", items },
    10_000,
  );
}

export async function listMacKingmakerInventory(timeoutMs = 30_000) {
  const response = await postInstaCompMacRegistry(
    "/v1/kingmaker/accounting/commercial-inventory",
    { action: "list", items: [] },
    timeoutMs,
  );
  return {
    items: Array.isArray(response.items) ? (response.items as MacCommercialItem[]) : [],
    summary: record(response.summary),
  };
}

export async function getMacKingmakerInventoryItem(inventoryItemId: string) {
  const { items } = await listMacKingmakerInventory();
  return items.find((item) => item.inventoryItemId === inventoryItemId) || null;
}

export async function createMacKingmakerDraft(draft: JsonRecord) {
  const response = await postInstaCompMacRegistry(
    "/v1/kingmaker/accounting/commercial-inventory",
    { action: "create", items: [draft] },
    30_000,
  );
  const items = Array.isArray(response.items) ? response.items : [];
  const created = items[0];
  if (!created || typeof created !== "object") {
    throw new Error("Mac-local KINGMAKER draft was not returned after create.");
  }
  const createdItem = created as MacCommercialItem;
  await projectMacMasterListingRows([
    {
      ...draft,
      ...createdItem,
      metadata:
        Object.keys(record(draft.metadata)).length > 0
          ? record(draft.metadata)
          : createdItem.metadata || {},
    },
  ]);
  return createdItem;
}
export async function updateMacKingmakerDraft(
  inventoryItemId: string,
  edit: JsonRecord,
) {
  const response = await postInstaCompMacRegistry(
    "/v1/kingmaker/accounting/commercial-inventory",
    { action: "update", items: [{ inventoryItemId, ...edit, updateEbay: false }] },
    30_000,
  );
  const results = Array.isArray(response.results) ? response.results : [];
  const result = results[0] as JsonRecord | undefined;
  if (!result || result.success !== true) {
    throw new Error(String(result?.message || "Mac-local KINGMAKER draft update failed."));
  }
  const updated = await getMacKingmakerInventoryItem(inventoryItemId);
  if (updated) {
    await projectMacMasterListingRows([
      {
        ...updated,
        ...edit,
        inventoryItemId,
        metadata:
          Object.keys(record(edit.metadata)).length > 0
            ? record(edit.metadata)
            : updated.metadata || {},
      },
    ]);
  }
  return updated;
}

function registryFingerprint(scan: InstaCompAiLocalScan) {
  const receipts = Array.isArray(scan.checklist?.source_receipts)
    ? scan.checklist.source_receipts
    : [];
  const value = receipts.find((entry) => String(entry).startsWith("registry_fingerprint:"));
  return value ? String(value).slice("registry_fingerprint:".length) : null;
}

function orientationReceipt(scan: InstaCompAiLocalScan) {
  const value = scan.image_orientation || {};
  return {
    status: text(value.status, 80),
    model: text(value.source, 120),
    source: text(value.source, 120),
    frontRotation: numberValue(value.front_rotation) || 0,
    backRotation: numberValue(value.back_rotation) || 0,
    frontConfidence: numberValue(value.front_confidence) || 0,
    backConfidence: numberValue(value.back_confidence) || 0,
    frontEvidenceText: Array.isArray(value.front_evidence) ? value.front_evidence.map(String) : [],
    backEvidenceText: Array.isArray(value.back_evidence) ? value.back_evidence.map(String) : [],
    reason: text(value.status, 80) === "completed"
      ? "Mac-local InstaComp canonical orientation completed."
      : "Mac-local orientation requires review.",
  };
}

function parallelDecision(scan: InstaCompAiLocalScan) {
  const identity = scanIdentity(scan);
  return {
    status: identity.exact ? "resolved" : "review_required",
    selectedParallel: identity.exact ? identity.checklistParallel : null,
    selectedIdentityId: identity.registryIdentityId,
    confidence: identity.exact ? 0.99 : 0,
    evidence: identity.exact
      ? "Mac-local Checklist Registry supplied the exact identity."
      : "Exact parallel is not proven; review remains required.",
    candidateParallels: identity.checklistParallel ? [identity.checklistParallel] : [],
  };
}

export type KingmakerMacScanResult = {
  scan: InstaCompAiLocalScan;
  inventoryItem: MacCommercialItem;
  market: JsonRecord | null;
  pricing: JsonRecord | null;
  ai: JsonRecord;
  identityComplete: boolean;
};

export function suggestedPriceFromMarket(market: JsonRecord | null) {
  const summary = record(market?.marketSummary);
  const median = numberValue(summary.soldMedian);
  const average = numberValue(summary.soldAverage);
  const activeLow = numberValue(summary.activeLow);
  const value = median || average || activeLow;
  return value && value > 0 ? Math.round(value * 100) / 100 : null;
}

function marketFields(market: JsonRecord | null) {
  const suggestedPrice = suggestedPriceFromMarket(market);
  return {
    suggestedPrice,
    marketSummary: record(market?.marketSummary),
    priceGuide: record(market?.priceGuide),
    soldCompEvidence: Array.isArray(market?.sold) ? market.sold : [],
    activeCompetition: Array.isArray(market?.active) ? market.active : [],
    providerCoverage: Array.isArray(market?.providerCoverage)
      ? market.providerCoverage
      : [],
    pricingCheckedAt: market ? new Date().toISOString() : null,
  };
}

export async function refreshKingmakerMacMarketForScan(
  scan: InstaCompAiLocalScan,
  inventoryItemId: string,
) {
  const market = await searchMacMarketForScan(scan);
  if (!market) return null;
  const existing = await getMacKingmakerInventoryItem(inventoryItemId);
  if (!existing) throw new Error("Mac-local KINGMAKER draft disappeared before market refresh.");
  const metadata = record(existing.metadata);
  const instaComp = record(metadata.instacomp);
  const fields = marketFields(market);
  const suggestedPrice = fields.suggestedPrice;
  const updated = await updateMacKingmakerDraft(inventoryItemId, {
    price: suggestedPrice || existing.price || 0,
    metadata: {
      ...metadata,
      instacomp: {
        ...instaComp,
        ...fields,
        pricingStatus: suggestedPrice
          ? "priced_from_exact_sold_market"
          : "identity_complete_no_exact_sold_price",
        pricingReason: suggestedPrice
          ? "Mac-local exact sold comps supplied pricing."
          : "Identity is exact but no pricing-eligible sold comp was available.",
      },
    },
  });
  return { market, updated, ...fields };
}

function scanMetadata(scan: InstaCompAiLocalScan, market: JsonRecord | null, imagePairSha256?: string | null) {
  const identity = scanIdentity(scan);
  const pricing = suggestedPriceFromMarket(market);
  const localVision = record(scan.local_vision);
  const canonicalImagePairSha256 =
    text(scan.image_pair_sha256, 128) || text(imagePairSha256, 128);
  return {
    instacomp: {
      source: "kingmaker_mac_scan",
      scanId: scan.scan_id,
      cardUuid: scan.card_uuid || null,
      imagePairSha256: canonicalImagePairSha256,
      inputImagePairSha256: text(imagePairSha256, 128),
      ai: { ...identity, internalScanId: scan.scan_id, confidence: identity.exact ? 0.99 : 0 },
      imageOrientation: orientationReceipt(scan),
      centering: {
        front: record(localVision.front_centering),
        back: record(localVision.back_centering),
      },
      imageOrientationPersisted: text(scan.image_orientation?.status, 80) === "completed",
      imagePersistenceVerified: true,
      frontImageUrl: kingmakerScanImageUrl(scan.scan_id, "front"),
      backImageUrl: kingmakerScanImageUrl(scan.scan_id, "back"),
      checklistDecision: {
        status: scan.checklist?.outcome || null,
        reasons: scan.checklist?.reasons || [],
        candidateCount: identity.exact ? 1 : Number(record(scan.checklist).candidate_count || 0),
        candidateIdentityIds: identity.registryIdentityId ? [identity.registryIdentityId] : [],
      },
      checklistIdentity: {
        status: scan.checklist?.outcome || null,
        identityId: identity.registryIdentityId,
        fingerprintSha256: registryFingerprint(scan),
      },
      pricingGroupKey: registryFingerprint(scan),
      parallelDecision: parallelDecision(scan),
      identitySource: identity.exact ? "mac_checklist_registry_exact" : "mac_scan_review_required",
      identityComplete: identity.exact,
      humanVerified: false,
      trustedForIdentity: identity.exact,
      manualIdentityEdit: false,
      manualIdentityLocked: false,
      identityRefreshRequired: !identity.exact,
      pricingStatus: pricing ? "priced_from_exact_sold_market" : identity.exact ? "identity_complete_no_exact_sold_price" : "blocked_identity_review_required",
      pricingReason: pricing ? "Mac-local exact sold comps supplied pricing." : identity.exact ? "Identity is exact but no pricing-eligible sold comp was available." : "Exact Checklist identity is required before pricing.",
      suggestedPrice: pricing,
      marketSummary: record(market?.marketSummary),
      priceGuide: record(market?.priceGuide),
      soldCompEvidence: Array.isArray(market?.sold) ? market.sold : [],
      activeCompetition: Array.isArray(market?.active) ? market.active : [],
      providerCoverage: Array.isArray(market?.providerCoverage)
        ? market.providerCoverage
        : [],
      pricingCheckedAt: market ? new Date().toISOString() : null,
      lastStatus: identity.exact ? "identity_complete" : "review_required",
      lastStage: identity.exact ? "complete" : "identity_review",
      lastError: null,
      lastErrorCode: null,
      scannedAt: new Date().toISOString(),
    },
    collectible_asset: {
      parallel_name: identity.parallel,
      exact_serial_number: identity.serialNumber,
      print_run: identity.serialNumber,
    },
    seller_review: { identity_confirmed: false },
  };
}

export async function runKingmakerMacScan(params: {
  front: File;
  back: File;
  inventoryItemId?: string | null;
  imagePairSha256?: string | null;
  searchMarket?: boolean;
  forceFreshIdentity?: boolean;
  replaceManualIdentity?: boolean;
  scanTimeoutMs?: number;
  fastPassOnly?: boolean;
}) : Promise<KingmakerMacScanResult> {
  // IDENTITY-FIRST FAST LANE:
  // Most seller scans arrive upright. Try the known-fast 0/0 physical scan first.
  // This avoids paying the full four-way orientation referee before we even know
  // whether orientation recovery is needed.
  let scan = await analyzeWithInstaCompAiLocal({
    front: params.front,
    back: params.back,
    frontRotation: 0,
    backRotation: 0,
    forceFreshIdentity: params.forceFreshIdentity === true,
    timeoutMs:
      params.scanTimeoutMs ??
      (params.forceFreshIdentity === true ? 12_000 : 30_000),
  });
  if (!scan.scan_id) throw new Error("Mac-local InstaComp scan returned no scan ID.");

  // If the fast upright attempt cannot establish an exact identity, fall back
  // to the Mac's full local orientation/identity pipeline. Upside-down or
  // sideways cards therefore retain the existing recovery path.
  if (
    params.fastPassOnly !== true &&
    !scanIdentity(scan).exact &&
    !(
      params.forceFreshIdentity === true &&
      String(scan.image_orientation?.status || "").trim().toLowerCase() === "completed"
    )
  ) {
    const orientationRecoveryScan = await analyzeWithInstaCompAiLocal({
      front: params.front,
      back: params.back,
      frontRotation: null,
      backRotation: null,
      forceFreshIdentity: params.forceFreshIdentity === true,
      timeoutMs: 60_000,
    });

    if (orientationRecoveryScan.scan_id) {
      scan = orientationRecoveryScan;
    }
  }

  // External orientation remains last-resort only, after both local attempts.
  if (
    params.fastPassOnly !== true &&
    !scanIdentity(scan).exact &&
    String(scan.image_orientation?.status || "").trim().toLowerCase() !== "completed"
  ) {
    try {
      const normalizedSides = await normalizeInstaCompSideImages({
        frontImage: params.front,
        backImage: params.back,
      });

      if (
        normalizedSides.backFile &&
        normalizedSides.orientation.status === "completed"
      ) {
        const fallbackScan = await analyzeWithInstaCompAiLocal({
          front: params.front,
          back: params.back,
          frontRotation: normalizedSides.orientation.frontRotation,
          backRotation: normalizedSides.orientation.backRotation,
          forceFreshIdentity: params.forceFreshIdentity === true,
          timeoutMs: 60_000,
        });

        if (fallbackScan.scan_id) scan = fallbackScan;
      }
    } catch (error) {
      scan.external_orientation_fallback_error =
        error instanceof Error
          ? error.message
          : "External orientation fallback failed.";
    }
  }
  const identity = scanIdentity(scan);
  const market =
    identity.exact && params.searchMarket === true
      ? await searchMacMarketForScan(scan)
      : null;
  const pricing = market ? { suggestedPrice: suggestedPriceFromMarket(market), marketSummary: record(market.marketSummary) } : null;
  const metadata = scanMetadata(scan, market, params.imagePairSha256);
  const inventoryItemId = text(params.inventoryItemId, 200) || text(scan.card_uuid, 200) || scan.scan_id;
  const draft = {
    inventoryItemId,
    cardUuid: scan.card_uuid || null,
    title: scanTitle(scan),
    sku: `scan-${String(inventoryItemId).slice(0, 12)}`,
    description: identity.exact ? "Mac-local KINGMAKER draft with exact Registry identity." : "Mac-local KINGMAKER draft awaiting exact identity review.",
    player: identity.player,
    sport: identity.sport,
    category: "Trading Card Singles",
    condition: "Near Mint or Better",
    price: suggestedPriceFromMarket(market) || 0,
    imageUrl: kingmakerScanImageUrl(scan.scan_id, "front"),
    metadata,
  };
  const existing = params.inventoryItemId ? await getMacKingmakerInventoryItem(params.inventoryItemId) : null;
  const manualIdentityLocked = record(record(existing?.metadata).instacomp).manualIdentityLocked === true;
  if (existing && manualIdentityLocked && params.replaceManualIdentity !== true) {
    // Fresh pixels were still analyzed above, but a human lock owns the draft
    // until the caller explicitly authorizes replacement.
    return { scan, inventoryItem: existing, market: null, pricing: null, ai: record(metadata.instacomp).ai as JsonRecord, identityComplete: identity.exact };
  }
  const inventoryItem = existing
    ? (await updateMacKingmakerDraft(params.inventoryItemId!, draft)) || existing
    : await createMacKingmakerDraft(draft);
  return { scan, inventoryItem, market, pricing, ai: record(metadata.instacomp).ai as JsonRecord, identityComplete: identity.exact };
}



export async function archiveKingmakerMacReviewFallback(params: {
  front: File;
  back: File;
  imagePairSha256?: string | null;
  inventoryItemId?: string | null;
  reason?: string | null;
}): Promise<KingmakerMacScanResult> {
  const archive = await archiveInstaCompAiLocalSupervisedScan({
    front: params.front,
    back: params.back,
    timeoutMs: 12_000,
  });
  const scan: InstaCompAiLocalScan = {
    schema_version: "tcos.instacomp-ai.scan.v1",
    scan_id: archive.scan_id,
    card_uuid: archive.card_uuid,
    status: "needs_review",
    front_sha256: archive.front_sha256,
    back_sha256: archive.back_sha256,
    image_pair_sha256:
      archive.image_pair_sha256 || params.imagePairSha256 || undefined,
    image_orientation: {
      status: "review_required",
      source: "supervised_archive_fast_intake_fallback",
      front_rotation: 0,
      back_rotation: 0,
      front_confidence: 0,
      back_confidence: 0,
      front_evidence: [],
      back_evidence: [],
    },
    local_vision: null,
    pricing_allowed: false,
    learning_allowed: false,
    trusted_identity: null,
    local_suggestion: null,
    match_source: "none",
    checklist: {
      outcome: "input_incomplete",
      identity_id: null,
      identity: null,
      source_receipts: ["supervised_archive_fast_intake_fallback"],
      reasons: [
        params.reason ||
          "Foreground identity pass did not finish inside the intake latency budget.",
      ],
    },
    next_action:
      "Card images are safely archived. Continue exact identity recovery in Pending Verification.",
  };
  const metadata = scanMetadata(
    scan,
    null,
    params.imagePairSha256 || archive.image_pair_sha256,
  );
  const inventoryItemId =
    text(params.inventoryItemId, 200) ||
    text(archive.card_uuid, 200) ||
    archive.scan_id;
  const draft = {
    inventoryItemId,
    cardUuid: archive.card_uuid,
    title: scanTitle(scan),
    sku: `scan-${String(inventoryItemId).slice(0, 12)}`,
    description:
      "Mac-local KINGMAKER draft safely archived; exact identity review required.",
    player: null,
    sport: null,
    category: "Trading Card Singles",
    condition: "Near Mint or Better",
    price: 0,
    imageUrl: kingmakerScanImageUrl(archive.scan_id, "front"),
    metadata,
  };
  const inventoryItem = params.inventoryItemId
    ? (await updateMacKingmakerDraft(params.inventoryItemId, draft)) ||
      (await createMacKingmakerDraft(draft))
    : await createMacKingmakerDraft(draft);
  return {
    scan,
    inventoryItem,
    market: null,
    pricing: null,
    ai: record(metadata.instacomp).ai as JsonRecord,
    identityComplete: false,
  };
}

export async function findMacDuplicateByImagePair(
  imagePairSha256: string,
  timeoutMs = 2_500,
) {
  try {
    const { items } = await listMacKingmakerInventory(timeoutMs);
    return (
      items.find(
        (item) => {
          const instacomp = record(item.metadata?.instacomp);
          return (
            text(instacomp.imagePairSha256, 128) === imagePairSha256 ||
            text(instacomp.inputImagePairSha256, 128) === imagePairSha256
          );
        },
      ) || null
    );
  } catch {
    // Duplicate lookup is a guard, not identity authority. Exact image pairs
    // are still bound by the Mac scan store, so a slow inventory enumeration
    // must never block a fresh physical scan.
    return null;
  }
}
