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
        { error: "InstaComp returned an unreadable response.", details: scanText.slice(0, 1000) },
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

    const existingInstaComp = recordValue(metadata.instacomp);
    const suggestedPrice =
      Number(scan?.stats?.suggestedPrice || scan?.stats?.median || 0) || null;
    const providerCoverage = Array.isArray(scan?.providers)
      ? scan.providers.map((provider: any) => ({
          source: provider?.source || null,
          label: provider?.label || null,
          status: provider?.status || null,
          resultCount: Array.isArray(provider?.results) ? provider.results.length : 0,
          message: provider?.message || null,
        }))
      : [];
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...existingInstaComp,
        schema: "truely.instacompInventoryScan.v1",
        source: "seller_inventory_action",
        scanId: scan.scanId || null,
        humanVerified: existingInstaComp.humanVerified === true,
        trustedForIdentity:
          scan?.consensus?.trustedForIdentity === true ||
          scan?.review?.trustedForPricing === true,
        hasBackImage: files.length >= 2,
        marketPrice: suggestedPrice,
        listingPrice: existingInstaComp.listingPrice || null,
        listingPriceSource: existingInstaComp.listingPriceSource || null,
        ai: scan.ai,
        review: scan.review || null,
        providerCoverage,
        searchQuery: scan.searchQuery || null,
        scannedAt: new Date().toISOString(),
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    const exactCompCount = Array.isArray(scan.marketValueComps)
      ? scan.marketValueComps.length
      : 0;
    const failedProviders = providerCoverage.filter(
      (provider: any) => provider.status === "error" || provider.status === "not_configured",
    );

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      sku: item.sku,
      title: item.title,
      scanId: scan.scanId || null,
      ai: scan.ai,
      review: scan.review || null,
      suggestedPrice,
      exactCompCount,
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
