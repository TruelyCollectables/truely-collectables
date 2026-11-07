import { getAuthenticatedAccountFromRequest } from "../../../../../../../lib/account-auth";
import { postInstaCompMacAccounting } from "../../../../../../../lib/instacomp-mac-accounting-client";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const MAC_EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
];

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const bridge = await postInstaCompMacAccounting(
      "/v1/kingmaker/accounting/ebay-bridge",
      { mode: "readiness" },
      45_000,
    );
    const readiness = record(bridge?.readiness);
    if (readiness.ready !== true) {
      throw new Error(String(readiness.error || "Mac-local eBay credential is not ready."));
    }

    const now = new Date().toISOString();
    const { data: existing, error: existingError } = await supabase
      .from("seller_marketplace_connections")
      .select("id,provider_metadata")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .single();
    if (existingError || !existing?.id) {
      throw existingError || new Error("Seller eBay connection was not found.");
    }

    const identityWarning =
      "Mac-local eBay credential is healthy. Reconnect only when you want to add identity or order-import scopes.";
    const { error: updateError } = await supabase
      .from("seller_marketplace_connections")
      .update({
        connection_status: "connected",
        oauth_scope: MAC_EBAY_SCOPES,
        token_storage_key: "mac_local:TCOS-Current-Review/ebay-seller-token.json",
        access_token_expires_at: null,
        refresh_token_expires_at: null,
        last_sync_error: null,
        provider_metadata: {
          ...record(existing.provider_metadata),
          credential_authority: "mac_local",
          oauth_reconnect_pending: false,
          mac_readiness_checked_at: now,
          scope_upgrade_pending: true,
        },
        updated_at: now,
      })
      .eq("id", existing.id);
    if (updateError) throw updateError;

    return Response.json(
      {
        success: true,
        status: {
          connected: true,
          ready: true,
          credentialAuthority: "mac_local",
          marketplaceId: readiness.marketplaceId || "EBAY_US",
          identity: null,
          identityWarning,
        },
      },
      {
        headers: sellerMarketplaceEbayStatusHeaders({
          refreshStatus: "refreshed",
          identityVerified: false,
          identityWarning: true,
        }),
      },
    );
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not refresh seller eBay status" },
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
