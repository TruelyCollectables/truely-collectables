import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  encryptMarketplaceToken,
  parseSellerMarketplaceOAuthState,
} from "../../../../lib/marketplace-token-crypto";
import { getActiveStoreId } from "../../../../lib/stores";
import { getStoreSettings } from "../../../../lib/store-settings";

export const dynamic = "force-dynamic";

const EBAY_REDIRECT_URI = "Truely_Collecta-TruelyCo-Truely-kmpcb";
const EBAY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
];

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function sellerRedirect(
  request: Request,
  status: "connected" | "error",
  message?: string,
) {
  const redirectUrl = new URL("/seller/marketplaces", request.url);
  redirectUrl.searchParams.set("ebay", status);

  if (message) {
    redirectUrl.searchParams.set("message", message.slice(0, 180));
  }

  return NextResponse.redirect(redirectUrl);
}

export async function GET(request: Request) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing eBay client credentials" },
      { status: 500 },
    );
  }

  const supabase = getSupabaseClient();
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

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    if (!state) {
      return NextResponse.json({ error: "No code received" });
    }

    try {
      const sellerState = parseSellerMarketplaceOAuthState(state);

      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: "No code received from eBay",
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", sellerState.accountId)
        .eq("store_id", sellerState.storeId)
        .eq("provider", "ebay");
    } catch {
      return sellerRedirect(request, "error", "Seller eBay state was invalid.");
    }

    return sellerRedirect(request, "error", "No code received from eBay.");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const tokenBase =
    storeSettings.ebayEnvironment === "sandbox"
      ? "https://api.sandbox.ebay.com"
      : "https://api.ebay.com";

  const response = await fetch(`${tokenBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: EBAY_REDIRECT_URI,
    }),
  });

  const data = await response.json();

  if (state) {
    let sellerState;

    try {
      sellerState = parseSellerMarketplaceOAuthState(state);
    } catch (error: any) {
      return sellerRedirect(
        request,
        "error",
        error.message || "Seller eBay state was invalid.",
      );
    }

    if (!response.ok || !data.refresh_token) {
      const errorMessage =
        data.error_description ||
        data.error ||
        "eBay seller authorization failed";

      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", sellerState.accountId)
        .eq("store_id", sellerState.storeId)
        .eq("provider", "ebay");

      return sellerRedirect(request, "error", errorMessage);
    }

    const now = Date.now();
    const accessTokenExpiresAt = data.expires_in
      ? new Date(now + Number(data.expires_in) * 1000).toISOString()
      : null;
    const refreshTokenExpiresAt = data.refresh_token_expires_in
      ? new Date(now + Number(data.refresh_token_expires_in) * 1000).toISOString()
      : null;
    const oauthScope =
      typeof data.scope === "string"
        ? data.scope.split(" ").filter(Boolean)
        : EBAY_SCOPE;

    const { data: connection, error: connectionError } = await supabase
      .from("seller_marketplace_connections")
      .upsert(
        {
          account_id: sellerState.accountId,
          store_id: sellerState.storeId,
          provider: "ebay",
          connection_status: "connected",
          sync_status: "not_started",
          oauth_scope: oauthScope,
          token_storage_key: `seller_marketplace_connection_tokens:${sellerState.storeId}:${sellerState.accountId}:ebay`,
          access_token_expires_at: accessTokenExpiresAt,
          refresh_token_expires_at: refreshTokenExpiresAt,
          token_last_rotated_at: new Date().toISOString(),
          last_sync_error: null,
          updated_at: new Date().toISOString(),
          provider_metadata: {
            callback_source: "ebay_oauth_callback",
            ebay_environment: storeSettings.ebayEnvironment,
          },
        },
        { onConflict: "store_id,account_id,provider" },
      )
      .select("id")
      .single();

    if (connectionError || !connection?.id) {
      return sellerRedirect(
        request,
        "error",
        connectionError?.message || "Could not save seller eBay connection.",
      );
    }

    const { error: tokenError } = await supabase
      .from("seller_marketplace_connection_tokens")
      .upsert(
        {
          connection_id: connection.id,
          account_id: sellerState.accountId,
          store_id: sellerState.storeId,
          provider: "ebay",
          encrypted_refresh_token: encryptMarketplaceToken(data.refresh_token),
          encrypted_access_token: data.access_token
            ? encryptMarketplaceToken(data.access_token)
            : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "store_id,account_id,provider" },
      );

    if (tokenError) {
      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: tokenError.message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connection.id);

      return sellerRedirect(request, "error", tokenError.message);
    }

    return sellerRedirect(request, "connected");
  }

  if (data.refresh_token) {
    await supabase.from("ebay_tokens").insert({
      store_id: storeId,
      refresh_token: data.refresh_token,
    });
  }

  return NextResponse.json({
    success: true,
    token_received: !!data.access_token,
    refresh_token_received: !!data.refresh_token,
    expires_in: data.expires_in,
  });
}
