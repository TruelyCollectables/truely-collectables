export type SellerMarketplaceProvider =
  | "ebay"
  | "shopify"
  | "whatnot"
  | "etsy"
  | "mercari"
  | "other";

export type SellerMarketplaceConnectionRow = {
  id: string;
  provider: SellerMarketplaceProvider;
  provider_account_id: string | null;
  provider_account_label: string | null;
  connection_status: string;
  sync_status: string;
  oauth_scope: string[] | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  token_last_rotated_at: string | null;
  last_sync_started_at: string | null;
  last_sync_completed_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicSellerMarketplaceConnection = {
  id: string;
  provider: SellerMarketplaceProvider;
  providerAccountId: string | null;
  providerAccountLabel: string | null;
  connectionStatus: string;
  syncStatus: string;
  oauthScope: string[];
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  tokenLastRotatedAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
};

export const SELLER_MARKETPLACE_PROVIDERS: SellerMarketplaceProvider[] = [
  "ebay",
  "shopify",
  "whatnot",
  "etsy",
  "mercari",
  "other",
];

export function isMissingSellerMarketplaceConnectionsTable(error: {
  code?: string;
  message?: string;
}) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("seller_marketplace_connections")
  );
}

export function publicSellerMarketplaceConnection(
  row: SellerMarketplaceConnectionRow,
): PublicSellerMarketplaceConnection {
  return {
    id: row.id,
    provider: row.provider,
    providerAccountId: row.provider_account_id || null,
    providerAccountLabel: row.provider_account_label || null,
    connectionStatus: row.connection_status,
    syncStatus: row.sync_status,
    oauthScope: row.oauth_scope || [],
    accessTokenExpiresAt: row.access_token_expires_at || null,
    refreshTokenExpiresAt: row.refresh_token_expires_at || null,
    tokenLastRotatedAt: row.token_last_rotated_at || null,
    lastSyncStartedAt: row.last_sync_started_at || null,
    lastSyncCompletedAt: row.last_sync_completed_at || null,
    lastSyncError: row.last_sync_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
