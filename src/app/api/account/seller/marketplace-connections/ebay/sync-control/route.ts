import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../../lib/account-auth";
import {
  publicSellerMarketplaceConnection,
  type SellerMarketplaceConnectionRow,
} from "../../../../../../../lib/seller-marketplace-connections";
import { getStoreSettings } from "../../../../../../../lib/store-settings";
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

type SyncControlAction = "pause" | "resume";
type SellerMarketplaceSyncControlRow = SellerMarketplaceConnectionRow & {
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

function cleanAction(value: unknown): SyncControlAction | null {
  return value === "pause" || value === "resume" ? value : null;
}

function sellerMarketplaceSyncControlHeaders(params: {
  action: SyncControlAction | "invalid" | "unknown";
  result: "changed" | "unchanged" | "blocked" | "missing" | "invalid" | "failed";
  unchanged: boolean;
  connectionStatus?: string | null;
  syncStatus?: string | null;
}) {
  return {
    "X-TCOS-Seller-Marketplace-Sync-Control-Mutation": "sync_control",
    "X-TCOS-Seller-Marketplace-Sync-Control-Action": params.action,
    "X-TCOS-Seller-Marketplace-Sync-Control-Result": params.result,
    "X-TCOS-Seller-Marketplace-Sync-Control-Unchanged": params.unchanged
      ? "true"
      : "false",
    "X-TCOS-Seller-Marketplace-Sync-Control-Connection-Status":
      params.connectionStatus || "unknown",
    "X-TCOS-Seller-Marketplace-Sync-Control-Sync-Status":
      params.syncStatus || "unknown",
  };
}

export async function POST(request: Request) {
  let requestedAction: SyncControlAction | "invalid" | "unknown" = "unknown";

  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = cleanAction(body.action);
    requestedAction = action || "invalid";

    if (!action) {
      return Response.json(
        { error: "A sync-control action of pause or resume is required." },
        {
          status: 400,
          headers: sellerMarketplaceSyncControlHeaders({
            action: "invalid",
            result: "invalid",
            unchanged: false,
          }),
        },
      );
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
      return Response.json(
        { error: "Seller eBay connection was not found." },
        {
          status: 404,
          headers: sellerMarketplaceSyncControlHeaders({
            action,
            result: "missing",
            unchanged: false,
          }),
        },
      );
    }

    const connectionRow =
      connection as unknown as SellerMarketplaceSyncControlRow;
    const alreadyPaused =
      connectionRow.connection_status === "sync_paused" ||
      connectionRow.sync_status === "paused";

    if (action === "pause" && alreadyPaused) {
      return Response.json({
        success: true,
        action,
        unchanged: true,
        connection: publicSellerMarketplaceConnection(connectionRow),
      }, {
        headers: sellerMarketplaceSyncControlHeaders({
          action,
          result: "unchanged",
          unchanged: true,
          connectionStatus: connectionRow.connection_status,
          syncStatus: connectionRow.sync_status,
        }),
      });
    }

    if (action === "resume" && !alreadyPaused) {
      if (connectionRow.connection_status !== "connected") {
        return Response.json(
          { error: "Reconnect eBay before resuming seller sync." },
          {
            status: 409,
            headers: sellerMarketplaceSyncControlHeaders({
              action,
              result: "blocked",
              unchanged: false,
              connectionStatus: connectionRow.connection_status,
              syncStatus: connectionRow.sync_status,
            }),
          },
        );
      }

      return Response.json({
        success: true,
        action,
        unchanged: true,
        connection: publicSellerMarketplaceConnection(connectionRow),
      }, {
        headers: sellerMarketplaceSyncControlHeaders({
          action,
          result: "unchanged",
          unchanged: true,
          connectionStatus: connectionRow.connection_status,
          syncStatus: connectionRow.sync_status,
        }),
      });
    }

    if (
      action === "pause" &&
      connectionRow.connection_status !== "connected"
    ) {
      return Response.json(
        { error: "Only an active seller eBay connection can be paused." },
        {
          status: 409,
          headers: sellerMarketplaceSyncControlHeaders({
            action,
            result: "blocked",
            unchanged: false,
            connectionStatus: connectionRow.connection_status,
            syncStatus: connectionRow.sync_status,
          }),
        },
      );
    }

    if (action === "resume") {
      const storeSettings = await getStoreSettings(supabase, storeId);

      if (!storeSettings.ebaySyncEnabled) {
        return Response.json(
          {
            error:
              "Store-wide eBay sync is disabled. A store admin must enable it before seller sync can resume.",
          },
          {
            status: 403,
            headers: sellerMarketplaceSyncControlHeaders({
              action,
              result: "blocked",
              unchanged: false,
              connectionStatus: connectionRow.connection_status,
              syncStatus: connectionRow.sync_status,
            }),
          },
        );
      }

      const { data: token, error: tokenError } = await supabase
        .from("seller_marketplace_connection_tokens")
        .select("id")
        .eq("connection_id", connectionRow.id)
        .eq("account_id", account.id)
        .eq("store_id", storeId)
        .eq("provider", "ebay")
        .maybeSingle();

      if (tokenError) {
        throw tokenError;
      }

      if (!token) {
        return Response.json(
          { error: "Seller eBay credentials are missing. Reconnect eBay." },
          {
            status: 409,
            headers: sellerMarketplaceSyncControlHeaders({
              action,
              result: "blocked",
              unchanged: false,
              connectionStatus: connectionRow.connection_status,
              syncStatus: connectionRow.sync_status,
            }),
          },
        );
      }
    }

    const changedAt = new Date().toISOString();
    const metadata = recordValue(connectionRow.provider_metadata);
    const nextMetadata =
      action === "pause"
        ? {
            ...metadata,
            seller_sync_paused_at: changedAt,
            seller_sync_pause_source: "seller_marketplaces_page",
          }
        : {
            ...metadata,
            seller_sync_paused_at: null,
            seller_sync_resumed_at: changedAt,
            seller_sync_resume_source: "seller_marketplaces_page",
          };
    const { data: updatedConnection, error: updateError } = await supabase
      .from("seller_marketplace_connections")
      .update({
        connection_status: action === "pause" ? "sync_paused" : "connected",
        sync_status: action === "pause" ? "paused" : "not_started",
        last_sync_error: null,
        provider_metadata: nextMetadata,
        updated_at: changedAt,
      })
      .eq("id", connectionRow.id)
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .eq("provider", "ebay")
      .select(CONNECTION_FIELDS)
      .single();

    if (updateError || !updatedConnection) {
      throw updateError || new Error("Could not update seller eBay sync.");
    }

    return Response.json({
      success: true,
      action,
      unchanged: false,
      connection: publicSellerMarketplaceConnection(
        updatedConnection as unknown as SellerMarketplaceConnectionRow,
      ),
    }, {
      headers: sellerMarketplaceSyncControlHeaders({
        action,
        result: "changed",
        unchanged: false,
        connectionStatus: String(
          (updatedConnection as unknown as SellerMarketplaceSyncControlRow)
            .connection_status || "",
        ),
        syncStatus: String(
          (updatedConnection as unknown as SellerMarketplaceSyncControlRow)
            .sync_status || "",
        ),
      }),
    });
  } catch (error: any) {
    return Response.json(
      { error: error.message || "Could not update seller eBay sync" },
      {
        status: 500,
        headers: sellerMarketplaceSyncControlHeaders({
          action: requestedAction,
          result: "failed",
          unchanged: false,
        }),
      },
    );
  }
}
