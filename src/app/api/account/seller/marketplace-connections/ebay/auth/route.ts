import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import { createSellerMarketplaceOAuthState } from "../../../../../../../lib/marketplace-token-crypto";
import { getStoreSettings } from "../../../../../../../lib/store-settings";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const EBAY_REDIRECT_URI = "Truely_Collecta-TruelyCo-Truely-kmpcb";
const EBAY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
].join(" ");

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function sellerMarketplaceEbayAuthHeaders(params: {
  status: "requested" | "misconfigured" | "blocked" | "failed";
  storeSyncStatus: "enabled" | "disabled" | "unknown";
  connectionStatus: string;
  syncStatus: string;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Mutation": "start_oauth",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Status": params.status,
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Provider": "ebay",
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Store-Sync": params.storeSyncStatus,
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Connection-Status":
      params.connectionStatus,
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Sync-Status": params.syncStatus,
  };
}

export async function POST(request: Request) {
  let storeSyncStatus: "enabled" | "disabled" | "unknown" = "unknown";

  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientId = process.env.EBAY_CLIENT_ID;

    if (!clientId) {
      return Response.json(
        { error: "Missing eBay client credentials" },
        {
          status: 500,
          headers: sellerMarketplaceEbayAuthHeaders({
            status: "misconfigured",
            storeSyncStatus,
            connectionStatus: "not_requested",
            syncStatus: "unknown",
          }),
        },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);
    storeSyncStatus = storeSettings.ebaySyncEnabled ? "enabled" : "disabled";

    if (!storeSettings.ebaySyncEnabled) {
      return Response.json(
        { error: "eBay sync is disabled for this store" },
        {
          status: 403,
          headers: sellerMarketplaceEbayAuthHeaders({
            status: "blocked",
            storeSyncStatus,
            connectionStatus: "not_requested",
            syncStatus: "unknown",
          }),
        },
      );
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const now = new Date().toISOString();
    const { data: existingConnection, error: existingConnectionError } = await supabase
      .from("seller_marketplace_connections")
      .select("connection_status,sync_status,last_sync_error,provider_metadata")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .maybeSingle();
    if (existingConnectionError) throw existingConnectionError;

    const preserveLiveConnection =
      existingConnection?.connection_status === "connected" ||
      existingConnection?.connection_status === "sync_paused";
    const connectionStatus = preserveLiveConnection
      ? existingConnection.connection_status
      : "connect_requested";
    const syncStatus = preserveLiveConnection
      ? existingConnection.sync_status || "not_started"
      : "not_started";
    const providerMetadata =
      existingConnection?.provider_metadata &&
      typeof existingConnection.provider_metadata === "object" &&
      !Array.isArray(existingConnection.provider_metadata)
        ? existingConnection.provider_metadata
        : {};

    const { error: connectionError } = await supabase
      .from("seller_marketplace_connections")
      .upsert(
      {
        account_id: account.id,
        store_id: storeId,
        provider: "ebay",
        connection_status: connectionStatus,
        sync_status: syncStatus,
        oauth_scope: EBAY_SCOPE.split(" "),
        last_sync_error: preserveLiveConnection
          ? existingConnection.last_sync_error
          : null,
        updated_at: now,
        provider_metadata: {
          ...providerMetadata,
          request_source: "seller_ebay_oauth_start",
          oauth_requested_at: now,
          oauth_reconnect_pending: true,
        },
      },
      { onConflict: "store_id,account_id,provider" },
    );

    if (connectionError) {
      throw connectionError;
    }

    const state = createSellerMarketplaceOAuthState({
      accountId: account.id,
      storeId,
      provider: "ebay",
    });

    const authBase =
      storeSettings.ebayEnvironment === "sandbox"
        ? "https://auth.sandbox.ebay.com/oauth2/authorize"
        : "https://auth.ebay.com/oauth2/authorize";

    const authorizationUrl =
      `${authBase}?client_id=${clientId}` +
      `&response_type=code` +
      `&prompt=login` +
      `&redirect_uri=${EBAY_REDIRECT_URI}` +
      `&scope=${encodeURIComponent(EBAY_SCOPE)}` +
      `&state=${encodeURIComponent(state)}`;

    return Response.json({
      success: true,
      authorizationUrl,
    }, {
      headers: sellerMarketplaceEbayAuthHeaders({
        status: "requested",
        storeSyncStatus,
        connectionStatus,
        syncStatus,
      }),
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error.message || "Could not start seller eBay authorization",
      },
      {
        status: 500,
        headers: sellerMarketplaceEbayAuthHeaders({
          status: "failed",
          storeSyncStatus,
          connectionStatus: "not_requested",
          syncStatus: "unknown",
        }),
      },
    );
  }
}
