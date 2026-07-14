import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  importSellerEbayOrdersBatch,
  loadSellerEbayOrderImportStatus,
} from "../../../../../../../lib/seller-ebay-orders";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function isMissingOrderSchema(error: { code?: string; message?: string }) {
  const message = String(error.message || "").toLowerCase();
  return (
    error.code === "42P01" ||
    message.includes("seller_marketplace_order")
  );
}

function sellerMarketplaceOrderImportHeaders(params: {
  mode: "status" | "import" | "schema";
  status: "loaded" | "imported" | "blocked" | "failed" | "unavailable";
  orderCount?: number;
  paidCount?: number;
  refundedCount?: number;
  recentOrderCount?: number;
  importedOrderCount?: number;
  importedItemCount?: number;
  inventoryReducedCount?: number;
  soldCount?: number;
  unmatchedItemCount?: number;
  reviewCount?: number;
  failedItemCount?: number;
  hasMore?: boolean;
  resetCursor?: boolean;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Order-Import-Mutation": params.mode,
    "X-TCOS-Seller-Marketplace-Order-Import-Status": params.status,
    "X-TCOS-Seller-Marketplace-Order-Import-Orders": String(
      params.orderCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Paid": String(
      params.paidCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Refunded": String(
      params.refundedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Recent": String(
      params.recentOrderCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Orders": String(
      params.importedOrderCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Items": String(
      params.importedItemCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Inventory-Reduced": String(
      params.inventoryReducedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Sold": String(
      params.soldCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Unmatched": String(
      params.unmatchedItemCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Review": String(
      params.reviewCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Failed-Items": String(
      params.failedItemCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Order-Import-Has-More": params.hasMore
      ? "true"
      : "false",
    "X-TCOS-Seller-Marketplace-Order-Import-Reset-Cursor": params.resetCursor
      ? "true"
      : "false",
  };
}

function unavailableOrderImportResponse() {
  return Response.json(
    { error: "Seller eBay order import is not available until its migration is applied." },
    {
      status: 503,
      headers: sellerMarketplaceOrderImportHeaders({
        mode: "schema",
        status: "unavailable",
      }),
    },
  );
}

async function authenticate(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;

  await ensureAccountStoreMembership({
    accountId: account.id,
    role: "seller",
    status: "active",
  });
  return account;
}

export async function GET(request: Request) {
  try {
    const account = await authenticate(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = await loadSellerEbayOrderImportStatus({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
    });
    return Response.json(
      { success: true, ...status },
      {
        headers: sellerMarketplaceOrderImportHeaders({
          mode: "status",
          status: "loaded",
          orderCount: status.orderCount,
          paidCount: status.paidCount,
          refundedCount: status.refundedCount,
          unmatchedItemCount: status.unmatchedItemCount,
          recentOrderCount: status.recentOrders.length,
        }),
      },
    );
  } catch (error: any) {
    if (isMissingOrderSchema(error)) {
      return unavailableOrderImportResponse();
    }
    return Response.json(
      { error: error.message || "Could not load seller eBay outside orders" },
      {
        status: 500,
        headers: sellerMarketplaceOrderImportHeaders({
          mode: "status",
          status: "failed",
        }),
      },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await authenticate(request);
    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const result = await importSellerEbayOrdersBatch({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
      resetCursor: body.resetCursor === true,
      source: "seller_manual",
    });
    return Response.json(
      { success: true, result },
      {
        headers: sellerMarketplaceOrderImportHeaders({
          mode: "import",
          status: "imported",
          importedOrderCount: result.importedOrderCount,
          importedItemCount: result.importedItemCount,
          inventoryReducedCount: result.inventoryReducedCount,
          soldCount: result.soldCount,
          unmatchedItemCount: result.unmatchedItemCount,
          reviewCount: result.reviewCount,
          failedItemCount: result.failedItemCount,
          hasMore: result.hasMore,
          resetCursor: body.resetCursor === true,
        }),
      },
    );
  } catch (error: any) {
    if (isMissingOrderSchema(error)) {
      return unavailableOrderImportResponse();
    }
    const message = error.message || "Could not import seller eBay orders";
    const status = message.includes("Reconnect eBay") ? 409 : 500;
    return Response.json(
      { error: message },
      {
        status,
        headers: sellerMarketplaceOrderImportHeaders({
          mode: "import",
          status: status === 409 ? "blocked" : "failed",
        }),
      },
    );
  }
}
