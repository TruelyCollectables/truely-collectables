import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { loadSellerEbayInventoryPreview } from "../../../../../../../lib/seller-ebay";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function sellerMarketplaceImportPreviewHeaders(params: {
  status: "loaded" | "blocked" | "failed";
  requestedLimit: number;
  sampledCount: number;
  totalAvailable: number | null;
  hasMore: boolean;
  writeBlocked: boolean;
  readyToStageCount: number;
  needsReviewCount: number;
  missingSkuCount: number;
  missingListingIdCount: number;
  missingPriceCount: number;
  missingImageCount: number;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Import-Preview-Status": params.status,
    "X-TCOS-Seller-Marketplace-Import-Preview-Requested-Limit": String(
      params.requestedLimit,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Sampled": String(
      params.sampledCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Total-Available":
      params.totalAvailable === null ? "unknown" : String(params.totalAvailable),
    "X-TCOS-Seller-Marketplace-Import-Preview-Has-More": params.hasMore
      ? "true"
      : "false",
    "X-TCOS-Seller-Marketplace-Import-Preview-Write-Blocked":
      params.writeBlocked ? "true" : "false",
    "X-TCOS-Seller-Marketplace-Import-Preview-Ready": String(
      params.readyToStageCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Needs-Review": String(
      params.needsReviewCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-SKU": String(
      params.missingSkuCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Listing-ID": String(
      params.missingListingIdCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Price": String(
      params.missingPriceCount,
    ),
    "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Image": String(
      params.missingImageCount,
    ),
  };
}

function summarizeImportPreviewItems(
  sampleItems: Array<{
    sku?: string | null;
    listingId?: string | null;
    price?: number | null;
    imageUrl?: string | null;
    reviewRequired?: boolean;
  }>,
) {
  return sampleItems.reduce(
    (summary, item) => {
      const hasSku = Boolean(item.sku);
      const hasListingId = Boolean(item.listingId);
      const hasPrice = typeof item.price === "number" && item.price > 0;
      const hasImage = Boolean(item.imageUrl);
      const needsReview = Boolean(item.reviewRequired) || !hasSku || !hasListingId;

      if (!hasSku) summary.missingSkuCount += 1;
      if (!hasListingId) summary.missingListingIdCount += 1;
      if (!hasPrice) summary.missingPriceCount += 1;
      if (!hasImage) summary.missingImageCount += 1;
      if (needsReview) {
        summary.needsReviewCount += 1;
      } else {
        summary.readyToStageCount += 1;
      }

      return summary;
    },
    {
      readyToStageCount: 0,
      needsReviewCount: 0,
      missingSkuCount: 0,
      missingListingIdCount: 0,
      missingPriceCount: 0,
      missingImageCount: 0,
    },
  );
}

export async function GET(request: Request) {
  let requestedLimit = 5;

  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") || "5");
    requestedLimit = Number.isFinite(limit) && limit > 0 ? limit : 5;
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const preview = await loadSellerEbayInventoryPreview({
      supabase,
      accountId: account.id,
      storeId,
      limit: requestedLimit,
    });
    const summary = summarizeImportPreviewItems(preview.sampleItems);

    return Response.json({
      success: true,
      preview,
    }, {
      headers: sellerMarketplaceImportPreviewHeaders({
        status: preview.writeBlocked ? "blocked" : "loaded",
        requestedLimit,
        sampledCount: preview.sampled,
        totalAvailable: preview.totalAvailable,
        hasMore: preview.hasMore,
        writeBlocked: preview.writeBlocked,
        ...summary,
      }),
    });
  } catch (error: any) {
    const message =
      error.message || "Could not load seller eBay inventory preview";

    return Response.json(
      { error: message },
      {
        status: message.includes("disabled") ? 403 : 500,
        headers: sellerMarketplaceImportPreviewHeaders({
          status: message.includes("disabled") ? "blocked" : "failed",
          requestedLimit,
          sampledCount: 0,
          totalAvailable: null,
          hasMore: false,
          writeBlocked: message.includes("disabled"),
          readyToStageCount: 0,
          needsReviewCount: 0,
          missingSkuCount: 0,
          missingListingIdCount: 0,
          missingPriceCount: 0,
          missingImageCount: 0,
        }),
      },
    );
  }
}
