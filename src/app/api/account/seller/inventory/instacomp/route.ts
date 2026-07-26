import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  buildInstaCompQueries,
  type InstaCompAiResult,
} from "../../../../../../lib/instacomp";
import { verifyInstaCompCompetitionImages } from "../../../../../../lib/instacomp-comp-visual-verification";
import { getExactEbayMarketProviders } from "../../../../../../lib/instacomp-exact-market-provider";
import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";
import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";
import { POST as runInstaCompScan } from "../../../../instacomp/scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_SCAN_BYTES = 18 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 250)
    : [];
}

function hasUsableStoredIdentity(ai: Record<string, unknown>) {
  return Boolean(
    String(ai.player || "").trim() &&
      String(ai.year || "").trim() &&
      String(ai.setName || ai.brand || "").trim() &&
      String(ai.cardNumber || "").trim(),
  );
}

function imageType(url: string, responseType: string | null) {
  const normalized = String(responseType || "").split(";")[0].trim().toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(normalized)) return normalized;
  if (/\.png(?:\?|$)/i.test(url)) return "image/png";
  if (/\.webp(?:\?|$)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

function imageExtension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

async function downloadImage(url: string, index: number) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp-ExactMarket/1.0" },
  });
  if (!response.ok) throw new Error(`Image ${index + 1} returned HTTP ${response.status}.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(url, response.headers.get("content-type"));
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, { type });
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
    sourceLabel: typeof row.sourceLabel === "string" ? row.sourceLabel : "Unknown source",
    sourceCategory: typeof row.sourceCategory === "string" ? row.sourceCategory : "broad",
    matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : null,
    flags: Array.isArray(row.flags) ? row.flags.map((flag) => String(flag)).slice(0, 20) : [],
    soldAt: typeof row.soldAt === "string" ? row.soldAt : null,
    listedAt: typeof row.listedAt === "string" ? row.listedAt : null,
    observedAt: typeof row.observedAt === "string" ? row.observedAt : null,
  };
}

function evidenceList(value: unknown, limit = 50) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizedEvidence)
    .filter((row): row is Evidence => Boolean(row))
    .slice(0, limit);
}

function dedupeEvidence(values: Evidence[], limit: number) {
  const seen = new Set<string>();
  return values
    .filter((row) => {
      if (seen.has(row.url)) return false;
      seen.add(row.url);
      return true;
    })
    .slice(0, limit);
}

function isExcludedEvidence(row: Evidence) {
  return row.flags.some((flag) =>
    /excluded|guidance comp|not used for pricing|parallel mismatch|not exact parallel|visual mismatch|inconclusive|unavailable/i.test(
      flag,
    ),
  );
}

function forceImageVerification(values: Evidence[]) {
  return values.map((row) => ({
    ...row,
    flags: Array.from(new Set([...row.flags, "guidance comp", "strict exact title awaiting image proof"])).slice(
      0,
      20,
    ),
  }));
}

function providerCoverageRow(provider: {
  source: string;
  label: string;
  status: string;
  message: string | null;
  results: unknown[];
  searchUrl?: string;
  attempts?: unknown[];
}) {
  return {
    source: provider.source,
    label: provider.label,
    status: provider.status,
    resultCount: provider.results.length,
    message: provider.message,
    searchUrl: provider.searchUrl || null,
    attempts: Array.isArray(provider.attempts) ? provider.attempts : [],
  };
}

async function scanIdentity(params: {
  request: NextRequest;
  files: File[];
  aiCouncilTier: string;
}) {
  const formData = new FormData();
  formData.set("frontImage", params.files[0]);
  if (params.files[1]) formData.set("backImage", params.files[1]);
  for (const detail of params.files.slice(2, 8)) formData.append("detailImages", detail);
  formData.set("aiCouncilTier", params.aiCouncilTier);
  const authorization = params.request.headers.get("authorization") || "";
  const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
    body: formData,
  });
  const response = await runInstaCompScan(scanRequest);
  const text = await response.text();
  let scan: any;
  try {
    scan = JSON.parse(text);
  } catch {
    throw new Error(`InstaComp returned an unreadable response: ${text.slice(0, 300)}`);
  }
  if (!response.ok || scan?.ok !== true || !scan?.ai) {
    throw new Error(scan?.error || "InstaComp could not identify this inventory item.");
  }
  return scan;
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
      return NextResponse.json({ error: "Choose a seller inventory item to scan." }, { status: 400 });
    }

    const scanStartedAt = Date.now();
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let itemQuery = supabase
      .from("inventory_items")
      .select("id,legacy_product_id,seller_account_id,sku,title,status,quantity,price,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    itemQuery = isStoreOwnerAccount
      ? itemQuery.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : itemQuery.eq("seller_account_id", account.id);
    const { data: item, error: itemError } = await itemQuery.maybeSingle();
    if (itemError) throw itemError;
    if (!item) return NextResponse.json({ error: "Seller inventory item was not found." }, { status: 404 });

    const [{ data: product, error: productError }, { data: imageRows, error: imageError }] =
      await Promise.all([
        item.legacy_product_id
          ? supabase
              .from("products")
              .select("id,image_url")
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
    if (productError) throw productError;
    if (imageError) throw imageError;

    let metadata = recordValue(item.metadata);
    let currentInstaComp = recordValue(metadata.instacomp);
    const storedAi = recordValue(currentInstaComp.ai);
    const trustedStoredIdentity =
      currentInstaComp.humanVerified === true || currentInstaComp.trustedForIdentity === true;
    const useStoredIdentity =
      body?.forceIdentityRescan !== true && trustedStoredIdentity && hasUsableStoredIdentity(storedAi);

    const sourceUrls = normalizeListingImageUrls([
      ...(imageRows || []).map((row: any) => row.image_url),
      product?.image_url,
      ...(Array.isArray(metadata.ebay_image_urls) ? metadata.ebay_image_urls : []),
    ]);
    if (!sourceUrls.length) {
      return NextResponse.json({ error: "This inventory item has no usable card images." }, { status: 409 });
    }

    const files: File[] = [];
    let totalBytes = 0;
    const imageLimit = useStoredIdentity ? 2 : 8;
    for (const [index, url] of sourceUrls.slice(0, imageLimit).entries()) {
      try {
        const file = await downloadImage(url, index);
        if (totalBytes + file.size > MAX_TOTAL_SCAN_BYTES) break;
        files.push(file);
        totalBytes += file.size;
      } catch (error) {
        if (index === 0) throw error;
      }
    }
    if (!files.length) throw new Error("The primary card image could not be downloaded.");

    let ai: InstaCompAiResult;
    let scanId: string | null = String(currentInstaComp.scanId || "").trim() || null;
    let review: unknown = currentInstaComp.review || null;
    let identitySource = "stored_human_verified_identity";
    if (useStoredIdentity) {
      ai = storedAi as InstaCompAiResult;
    } else {
      const scan = await scanIdentity({
        request,
        files,
        aiCouncilTier: typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : "adaptive",
      });
      ai = scan.ai as InstaCompAiResult;
      scanId = scan.scanId || null;
      review = scan.review || null;
      identitySource = "fresh_image_scan";
      const { data: refreshedItem, error: refreshError } = await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", item.id)
        .eq("store_id", storeId)
        .maybeSingle();
      if (refreshError) throw refreshError;
      metadata = recordValue(refreshedItem?.metadata || metadata);
      currentInstaComp = recordValue(metadata.instacomp);
    }

    const fallbackQuery = buildInstaCompQueries(ai).primary;
    const market = await getExactEbayMarketProviders({
      exactTitle: item.title,
      fallbackQuery,
      ai,
    });
    const soldCandidates = forceImageVerification(evidenceList(market.sold.results, 50));
    const activeCandidates = forceImageVerification(evidenceList(market.active.results, 30));
    const [soldReview, activeReview] = await Promise.all([
      verifyInstaCompCompetitionImages({
        targetFrontImage: files[0],
        targetAi: ai,
        candidates: soldCandidates,
      }),
      verifyInstaCompCompetitionImages({
        targetFrontImage: files[0],
        targetAi: ai,
        candidates: activeCandidates,
      }),
    ]);

    const excludedCompUrls = new Set(stringList(currentInstaComp.excludedCompUrls));
    const soldCompEvidence = dedupeEvidence(
      evidenceList(soldReview.accepted, 50).filter(
        (row) => row.sourceCategory === "sold" && !isExcludedEvidence(row),
      ),
      50,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const activeCompetition = dedupeEvidence(
      evidenceList(activeReview.accepted, 30).filter(
        (row) =>
          (row.sourceCategory === "marketplace" || row.sourceCategory === "auction") &&
          !isExcludedEvidence(row),
      ),
      30,
    ).filter((row) => !excludedCompUrls.has(row.url));
    const rejectedCandidates = dedupeEvidence(
      [...evidenceList(soldReview.rejected, 30), ...evidenceList(activeReview.rejected, 30)],
      60,
    );

    const rawPricingAnalysis = calculateInstaCompSweetSpot({
      sold: soldCompEvidence,
      active: activeCompetition,
    });
    const hasReliableSoldComps = rawPricingAnalysis.soldCount > 0;
    const suggestedPrice = hasReliableSoldComps ? rawPricingAnalysis.suggestedPrice : 0;
    const pricingAnalysis = { ...rawPricingAnalysis, suggestedPrice };
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const pricingReason = hasReliableSoldComps
      ? pricingAnalysis.explanation
      : `${pricingAnalysis.explanation} InstaComp will not issue a suggested price without at least one image-verified exact sold listing.`;
    const checkedAt = new Date().toISOString();
    const providerCoverage = [providerCoverageRow(market.sold), providerCoverageRow(market.active)];
    const sourceLinks = {
      ...recordValue(currentInstaComp.sourceLinks),
      ebaySoldUrl: market.sold.searchUrl || null,
      ebayActiveUrl: market.active.searchUrl || null,
    };

    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...currentInstaComp,
        schema: "truely.instacompInventoryScan.v4",
        source: "seller_inventory_exact_market_action",
        scanId,
        humanVerified: currentInstaComp.humanVerified === true,
        trustedForIdentity: useStoredIdentity || currentInstaComp.trustedForIdentity === true,
        identitySource,
        hasBackImage: files.length >= 2 || currentInstaComp.hasBackImage === true,
        ai,
        review,
        exactStoredTitleQuery: market.query,
        exactMarketQueries: market.queries,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason,
        pricingAnalysis,
        reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
        pricingCheckedAt: checkedAt,
        trustedForPricing: hasReliableSoldComps,
        soldCompEvidence,
        activeCompetition,
        rejectedCandidates,
        excludedCompUrls: Array.from(excludedCompUrls),
        excludedCompEvidence: Array.isArray(currentInstaComp.excludedCompEvidence)
          ? currentInstaComp.excludedCompEvidence
          : [],
        providerCoverage,
        sourceLinks,
        exactMarketVisualReview: {
          soldReviewed: soldReview.reviewedCount,
          activeReviewed: activeReview.reviewedCount,
          soldTitleOverrides: soldReview.titleOverrides,
          activeTitleOverrides: activeReview.titleOverrides,
          configured: soldReview.configured && activeReview.configured,
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
      success: true,
      inventoryItemId: item.id,
      sku: item.sku,
      title: item.title,
      scanId,
      ai,
      review,
      identitySource,
      suggestedPrice,
      pricingStatus,
      pricingReason,
      pricingAnalysis,
      trustedForPricing: hasReliableSoldComps,
      exactCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
      reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
      soldCompEvidence,
      activeCompetition,
      rejectedCandidates,
      sourceLinks,
      providerCoverage,
      providerProblems: providerCoverage.filter(
        (row) => row.status === "error" || row.status === "not_configured",
      ),
      exactMarketQueries: market.queries,
      exactMarketVisualReview: {
        soldReviewed: soldReview.reviewedCount,
        activeReviewed: activeReview.reviewedCount,
        soldTitleOverrides: soldReview.titleOverrides,
        activeTitleOverrides: activeReview.titleOverrides,
      },
      fastLane: useStoredIdentity,
      durationMs: Date.now() - scanStartedAt,
      imageCountUsed: files.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Seller inventory InstaComp exact-market scan failed.",
        code: error?.code || null,
      },
      { status: 500 },
    );
  }
}
