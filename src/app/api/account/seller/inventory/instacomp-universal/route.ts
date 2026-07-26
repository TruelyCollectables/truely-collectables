import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { buildInstaCompQueries } from "../../../../../../lib/instacomp";
import { verifyInstaCompCompetitionImages } from "../../../../../../lib/instacomp-comp-visual-verification";
import { getUniversalEbaySerpProviders } from "../../../../../../lib/instacomp-ebay-serp-provider";
import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runLegacySellerInstaComp } from "../instacomp/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

type Evidence = {
  title: string;
  price: number;
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizedEvidence(value: unknown): Evidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const price = Number(row.price);
  const url = typeof row.url === "string" ? row.url.trim() : "";
  if (!Number.isFinite(price) || price <= 0 || !url) return null;
  return {
    title: typeof row.title === "string" ? row.title : "Untitled listing",
    price: Math.round(price * 100) / 100,
    currency: typeof row.currency === "string" ? row.currency : "USD",
    url,
    imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : null,
    source: typeof row.source === "string" ? row.source : "unknown",
    sourceLabel:
      typeof row.sourceLabel === "string" ? row.sourceLabel : "Unknown source",
    sourceCategory:
      typeof row.sourceCategory === "string" ? row.sourceCategory : "broad",
    matchScore: Number.isFinite(Number(row.matchScore))
      ? Number(row.matchScore)
      : null,
    flags: Array.isArray(row.flags)
      ? row.flags.map((flag) => String(flag)).slice(0, 20)
      : [],
    soldAt: typeof row.soldAt === "string" ? row.soldAt : null,
    listedAt: typeof row.listedAt === "string" ? row.listedAt : null,
    observedAt: typeof row.observedAt === "string" ? row.observedAt : null,
  };
}

function evidenceList(value: unknown, limit = 60) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizedEvidence)
    .filter((row): row is Evidence => Boolean(row))
    .slice(0, limit);
}

function isExcluded(row: Evidence) {
  return row.flags.some((flag) =>
    /excluded|guidance comp|not used for pricing|parallel mismatch|not exact parallel|visual mismatch|inconclusive/i.test(
      flag,
    ),
  );
}

function dedupeEvidence(values: Evidence[], limit = 60) {
  const seen = new Set<string>();
  return values
    .filter((row) => {
      const key = row.url || `${row.title}|${row.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function soldSuggestion(values: Evidence[]) {
  const prices = values
    .map((value) => value.price)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);
  if (!prices.length) return 0;
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];
  return Math.round(median * 100) / 100;
}

async function downloadFrontImage(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-Universal/1.0" },
  });
  if (!response.ok) throw new Error(`Target card image returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Target card image was empty or larger than 12MB.");
  }
  const type = String(response.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim();
  return new File([bytes], "target-card.jpg", { type });
}

function asVisualCandidates(values: Evidence[]) {
  return values.map((row) => ({
    ...row,
    sourceCategory: row.sourceCategory,
  }));
}

function providerCoverageRow(provider: {
  source: string;
  label: string;
  status: string;
  message: string | null;
  results: unknown[];
  searchUrl?: string;
}) {
  return {
    source: provider.source,
    label: provider.label,
    status: provider.status,
    resultCount: provider.results.length,
    message: provider.message,
    searchUrl: provider.searchUrl || null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    if (!inventoryItemId) {
      return NextResponse.json(
        { error: "Choose a seller inventory item to scan." },
        { status: 400 },
      );
    }

    const legacyHeaders = new Headers(request.headers);
    legacyHeaders.set("content-type", "application/json");
    legacyHeaders.delete("content-length");
    const legacyRequest = new NextRequest(request.url, {
      method: "POST",
      headers: legacyHeaders,
      body: JSON.stringify(body),
    });
    const legacyResponse = await runLegacySellerInstaComp(legacyRequest);
    const legacyText = await legacyResponse.text();
    let legacy: Record<string, any>;
    try {
      legacy = JSON.parse(legacyText);
    } catch {
      return NextResponse.json(
        { error: "The base InstaComp scan returned an unreadable response." },
        { status: 502 },
      );
    }
    if (!legacyResponse.ok || legacy?.success !== true) {
      return NextResponse.json(legacy, { status: legacyResponse.status || 500 });
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let itemQuery = supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,seller_account_id,sku,title,status,quantity,price,metadata",
      )
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    itemQuery = isStoreOwnerAccount
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) {
      return NextResponse.json(
        { error: "Seller inventory item was not found after scanning." },
        { status: 404 },
      );
    }

    const [{ data: product }, { data: imageRows, error: imageError }] =
      await Promise.all([
        item.legacy_product_id
          ? supabase
              .from("products")
              .select("image_url")
              .eq("id", item.legacy_product_id)
              .eq("store_id", storeId)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("inventory_images")
          .select("image_url,sort_order,is_primary")
          .eq("inventory_item_id", item.id)
          .order("sort_order", { ascending: true }),
      ]);
    if (imageError) throw imageError;

    const metadata = recordValue(item.metadata);
    const targetUrls = normalizeListingImageUrls([
      ...(imageRows || []).map((row: any) => row.image_url),
      product?.image_url,
      ...(Array.isArray(metadata.ebay_image_urls) ? metadata.ebay_image_urls : []),
    ]);
    if (!targetUrls.length) {
      throw new Error("The scanned card has no target image for comp verification.");
    }
    const targetFrontImage = await downloadFrontImage(targetUrls[0]);

    const ai = legacy.ai;
    if (!ai || typeof ai !== "object") {
      throw new Error("The base scan did not return a usable card identity.");
    }
    const fallbackQuery = buildInstaCompQueries(ai).primary;
    const universal = await getUniversalEbaySerpProviders({
      exactTitle: item.title,
      fallbackQuery,
      ai,
    });

    const soldCandidates = evidenceList(universal.sold.results, 50);
    const activeCandidates = evidenceList(universal.active.results, 30);
    const [soldReview, activeReview] = await Promise.all([
      verifyInstaCompCompetitionImages({
        targetFrontImage,
        targetAi: ai,
        candidates: asVisualCandidates(soldCandidates),
      }),
      verifyInstaCompCompetitionImages({
        targetFrontImage,
        targetAi: ai,
        candidates: asVisualCandidates(activeCandidates),
      }),
    ]);

    const universalSold = evidenceList(soldReview.accepted, 50).filter(
      (row) => row.sourceCategory === "sold" && !isExcluded(row),
    );
    const universalActive = evidenceList(activeReview.accepted, 30).filter(
      (row) =>
        (row.sourceCategory === "marketplace" || row.sourceCategory === "auction") &&
        !isExcluded(row),
    );
    const legacySold = evidenceList(legacy.soldCompEvidence, 30).filter(
      (row) => row.sourceCategory === "sold" && !isExcluded(row),
    );
    const legacyActive = evidenceList(legacy.activeCompetition, 30).filter(
      (row) => !isExcluded(row),
    );
    const soldCompEvidence = dedupeEvidence([...universalSold, ...legacySold], 50);
    const activeCompetition = dedupeEvidence(
      universal.active.status === "live" && universalActive.length
        ? universalActive
        : [...universalActive, ...legacyActive],
      30,
    );
    const rejectedCandidates = dedupeEvidence(
      [
        ...evidenceList(soldReview.rejected, 30),
        ...evidenceList(activeReview.rejected, 30),
        ...evidenceList(legacy.rejectedCandidates, 30),
      ],
      60,
    );

    const suggestedPrice = soldSuggestion(soldCompEvidence);
    const reliableSoldCompCount = soldCompEvidence.length;
    const hasReliableSoldComps = reliableSoldCompCount > 0 && suggestedPrice > 0;
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? `${reliableSoldCompCount} exact sold comp${reliableSoldCompCount === 1 ? "" : "s"} passed the universal eBay identity filter. Active listings were not used to calculate the ${suggestedPrice.toFixed(2)} suggestion.`
      : `The universal eBay sold lane returned no accepted exact sale. Seller pricing is required. Sold provider: ${universal.sold.message || universal.sold.status}.`;
    const checkedAt = new Date().toISOString();

    const currentInstaComp = recordValue(metadata.instacomp);
    const existingCoverage = Array.isArray(currentInstaComp.providerCoverage)
      ? currentInstaComp.providerCoverage.filter((row: any) => {
          const source = String(row?.source || "");
          return source !== "ebay_sold_serpapi" && source !== "ebay_active_serpapi";
        })
      : [];
    const providerCoverage = [
      providerCoverageRow(universal.sold),
      providerCoverageRow(universal.active),
      ...existingCoverage,
    ];
    const sourceLinks = {
      ...recordValue(currentInstaComp.sourceLinks),
      ebaySoldUrl: universal.sold.searchUrl || null,
      ebayActiveUrl: universal.active.searchUrl || null,
    };

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...currentInstaComp,
        schema: "truely.instacompInventoryScan.v3",
        exactStoredTitleQuery: universal.query,
        fallbackIdentityQuery: universal.fallbackQuery,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason,
        reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
        pricingCheckedAt: checkedAt,
        trustedForPricing: hasReliableSoldComps,
        soldCompEvidence,
        activeCompetition,
        rejectedCandidates,
        providerCoverage,
        sourceLinks,
        universalEbayReview: {
          soldReviewed: soldReview.reviewedCount,
          activeReviewed: activeReview.reviewedCount,
          soldTitleOverrides: soldReview.titleOverrides,
          activeTitleOverrides: activeReview.titleOverrides,
          model: soldReview.model,
        },
        scannedAt: checkedAt,
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: checkedAt })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return NextResponse.json({
      ...legacy,
      suggestedPrice,
      pricingStatus,
      pricingReason,
      trustedForPricing: hasReliableSoldComps,
      exactCompCount: reliableSoldCompCount,
      reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
      soldCompEvidence,
      activeCompetition,
      rejectedCandidates,
      sourceLinks,
      providerCoverage,
      providerProblems: providerCoverage.filter(
        (row: any) => row.status === "error" || row.status === "not_configured",
      ),
      exactStoredTitleQuery: universal.query,
      fallbackIdentityQuery: universal.fallbackQuery,
      universalEbayReview: {
        soldReviewed: soldReview.reviewedCount,
        activeReviewed: activeReview.reviewedCount,
        soldTitleOverrides: soldReview.titleOverrides,
        activeTitleOverrides: activeReview.titleOverrides,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Universal seller InstaComp scan failed.",
        code: error?.code || null,
      },
      { status: 500 },
    );
  }
}
