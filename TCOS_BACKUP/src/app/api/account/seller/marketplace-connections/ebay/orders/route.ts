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
    return Response.json({ success: true, ...status });
  } catch (error: any) {
    if (isMissingOrderSchema(error)) {
      return Response.json(
        { error: "Seller eBay order import is not available until its migration is applied." },
        { status: 503 },
      );
    }
    return Response.json(
      { error: error.message || "Could not load seller eBay outside orders" },
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
    const result = await importSellerEbayOrdersBatch({
      supabase: getSupabaseClient(),
      accountId: account.id,
      storeId: getActiveStoreId(),
      resetCursor: body.resetCursor === true,
      source: "seller_manual",
    });
    return Response.json({ success: true, result });
  } catch (error: any) {
    if (isMissingOrderSchema(error)) {
      return Response.json(
        { error: "Seller eBay order import is not available until its migration is applied." },
        { status: 503 },
      );
    }
    const message = error.message || "Could not import seller eBay orders";
    const status = message.includes("Reconnect eBay") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
