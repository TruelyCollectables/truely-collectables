import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  publicSellerMarketplaceConnection,
  type SellerMarketplaceConnectionRow,
} from "../../../../../../../lib/seller-marketplace-connections";
import { getActiveStoreId } from "../../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

const CONNECTION_FIELDS = [
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
  "import_cursor",
  "provider_metadata",
  "created_at",
  "updated_at",
].join(",");

type SellerMarketplaceDisconnectRow = SellerMarketplaceConnectionRow & {
  provider_metadata: Record<string, unknown> | null;
};

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function DELETE(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: connection, error: connectionError } = await supabase
      .from("seller_marketplace_connections")
      .select(CONNECTION_FIELDS)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .maybeSingle();

    if (connectionError) {
      throw connectionError;
    }

    if (!connection) {
      return Response.json({
        success: true,
        alreadyDisconnected: true,
        connection: null,
      });
    }

    const connectionRow =
      connection as unknown as SellerMarketplaceDisconnectRow;

    const { error: tokenDeleteError } = await supabase
      .from("seller_marketplace_connection_tokens")
      .delete()
      .eq("connection_id", connectionRow.id)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay");

    if (tokenDeleteError) {
      throw tokenDeleteError;
    }

    const disconnectedAt = new Date().toISOString();
    const { data: disconnectedConnection, error: updateError } = await supabase
      .from("seller_marketplace_connections")
      .update({
        connection_status: "revoked",
        sync_status: "paused",
        oauth_scope: [],
        token_storage_key: null,
        access_token_expires_at: null,
        refresh_token_expires_at: null,
        last_sync_error: null,
        provider_metadata: {
          ...recordValue(connectionRow.provider_metadata),
          disconnected_at: disconnectedAt,
          disconnect_source: "seller_marketplaces_page",
          local_credentials_deleted: true,
        },
        updated_at: disconnectedAt,
      })
      .eq("id", connectionRow.id)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .select(CONNECTION_FIELDS)
      .single();

    if (updateError || !disconnectedConnection) {
      throw updateError || new Error("Could not mark seller eBay as disconnected.");
    }

    return Response.json({
      success: true,
      alreadyDisconnected: false,
      connection: publicSellerMarketplaceConnection(
        disconnectedConnection as unknown as SellerMarketplaceConnectionRow,
      ),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not disconnect seller eBay" },
      { status: 500 },
    );
  }
}
