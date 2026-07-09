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

export async function GET(request: Request) {
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
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const preview = await loadSellerEbayInventoryPreview({
      supabase,
      accountId: account.id,
      storeId,
      limit,
    });

    return Response.json({
      success: true,
      preview,
    });
  } catch (error: any) {
    const message =
      error.message || "Could not load seller eBay inventory preview";

    return Response.json(
      { error: message },
      { status: message.includes("disabled") ? 403 : 500 },
    );
  }
}
