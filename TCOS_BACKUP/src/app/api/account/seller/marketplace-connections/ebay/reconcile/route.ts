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
    { status: 503 },
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

    const status = await loadSellerEbayReconciliationStatus({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
    });

    return Response.json({ success: true, ...status });
  } catch (error: any) {
    if (isMissingReconciliationSchema(error)) return unavailableResponse();

    return Response.json(
      { error: error.message || "Could not load seller eBay reconciliation" },
      { status: 500 },
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

    return Response.json({ success: true, result });
  } catch (error: any) {
    if (isMissingReconciliationSchema(error)) return unavailableResponse();

    const message = error.message || "Could not reconcile seller eBay inventory";
    const status = message.includes("paused") ? 409 : 500;

    return Response.json({ error: message }, { status });
  }
}
