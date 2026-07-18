import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import {
  normalizeEbayDuplicateProductIds,
  planEbayDuplicateQuantityMerge,
} from "../../../../lib/ebay-duplicate-merge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ProductRow = {
  id: number;
  sku: string | null;
  title: string | null;
  price: number | string | null;
  quantity: number | null;
  image_url: string | null;
  ebay_item_id: string | null;
  last_seen_at: string | null;
  created_at: string | null;
};

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  status: string | null;
  quantity: number | null;
  price: number | string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type EbayOfferSummary = {
  offerId: string | null;
  status: string | null;
  listingId: string | null;
  listingStatus: string | null;
  listingOnHold: boolean;
  price: number | null;
};

let ebayStoreTokenCache:
  | {
      token: string;
      expiresAt: number;
    }
  | null = null;

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function generatedSku(product: ProductRow) {
  return cleanText(product.sku) || `EBAY-${cleanText(product.ebay_item_id) || product.id}`;
}

function duplicateIdentityKey(product: ProductRow) {
  const normalizedTitle = String(product.title || "")
    .toLowerCase()
    .replace(/\b(listing|lot|card|cards)\b/g, " ")
    .replace(/[^a-z0-9#/.+-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const priceCents = Math.round(moneyNumber(product.price) * 100);

  if (!normalizedTitle || priceCents <= 0) return null;

  return `${normalizedTitle}::${priceCents}`;
}

function rowForClient(product: ProductRow, inventory: InventoryRow | null) {
  return {
    productId: product.id,
    inventoryItemId: inventory?.id ?? null,
    sku: product.sku,
    title: product.title || "Untitled eBay listing",
    price: moneyNumber(product.price),
    quantity: wholeQuantity(product.quantity),
    imageUrl: product.image_url,
    ebayItemId: product.ebay_item_id,
    lastSeenAt: product.last_seen_at,
    createdAt: product.created_at,
    inventoryStatus: inventory?.status ?? "missing",
    inventoryQuantity: inventory?.quantity ?? null,
    inventoryPrice: inventory ? moneyNumber(inventory.price) : null,
  };
}

async function loadInventoryRows(productIds: number[]) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const rows: InventoryRow[] = [];

  for (let index = 0; index < productIds.length; index += 100) {
    const batch = productIds.slice(index, index + 100);

    if (batch.length === 0) continue;

    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,status,quantity,price,metadata,updated_at")
      .eq("store_id", storeId)
      .in("legacy_product_id", batch)
      .range(0, 4999);

    if (error) throw error;
    rows.push(...((data || []) as InventoryRow[]));
  }

  return rows;
}

async function buildDuplicateGroups() {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("products")
    .select("id,sku,title,price,quantity,image_url,ebay_item_id,last_seen_at,created_at")
    .eq("store_id", storeId)
    .not("ebay_item_id", "is", null)
    .gt("quantity", 0)
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .range(0, 2999);

  if (error) throw error;

  const products = (data || []) as ProductRow[];
  const inventoryRows = await loadInventoryRows(products.map((product) => product.id));
  const inventoryByProductId = new Map<number, InventoryRow>();

  for (const row of inventoryRows) {
    if (row.legacy_product_id) inventoryByProductId.set(Number(row.legacy_product_id), row);
  }

  const grouped = new Map<string, ProductRow[]>();

  for (const product of products) {
    const key = duplicateIdentityKey(product);
    const inventory = inventoryByProductId.get(product.id);

    if (!key) continue;
    if (inventory && inventory.status && inventory.status !== "active") continue;

    grouped.set(key, [...(grouped.get(key) || []), product]);
  }

  return Array.from(grouped.entries())
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => {
      const sortedRows = [...rows].sort((left, right) => {
        const leftSeen = String(left.last_seen_at || left.created_at || "");
        const rightSeen = String(right.last_seen_at || right.created_at || "");
        const seenCompare = rightSeen.localeCompare(leftSeen);
        if (seenCompare !== 0) return seenCompare;
        return left.id - right.id;
      });
      const price = moneyNumber(sortedRows[0]?.price);
      const clientRows = sortedRows.map((row) =>
        rowForClient(row, inventoryByProductId.get(row.id) ?? null),
      );

      return {
        key,
        title: sortedRows[0]?.title || "Untitled eBay listing",
        price,
        count: sortedRows.length,
        totalQuantity: sortedRows.reduce((sum, row) => sum + wholeQuantity(row.quantity), 0),
        recommendedKeeperProductId: sortedRows[0]?.id ?? null,
        rows: clientRows,
      };
    })
    .sort((left, right) => right.totalQuantity - left.totalQuantity || right.count - left.count);
}

async function getEbayStoreAccessToken(storeId: string) {
  if (ebayStoreTokenCache && ebayStoreTokenCache.expiresAt > Date.now()) {
    return ebayStoreTokenCache.token;
  }

  if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) {
    return null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data?.refresh_token) return null;

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
  ).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(data.refresh_token),
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory",
    }),
  });
  const tokenData = await response.json().catch(() => ({}));

  if (!response.ok || !tokenData.access_token) {
    ebayStoreTokenCache = null;
    return null;
  }

  const expiresInSeconds = Number(tokenData.expires_in || 0);
  ebayStoreTokenCache = {
    token: String(tokenData.access_token),
    expiresAt:
      Date.now() +
      (Number.isFinite(expiresInSeconds) && expiresInSeconds > 120
        ? (expiresInSeconds - 60) * 1000
        : 30 * 60 * 1000),
  };

  return ebayStoreTokenCache.token;
}

function ebayHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
  };
}

async function fetchEbayOffers(params: {
  accessToken: string;
  sku: string;
}): Promise<EbayOfferSummary[]> {
  const response = await fetch(
    `https://api.ebay.com/sell/inventory/v1/offer?sku=${encodeURIComponent(params.sku)}`,
    { headers: ebayHeaders(params.accessToken) },
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) return [];

  return (Array.isArray(data.offers) ? data.offers : []).map((offer: any) => ({
    offerId: cleanText(offer?.offerId),
    status: cleanText(offer?.status),
    listingId: cleanText(offer?.listing?.listingId),
    listingStatus: cleanText(offer?.listing?.listingStatus),
    listingOnHold: offer?.listing?.listingOnHold === true,
    price: moneyNumber(offer?.pricingSummary?.price?.value) || null,
  }));
}

function matchingOffer(offers: EbayOfferSummary[], ebayItemId: string | null) {
  return (
    (ebayItemId
      ? offers.find((offer) => offer.listingId === ebayItemId)
      : null) ||
    offers.find(
      (offer) => offer.status === "PUBLISHED" && offer.listingStatus === "ACTIVE",
    ) ||
    offers[0] ||
    null
  );
}

async function withdrawDuplicateOffer(params: {
  accessToken: string;
  duplicate: ProductRow;
}) {
  const offers = await fetchEbayOffers({
    accessToken: params.accessToken,
    sku: generatedSku(params.duplicate),
  });
  const offer = matchingOffer(offers, cleanText(params.duplicate.ebay_item_id));

  if (!offer?.offerId) {
    return { ok: false, skipped: true, message: "No duplicate eBay offer found." };
  }

  if (offer.status !== "PUBLISHED" || offer.listingStatus !== "ACTIVE") {
    return {
      ok: true,
      skipped: true,
      offerId: offer.offerId,
      message: `Duplicate eBay offer already ${offer.status || "unknown"} / ${
        offer.listingStatus || "unknown"
      }.`,
    };
  }

  const response = await fetch(
    `https://api.ebay.com/sell/inventory/v1/offer/${encodeURIComponent(
      offer.offerId,
    )}/withdraw`,
    {
      method: "POST",
      headers: ebayHeaders(params.accessToken),
      body: JSON.stringify({}),
    },
  );
  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    skipped: false,
    offerId: offer.offerId,
    status: response.status,
    message: response.ok
      ? "Duplicate eBay offer withdrawn."
      : `Duplicate eBay withdraw failed: ${JSON.stringify(data).slice(0, 500)}`,
  };
}

async function updateKeeperEbayQuantity(params: {
  accessToken: string;
  keeper: ProductRow;
  quantity: number;
  price: number;
}) {
  const offers = await fetchEbayOffers({
    accessToken: params.accessToken,
    sku: generatedSku(params.keeper),
  });
  const offer = matchingOffer(offers, cleanText(params.keeper.ebay_item_id));

  if (!offer?.offerId) {
    return { ok: false, skipped: true, message: "No keeper eBay offer found." };
  }

  const response = await fetch(
    "https://api.ebay.com/sell/inventory/v1/bulk_update_price_quantity",
    {
      method: "POST",
      headers: ebayHeaders(params.accessToken),
      body: JSON.stringify({
        requests: [
          {
            sku: generatedSku(params.keeper),
            shipToLocationAvailability: {
              quantity: params.quantity,
            },
            offers: [
              {
                offerId: offer.offerId,
                availableQuantity: params.quantity,
                price: {
                  currency: "USD",
                  value: String(params.price),
                },
              },
            ],
          },
        ],
      }),
    },
  );
  const data = await response.json().catch(() => ({}));

  return {
    ok: response.ok,
    skipped: false,
    offerId: offer.offerId,
    status: response.status,
    message: response.ok
      ? "Keeper eBay quantity/price updated."
      : `Keeper eBay quantity update failed: ${JSON.stringify(data).slice(0, 500)}`,
  };
}

async function bestEffortEbayAction(
  action: string,
  operation: () => Promise<Record<string, unknown>>,
) {
  try {
    return { action, ...(await operation()) };
  } catch (error) {
    return {
      action,
      ok: false,
      skipped: true,
      message:
        error instanceof Error
          ? `${action} skipped: ${error.message}`
          : `${action} skipped due to an unknown eBay error.`,
    };
  }
}

async function getBestEffortEbayStoreAccessToken(storeId: string) {
  try {
    return await getEbayStoreAccessToken(storeId);
  } catch (error) {
    return {
      token: null,
      action: "ebay_token_lookup",
      ok: false,
      skipped: true,
      message:
        error instanceof Error
          ? `eBay token lookup skipped: ${error.message}`
          : "eBay token lookup skipped due to an unknown error.",
    };
  }
}

async function loadProductForMerge(productId: number) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("products")
    .select("id,sku,title,price,quantity,image_url,ebay_item_id,last_seen_at,created_at")
    .eq("store_id", storeId)
    .eq("id", productId)
    .limit(1);

  if (error) throw error;

  const row = ((data || []) as ProductRow[])[0] || null;

  if (!row) {
    throw new Error(`Product ${productId} was not found. Refresh duplicates and try again.`);
  }

  return row;
}

async function loadInventoryForProduct(productId: number) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,status,quantity,price,metadata,updated_at")
    .eq("store_id", storeId)
    .eq("legacy_product_id", productId)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) throw error;

  return (((data || []) as InventoryRow[])[0] || null) as InventoryRow | null;
}

async function collectMergeEbayActions(params: {
  storeId: string;
  keeper: ProductRow;
  duplicates: ProductRow[];
  mergedQuantity: number;
  keeperPrice: number;
}) {
  const tokenResult = await getBestEffortEbayStoreAccessToken(params.storeId);
  const ebayActions: Array<Record<string, unknown>> = [];
  const accessToken =
    typeof tokenResult === "string" ? tokenResult : tokenResult?.token ?? null;

  if (tokenResult && typeof tokenResult !== "string" && tokenResult.action) {
    ebayActions.push(tokenResult);
  }

  if (!accessToken) {
    ebayActions.push({
      action: "ebay_skipped",
      ok: false,
      skipped: true,
      message:
        "No eBay seller access token available. Local TCOS merge still completed.",
    });
    return ebayActions;
  }

  for (const duplicate of params.duplicates) {
    ebayActions.push(
      await bestEffortEbayAction(
        `withdraw_duplicate_offer:${duplicate.id}`,
        () =>
          withdrawDuplicateOffer({
            accessToken,
            duplicate,
          }),
      ),
    );
  }

  ebayActions.push(
    await bestEffortEbayAction("update_keeper_quantity", () =>
      updateKeeperEbayQuantity({
        accessToken,
        keeper: params.keeper,
        quantity: params.mergedQuantity,
        price: params.keeperPrice,
      }),
    ),
  );

  return ebayActions;
}

async function collectArchiveEbayActions(params: {
  storeId: string;
  duplicate: ProductRow;
}) {
  const tokenResult = await getBestEffortEbayStoreAccessToken(params.storeId);
  const ebayActions: Array<Record<string, unknown>> = [];
  const accessToken =
    typeof tokenResult === "string" ? tokenResult : tokenResult?.token ?? null;

  if (tokenResult && typeof tokenResult !== "string" && tokenResult.action) {
    ebayActions.push(tokenResult);
  }

  if (!accessToken) {
    ebayActions.push({
      action: "ebay_skipped",
      ok: false,
      skipped: true,
      message:
        "No eBay seller access token available. Local TCOS archive still completed.",
    });
    return ebayActions;
  }

  ebayActions.push(
    await bestEffortEbayAction("withdraw_duplicate_offer", () =>
      withdrawDuplicateOffer({
        accessToken,
        duplicate: params.duplicate,
      }),
    ),
  );

  return ebayActions;
}

async function mergeDuplicate(params: {
  keeperProductId: number;
  duplicateProductId: number;
}) {
  return mergeDuplicateRows({
    keeperProductId: params.keeperProductId,
    duplicateProductIds: [params.duplicateProductId],
  });
}

async function mergeDuplicateRows(params: {
  keeperProductId: number;
  duplicateProductIds: number[];
}) {
  const requestedDuplicateIds = normalizeEbayDuplicateProductIds(
    params.duplicateProductIds,
  ).filter((productId) => productId !== params.keeperProductId);

  if (!requestedDuplicateIds.length) {
    throw new Error("Pick at least one duplicate row different from the keeper.");
  }

  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const [keeper, keeperInventory, duplicates, duplicateInventories] = await Promise.all([
    loadProductForMerge(params.keeperProductId),
    loadInventoryForProduct(params.keeperProductId),
    Promise.all(requestedDuplicateIds.map((productId) => loadProductForMerge(productId))),
    Promise.all(requestedDuplicateIds.map((productId) => loadInventoryForProduct(productId))),
  ]);
  const keeperKey = duplicateIdentityKey(keeper);

  if (!keeperKey) {
    throw new Error("Keeper row does not look like an active exact-match eBay listing.");
  }

  for (const duplicate of duplicates) {
    const duplicateKey = duplicateIdentityKey(duplicate);

    if (keeperKey !== duplicateKey) {
      throw new Error(
        `Product ${duplicate.id} does not look like an exact duplicate of keeper ${keeper.id}.`,
      );
    }
  }

  const mergePlan = planEbayDuplicateQuantityMerge({
    keeperProductId: keeper.id,
    keeperQuantity: keeper.quantity,
    duplicateRows: duplicates.map((duplicate) => ({
      productId: duplicate.id,
      quantity: duplicate.quantity,
    })),
  });
  const keeperQuantity = mergePlan.previousKeeperQuantity;
  const duplicateQuantity = mergePlan.duplicateQuantity;
  const mergedQuantity = mergePlan.mergedQuantity;
  const keeperPrice = moneyNumber(keeper.price);
  const now = new Date().toISOString();
  const ebayActions = await collectMergeEbayActions({
    storeId,
    keeper,
    duplicates,
    mergedQuantity,
    keeperPrice,
  });

  const keeperMetadata =
    keeperInventory?.metadata && typeof keeperInventory.metadata === "object"
      ? { ...keeperInventory.metadata }
      : {};

  const { error: keeperProductError } = await supabase
    .from("products")
    .update({
      quantity: mergedQuantity,
      price: keeperPrice,
      last_seen_at: now,
    })
    .eq("store_id", storeId)
    .eq("id", keeper.id);

  if (keeperProductError) throw keeperProductError;

  const { error: duplicateProductError } = await supabase
    .from("products")
    .update({
      quantity: 0,
      last_seen_at: now,
    })
    .eq("store_id", storeId)
    .in(
      "id",
      duplicates.map((duplicate) => duplicate.id),
    );

  if (duplicateProductError) throw duplicateProductError;

  if (keeperInventory?.id) {
    const { error } = await supabase
      .from("inventory_items")
      .update({
        quantity: mergedQuantity,
        price: keeperPrice,
        status: "active",
        updated_at: now,
        metadata: {
          ...keeperMetadata,
          duplicate_merge_keeper: {
            merged_at: now,
            duplicate_product_ids: duplicates.map((duplicate) => duplicate.id),
            duplicate_ebay_item_ids: duplicates
              .map((duplicate) => duplicate.ebay_item_id)
              .filter(Boolean),
            previous_quantity: keeperQuantity,
            added_quantity: duplicateQuantity,
            merged_quantity: mergedQuantity,
            ebay_actions: ebayActions,
          },
        },
      })
      .eq("store_id", storeId)
      .eq("id", keeperInventory.id);

    if (error) throw error;
  }

  for (const [index, duplicate] of duplicates.entries()) {
    const duplicateInventory = duplicateInventories[index];

    if (!duplicateInventory?.id) continue;

    const duplicateMetadata =
      duplicateInventory.metadata && typeof duplicateInventory.metadata === "object"
        ? { ...duplicateInventory.metadata }
        : {};

    const { error } = await supabase
      .from("inventory_items")
      .update({
        quantity: 0,
        status: "archived",
        updated_at: now,
        metadata: {
          ...duplicateMetadata,
          duplicate_merge_archived: {
            merged_at: now,
            keeper_product_id: keeper.id,
            keeper_ebay_item_id: keeper.ebay_item_id,
            duplicate_product_id: duplicate.id,
            duplicate_ebay_item_id: duplicate.ebay_item_id,
            moved_quantity: wholeQuantity(duplicate.quantity),
            ebay_actions: ebayActions,
          },
        },
      })
      .eq("store_id", storeId)
      .eq("id", duplicateInventory.id);

    if (error) throw error;
  }

  return {
    keeperProductId: keeper.id,
    duplicateProductId: duplicates[0]?.id ?? null,
    duplicateProductIds: mergePlan.duplicateProductIds,
    title: keeper.title || "Untitled eBay listing",
    price: keeperPrice,
    previousKeeperQuantity: keeperQuantity,
    duplicateQuantity,
    mergedQuantity,
    archivedDuplicateCount: mergePlan.archivedDuplicateCount,
    ebayActions,
  };
}

async function previewMergeDuplicate(params: {
  keeperProductId: number;
  duplicateProductId: number;
}) {
  if (params.keeperProductId === params.duplicateProductId) {
    throw new Error("Keeper and duplicate must be different rows.");
  }

  const [keeper, duplicate] = await Promise.all([
    loadProductForMerge(params.keeperProductId),
    loadProductForMerge(params.duplicateProductId),
  ]);
  const keeperKey = duplicateIdentityKey(keeper);
  const duplicateKey = duplicateIdentityKey(duplicate);

  if (!keeperKey || keeperKey !== duplicateKey) {
    throw new Error("Those rows do not look like exact duplicate listings.");
  }

  const keeperQuantity = wholeQuantity(keeper.quantity);
  const duplicateQuantity = wholeQuantity(duplicate.quantity);

  return {
    keeperProductId: keeper.id,
    duplicateProductId: duplicate.id,
    title: keeper.title || "Untitled eBay listing",
    price: moneyNumber(keeper.price),
    previousKeeperQuantity: keeperQuantity,
    duplicateQuantity,
    mergedQuantity: keeperQuantity + duplicateQuantity,
    dryRun: true,
  };
}

async function previewMergeDuplicateRows(params: {
  keeperProductId: number;
  duplicateProductIds: number[];
}) {
  const requestedDuplicateIds = normalizeEbayDuplicateProductIds(
    params.duplicateProductIds,
  ).filter((productId) => productId !== params.keeperProductId);

  if (!requestedDuplicateIds.length) {
    throw new Error("Pick at least one duplicate row different from the keeper.");
  }

  const [keeper, duplicates] = await Promise.all([
    loadProductForMerge(params.keeperProductId),
    Promise.all(requestedDuplicateIds.map((productId) => loadProductForMerge(productId))),
  ]);
  const keeperKey = duplicateIdentityKey(keeper);

  if (!keeperKey) {
    throw new Error("Keeper row does not look like an active exact-match eBay listing.");
  }

  for (const duplicate of duplicates) {
    const duplicateKey = duplicateIdentityKey(duplicate);

    if (keeperKey !== duplicateKey) {
      throw new Error(
        `Product ${duplicate.id} does not look like an exact duplicate of keeper ${keeper.id}.`,
      );
    }
  }

  const mergePlan = planEbayDuplicateQuantityMerge({
    keeperProductId: keeper.id,
    keeperQuantity: keeper.quantity,
    duplicateRows: duplicates.map((duplicate) => ({
      productId: duplicate.id,
      quantity: duplicate.quantity,
    })),
  });

  return {
    keeperProductId: keeper.id,
    duplicateProductId: duplicates[0]?.id ?? null,
    duplicateProductIds: mergePlan.duplicateProductIds,
    title: keeper.title || "Untitled eBay listing",
    price: moneyNumber(keeper.price),
    previousKeeperQuantity: mergePlan.previousKeeperQuantity,
    duplicateQuantity: mergePlan.duplicateQuantity,
    mergedQuantity: mergePlan.mergedQuantity,
    archivedDuplicateCount: mergePlan.archivedDuplicateCount,
    dryRun: true,
  };
}

async function archiveDuplicate(params: { duplicateProductId: number }) {
  const supabase = getSupabaseClient();
  const storeId = getActiveStoreId();
  const duplicate = await loadProductForMerge(params.duplicateProductId);
  const duplicateInventory = await loadInventoryForProduct(params.duplicateProductId);
  const duplicateQuantity = wholeQuantity(duplicate.quantity);
  const now = new Date().toISOString();
  const duplicateMetadata =
    duplicateInventory?.metadata && typeof duplicateInventory.metadata === "object"
      ? { ...duplicateInventory.metadata }
      : {};
  const ebayActions = await collectArchiveEbayActions({
    storeId,
    duplicate,
  });

  const { error: duplicateProductError } = await supabase
    .from("products")
    .update({
      quantity: 0,
      last_seen_at: now,
    })
    .eq("store_id", storeId)
    .eq("id", duplicate.id);

  if (duplicateProductError) throw duplicateProductError;

  if (duplicateInventory?.id) {
    const { error } = await supabase
      .from("inventory_items")
      .update({
        quantity: 0,
        status: "archived",
        updated_at: now,
        metadata: {
          ...duplicateMetadata,
          duplicate_manual_archived: {
            archived_at: now,
            duplicate_product_id: duplicate.id,
            duplicate_ebay_item_id: duplicate.ebay_item_id,
            previous_quantity: duplicateQuantity,
            ebay_actions: ebayActions,
          },
        },
      })
      .eq("store_id", storeId)
      .eq("id", duplicateInventory.id);

    if (error) throw error;
  }

  return {
    duplicateProductId: duplicate.id,
    title: duplicate.title || "Untitled eBay listing",
    previousQuantity: duplicateQuantity,
    ebayActions,
  };
}

async function previewArchiveDuplicate(params: { duplicateProductId: number }) {
  const duplicate = await loadProductForMerge(params.duplicateProductId);
  const duplicateInventory = await loadInventoryForProduct(params.duplicateProductId);
  const duplicateQuantity = wholeQuantity(duplicate.quantity);

  return {
    duplicateProductId: duplicate.id,
    title: duplicate.title || "Untitled eBay listing",
    previousQuantity: duplicateQuantity,
    previousInventoryQuantity:
      duplicateInventory?.quantity === null ||
      duplicateInventory?.quantity === undefined
        ? null
        : wholeQuantity(duplicateInventory.quantity),
    inventoryStatus: duplicateInventory?.status ?? "missing",
    dryRun: true,
  };
}

export async function GET() {
  try {
    const groups = await buildDuplicateGroups();

    return Response.json({
      success: true,
      groups,
      summary: {
        groups: groups.length,
        duplicateRows: groups.reduce((sum, group) => sum + Math.max(0, group.count - 1), 0),
        totalRowsInGroups: groups.reduce((sum, group) => sum + group.count, 0),
      },
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message || "Could not find duplicates." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = cleanText(body.action);

    if (
      action !== "merge-duplicate" &&
      action !== "merge-duplicates" &&
      action !== "end-duplicate"
    ) {
      return Response.json(
        { success: false, error: "Unsupported duplicate action." },
        { status: 400 },
      );
    }

    if (
      (action === "merge-duplicate" && body.confirm !== "MERGE_DUPLICATE") ||
      (action === "merge-duplicates" && body.confirm !== "MERGE_DUPLICATES") ||
      (action === "end-duplicate" && body.confirm !== "END_DUPLICATE")
    ) {
      return Response.json(
        {
          success: false,
          error: "Confirmation is required before ending/merging duplicate listings.",
        },
        { status: 400 },
      );
    }

    if (action === "end-duplicate") {
      const duplicateProductId = positiveInteger(body.duplicateProductId);

      if (!duplicateProductId) {
        return Response.json(
          { success: false, error: "Duplicate product ID is required." },
          { status: 400 },
        );
      }

      if (body.dryRun === true) {
        const result = await previewArchiveDuplicate({ duplicateProductId });

        return Response.json({
          success: true,
          result,
          message: `Dry run: product #${result.duplicateProductId} quantity ${result.previousQuantity} will be archived to 0.`,
        });
      }

      const result = await archiveDuplicate({ duplicateProductId });

      return Response.json({
        success: true,
        result,
        message: `Ended/archived duplicate locally. Previous quantity was ${result.previousQuantity}.`,
      });
    }

    const keeperProductId = positiveInteger(body.keeperProductId);
    const requestedDuplicateIds =
      action === "merge-duplicates"
        ? normalizeEbayDuplicateProductIds(body.duplicateProductIds)
        : normalizeEbayDuplicateProductIds(body.duplicateProductId);
    const duplicateProductId = requestedDuplicateIds[0] || 0;

    if (!keeperProductId || !requestedDuplicateIds.length) {
      return Response.json(
        { success: false, error: "Keeper and duplicate product IDs are required." },
        { status: 400 },
      );
    }

    if (body.dryRun === true) {
      const result =
        action === "merge-duplicates"
          ? await previewMergeDuplicateRows({
              keeperProductId,
              duplicateProductIds: requestedDuplicateIds,
            })
          : await previewMergeDuplicate({
              keeperProductId,
              duplicateProductId,
            });

      return Response.json({
        success: true,
        result,
        message: `Dry run: quantity ${result.previousKeeperQuantity} + ${result.duplicateQuantity} = ${result.mergedQuantity}.`,
      });
    }

    const result =
      action === "merge-duplicates"
        ? await mergeDuplicateRows({
            keeperProductId,
            duplicateProductIds: requestedDuplicateIds,
          })
        : await mergeDuplicate({
            keeperProductId,
            duplicateProductId,
          });

    return Response.json({
      success: true,
      result,
      message: `Merged ${result.archivedDuplicateCount || 1} duplicate row${
        (result.archivedDuplicateCount || 1) === 1 ? "" : "s"
      } into keeper. Quantity ${result.previousKeeperQuantity} + ${result.duplicateQuantity} = ${result.mergedQuantity}.`,
    });
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message || "Could not merge duplicate." },
      { status: 500 },
    );
  }
}
