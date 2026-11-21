import { createHash, timingSafeEqual } from "node:crypto";
import { hasVerifiedCsvAuthority } from "../../../../../../lib/kingmaker-verified-csv";
import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/kingmaker-local-auth";
import {
  buildInstaCompQueries,
  type InstaCompAiResult,
} from "../../../../../../lib/instacomp";
import { getOfficialEbayActiveExactProvider } from "../../../../../../lib/instacomp-ebay-active-browse";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
} from "../../../../../../lib/instacomp-mac-credentials";
import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";
import {
  discountedListingPrice,
  listingPromotionFromMetadata,
} from "../../../../../../lib/listing-promotions";
import { effectiveInstaCompPricingGroupKey } from "../../../../../../lib/instacomp-pricing-group";
import {
  getMacMasterListingRow,
  listMacMasterListingRows,
  updateMacKingmakerDrafts,
} from "../../../../../../lib/kingmaker-mac-scan-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// The Mac pricing employee may only price seller-certified CSV cards. The
// same high-entropy Mac key already secures the Worker -> Mac bridge.
function trustedVerifiedCsvPricingWorker(request: NextRequest) {
  const supplied = request.headers.get("x-kingmaker-verified-pricing-key") || "";
  const configured = getConfiguredInstaCompMacKey();
  if (!supplied || !configured) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(supplied), hash(configured));
}

const MIN_EXACT_SOLD = Math.max(
  1,
  Number(process.env.INSTACOMP_FAST_EBAY_MIN_SOLD || 3) || 3,
);

type JsonRecord = Record<string, any>;

type Evidence = {
  title: string;
  price: number;
  itemPrice: number | null;
  shippingPrice: number | null;
  priceIncludesShipping: boolean;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  sourceCategory: string;
  matchScore: number | null;
  flags: string[];
  soldAt: string | null;
  listedAt: string | null;
  observedAt: string | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function evidenceList(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): Evidence | null => {
      const row = record(raw);
      const price = Number(row.price || 0);
      const itemPrice = Number(row.itemPrice ?? row.item_price ?? 0);
      const shippingPrice = row.shippingPrice ?? row.shipping_price;
      const shipping = shippingPrice === null || shippingPrice === undefined
        ? null
        : Number(shippingPrice);
      const url = text(row.url);
      const title = text(row.title);
      if (!title || !url || !Number.isFinite(price) || price <= 0) return null;
      return {
        title,
        price,
        itemPrice: Number.isFinite(itemPrice) && itemPrice > 0 ? itemPrice : null,
        shippingPrice: Number.isFinite(shipping) && shipping! >= 0 ? shipping : null,
        priceIncludesShipping: row.priceIncludesShipping === true || row.price_includes_shipping === true,
        currency: text(row.currency) || "USD",
        url,
        imageUrl: text(row.imageUrl ?? row.image_url),
        source: text(row.source) || "ebay",
        sourceLabel: text(row.sourceLabel) || "eBay",
        sourceCategory: text(row.sourceCategory) || "marketplace",
        matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : null,
        flags: Array.isArray(row.flags) ? row.flags.map(String) : [],
        soldAt: text(row.soldAt ?? row.sold_at),
        listedAt: text(row.listedAt ?? row.listed_at),
        observedAt: text(row.observedAt ?? row.observed_at),
      };
    })
    .filter((row): row is Evidence => Boolean(row));
}

function pricingEligible(row: Evidence, lane: "sold" | "active") {
  if (!row.priceIncludesShipping) return false;
  if (!Number.isFinite(Number(row.itemPrice)) || Number(row.itemPrice) <= 0) return false;
  if (!Number.isFinite(Number(row.shippingPrice)) || Number(row.shippingPrice) < 0) return false;
  if (lane === "sold" && !row.soldAt) return false;
  return !row.flags.some((flag) => /reference only|not used for pricing|excluded/i.test(flag));
}

function providerCoverage(provider: JsonRecord) {
  return {
    source: text(provider.source) || "unknown",
    label: text(provider.label) || text(provider.source) || "Unknown",
    status: text(provider.status) || "unknown",
    resultCount: Number(provider.resultCount || provider.results?.length || 0),
    message: text(provider.message),
    searchUrl: text(provider.searchUrl),
  };
}

function parseIdentityFromTitle(rawTitle: unknown, rawSport: unknown): JsonRecord {
  const title = text(rawTitle) || "";
  if (!title) return {};
  const yearMatch = title.match(/\b((?:19|20)\d{2}(?:-\d{2,4})?)\b/);
  const numMatch = title.match(/#([A-Za-z0-9-]+)/);
  const serialMatch = title.match(/(\d+\/\d+|\/\d+)\b/);
  const cleaned = title
    .replace(/\b(?:19|20)\d{2}(?:-\d{2,4})?\b/g, " ")
    .replace(/#[A-Za-z0-9-]+/g, " ")
    .replace(/\b(?:\d+\/\d+|\/\d+)\b/g, " ")
    .replace(/\b(?:RC|Auto|Autograph|Relic|Patch|PSA|BGS|SGC|CGC)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned.split(" ").filter(Boolean);
  const playerGuess = tokens.length >= 2 ? tokens.slice(-2).join(" ") : tokens.join(" ");
  const setGuess = tokens.length > 2 ? tokens.slice(0, -2).join(" ") : tokens[0] || "";
  return {
    year: yearMatch ? yearMatch[1] : null,
    cardNumber: numMatch ? numMatch[1] : null,
    player: playerGuess || null,
    setName: setGuess || null,
    product: setGuess || null,
    serialNumber: serialMatch ? serialMatch[1] : null,
    sport: text(rawSport),
    isAuto: /\b(?:auto|autograph|autographed)\b/i.test(title),
    isRelic: /\b(?:relic|patch|jersey|memorabilia)\b/i.test(title),
  };
}

function resolveItemIdentity(item: JsonRecord, metadata: JsonRecord, instaComp: JsonRecord): InstaCompAiResult {
  const manual = record(instaComp.manualIdentity);
  const lockedFields = record(record(instaComp.checklistIdentity).lockedFields);
  const ai = record(instaComp.ai);
  const topLevel = record(item.identity);
  const cardId = record(metadata.card_identity);
  const legacyCardId = record(metadata.cardIdentity);
  const saleId = record(metadata.sale_identity);
  const base =
    instaComp.manualIdentityLocked === true && Object.keys(manual).length > 0
      ? manual
      : Object.keys(lockedFields).length > 0
        ? { ...ai, ...lockedFields }
        : Object.keys(ai).length > 0
          ? ai
          : Object.keys(topLevel).length > 0
            ? topLevel
            : Object.keys(cardId).length > 0
              ? cardId
              : Object.keys(legacyCardId).length > 0
                ? legacyCardId
                : Object.keys(saleId).length > 0
                  ? saleId
                  : parseIdentityFromTitle(item.title, item.sport);
  const normalizedPlayer = text((base as JsonRecord).player) || text((base as JsonRecord).playerName);
  const normalizedCardNumber = text((base as JsonRecord).cardNumber) || text((base as JsonRecord).card_number);
  const normalizedSet = text((base as JsonRecord).setName) || text((base as JsonRecord).set_name) || text((base as JsonRecord).product) || text((base as JsonRecord).brand);
  if (!normalizedPlayer || !text((base as JsonRecord).year) || !normalizedCardNumber) {
    const fallback = parseIdentityFromTitle(item.title, item.sport);
    return {
      ...fallback,
      ...base,
      player: normalizedPlayer || fallback.player,
      year: text((base as JsonRecord).year) || fallback.year,
      cardNumber: normalizedCardNumber || fallback.cardNumber,
      setName: normalizedSet || fallback.setName,
    } as InstaCompAiResult;
  }
  return {
    ...base,
    player: normalizedPlayer,
    cardNumber: normalizedCardNumber,
    setName: normalizedSet,
  } as InstaCompAiResult;
}

function usableIdentity(ai: InstaCompAiResult) {
  return Boolean(
    text(ai.player) &&
      text(ai.year) &&
      text(ai.cardNumber) &&
      (text(ai.setName) || text(ai.brand) || text(ai.product)),
  );
}

function trustedIdentity(item: JsonRecord, instaComp: JsonRecord, ai: InstaCompAiResult) {
  const checklist = record(instaComp.checklistIdentity);
  const status = String(checklist.status || "").toLowerCase();
  return (
    item.manualIdentityLocked === true ||
    item.humanVerified === true ||
    instaComp.manualIdentityLocked === true ||
    instaComp.humanVerified === true ||
    instaComp.trustedForIdentity === true ||
    instaComp.identityComplete === true ||
    status === "identified" ||
    status === "exact_match" ||
    usableIdentity(ai)
  );
}

function uniquePhysicalCopy(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const asset = record(metadata.collectible_asset);
  const instaComp = record(metadata.instacomp);
  const ai = record(instaComp.manualIdentityLocked === true ? instaComp.manualIdentity : instaComp.ai);
  return Boolean(
    text(asset.exact_serial_number) ||
      text(asset.grading_cert_number) ||
      text(ai.serialNumber) ||
      text(ai.certificationNumber) ||
      text(ai.gradingCertNumber),
  );
}

function pricingPatch(instaComp: JsonRecord, source: JsonRecord) {
  return {
    ...instaComp,
    marketPrice: source.marketPrice,
    suggestedPrice: source.suggestedPrice,
    pricingStatus: source.pricingStatus,
    pricingReason: source.pricingReason,
    pricingAnalysis: source.pricingAnalysis,
    reliableSoldCompCount: source.reliableSoldCompCount,
    trustedForPricing: source.trustedForPricing,
    soldCompEvidence: source.soldCompEvidence,
    activeCompetition: source.activeCompetition,
    activePricingEvidenceCount: source.activePricingEvidenceCount,
    providerCoverage: source.providerCoverage,
    exactMarketQueries: source.exactMarketQueries,
    fastMarketLane: source.fastMarketLane,
    pricingCheckedAt: source.pricingCheckedAt,
  };
}

async function macSoldOnly(params: {
  title: string;
  ai: InstaCompAiResult;
  instaComp: JsonRecord;
}) {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key) throw new Error("Mac-local InstaComp market service is not configured.");
  const response = await fetch(`${baseUrl}/v1/market-comp/search`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-InstaComp-AI-Key": key,
    },
    body: JSON.stringify({
      exact_title: params.title,
      identity: params.ai,
      scan_id: text(params.instaComp.scanId),
      registry_identity_id:
        text(record(params.instaComp.checklistIdentity).registryIdentityId) ||
        text(record(params.instaComp.checklistIdentity).identityId) ||
        text(record(params.instaComp.ai).checklistIdentityId) ||
        null,
      operator_certified_identity:
        params.instaComp.manualIdentityLocked === true || params.instaComp.humanVerified === true,
      include_130point: false,
      include_active: true,
      include_fanatics: false,
      max_sold: 50,
      max_active: 30,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok || payload.ok !== true) {
    throw new Error(String(payload.detail || payload.error || `Mac eBay sold search failed (${response.status}).`));
  }
  return payload;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const automaticVerifiedPricing = trustedVerifiedCsvPricingWorker(request);
    const account = automaticVerifiedPricing ? null : await getAuthenticatedAccountFromRequest(request);
    if (!account && !automaticVerifiedPricing) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    if (account) await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json({ success: false, error: "Choose a pending card to price." }, { status: 400 });
    }

    const owner = Boolean(account && ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    ));
    const item = await getMacMasterListingRow(inventoryItemId);
    if (!item) return NextResponse.json({ success: false, error: "Pending card was not found." }, { status: 404 });
    if (automaticVerifiedPricing && !hasVerifiedCsvAuthority(item.metadata)) {
      return NextResponse.json({ success: false, error: "Automated pricing only permits seller-certified CSV cards." }, { status: 403 });
    }
    const sellerAccountId = String(item.seller_account_id ?? item.sellerAccountId ?? "").trim();
    if (!automaticVerifiedPricing && !owner && sellerAccountId && sellerAccountId !== account?.id) {
      return NextResponse.json({ success: false, error: "Pending card was not found." }, { status: 404 });
    }

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const ai = resolveItemIdentity(item, metadata, instaComp);
    if (!trustedIdentity(item, instaComp, ai) || !usableIdentity(ai)) {
      return NextResponse.json(
        { success: false, error: "Exact or operator-confirmed identity is required before fast eBay pricing." },
        { status: 409 },
      );
    }

    const exactTitle = String(item.title || "").trim();
    const primaryQuery = buildInstaCompQueries(ai).primary || exactTitle;
    const [soldPayload, activeProvider] = await Promise.all([
      macSoldOnly({ title: exactTitle, ai, instaComp }),
      getOfficialEbayActiveExactProvider({ query: primaryQuery, ai, limit: 20 }),
    ]);
    const sold = evidenceList(soldPayload.sold);
    const pricingSold = sold.filter((row) => pricingEligible(row, "sold"));

    const macActive = evidenceList(soldPayload.active);
    const browseActive = evidenceList(activeProvider.results);
    const seenActiveUrls = new Set<string>();
    const active: Evidence[] = [];
    for (const row of [...browseActive, ...macActive]) {
      const key = row.url.split("?")[0].toLowerCase();
      if (seenActiveUrls.has(key)) continue;
      seenActiveUrls.add(key);
      active.push(row);
    }
    active.sort((a, b) => a.price - b.price);
    const pricingActive = active.filter((row) => pricingEligible(row, "active"));
    const pricingAnalysis = calculateInstaCompSweetSpot({ sold: pricingSold, active: pricingActive });
    const suggestedPrice = pricingSold.length > 0 ? pricingAnalysis.suggestedPrice : 0;
    const checkedAt = new Date().toISOString();
    const pricingStatus = suggestedPrice > 0
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = suggestedPrice > 0
      ? pricingAnalysis.explanation
      : "No pricing-eligible exact eBay sold comp was available. Active listings are guidance only; seller pricing is required.";

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason,
        pricingAnalysis,
        reliableSoldCompCount: pricingSold.length,
        trustedForPricing: pricingSold.length > 0,
        soldCompEvidence: sold,
        activeCompetition: active,
        activePricingEvidenceCount: pricingActive.length,
        providerCoverage: [
          ...(Array.isArray(soldPayload.providerCoverage)
            ? soldPayload.providerCoverage.map((row: unknown) => providerCoverage(record(row)))
            : []),
          providerCoverage(record(activeProvider)),
        ],
        exactMarketQueries: Array.from(new Set([exactTitle, primaryQuery].filter(Boolean))),
        fastMarketLane: {
          schema: "truely.instacomp.fast-ebay-market.v1",
          soldSource: "eBay sold · Mac Chrome",
          activeSource: "eBay official Browse API",
          minimumExactSoldBeforeActiveSkip: 0,
          activeSearchSkipped: false,
          point130Enabled: false,
          fanaticsEnabled: false,
        },
        pricingCheckedAt: checkedAt,
      },
    };

    const fastPricing = record(nextMetadata.instacomp);
    const groupKey = effectiveInstaCompPricingGroupKey(nextMetadata) || "";
    const autoPrice = suggestedPrice > 0 && Number(item.price || 0) <= 0;
    const applyGroup = !automaticVerifiedPricing && autoPrice && Boolean(groupKey) && !uniquePhysicalCopy(nextMetadata);
    let priceUpdatedCount = 0;
    let grouped = false;

    if (autoPrice) {
      let candidates: Array<JsonRecord> = [item];
      if (applyGroup) {
        const masterRows = await listMacMasterListingRows({ compact: false, timeoutMs: 15_000 });
        candidates = masterRows.filter((candidate) => {
          const candidateSeller = String(candidate.seller_account_id ?? candidate.sellerAccountId ?? "").trim();
          return (
            (owner || !candidateSeller || candidateSeller === account?.id) &&
            effectiveInstaCompPricingGroupKey(candidate.metadata) === groupKey
          );
        });
        grouped = candidates.length > 1;
      }

      const edits = candidates.map((candidate) => {
        const candidateId = String(candidate.id ?? candidate.inventoryItemId ?? candidate.inventory_item_id ?? "").trim();
        const candidateMetadata: JsonRecord = candidateId === inventoryItemId ? record(nextMetadata) : record(candidate.metadata);
        const candidateInstaComp = record(candidateMetadata.instacomp);
        const mergedInstaComp = pricingPatch(candidateInstaComp, fastPricing);
        const candidateAlreadyPriced = Number(candidate.price || 0) > 0;
        const promotion = listingPromotionFromMetadata(candidateMetadata);
        const effectivePrice = promotion.onSale
          ? discountedListingPrice(suggestedPrice, promotion.discountPercent) || suggestedPrice
          : suggestedPrice;
        const promo = record(candidateMetadata.tcos_promo);
        const pricedMetadata = {
          ...candidateMetadata,
          ...(promotion.onSale && !candidateAlreadyPriced
            ? {
                tcos_promo: {
                  ...promo,
                  original_price: suggestedPrice,
                  sale_price: effectivePrice,
                },
              }
            : {}),
          instacomp: {
            ...mergedInstaComp,
            ...(candidateAlreadyPriced
              ? {}
              : {
                  listingPrice: effectivePrice,
                  pricingGroupBasePrice: suggestedPrice,
                  listingPriceSource: "instacomp_fast_ebay",
                  pricingChosenAt: checkedAt,
                  pricingGroupKey: groupKey || null,
                }),
          },
        };
        if (!candidateAlreadyPriced) priceUpdatedCount += 1;
        return {
          inventoryItemId: candidateId,
          edit: candidateAlreadyPriced
            ? { metadata: pricedMetadata, updatedAt: checkedAt }
            : { price: effectivePrice, metadata: pricedMetadata, updatedAt: checkedAt },
        };
      }).filter((entry) => Boolean(entry.inventoryItemId));
      await updateMacKingmakerDrafts(edits, 20_000);
    } else {
      await updateMacKingmakerDrafts(
        [{
          inventoryItemId,
          edit: { metadata: nextMetadata, updatedAt: checkedAt },
        }],
        15_000,
      );
    }

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      title: exactTitle,
      suggestedPrice,
      pricingStatus,
      pricingReason,
      pricingAnalysis,
      reliableSoldCompCount: pricingSold.length,
      exactCompCount: pricingSold.length,
      soldCompEvidence: sold,
      activeCompetition: active,
      activeSearchSkipped: false,
      minimumExactSoldBeforeActiveSkip: 0,
      priceSaveRecommended: false,
      draftPriceSaved: priceUpdatedCount > 0,
      priceUpdatedCount,
      groupedPriceSave: grouped,
      existingDraftPricePreserved: suggestedPrice > 0 && Number(item.price || 0) > 0,
      durationMs: Date.now() - startedAt,
      nothingPublished: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Fast eBay InstaComp pricing failed.",
      },
      { status: 500 },
    );
  }
}
