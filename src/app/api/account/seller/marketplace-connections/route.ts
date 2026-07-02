import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import {
  isMissingSellerMarketplaceConnectionsTable,
  publicSellerMarketplaceConnection,
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
