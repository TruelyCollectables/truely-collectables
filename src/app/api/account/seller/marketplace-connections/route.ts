import { createClient } from "@supabase/supabase-js";
import { ensureAccountStoreMembership } from "../../../../../lib/account-auth";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  SELLER_MARKETPLACE_PROVIDERS,
  isMissingSellerMarketplaceConnectionsTable,
  publicSellerMarketplaceConnection,
  type SellerMarketplaceProvider,
  type SellerMarketplaceConnectionRow,
} from "../../../../../lib/seller-marketplace-connections";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function unavailableResponse() {
  return Response.json(
    {
      error:
        "Seller marketplace connections are not available until the marketplace connections migration is applied.",
      connections: [],
    },
    { status: 503 },
  );
}

function cleanText(value: unknown, maxLength = 120) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanProvider(value: unknown): SellerMarketplaceProvider | null {
  const provider = String(value || "").trim().toLowerCase();

  return SELLER_MARKETPLACE_PROVIDERS.includes(
    provider as SellerMarketplaceProvider,
  )
    ? (provider as SellerMarketplaceProvider)
    : null;
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
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
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false });

    if (error) {
      if (isMissingSellerMarketplaceConnectionsTable(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    return Response.json({
      success: true,
      connections: ((data || []) as unknown as SellerMarketplaceConnectionRow[])
        .map(publicSellerMarketplaceConnection),
    });
  } catch (error: any) {
    return Response.json(
      {
        error:
          error.message || "Could not load seller marketplace connections",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const provider = cleanProvider(body.provider);

    if (!provider) {
      return Response.json(
        { error: "A supported marketplace provider is required." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const now = new Date().toISOString();

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const payload = {
      account_id: account.id,
      store_id: storeId,
      provider,
      provider_account_label: cleanText(body.providerAccountLabel, 120),
      connection_status: "connect_requested",
      sync_status: "not_started",
      last_sync_error: null,
      updated_at: now,
      provider_metadata: {
        request_source: "seller_marketplaces_page",
        request_note: cleanText(body.requestNote, 240),
      },
    };

    const { data, error } = await supabase
      .from("seller_marketplace_connections")
      .upsert(payload, { onConflict: "store_id,account_id,provider" })
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
      .single();

    if (error) {
      if (isMissingSellerMarketplaceConnectionsTable(error)) {
        return unavailableResponse();
      }

      throw error;
    }

    return Response.json({
      success: true,
      connection: publicSellerMarketplaceConnection(
        data as unknown as SellerMarketplaceConnectionRow,
      ),
    });
  } catch (error: any) {
    return Response.json(
      {
        error:
          error.message || "Could not save seller marketplace connection",
      },
      { status: 500 },
    );
  }
}
