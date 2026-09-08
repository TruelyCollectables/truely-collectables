import { NextResponse } from "next/server";
import {
  encryptMarketplaceToken,
  parseAdminMarketplaceOAuthState,
  parseSellerMarketplaceOAuthState,
} from "../../../../lib/marketplace-token-crypto";
import { fetchSellerEbayIdentity } from "../../../../lib/seller-ebay";
import { postInstaCompMacAccounting } from "../../../../lib/instacomp-mac-accounting-client";
import { configuredSiteOrigin } from "../../../../lib/site-origin";
import { getActiveStoreId } from "../../../../lib/stores";
import { getStoreSettings } from "../../../../lib/store-settings";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const EBAY_REDIRECT_URI = "Truely_Collecta-TruelyCo-Truely-kmpcb";
const EBAY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

type OAuthActor =
  | {
      type: "seller";
      state: ReturnType<typeof parseSellerMarketplaceOAuthState>;
    }
  | {
      type: "admin";
      state: ReturnType<typeof parseAdminMarketplaceOAuthState>;
    };

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

async function exchangeEbayAuthorizationCode(params: {
  code: string;
  ebayEnvironment: string;
}) {
  const clientId = String(process.env.EBAY_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET || "").trim();

  if (clientId && clientSecret) {
    const tokenBase =
      params.ebayEnvironment === "sandbox"
        ? "https://api.sandbox.ebay.com"
        : "https://api.ebay.com";
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(`${tokenBase}/identity/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: EBAY_REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.refresh_token) {
      throw new Error(
        String(
          data?.error_description ||
            data?.error ||
            `eBay OAuth token exchange failed with HTTP ${response.status}.`,
        ),
      );
    }
    return data as Record<string, any>;
  }

  return await postInstaCompMacAccounting(
    "/v1/kingmaker/accounting/ebay-bridge",
    { mode: "oauth_exchange", code: params.code, redirect_uri: EBAY_REDIRECT_URI },
    45_000,
  );
}

async function preserveExistingSellerConnectionAfterOAuthFailure(params: {
  supabase: ReturnType<typeof getSupabaseClient>;
  accountId: string;
  storeId: string;
  errorMessage: string;
}) {
  const { data: connection } = await params.supabase
    .from("seller_marketplace_connections")
    .select("id,connection_status,sync_status,last_sync_error,provider_metadata")
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay")
    .maybeSingle();

  if (
    !connection?.id ||
    !["connected", "sync_paused"].includes(String(connection.connection_status || ""))
  ) {
    return false;
  }

  const { count } = await params.supabase
    .from("seller_marketplace_connection_tokens")
    .select("connection_id", { count: "exact", head: true })
    .eq("connection_id", connection.id)
    .eq("account_id", params.accountId)
    .eq("store_id", params.storeId)
    .eq("provider", "ebay");
  if (!count) return false;

  const now = new Date().toISOString();
  await params.supabase
    .from("seller_marketplace_connections")
    .update({
      provider_metadata: {
        ...record(connection.provider_metadata),
        oauth_reconnect_pending: false,
        last_oauth_error: params.errorMessage,
        last_oauth_error_at: now,
      },
      updated_at: now,
    })
    .eq("id", connection.id);

  return true;
}

function sellerRedirect(
  _request: Request,
  status: "connected" | "error",
  message?: string,
) {
  const redirectUrl = new URL("/seller/marketplaces", configuredSiteOrigin());
  redirectUrl.searchParams.set("ebay", status);

  if (message) {
    redirectUrl.searchParams.set("message", message.slice(0, 180));
  }

  return NextResponse.redirect(redirectUrl);
}

function adminRedirect(status: "connected" | "error", message?: string) {
  const redirectUrl = new URL("/admin/ebay", configuredSiteOrigin());
  redirectUrl.searchParams.set("ebay", status);

  if (message) {
    redirectUrl.searchParams.set("message", message.slice(0, 180));
  }

  return NextResponse.redirect(redirectUrl);
}

function parseOAuthActor(state: string, activeStoreId: string): OAuthActor {
  try {
    const sellerState = parseSellerMarketplaceOAuthState(state);

    if (sellerState.storeId !== activeStoreId) {
      throw new Error("Seller OAuth state belongs to another store");
    }

    return { type: "seller", state: sellerState };
  } catch {
    const adminState = parseAdminMarketplaceOAuthState(state);

    if (adminState.storeId !== activeStoreId) {
      throw new Error("Admin OAuth state belongs to another store");
    }

    return { type: "admin", state: adminState };
  }
}

export async function GET(request: Request) {
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
  const callbackError =
    url.searchParams.get("error_description") ||
    url.searchParams.get("error") ||
    "No authorization code received from eBay.";

  if (!state) {
    return adminRedirect(
      "error",
      "eBay OAuth state was missing. Restart the connection from the protected admin or seller page.",
    );
  }

  let actor: OAuthActor;

  try {
    actor = parseOAuthActor(state, storeId);
  } catch {
    return adminRedirect(
      "error",
      "eBay OAuth state was invalid, expired, or belonged to another store. Restart the connection.",
    );
  }

  if (!code) {
    if (actor.type === "seller") {
      const preserved = await preserveExistingSellerConnectionAfterOAuthFailure({
        supabase,
        accountId: actor.state.accountId,
        storeId: actor.state.storeId,
        errorMessage: callbackError,
      });
      if (preserved) {
        return sellerRedirect(
          request,
          "connected",
          "Existing eBay connection kept; reconnect was not completed.",
        );
      }

      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: callbackError,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", actor.state.accountId)
        .eq("store_id", actor.state.storeId)
        .eq("provider", "ebay");

      return sellerRedirect(request, "error", callbackError);
    }

    return adminRedirect("error", callbackError);
  }

  let data: Record<string, any>;
  try {
    data = await exchangeEbayAuthorizationCode({
      code,
      ebayEnvironment: storeSettings.ebayEnvironment,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "eBay authorization token exchange failed.";
    if (actor.type === "seller") {
      const preserved = await preserveExistingSellerConnectionAfterOAuthFailure({
        supabase,
        accountId: actor.state.accountId,
        storeId: actor.state.storeId,
        errorMessage,
      });
      if (preserved) {
        return sellerRedirect(
          request,
          "connected",
          "Existing eBay connection kept; reconnect failed safely. Start a fresh reconnect if needed.",
        );
      }

      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", actor.state.accountId)
        .eq("store_id", actor.state.storeId)
        .eq("provider", "ebay");
      return sellerRedirect(request, "error", errorMessage);
    }
    return adminRedirect("error", errorMessage);
  }

  if (actor.type === "seller") {
    if (!data.refresh_token) {
      const errorMessage =
        data.error_description ||
        data.error ||
        "eBay seller authorization failed";

      const preserved = await preserveExistingSellerConnectionAfterOAuthFailure({
        supabase,
        accountId: actor.state.accountId,
        storeId: actor.state.storeId,
        errorMessage,
      });
      if (preserved) {
        return sellerRedirect(
          request,
          "connected",
          "Existing eBay connection kept; reconnect failed safely. Start a fresh reconnect if needed.",
        );
      }

      await supabase
        .from("seller_marketplace_connections")
        .update({
          connection_status: "error",
          last_sync_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq("account_id", actor.state.accountId)
        .eq("store_id", actor.state.storeId)
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
    let identity = null;
    let identityWarning: string | null = null;

    try {
      identity = await fetchSellerEbayIdentity({
        accessToken: data.access_token,
        ebayEnvironment: storeSettings.ebayEnvironment,
      });
    } catch {
      identityWarning =
        "eBay identity could not be verified. Refresh status or reconnect to enable automatic authorization-revocation monitoring.";
    }

    const { data: connection, error: connectionError } = await supabase
      .from("seller_marketplace_connections")
      .upsert(
        {
          account_id: actor.state.accountId,
          store_id: actor.state.storeId,
          provider: "ebay",
          provider_account_id: identity?.userId || null,
          provider_account_label: identity?.username || null,
          connection_status: "connected",
          sync_status: "not_started",
          oauth_scope: oauthScope,
          token_storage_key: `seller_marketplace_connection_tokens:${actor.state.storeId}:${actor.state.accountId}:ebay`,
          access_token_expires_at: accessTokenExpiresAt,
          refresh_token_expires_at: refreshTokenExpiresAt,
          token_last_rotated_at: new Date().toISOString(),
          last_sync_error: identityWarning,
          updated_at: new Date().toISOString(),
          provider_metadata: {
            callback_source: "ebay_oauth_callback",
            oauth_reconnect_pending: false,
            last_oauth_error: null,
            last_oauth_error_at: null,
            ebay_environment: storeSettings.ebayEnvironment,
            ebay_identity_verified_at: identity
              ? new Date().toISOString()
              : null,
            ebay_account_type: identity?.accountType || null,
            ebay_registration_marketplace_id:
              identity?.registrationMarketplaceId || null,
            ebay_account_status: identity?.status || null,
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
          account_id: actor.state.accountId,
          store_id: actor.state.storeId,
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

  if (!data.refresh_token) {
    return adminRedirect(
      "error",
      data.error_description ||
        data.error ||
        "eBay authorization did not return a refresh token.",
    );
  }

  const { error: tokenInsertError } = await supabase.from("ebay_tokens").insert({
    store_id: actor.state.storeId,
    refresh_token: data.refresh_token,
  });

  if (tokenInsertError) {
    return adminRedirect("error", tokenInsertError.message);
  }

  return adminRedirect("connected");
}
