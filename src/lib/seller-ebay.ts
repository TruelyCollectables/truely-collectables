import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptMarketplaceToken, encryptMarketplaceToken } from "./marketplace-token-crypto";
import { getStoreSettings } from "./store-settings";
import { type SellerMarketplaceConnectionRow } from "./seller-marketplace-connections";

const EBAY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
];

type SellerMarketplaceTokenRow = {
  connection_id: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
};

type SellerEbayConnectionBundle = {
  connection: SellerMarketplaceConnectionRow;
  token: SellerMarketplaceTokenRow;
};

function ebayTokenBase(environment: string | null | undefined) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

async function getSellerEbayBundle(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
}): Promise<SellerEbayConnectionBundle> {
  const { data: connection, error: connectionError } = await params.supabase
    .from("seller_marketplace_connections")
    .select(
      [
        "id",
        "provider",
        "provider_account_id",
        "provider_account_label",
        "connection_status",
        "sync_status",
        "oauth_scope",
        "access_token_expires_at",
        "refresh_token_expires_at",
        "token_last_rotated_at",
        "last_sync_started_at",
        "last_sync_completed_at",
        "last_sync_error",
        "created_at",
        "updated_at",
      ].join(","),
    )
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .single();

  if (connectionError || !connection) {
    throw new Error("Seller eBay connection was not found.");
  }

  const { data: token, error: tokenError } = await params.supabase
    .from("seller_marketplace_connection_tokens")
    .select("connection_id,encrypted_refresh_token,encrypted_access_token")
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .single();

  if (tokenError || !token?.encrypted_refresh_token) {
    throw new Error("Seller eBay token record was not found.");
  }

  return {
    connection: connection as unknown as SellerMarketplaceConnectionRow,
    token: token as SellerMarketplaceTokenRow,
  };
}

export async function refreshSellerEbayAccessToken(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing eBay client credentials");
  }

  const bundle = await getSellerEbayBundle(params);
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);
  const refreshToken = decryptMarketplaceToken(
    bundle.token.encrypted_refresh_token,
  );
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const tokenBase = ebayTokenBase(storeSettings.ebayEnvironment);

  const response = await fetch(`${tokenBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: EBAY_SCOPE.join(" "),
    }),
  });

  const data = await response.json().catch(() => ({}));
  const nowIso = new Date().toISOString();

  if (!response.ok || !data.access_token) {
    const errorMessage =
      data.error_description || data.error || "Seller eBay token refresh failed";
    const nextConnectionStatus =
      data.error === "invalid_grant" ? "needs_reauth" : "error";

    await params.supabase
      .from("seller_marketplace_connections")
      .update({
        connection_status: nextConnectionStatus,
        last_sync_error: errorMessage,
        updated_at: nowIso,
      })
      .eq("id", bundle.connection.id);

    throw new Error(errorMessage);
  }

  const accessTokenExpiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : null;
  const refreshTokenExpiresAt = data.refresh_token_expires_in
    ? new Date(
        Date.now() + Number(data.refresh_token_expires_in) * 1000,
      ).toISOString()
    : bundle.connection.refresh_token_expires_at;

  await params.supabase
    .from("seller_marketplace_connection_tokens")
    .update({
      encrypted_access_token: encryptMarketplaceToken(data.access_token),
      updated_at: nowIso,
    })
    .eq("connection_id", bundle.connection.id);

  await params.supabase
    .from("seller_marketplace_connections")
    .update({
      connection_status: "connected",
      oauth_scope:
        typeof data.scope === "string"
          ? data.scope.split(" ").filter(Boolean)
          : bundle.connection.oauth_scope,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      token_last_rotated_at: nowIso,
      last_sync_error: null,
      updated_at: nowIso,
    })
    .eq("id", bundle.connection.id);

  return {
    connectionId: bundle.connection.id,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    refreshedAt: nowIso,
  };
}
