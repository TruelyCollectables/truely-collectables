import "server-only";

import { createHash } from "node:crypto";
import {
  analyzeWithInstaCompAiLocal,
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
  title: string;
  sku: string;
  status: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
  player?: string | null;
  sport?: string | null;
  metadata?: JsonRecord;
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
  const identity = checklistIdentity(scan);
  const exact = scan.pricing_allowed === true && Boolean(text(scan.checklist?.identity_id, 200));
  const parallelRaw = identityValue(identity, "parallel");
  const parallel = /^base$/i.test(parallelRaw || "") ? null : parallelRaw;
  return {
    exact,
    registryIdentityId: text(scan.checklist?.identity_id, 200),
    year: identityValue(identity, "year"),
    manufacturer: identityValue(identity, "manufacturer", "brand"),
    brand: identityValue(identity, "brand", "manufacturer"),
    product: identityValue(identity, "product", "set_name", "setName"),
    setName: identityValue(identity, "set_name", "setName", "product"),
    player: identityValue(identity, "player", "player_name", "playerName"),
    cardNumber: identityValue(identity, "card_number", "cardNumber"),
    parallel,
    checklistParallel: parallelRaw || "Base",
    variation: identityValue(identity, "variation"),
    serialNumber: identityValue(identity, "serial_number", "serialNumber"),
    team: identityValue(identity, "team"),
    sport: identityValue(identity, "sport"),
    league: identityValue(identity, "league"),
    isAuto: identity.autograph === true || identity.isAuto === true,
    isRelic: identity.memorabilia === true || identity.isRelic === true,
  };
}

export function scanTitle(scan: InstaCompAiLocalScan) {
  const identity = scanIdentity(scan);
  if (!identity.exact) return "InstaComp card — identity review required";
  return [
    identity.year,
    identity.manufacturer,
    identity.setName,
    identity.cardNumber ? `#${identity.cardNumber}` : null,
    identity.player,
    identity.checklistParallel,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
export async function searchMacMarketForScan(scan: InstaCompAiLocalScan) {
  const identity = scanIdentity(scan);
  if (!identity.exact || !identity.year || !identity.player || !identity.cardNumber) {
    return null;
  }
  const response = await fetch(`${macBaseUrl()}/v1/market-comp/search`, {
    method: "POST",
    headers: macHeaders(true),
    body: JSON.stringify({
      exact_title: scanTitle(scan),
      identity,
      scan_id: scan.scan_id,
      registry_identity_id: identity.registryIdentityId,
      operator_certified_identity: false,
      include_130point: false,
      include_active: true,
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
export async function listMacKingmakerInventory() {
  const response = await postInstaCompMacRegistry(
    "/v1/kingmaker/accounting/commercial-inventory",
    { action: "list", items: [] },
    30_000,
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
  return created as MacCommercialItem;
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
  return getMacKingmakerInventoryItem(inventoryItemId);
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

function suggestedPriceFromMarket(market: JsonRecord | null) {
  const summary = record(market?.marketSummary);
  const median = numberValue(summary.soldMedian);
  const average = numberValue(summary.soldAverage);
  const activeLow = numberValue(summary.activeLow);
  const value = median || average || activeLow;
  return value && value > 0 ? Math.round(value * 100) / 100 : null;
}

function scanMetadata(scan: InstaCompAiLocalScan, market: JsonRecord | null, imagePairSha256?: string | null) {
  const identity = scanIdentity(scan);
  const pricing = suggestedPriceFromMarket(market);
  return {
    instacomp: {
      source: "kingmaker_mac_scan",
      scanId: scan.scan_id,
      cardUuid: scan.card_uuid || null,
      imagePairSha256: imagePairSha256 || null,
      ai: { ...identity, internalScanId: scan.scan_id, confidence: identity.exact ? 0.99 : 0 },
      imageOrientation: orientationReceipt(scan),
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
}) : Promise<KingmakerMacScanResult> {
  // Local-first is mandatory for KINGMAKER. The Mac receives the untouched
  // physical front/back pair before any paid/external orientation provider is
  // consulted, so the local scan is archived and InstaComp gets the first chance
  // to orient, identify, and learn from the card.
  let scan = await analyzeWithInstaCompAiLocal({
    front: params.front,
    back: params.back,
    frontRotation: null,
    backRotation: null,
    timeoutMs: 225_000,
  });
  if (!scan.scan_id) throw new Error("Mac-local InstaComp scan returned no scan ID.");

  // Only use the outside orientation referee when the Mac actually ran but could
  // not verify orientation. If the outside provider is unavailable or out of
  // credits, keep the completed local scan/review record instead of failing the
  // receiving flow with a provider quota error.
  if (String(scan.image_orientation?.status || "").trim().toLowerCase() !== "completed") {
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
          timeoutMs: 225_000,
        });
        if (fallbackScan.scan_id) scan = fallbackScan;
      }
    } catch (error) {
      scan.external_orientation_fallback_error =
        error instanceof Error ? error.message : "External orientation fallback failed.";
    }
  }
  const identity = scanIdentity(scan);
  const market = identity.exact && params.searchMarket !== false ? await searchMacMarketForScan(scan) : null;
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
  const inventoryItem = existing
    ? (await updateMacKingmakerDraft(params.inventoryItemId!, draft)) || existing
    : await createMacKingmakerDraft(draft);
  return { scan, inventoryItem, market, pricing, ai: record(metadata.instacomp).ai as JsonRecord, identityComplete: identity.exact };
}

export async function findMacDuplicateByImagePair(imagePairSha256: string) {
  const { items } = await listMacKingmakerInventory();
  return items.find((item) => text(record(item.metadata?.instacomp).imagePairSha256, 100) === imagePairSha256) || null;
}
