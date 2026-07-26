import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function roundedPrice(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : 0;
}

function compactComp(value: any) {
  const price = roundedPrice(value?.price);
  const url = String(value?.url || "").trim();
  if (!price || !url) return null;

  return {
    title: String(value?.title || "Untitled comp").slice(0, 300),
    price,
    currency: String(value?.currency || "USD").slice(0, 12),
    url,
    imageUrl: typeof value?.imageUrl === "string" ? value.imageUrl : null,
    source: String(value?.source || "unknown").slice(0, 100),
    sourceLabel: String(value?.sourceLabel || value?.source || "Source").slice(0, 120),
    sourceCategory: String(value?.sourceCategory || "broad").slice(0, 40),
    matchScore: Number.isFinite(Number(value?.matchScore))
      ? Math.max(0, Math.min(1, Number(value.matchScore)))
      : null,
    flags: Array.isArray(value?.flags)
      ? value.flags.map((flag: unknown) => String(flag).slice(0, 120)).slice(0, 20)
      : [],
    soldAt: typeof value?.soldAt === "string" ? value.soldAt : null,
    listedAt: typeof value?.listedAt === "string" ? value.listedAt : null,
    observedAt: typeof value?.observedAt === "string" ? value.observedAt : null,
  };
}

function compactCompList(values: unknown, limit = 20) {
  if (!Array.isArray(values)) return [];
  return values
    .map(compactComp)
    .filter((value): value is NonNullable<ReturnType<typeof compactComp>> => Boolean(value))
    .slice(0, limit);
}

function isExcludedEvidence(comp: ReturnType<typeof compactComp>) {
  return Boolean(
    comp?.flags.some((flag) =>
      /excluded|guidance comp|not used for pricing/i.test(flag),
    ),
  );
}

function isOwnStoreCompetition(comp: ReturnType<typeof compactComp>) {
  if (!comp) return true;
  if (comp.source.toLowerCase() === "tcos_inventory") return true;
  return comp.flags.some((flag) => /seller listing|own listing|store listing/i.test(flag));
}

async function downloadImage(url: string, index: number) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(25_000),
    headers: { "User-Agent": "TCOS-InstaComp/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Image ${index + 1} returned HTTP ${response.status}.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(`Image ${index + 1} is empty or larger than 12MB.`);
  }
  const type = imageType(url, response.headers.get("content-type"));
  return new File([bytes], `inventory-${index + 1}.${imageExtension(type)}`, {
    type,
  });
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
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
        { error: "Seller inventory item was not found." },
        { status: 404 },
      );
    }

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

    const metadata = recordValue(item.metadata);
    const sourceUrls = normalizeListingImageUrls([
      ...(imageRows || []).map((row: any) => row.image_url),
      product?.image_url,
      ...(Array.isArray(metadata.ebay_image_urls) ? metadata.ebay_image_urls : []),
    ]);
    if (!sourceUrls.length) {
      return NextResponse.json(
        { error: "This inventory item has no usable card images." },
        { status: 409 },
      );
    }

    const files: File[] = [];
    let totalBytes = 0;
    for (const [index, url] of sourceUrls.slice(0, 8).entries()) {
      try {
        const file = await downloadImage(url, index);
        if (totalBytes + file.size > MAX_TOTAL_SCAN_BYTES) break;
        files.push(file);
        totalBytes += file.size;
      } catch (error) {
        if (index === 0) throw error;
      }
    }
    if (!files.length) {
      return NextResponse.json(
        { error: "The primary listing image could not be downloaded." },
        { status: 502 },
      );
    }

    const formData = new FormData();
    formData.set("frontImage", files[0]);
    if (files[1]) formData.set("backImage", files[1]);
    for (const detail of files.slice(2, 8)) formData.append("detailImages", detail);
    formData.set(
      "aiCouncilTier",
      typeof body?.aiCouncilTier === "string" ? body.aiCouncilTier : "adaptive",
    );

    const authorization = request.headers.get("authorization") || "";
    const scanRequest = new NextRequest("http://localhost/api/instacomp/scan", {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
      body: formData,
    });
    const scanResponse = await runInstaCompScan(scanRequest);
    const scanText = await scanResponse.text();
    let scan: any;
    try {
      scan = JSON.parse(scanText);
    } catch {
      return NextResponse.json(
        {
          error: "InstaComp returned an unreadable response.",
          details: scanText.slice(0, 1000),
        },
        { status: 502 },
      );
    }
    if (!scanResponse.ok || scan?.ok !== true) {
      return NextResponse.json(
        {
          error: scan?.error || "InstaComp could not scan this inventory item.",
          details: scan?.details || null,
        },
        { status: scanResponse.status || 500 },
      );
    }

    const providerCoverage = Array.isArray(scan?.providers)
      ? scan.providers.map((provider: any) => ({
          source: provider?.source || null,
          label: provider?.label || null,
          status: provider?.status || null,
          resultCount: Array.isArray(provider?.results) ? provider.results.length : 0,
          message: provider?.message || null,
          searchUrl: typeof provider?.searchUrl === "string" ? provider.searchUrl : null,
        }))
      : [];
    const failedProviders = providerCoverage.filter(
      (provider: any) =>
        provider.status === "error" || provider.status === "not_configured",
    );

    const soldCompEvidence = compactCompList(scan?.soldComps, 20).filter(
      (comp) => comp.sourceCategory === "sold" && !isExcludedEvidence(comp),
    );
    const activeCompetition = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isOwnStoreCompetition(comp),
    );

    const reliableSoldCompCount = soldCompEvidence.length;
    const priceCandidate = roundedPrice(
      scan?.soldStats?.suggestedPrice || scan?.soldStats?.median || 0,
    );
    const trustedForPricing = scan?.review?.trustedForPricing === true;
    const hasReliableSoldComps =
      trustedForPricing && reliableSoldCompCount > 0 && priceCandidate > 0;
    const suggestedPrice = hasReliableSoldComps ? priceCandidate : 0;
    const pricingStatus = hasReliableSoldComps
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const providerFailureSummary = failedProviders
      .slice(0, 3)
      .map(
        (provider: any) =>
          provider.message || `${provider.label || provider.source || "Provider"} unavailable`,
      )
      .join("; ");
    const pricingReason = hasReliableSoldComps
      ? `${reliableSoldCompCount} reliable exact sold comp${reliableSoldCompCount === 1 ? "" : "s"} passed identity and pricing trust checks. Active listings were not used to calculate this price.`
      : providerFailureSummary
        ? `No reliable sold-comp price was available. ${providerFailureSummary} Active listings are shown only as competition. Seller sets the price.`
        : "No reliable sold comps passed the exact-card identity and pricing trust checks. Active listings are shown only as competition. Seller sets the price.";
    const pricingCheckedAt = new Date().toISOString();
    const sourceLinks = {
      ebaySoldUrl: typeof scan?.links?.ebaySoldUrl === "string" ? scan.links.ebaySoldUrl : null,
      ebayActiveUrl:
        typeof scan?.links?.ebayActiveUrl === "string" ? scan.links.ebayActiveUrl : null,
      broadCardMarketUrl:
        typeof scan?.links?.broadCardMarketUrl === "string"
          ? scan.links.broadCardMarketUrl
          : null,
    };

    const existingInstaComp = recordValue(metadata.instacomp);
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...existingInstaComp,
        schema: "truely.instacompInventoryScan.v2",
        source: "seller_inventory_action",
        scanId: scan.scanId || null,
        humanVerified: existingInstaComp.humanVerified === true,
        trustedForIdentity:
          scan?.consensus?.trustedForIdentity === true ||
          scan?.review?.trustedForPricing === true,
        hasBackImage: files.length >= 2,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason,
        reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
        pricingCheckedAt,
        trustedForPricing: hasReliableSoldComps,
        listingPrice: existingInstaComp.listingPrice ?? null,
        listingPriceSource: existingInstaComp.listingPriceSource ?? null,
        ai: scan.ai,
        review: scan.review || null,
        providerCoverage,
        soldCompEvidence,
        activeCompetition,
        sourceLinks,
        searchQuery: scan.searchQuery || null,
        scannedAt: pricingCheckedAt,
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: pricingCheckedAt })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      sku: item.sku,
      title: item.title,
      scanId: scan.scanId || null,
      ai: scan.ai,
      review: scan.review || null,
      suggestedPrice,
      pricingStatus,
      pricingReason,
      trustedForPricing: hasReliableSoldComps,
      exactCompCount: reliableSoldCompCount,
      reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
      soldCompEvidence,
      activeCompetition,
      sourceLinks,
      providerCoverage,
      providerProblems: failedProviders,
      imageCountUsed: files.length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error?.message || "Seller inventory InstaComp scan failed.",
        code: error?.code || null,
      },
      { status: 500 },
    );
  }
}
