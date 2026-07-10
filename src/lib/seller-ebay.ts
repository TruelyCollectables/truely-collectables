import type { SupabaseClient } from "@supabase/supabase-js";
import { inferAuthenticityProfileFromEbayListing } from "./authenticity";
import { mapEbayInventoryCategory } from "./ebay-category-mapper";
import { decryptMarketplaceToken, encryptMarketplaceToken } from "./marketplace-token-crypto";
import { getStoreSettings } from "./store-settings";
import { type SellerMarketplaceConnectionRow } from "./seller-marketplace-connections";

const EBAY_SCOPE = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];

export type SellerEbayIdentity = {
  userId: string;
  username: string | null;
  accountType: string | null;
  registrationMarketplaceId: string | null;
  status: string | null;
};

type SellerMarketplaceTokenRow = {
  connection_id: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
};

type SellerEbayConnectionBundle = {
  connection: SellerMarketplaceConnectionRow;
  token: SellerMarketplaceTokenRow;
};

export type SellerEbayPreviewItem = {
  sku: string;
  title: string;
  quantity: number;
  price: number | null;
  listingId: string | null;
  offerStatus: string | null;
  listingStatus: string | null;
  imageUrl: string | null;
  condition: string | null;
  categoryHint?: string | null;
  categoryConfidence?: "high" | "medium" | "low" | null;
  reviewRequired?: boolean;
  authenticity?: Record<string, unknown> | null;
  aspects?: Record<string, unknown> | null;
};

export type SellerEbayInventoryPreview = {
  connectionId: string;
  storeId: string;
  ebayEnvironment: string;
  totalAvailable: number | null;
  sampled: number;
  hasMore: boolean;
  fetchedAt: string;
  writeBlocked: boolean;
  writeBlockReason: string;
  sampleItems: SellerEbayPreviewItem[];
};

export type SellerEbayStagingResult = {
  importJobId: string | null;
  connectionId: string;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  stagedCount: number;
  skippedCount: number;
  totalAvailable: number | null;
  fetchedAt: string;
  sampleItems: SellerEbayPreviewItem[];
};

function ebayTokenBase(environment: string | null | undefined) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

function first(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function toPositiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function toNonNegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function summarizeSellerEbayImport(snapshot: {
  sampleItems: SellerEbayPreviewItem[];
}) {
  const qualitySummary = {
    missing_sku: 0,
    missing_listing_id: 0,
    missing_price: 0,
    missing_image: 0,
    needs_review: 0,
    ready_to_stage: 0,
  };
  const skipReasonSummary: Record<string, number> = {};

  for (const item of snapshot.sampleItems) {
    const hasSku = Boolean(item.sku);
    const hasListingId = Boolean(item.listingId);
    const hasPrice = typeof item.price === "number" && item.price > 0;
    const hasImage = Boolean(item.imageUrl);

    if (!hasSku) qualitySummary.missing_sku += 1;
    if (!hasListingId) qualitySummary.missing_listing_id += 1;
    if (!hasPrice) qualitySummary.missing_price += 1;
    if (!hasImage) qualitySummary.missing_image += 1;

    if (hasSku && hasListingId) {
      qualitySummary.ready_to_stage += 1;
      continue;
    }

    qualitySummary.needs_review += 1;

    let reason = "missing_stage_identity";
    if (!hasSku && !hasListingId) {
      reason = "missing_sku_and_listing_id";
    } else if (!hasSku) {
      reason = "missing_sku";
    } else if (!hasListingId) {
      reason = "missing_listing_id";
    }

    skipReasonSummary[reason] = (skipReasonSummary[reason] || 0) + 1;
  }

  return {
    qualitySummary,
    skipReasonSummary,
  };
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
        "import_cursor",
        "provider_metadata",
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

export async function fetchSellerEbayIdentity(params: {
  accessToken: string;
  ebayEnvironment: string;
}): Promise<SellerEbayIdentity> {
  const identityBase =
    params.ebayEnvironment === "sandbox"
      ? "https://apiz.sandbox.ebay.com"
      : "https://apiz.ebay.com";
  const response = await fetch(`${identityBase}/commerce/identity/v1/user/`, {
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.userId) {
    throw new Error(
      data?.errors?.[0]?.message ||
        data?.message ||
        "Seller eBay identity lookup failed",
    );
  }

  return {
    userId: String(data.userId),
    username: data.username ? String(data.username) : null,
    accountType: data.accountType ? String(data.accountType) : null,
    registrationMarketplaceId: data.registrationMarketplaceId
      ? String(data.registrationMarketplaceId)
      : null,
    status: data.status ? String(data.status) : null,
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
      scope: (bundle.connection.oauth_scope?.length
        ? bundle.connection.oauth_scope
        : EBAY_SCOPE
      ).join(" "),
    }),
  });

  const data = await response.json().catch(() => ({}));
  const nowIso = new Date().toISOString();

  if (!response.ok || !data.access_token) {
    const errorMessage =
      data.error_description || data.error || "Seller eBay token refresh failed";
    const refreshTokenInvalid = data.error === "invalid_grant";
    const nextConnectionStatus = refreshTokenInvalid ? "needs_reauth" : "error";

    if (refreshTokenInvalid) {
      const { error: tokenDeleteError } = await params.supabase
        .from("seller_marketplace_connection_tokens")
        .delete()
        .eq("connection_id", bundle.connection.id)
        .eq("account_id", params.accountId)
        .eq("store_id", params.storeId)
        .eq("provider", "ebay");

      if (tokenDeleteError) {
        throw tokenDeleteError;
      }
    }

    await params.supabase
      .from("seller_marketplace_connections")
      .update({
        connection_status: nextConnectionStatus,
        sync_status: refreshTokenInvalid ? "paused" : bundle.connection.sync_status,
        oauth_scope: refreshTokenInvalid ? [] : bundle.connection.oauth_scope,
        token_storage_key: refreshTokenInvalid
          ? null
          : `seller_marketplace_connection_tokens:${params.storeId}:${params.accountId}:ebay`,
        access_token_expires_at: refreshTokenInvalid
          ? null
          : bundle.connection.access_token_expires_at,
        refresh_token_expires_at: refreshTokenInvalid
          ? null
          : bundle.connection.refresh_token_expires_at,
        last_sync_error: errorMessage,
        provider_metadata: {
          ...recordValue(bundle.connection.provider_metadata),
          invalid_grant_detected_at: refreshTokenInvalid ? nowIso : null,
          local_credentials_deleted: refreshTokenInvalid ? true : undefined,
        },
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
  let identity: SellerEbayIdentity | null = null;
  let identityWarning: string | null = null;

  try {
    identity = await fetchSellerEbayIdentity({
      accessToken: data.access_token,
      ebayEnvironment: storeSettings.ebayEnvironment,
    });
  } catch {
    identityWarning =
      "eBay identity could not be verified. Reconnect once to enable automatic authorization-revocation monitoring.";
  }

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
      provider_account_id: identity?.userId || bundle.connection.provider_account_id,
      provider_account_label:
        identity?.username || bundle.connection.provider_account_label,
      provider_metadata: {
        ...recordValue(bundle.connection.provider_metadata),
        ebay_identity_verified_at: identity ? nowIso : null,
        ebay_account_type: identity?.accountType || null,
        ebay_registration_marketplace_id:
          identity?.registrationMarketplaceId || null,
        ebay_account_status: identity?.status || null,
      },
      last_sync_error: identityWarning,
      updated_at: nowIso,
    })
    .eq("id", bundle.connection.id);

  return {
    accessToken: data.access_token as string,
    connectionId: bundle.connection.id,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    refreshedAt: nowIso,
    identity,
    identityWarning,
  };
}

export async function getSellerEbayAccessToken(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
}) {
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);

  if (!storeSettings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store");
  }

  const bundle = await getSellerEbayBundle(params);
  const accessTokenExpiresAt = bundle.connection.access_token_expires_at
    ? new Date(bundle.connection.access_token_expires_at).getTime()
    : 0;
  const tokenIsFresh =
    bundle.token.encrypted_access_token &&
    Number.isFinite(accessTokenExpiresAt) &&
    accessTokenExpiresAt - Date.now() > 60 * 1000;

  if (tokenIsFresh) {
    return {
      accessToken: decryptMarketplaceToken(bundle.token.encrypted_access_token!),
      connectionId: bundle.connection.id,
      ebayEnvironment: storeSettings.ebayEnvironment,
    };
  }

  const refreshed = await refreshSellerEbayAccessToken(params);

  return {
    accessToken: refreshed.accessToken,
    connectionId: refreshed.connectionId,
    ebayEnvironment: storeSettings.ebayEnvironment,
  };
}

async function fetchSellerEbayInventoryItems(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  limit: number;
  offset?: number;
}) {
  const storeSettings = await getStoreSettings(params.supabase, params.storeId);

  if (!storeSettings.ebaySyncEnabled) {
    throw new Error("eBay sync is disabled for this store");
  }

  const bundle = await getSellerEbayBundle(params);
  const limit = Math.min(Math.max(Number(params.limit), 1), 50);
  const offset = toNonNegativeInteger(params.offset);
  const auth = await getSellerEbayAccessToken(params);
  const ebayApi = ebayTokenBase(storeSettings.ebayEnvironment);
  const inventoryResponse = await fetch(
    `${ebayApi}/sell/inventory/v1/inventory_item?limit=${limit}&offset=${offset}`,
    {
      headers: ebayHeaders(auth.accessToken),
    },
  );
  const inventoryData = await inventoryResponse.json().catch(() => ({}));

  if (!inventoryResponse.ok) {
    throw new Error(
      `Seller eBay inventory fetch failed: ${JSON.stringify(inventoryData)}`,
    );
  }

  const inventoryItems = Array.isArray(inventoryData.inventoryItems)
    ? inventoryData.inventoryItems
    : [];
  const sampleItems = await Promise.all(
    inventoryItems.slice(0, limit).map(async (item: any) => {
      const sku = String(item?.sku || "");
      let price: number | null = null;
      let listingId: string | null = null;
      let offerStatus: string | null = null;
      let listingStatus: string | null = null;

      if (sku) {
        const offerResponse = await fetch(
          `${ebayApi}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`,
          {
            headers: ebayHeaders(auth.accessToken),
          },
        );
        const offerData = await offerResponse.json().catch(() => ({}));
        const offer = Array.isArray(offerData?.offers) ? offerData.offers[0] : null;

        if (offerResponse.ok && offer) {
          const numericPrice = Number(offer?.pricingSummary?.price?.value);
          price = Number.isFinite(numericPrice) ? numericPrice : null;
          listingId = String(offer?.listing?.listingId || "") || null;
          offerStatus = String(offer?.status || "") || null;
          listingStatus = String(offer?.listing?.listingStatus || "") || null;
        }
      }

      const product = item?.product || {};
      const aspects = product?.aspects || {};
      const categoryMapping = mapEbayInventoryCategory({
        title: String(product?.title || "Untitled"),
        aspects,
      });
      const authenticity = inferAuthenticityProfileFromEbayListing({
        title: String(product?.title || "Untitled"),
        category: categoryMapping.category,
        aspects,
      });

      return {
        sku,
        title: String(product?.title || "Untitled"),
        quantity: toPositiveNumber(
          item?.availability?.shipToLocationAvailability?.quantity,
        ),
        price,
        listingId,
        offerStatus,
        listingStatus,
        imageUrl: first(product?.imageUrls) ? String(first(product?.imageUrls)) : null,
        condition: first(aspects?.Condition)
          ? String(first(aspects.Condition))
          : null,
        categoryHint: categoryMapping.category,
        categoryConfidence: categoryMapping.confidence,
        reviewRequired: categoryMapping.reviewRequired,
        authenticity,
        aspects,
      } satisfies SellerEbayPreviewItem;
    }),
  );

  const fetchedAt = new Date().toISOString();
  const totalAvailable = Number.isFinite(Number(inventoryData?.total))
    ? Number(inventoryData.total)
    : null;

  return {
    connectionId: bundle.connection.id,
    ebayEnvironment: storeSettings.ebayEnvironment,
    totalAvailable,
    offset,
    fetchedAt,
    sampleItems,
  };
}

async function markSellerConnectionSyncState(params: {
  supabase: SupabaseClient;
  connectionId: string;
  status: "syncing" | "completed" | "completed_with_errors" | "failed";
  startedAt?: string;
  completedAt?: string;
  lastSyncError?: string | null;
  importCursor?: Record<string, unknown>;
}) {
  const payload: Record<string, unknown> = {
    sync_status: params.status,
    updated_at: params.completedAt || params.startedAt || new Date().toISOString(),
  };

  if (params.startedAt) payload.last_sync_started_at = params.startedAt;
  if (params.completedAt) payload.last_sync_completed_at = params.completedAt;
  if (params.lastSyncError !== undefined) payload.last_sync_error = params.lastSyncError;
  if (params.importCursor) payload.import_cursor = params.importCursor;

  await params.supabase
    .from("seller_marketplace_connections")
    .update(payload)
    .eq("id", params.connectionId);
}

export async function loadSellerEbayInventoryPreview(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  limit?: number;
}): Promise<SellerEbayInventoryPreview> {
  const startedAt = new Date().toISOString();
  const limit = Math.min(Math.max(Number(params.limit ?? 5), 1), 10);
  const bundle = await getSellerEbayBundle(params);

  await markSellerConnectionSyncState({
    supabase: params.supabase,
    connectionId: bundle.connection.id,
    status: "syncing",
    startedAt,
    lastSyncError: null,
  });

  try {
    const snapshot = await fetchSellerEbayInventoryItems({
      ...params,
      limit,
    });
    const hasMore =
      typeof snapshot.totalAvailable === "number"
        ? snapshot.totalAvailable > snapshot.sampleItems.length
        : snapshot.sampleItems.length >= limit;

    await markSellerConnectionSyncState({
      supabase: params.supabase,
      connectionId: bundle.connection.id,
      status: "completed",
      completedAt: snapshot.fetchedAt,
      lastSyncError: null,
      importCursor: {
        ...recordValue(bundle.connection.import_cursor),
        preview_limit: limit,
        preview_sampled: snapshot.sampleItems.length,
        preview_total_available: snapshot.totalAvailable,
        preview_fetched_at: snapshot.fetchedAt,
      },
    });

    return {
      connectionId: bundle.connection.id,
      storeId: params.storeId,
      ebayEnvironment: snapshot.ebayEnvironment,
      totalAvailable: snapshot.totalAvailable,
      sampled: snapshot.sampleItems.length,
      hasMore,
      fetchedAt: snapshot.fetchedAt,
      writeBlocked: false,
      writeBlockReason:
        "Preview is read-only. Use Stage batch to move seller-owned listings into the review workspace before creating TCOS inventory drafts.",
      sampleItems: snapshot.sampleItems,
    };
  } catch (error: any) {
    await markSellerConnectionSyncState({
      supabase: params.supabase,
      connectionId: bundle.connection.id,
      status: "failed",
      completedAt: new Date().toISOString(),
      lastSyncError: error.message || "Seller eBay preview failed",
    });

    throw error;
  }
}

export async function stageSellerEbayInventoryBatch(params: {
  supabase: SupabaseClient;
  accountId: string;
  storeId: string;
  limit?: number;
  resetCursor?: boolean;
}): Promise<SellerEbayStagingResult> {
  const bundle = await getSellerEbayBundle(params);
  const startedAt = new Date().toISOString();
  const limit = Math.min(Math.max(Number(params.limit ?? 25), 1), 50);
  const previousCursor = recordValue(bundle.connection.import_cursor);
  const offset = params.resetCursor
    ? 0
    : toNonNegativeInteger(previousCursor.stage_next_offset);

  await markSellerConnectionSyncState({
    supabase: params.supabase,
    connectionId: bundle.connection.id,
    status: "syncing",
    startedAt,
    lastSyncError: null,
  });

  const { data: importJob, error: importJobError } = await params.supabase
    .from("seller_marketplace_import_jobs")
    .insert({
      account_id: params.accountId,
      store_id: params.storeId,
      connection_id: bundle.connection.id,
      provider: "ebay",
      import_type: "inventory_stage",
      status: "processing",
      started_at: startedAt,
      metadata: {
        request_source: "seller_marketplaces_stage_batch",
        limit,
        offset,
        reset_cursor: params.resetCursor === true,
      },
    })
    .select("id")
    .single();

  if (importJobError) {
    throw importJobError;
  }

  const importJobId = importJob?.id ? String(importJob.id) : null;

  try {
    const snapshot = await fetchSellerEbayInventoryItems({
      ...params,
      limit,
      offset,
    });
    const nextOffset = offset + snapshot.sampleItems.length;
    const hasMore =
      typeof snapshot.totalAvailable === "number"
        ? nextOffset < snapshot.totalAvailable
        : snapshot.sampleItems.length >= limit;
    const importSummary = summarizeSellerEbayImport(snapshot);
    const stagedRows = snapshot.sampleItems
      .filter((item) => item.listingId || item.sku)
      .map((item) => ({
        account_id: params.accountId,
        store_id: params.storeId,
        connection_id: bundle.connection.id,
        import_job_id: importJobId,
        provider: "ebay",
        source_item_id: item.listingId || item.sku,
        sku: item.sku || null,
        title: item.title,
        quantity: item.quantity,
        price: item.price,
        currency: "USD",
        offer_status: item.offerStatus,
        listing_status: item.listingStatus,
        item_condition: item.condition,
        image_url: item.imageUrl,
        stage_status:
          item.sku && item.listingId ? "staged" : ("needs_review" as const),
        metadata: {
          source_marketplace: "ebay",
          source_listing_id: item.listingId,
          source_sku: item.sku || null,
          preview_only: true,
          staged_at: snapshot.fetchedAt,
          category_hint: item.categoryHint || null,
          category_confidence: item.categoryConfidence || null,
          review_required: item.reviewRequired === true,
          authenticity: item.authenticity || null,
          source_aspects: item.aspects || null,
        },
      }));
    const skippedCount = snapshot.sampleItems.length - stagedRows.length;

    if (stagedRows.length > 0) {
      const { error: stageError } = await params.supabase
        .from("seller_marketplace_staged_items")
        .upsert(stagedRows, {
          onConflict: "store_id,account_id,provider,source_item_id",
        });

      if (stageError) {
        throw stageError;
      }
    }

    const completedAt = new Date().toISOString();
    const status = skippedCount > 0 ? "completed_with_errors" : "completed";

    await params.supabase
      .from("seller_marketplace_import_jobs")
      .update({
        status,
        row_count: snapshot.sampleItems.length,
        staged_count: stagedRows.length,
        skipped_count: skippedCount,
        error_count: 0,
        source_cursor: {
          limit,
          offset,
          next_offset: nextOffset,
          has_more: hasMore,
          total_available: snapshot.totalAvailable,
        },
        metadata: {
          request_source: "seller_marketplaces_stage_batch",
          limit,
          offset,
          reset_cursor: params.resetCursor === true,
          fetched_at: snapshot.fetchedAt,
          quality_summary: importSummary.qualitySummary,
          skip_reason_summary: importSummary.skipReasonSummary,
        },
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", importJobId);

    await markSellerConnectionSyncState({
      supabase: params.supabase,
      connectionId: bundle.connection.id,
      status,
      completedAt,
      lastSyncError: null,
      importCursor: {
        ...previousCursor,
        stage_limit: limit,
        stage_last_offset: offset,
        stage_next_offset: nextOffset,
        stage_has_more: hasMore,
        stage_complete: !hasMore,
        stage_sampled: snapshot.sampleItems.length,
        stage_staged: stagedRows.length,
        stage_skipped: skippedCount,
        stage_total_available: snapshot.totalAvailable,
        stage_fetched_at: snapshot.fetchedAt,
      },
    });

    return {
      importJobId,
      connectionId: bundle.connection.id,
      offset,
      nextOffset,
      hasMore,
      stagedCount: stagedRows.length,
      skippedCount,
      totalAvailable: snapshot.totalAvailable,
      fetchedAt: snapshot.fetchedAt,
      sampleItems: snapshot.sampleItems,
    };
  } catch (error: any) {
    const failedAt = new Date().toISOString();

    await params.supabase
      .from("seller_marketplace_import_jobs")
      .update({
        status: "failed",
        error_count: 1,
        metadata: {
          request_source: "seller_marketplaces_stage_batch",
          limit,
          offset,
          reset_cursor: params.resetCursor === true,
          error: error.message || "Seller eBay staging failed",
        },
        completed_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", importJobId);

    await markSellerConnectionSyncState({
      supabase: params.supabase,
      connectionId: bundle.connection.id,
      status: "failed",
      completedAt: failedAt,
      lastSyncError: error.message || "Seller eBay staging failed",
    });

    throw error;
  }
}
