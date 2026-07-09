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
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
].join(" ");

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const clientId = process.env.EBAY_CLIENT_ID;

    if (!clientId) {
      return Response.json(
        { error: "Missing eBay client credentials" },
        { status: 500 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);

    if (!storeSettings.ebaySyncEnabled) {
      return Response.json(
        { error: "eBay sync is disabled for this store" },
        { status: 403 },
      );
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    await supabase.from("seller_marketplace_connections").upsert(
      {
        account_id: account.id,
        store_id: storeId,
        provider: "ebay",
        connection_status: "connect_requested",
        sync_status: "not_started",
        oauth_scope: EBAY_SCOPE.split(" "),
        last_sync_error: null,
        updated_at: new Date().toISOString(),
        provider_metadata: {
          request_source: "seller_ebay_oauth_start",
        },
      },
      { onConflict: "store_id,account_id,provider" },
    );

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
      `&redirect_uri=${EBAY_REDIRECT_URI}` +
      `&scope=${encodeURIComponent(EBAY_SCOPE)}` +
      `&state=${encodeURIComponent(state)}`;

    return Response.json({
      success: true,
      authorizationUrl,
    });
  } catch (error: any) {
    return Response.json(
      {
        error: error.message || "Could not start seller eBay authorization",
      },
      { status: 500 },
    );
  }
}
