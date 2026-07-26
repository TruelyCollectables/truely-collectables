import { NextResponse } from "next/server";
import { createAdminMarketplaceOAuthState } from "../../../../lib/marketplace-token-crypto";
import { getActiveStoreId } from "../../../../lib/stores";
import { getStoreSettings } from "../../../../lib/store-settings";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID;

  if (!clientId) {
    return NextResponse.json(
      { error: "Missing eBay client id" },
      { status: 500 },
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const storeSettings = await getStoreSettings(supabase, storeId);

  if (!storeSettings.ebaySyncEnabled) {
    return NextResponse.json(
      {
        error: "eBay sync is disabled for this store",
        storeId,
      },
      { status: 403 },
    );
  }

  const redirectUri = "Truely_Collecta-TruelyCo-Truely-kmpcb";
  const scope = [
    "https://api.ebay.com/oauth/api_scope",
    "https://api.ebay.com/oauth/api_scope/sell.inventory",
    "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  ].join(" ");
  const state = createAdminMarketplaceOAuthState({
    storeId,
    provider: "ebay",
  });
  const authBase =
    storeSettings.ebayEnvironment === "sandbox"
      ? "https://auth.sandbox.ebay.com/oauth2/authorize"
      : "https://auth.ebay.com/oauth2/authorize";
  const url =
    `${authBase}?client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(url);
}
