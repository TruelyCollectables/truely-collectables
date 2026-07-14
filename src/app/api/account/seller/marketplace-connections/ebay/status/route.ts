import { getAuthenticatedAccountFromRequest } from "../../../../../../../lib/account-auth";
import { refreshSellerEbayAccessToken } from "../../../../../../../lib/seller-ebay";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function sellerMarketplaceEbayStatusHeaders(params: {
  refreshStatus: "refreshed" | "failed";
  identityVerified: boolean;
  identityWarning: boolean;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Ebay-Status-Mutation": "refresh_status",
    "X-TCOS-Seller-Marketplace-Ebay-Status": params.refreshStatus,
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Verified": params.identityVerified
      ? "true"
      : "false",
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Warning": params.identityWarning
      ? "true"
      : "false",
  };
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const status = await refreshSellerEbayAccessToken({
      supabase,
      accountId: account.id,
      storeId,
    });

    return Response.json({
      success: true,
      status,
    }, {
      headers: sellerMarketplaceEbayStatusHeaders({
        refreshStatus: "refreshed",
        identityVerified: Boolean(status.identity),
        identityWarning: Boolean(status.identityWarning),
      }),
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error.message || "Could not refresh seller eBay status",
      },
      {
        status: 500,
        headers: sellerMarketplaceEbayStatusHeaders({
          refreshStatus: "failed",
          identityVerified: false,
          identityWarning: false,
        }),
      },
    );
  }
}
