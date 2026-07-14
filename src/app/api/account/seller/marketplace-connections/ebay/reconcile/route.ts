import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  loadSellerEbayReconciliationStatus,
  reconcileSellerEbayInventoryBatch,
} from "../../../../../../../lib/seller-ebay-reconciliation";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function isMissingReconciliationSchema(error: {
  code?: string;
  message?: string;
}) {
  const message = String(error.message || "").toLowerCase();

  return (
    error.code === "42P01" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    message.includes("seller_marketplace_reconciliation") ||
    message.includes("tcos_apply_seller_ebay_quantity_ceiling")
  );
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller eBay reconciliation is unavailable until the reconciliation migration is applied.",
    },
    {
      status: 503,
      headers: sellerMarketplaceReconciliationHeaders({
        mode: "schema",
        status: "unavailable",
      }),
    },
  );
}

function sellerMarketplaceReconciliationHeaders(params: {
  mode: "status" | "run" | "schema";
  status: "loaded" | "completed" | "processing" | "failed" | "blocked" | "unavailable";
  linkedCount?: number;
  recentRunCount?: number;
  latestScannedCount?: number;
  matchedCount?: number;
  quantityReducedCount?: number;
  soldCount?: number;
  reviewCount?: number;
  failedCount?: number;
  hasMore?: boolean;
  resetCursor?: boolean;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Reconcile-Mutation": params.mode,
    "X-TCOS-Seller-Marketplace-Reconcile-Status": params.status,
    "X-TCOS-Seller-Marketplace-Reconcile-Linked": String(
      params.linkedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Recent-Runs": String(
      params.recentRunCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Scanned": String(
      params.latestScannedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Matched": String(
      params.matchedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Quantity-Reduced": String(
      params.quantityReducedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Sold": String(params.soldCount || 0),
    "X-TCOS-Seller-Marketplace-Reconcile-Review": String(
      params.reviewCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Failed": String(
      params.failedCount || 0,
    ),
    "X-TCOS-Seller-Marketplace-Reconcile-Has-More": params.hasMore
      ? "true"
      : "false",
    "X-TCOS-Seller-Marketplace-Reconcile-Reset-Cursor": params.resetCursor
      ? "true"
      : "false",
  };
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

    const status = await loadSellerEbayReconciliationStatus({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
    });
    const latestRun = status.latestRun;

    return Response.json(
      { success: true, ...status },
      {
        headers: sellerMarketplaceReconciliationHeaders({
          mode: "status",
          status: "loaded",
          linkedCount: status.linkedCount,
          recentRunCount: status.recentRuns.length,
          latestScannedCount: latestRun?.scannedCount || 0,
          matchedCount: latestRun?.matchedCount || 0,
          quantityReducedCount: latestRun?.quantityReducedCount || 0,
          soldCount: latestRun?.soldCount || 0,
          reviewCount: latestRun?.reviewCount || 0,
          failedCount: latestRun?.failedCount || 0,
        }),
      },
    );
  } catch (error: any) {
    if (isMissingReconciliationSchema(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not load seller eBay reconciliation" },
      {
        status: 500,
        headers: sellerMarketplaceReconciliationHeaders({
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
    const result = await reconcileSellerEbayInventoryBatch({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
      resetCursor: body.resetCursor === true,
    });

    return Response.json(
      { success: true, result },
      {
        headers: sellerMarketplaceReconciliationHeaders({
          mode: "run",
          status: result.status === "completed" ? "completed" : "processing",
          linkedCount: result.totalLinked,
          latestScannedCount: result.scannedCount,
          matchedCount: result.matchedCount,
          quantityReducedCount: result.quantityReducedCount,
          soldCount: result.soldCount,
          reviewCount: result.reviewCount,
          failedCount: result.failedCount,
          hasMore: result.hasMore,
          resetCursor: body.resetCursor === true,
        }),
      },
    );
  } catch (error: any) {
    if (isMissingReconciliationSchema(error)) return unavailableResponse();

    const message = error.message || "Could not reconcile seller eBay inventory";
    const status = message.includes("paused") ? 409 : 500;

    return Response.json(
      { error: message },
      {
        status,
        headers: sellerMarketplaceReconciliationHeaders({
          mode: "run",
          status: status === 409 ? "blocked" : "failed",
        }),
      },
    );
  }
}
