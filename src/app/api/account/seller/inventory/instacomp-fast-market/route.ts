import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

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

function identityAi(instaComp: JsonRecord) {
  const manual = record(instaComp.manualIdentity);
  const ai = record(instaComp.ai);
  return (instaComp.manualIdentityLocked === true ? manual : ai) as InstaCompAiResult;
}

function usableIdentity(ai: InstaCompAiResult) {
  return Boolean(
    text(ai.player) &&
      text(ai.year) &&
      text(ai.cardNumber) &&
      (text(ai.setName) || text(ai.brand) || text(ai.product)),
  );
}

function trustedIdentity(instaComp: JsonRecord) {
  const checklist = record(instaComp.checklistIdentity);
  const status = String(checklist.status || "").toLowerCase();
  return (
    instaComp.manualIdentityLocked === true ||
    instaComp.humanVerified === true ||
    instaComp.trustedForIdentity === true ||
    instaComp.identityComplete === true ||
    status === "identified" ||
    status === "exact_match"
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
      include_active: false,
      include_fanatics: false,
      max_sold: 50,
      max_active: 1,
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
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json({ success: false, error: "Choose a pending card to price." }, { status: 400 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const owner = ["sales@truelycollectables.com", "sales@trulycollectables.com"].includes(
      String(account.email || "").toLowerCase(),
    );
    let query = supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,title,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    query = owner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await query.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ success: false, error: "Pending card was not found." }, { status: 404 });

    const metadata = record(item.metadata);
    const instaComp = record(metadata.instacomp);
    const ai = identityAi(instaComp);
    if (!trustedIdentity(instaComp) || !usableIdentity(ai)) {
      return NextResponse.json(
        { success: false, error: "Exact or operator-confirmed identity is required before fast eBay pricing." },
        { status: 409 },
      );
    }

    const exactTitle = String(item.title || "").trim();
    const soldPayload = await macSoldOnly({ title: exactTitle, ai, instaComp });
    const sold = evidenceList(soldPayload.sold);
    const pricingSold = sold.filter((row) => pricingEligible(row, "sold"));
    const primaryQuery = buildInstaCompQueries(ai).primary || exactTitle;

    const activeProvider = pricingSold.length >= MIN_EXACT_SOLD
      ? {
          source: "ebay_active",
          label: "eBay Active · Official Browse API",
          status: "skipped",
          message: `Skipped because ${pricingSold.length} exact sold comps met the ${MIN_EXACT_SOLD}-sale fast-lane threshold.`,
          results: [],
          searchUrl: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(primaryQuery)}`,
        }
      : await getOfficialEbayActiveExactProvider({ query: primaryQuery, ai, limit: 12 });
    const active = evidenceList(activeProvider.results);
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
          minimumExactSoldBeforeActiveSkip: MIN_EXACT_SOLD,
          activeSearchSkipped: pricingSold.length >= MIN_EXACT_SOLD,
          point130Enabled: false,
          fanaticsEnabled: false,
        },
        pricingCheckedAt: checkedAt,
      },
    };

    const fastPricing = record(nextMetadata.instacomp);
    const groupKey = effectiveInstaCompPricingGroupKey(nextMetadata) || "";
    const autoPrice = suggestedPrice > 0 && Number(item.price || 0) <= 0;
    const applyGroup = autoPrice && Boolean(groupKey) && !uniquePhysicalCopy(nextMetadata);
    let priceUpdatedCount = 0;
    let grouped = false;

    if (autoPrice) {
      let candidates: Array<JsonRecord> = [item];
      if (applyGroup) {
        let groupQuery = supabase
          .from("inventory_items")
          .select("id,legacy_product_id,seller_account_id,price,metadata")
          .eq("store_id", storeId);
        groupQuery = owner
          ? groupQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
          : groupQuery.eq("seller_account_id", account.id);
        const { data: ownedRows, error: groupReadError } = await groupQuery.range(0, 4999);
        if (groupReadError) throw groupReadError;
        candidates = (ownedRows || []).filter(
          (candidate) => effectiveInstaCompPricingGroupKey(candidate.metadata) === groupKey,
        );
        grouped = candidates.length > 1;
      }

      for (const candidate of candidates) {
        const candidateMetadata: JsonRecord = candidate.id === item.id ? record(nextMetadata) : record(candidate.metadata);
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
        const updatePayload = candidateAlreadyPriced
          ? { metadata: pricedMetadata, updated_at: checkedAt }
          : { price: effectivePrice, metadata: pricedMetadata, updated_at: checkedAt };
        const { error: candidateUpdateError } = await supabase
          .from("inventory_items")
          .update(updatePayload)
          .eq("id", candidate.id)
          .eq("store_id", storeId);
        if (candidateUpdateError) throw candidateUpdateError;
        if (!candidateAlreadyPriced) {
          priceUpdatedCount += 1;
          if (candidate.legacy_product_id) {
            const { error: productError } = await supabase
              .from("products")
              .update({ price: effectivePrice })
              .eq("store_id", storeId)
              .eq("id", candidate.legacy_product_id);
            if (productError) throw productError;
          }
        }
      }
    } else {
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update({ metadata: nextMetadata, updated_at: checkedAt })
        .eq("id", item.id)
        .eq("store_id", storeId);
      if (updateError) throw updateError;
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
      activeSearchSkipped: pricingSold.length >= MIN_EXACT_SOLD,
      minimumExactSoldBeforeActiveSkip: MIN_EXACT_SOLD,
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
