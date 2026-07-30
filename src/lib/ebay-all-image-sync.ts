import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listingImageAltText,
  listingImageIdentity,
  normalizeListingImageUrls,
  preferHighResolutionListingImage,
} from "./listing-image-utils";
import { getStoreSettings } from "./store-settings";

const TRADING_API_VERSION = "1409";
const PAGE_SIZE = 100;
const MAX_ACTIVE_LISTINGS = 3000;
const MAX_PAGES = Math.ceil(MAX_ACTIVE_LISTINGS / PAGE_SIZE);
const APPLY_CONCURRENCY = 8;
const DATABASE_PAGE_SIZE = 1000;
const MAX_DATABASE_PAGES = 50;
const PRODUCT_ID_CHUNK_SIZE = 100;
const INVENTORY_ID_CHUNK_SIZE = 20;
const MAX_ITEMS_PER_RUN = 1500;
const IMAGE_SYNC_VERSION = 3;

type InventoryImageRow = {
  id: string;
  inventory_item_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
};

type InventoryRow = {
  id: string;
  legacy_product_id: number;
  title: string;
  metadata: Record<string, unknown> | null;
};

type ProductRow = {
  id: number;
  title: string;
  ebay_item_id: string;
  image_url: string | null;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function syncErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message.slice(0, 400);
  if (typeof error === "string") return error.slice(0, 400);
  const value = recordValue(error);
  const parts = [
    value.message ? String(value.message) : null,
    value.code ? `code=${String(value.code)}` : null,
    value.details ? `details=${String(value.details)}` : null,
    value.hint ? `hint=${String(value.hint)}` : null,
  ].filter((part): part is string => Boolean(part));
  if (parts.length) return parts.join(" | ").slice(0, 400);
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== "{}") return serialized.slice(0, 400);
  } catch {
    // Fall through to the bounded generic message.
  }
  return fallback;
}

function decodeXml(value: string) {
  return value
    .trim()
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlBlock(xml: string, tag: string) {
  return (
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(
      xml,
    )?.[1] || null
  );
}

function xmlBlocks(xml: string, tag: string) {
  return Array.from(
    xml.matchAll(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi"),
    ),
    (match) => match[1],
  );
}

function xmlText(xml: string, tag: string) {
  const block = xmlBlock(xml, tag);
  return block === null ? null : decodeXml(block);
}

function nonNegativeInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function tradingEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/ws/api.dll"
    : "https://api.ebay.com/ws/api.dll";
}

function tokenEndpoint(environment: string) {
  return environment === "sandbox"
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";
}

async function getAccessToken(params: {
  supabase: SupabaseClient;
  storeId: string;
  environment: string;
}) {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Missing eBay client credentials.");

  const { data, error } = await params.supabase
    .from("ebay_tokens")
    .select("refresh_token")
    .eq("store_id", params.storeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.refresh_token) throw new Error("No store eBay refresh token is available.");

  const response = await fetch(tokenEndpoint(params.environment), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: String(data.refresh_token),
      scope: [
        "https://api.ebay.com/oauth/api_scope",
        "https://api.ebay.com/oauth/api_scope/sell.inventory",
      ].join(" "),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || "eBay token refresh failed.",
    );
  }
  return String(payload.access_token);
}

function activeSellerListEndRange() {
  const now = Date.now();
  return {
    endTimeFrom: new Date(now - 5 * 60 * 1000).toISOString(),
    endTimeTo: new Date(now + 119 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

async function readImagePage(params: {
  environment: string;
  accessToken: string;
  page: number;
  endTimeFrom: string;
  endTimeTo: string;
}) {
  const response = await fetch(tradingEndpoint(params.environment), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetSellerList",
      "X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_API_VERSION,
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-IAF-TOKEN": params.accessToken,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>High</WarningLevel>
  <EndTimeFrom>${params.endTimeFrom}</EndTimeFrom>
  <EndTimeTo>${params.endTimeTo}</EndTimeTo>
  <IncludeVariations>false</IncludeVariations>
  <Pagination>
    <EntriesPerPage>${PAGE_SIZE}</EntriesPerPage>
    <PageNumber>${params.page}</PageNumber>
  </Pagination>
</GetSellerListRequest>`,
    signal: AbortSignal.timeout(60_000),
  });
  const xml = await response.text();
  const ack = xmlText(xml, "Ack") || "Failure";
  if (!response.ok || !["Success", "Warning"].includes(ack)) {
    const errorBlock = xmlBlock(xml, "Errors") || xml;
    throw new Error(
      xmlText(errorBlock, "LongMessage") ||
        xmlText(errorBlock, "ShortMessage") ||
        `eBay GetSellerList image sync failed with ${response.status}.`,
    );
  }

  const itemArray = xmlBlock(xml, "ItemArray") || "";
  const items = xmlBlocks(itemArray, "Item");
  const listings = items.flatMap((itemXml) => {
    const itemId = xmlText(itemXml, "ItemID")?.trim();
    if (!itemId) return [];
    const pictureDetails = xmlBlock(itemXml, "PictureDetails") || "";
    const imageUrls = normalizeListingImageUrls([
      ...xmlBlocks(pictureDetails, "PictureURL").map(decodeXml),
      xmlText(pictureDetails, "GalleryURL"),
    ]);
    return [{ itemId, imageUrls }];
  });
  const pagination = xmlBlock(xml, "PaginationResult") || "";
  const totalPages = Math.max(
    nonNegativeInteger(xmlText(pagination, "TotalNumberOfPages")),
    1,
  );
  const hasMoreItems = xmlText(xml, "HasMoreItems") === "true";

  return {
    totalPages: hasMoreItems ? Math.max(totalPages, params.page + 1) : totalPages,
    listings,
  };
}

async function readAllListingImages(params: {
  environment: string;
  accessToken: string;
}) {
  const byItemId = new Map<string, string[]>();
  const endRange = activeSellerListEndRange();
  let totalPages = 1;
  let pagesRead = 0;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const result = await readImagePage({ ...params, ...endRange, page });
    totalPages = result.totalPages;
    pagesRead = page;
    for (const listing of result.listings) {
      byItemId.set(listing.itemId, listing.imageUrls);
    }
  }
  return {
    byItemId,
    pagesRead,
    cycleComplete: pagesRead >= totalPages,
    sourceCall: "GetSellerList" as const,
  };
}

function chooseFinalImages(remoteImages: string[], existingImages: InventoryImageRow[]) {
  const current = normalizeListingImageUrls(
    existingImages
      .slice()
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((image) => image.image_url),
  );
  if (!remoteImages.length) return current;
  return normalizeListingImageUrls([...remoteImages, ...current]);
}

function imageListsMatch(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (image, index) => listingImageIdentity(image) === listingImageIdentity(right[index]),
  );
}

async function synchronizeImageRows(params: {
  supabase: SupabaseClient;
  inventoryItemId: string;
  title: string;
  finalImages: string[];
  existingImages: InventoryImageRow[];
}) {
  if (!params.finalImages.length) return { added: 0, removed: 0 };

  const existingByIdentity = new Map<string, InventoryImageRow[]>();
  for (const row of params.existingImages) {
    const identity = listingImageIdentity(row.image_url);
    const rows = existingByIdentity.get(identity) || [];
    rows.push(row);
    existingByIdentity.set(identity, rows);
  }

  const { error: clearPrimaryError } = await params.supabase
    .from("inventory_images")
    .update({ is_primary: false })
    .eq("inventory_item_id", params.inventoryItemId);
  if (clearPrimaryError) throw clearPrimaryError;

  const usedIds = new Set<string>();
  let added = 0;
  for (const [index, imageUrl] of params.finalImages.entries()) {
    const identity = listingImageIdentity(imageUrl);
    const candidates = existingByIdentity.get(identity) || [];
    const exact = candidates.find(
      (row) => !usedIds.has(row.id) && row.image_url === imageUrl,
    );
    const normalizedMatch = candidates.find(
      (row) =>
        !usedIds.has(row.id) &&
        preferHighResolutionListingImage(row.image_url) === imageUrl,
    );
    const matched =
      exact || normalizedMatch || candidates.find((row) => !usedIds.has(row.id));
    const payload = {
      image_url: imageUrl,
      alt_text: listingImageAltText(params.title, index),
      sort_order: index,
      is_primary: index === 0,
    };

    if (matched) {
      usedIds.add(matched.id);
      const { error } = await params.supabase
        .from("inventory_images")
        .update(payload)
        .eq("id", matched.id)
        .eq("inventory_item_id", params.inventoryItemId);
      if (error) throw error;
    } else {
      const { error } = await params.supabase.from("inventory_images").insert({
        inventory_item_id: params.inventoryItemId,
        ...payload,
      });
      if (error) throw error;
      added += 1;
    }
  }

  const unusedIds = params.existingImages
    .filter((row) => !usedIds.has(row.id))
    .map((row) => row.id);
  if (unusedIds.length) {
    const { error } = await params.supabase
      .from("inventory_images")
      .delete()
      .eq("inventory_item_id", params.inventoryItemId)
      .in("id", unusedIds);
    if (error) throw error;
  }
  return { added, removed: unusedIds.length };
}

async function runWorkers<T>(items: T[], worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(APPLY_CONCURRENCY, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function readActiveProducts(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const rows: ProductRow[] = [];
  for (let page = 0; page < MAX_DATABASE_PAGES; page += 1) {
    const from = page * DATABASE_PAGE_SIZE;
    const { data, error } = await params.supabase
      .from("products")
      .select("id,title,ebay_item_id,image_url")
      .eq("store_id", params.storeId)
      .gt("quantity", 0)
      .not("ebay_item_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data || []) as ProductRow[];
    rows.push(...batch);
    if (batch.length < DATABASE_PAGE_SIZE) return rows;
  }
  throw new Error(`Active eBay product pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows.`);
}

async function readInventoriesByProductIds(params: {
  supabase: SupabaseClient;
  storeId: string;
  productIds: number[];
}) {
  const rows: InventoryRow[] = [];
  for (const productIds of chunkValues(params.productIds, PRODUCT_ID_CHUNK_SIZE)) {
    for (let page = 0; page < MAX_DATABASE_PAGES; page += 1) {
      const from = page * DATABASE_PAGE_SIZE;
      const { data, error } = await params.supabase
        .from("inventory_items")
        .select("id,legacy_product_id,title,metadata")
        .eq("store_id", params.storeId)
        .in("legacy_product_id", productIds)
        .order("legacy_product_id", { ascending: true })
        .range(from, from + DATABASE_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data || []) as InventoryRow[];
      rows.push(...batch);
      if (batch.length < DATABASE_PAGE_SIZE) break;
      if (page === MAX_DATABASE_PAGES - 1) throw new Error(`Inventory-item pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows for one product chunk.`);
    }
  }
  return rows;
}

async function readInventoryImagesByInventoryIds(params: {
  supabase: SupabaseClient;
  inventoryIds: string[];
}) {
  const rows: InventoryImageRow[] = [];
  for (const inventoryIds of chunkValues(params.inventoryIds, INVENTORY_ID_CHUNK_SIZE)) {
    for (let page = 0; page < MAX_DATABASE_PAGES; page += 1) {
      const from = page * DATABASE_PAGE_SIZE;
      const { data, error } = await params.supabase
        .from("inventory_images")
        .select("id,inventory_item_id,image_url,alt_text,sort_order,is_primary")
        .in("inventory_item_id", inventoryIds)
        .order("inventory_item_id", { ascending: true })
        .order("sort_order", { ascending: true })
        .range(from, from + DATABASE_PAGE_SIZE - 1);
      if (error) throw error;
      const batch = (data || []) as InventoryImageRow[];
      rows.push(...batch);
      if (batch.length < DATABASE_PAGE_SIZE) break;
      if (page === MAX_DATABASE_PAGES - 1) throw new Error(`Inventory-image pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows for one inventory chunk.`);
    }
  }
  return rows;
}

export async function syncEbayAllListingImages(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const checkedAt = new Date().toISOString();
  const settings = await getStoreSettings(params.supabase, params.storeId);
  const accessToken = await getAccessToken({
    ...params,
    environment: settings.ebayEnvironment,
  });
  const remote = await readAllListingImages({
    environment: settings.ebayEnvironment,
    accessToken,
  });

  const products = await readActiveProducts({
  supabase: params.supabase,
  storeId: params.storeId,
});
const productIds = products.map((product) => Number(product.id));
  if (!productIds.length) {
    return {
      checked: 0,
      updated: 0,
      imagesAdded: 0,
      imagesRemoved: 0,
      pagesRead: remote.pagesRead,
      cycleComplete: remote.cycleComplete,
      maxImagesPerListing: 20,
      remainingCandidates: 0,
      errors: [] as Array<{ legacyProductId: number; error: string }>,
    };
  }

  const inventories = await readInventoriesByProductIds({
  supabase: params.supabase,
  storeId: params.storeId,
  productIds,
});
const inventoryIds = inventories.map((inventory) => inventory.id);
const imageRows = inventoryIds.length
  ? await readInventoryImagesByInventoryIds({
      supabase: params.supabase,
      inventoryIds,
    })
  : [];

  const imagesByInventoryId = new Map<string, InventoryImageRow[]>();
  for (const image of (imageRows || []) as InventoryImageRow[]) {
    const rows = imagesByInventoryId.get(image.inventory_item_id) || [];
    rows.push(image);
    imagesByInventoryId.set(image.inventory_item_id, rows);
  }
  const productById = new Map(products.map((product) => [Number(product.id), product]));

  const allCandidates = inventories.flatMap((inventory) => {
    const product = productById.get(Number(inventory.legacy_product_id));
    if (!product) return [];
    const remoteImages = remote.byItemId.get(String(product.ebay_item_id || "")) || [];
    const existingImages = imagesByInventoryId.get(inventory.id) || [];
    const finalImages = chooseFinalImages(remoteImages, existingImages);
    const currentImages = normalizeListingImageUrls(
      existingImages
        .slice()
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((image) => image.image_url),
    );
    const hasSortCollision =
      new Set(existingImages.map((image) => image.sort_order)).size !==
      existingImages.length;
    return !imageListsMatch(currentImages, finalImages) || hasSortCollision
      ? [{ inventory, product, remoteImages, existingImages, finalImages }]
      : [];
  });
  const candidates = allCandidates.slice(0, MAX_ITEMS_PER_RUN);

  let updated = 0;
  let imagesAdded = 0;
  let imagesRemoved = 0;
  const errors: Array<{ legacyProductId: number; error: string }> = [];

  await runWorkers(candidates, async (candidate) => {
    try {
      const result = await synchronizeImageRows({
        supabase: params.supabase,
        inventoryItemId: candidate.inventory.id,
        title: candidate.product.title || candidate.inventory.title,
        finalImages: candidate.finalImages,
        existingImages: candidate.existingImages,
      });
      const metadata = {
        ...recordValue(candidate.inventory.metadata),
        ebay_image_urls: candidate.remoteImages,
        ebay_all_image_sync_version: IMAGE_SYNC_VERSION,
        ebay_all_image_sync_at: checkedAt,
        ebay_all_image_count: candidate.finalImages.length,
      };
      const { error: inventoryUpdateError } = await params.supabase
        .from("inventory_items")
        .update({ metadata, updated_at: checkedAt })
        .eq("id", candidate.inventory.id)
        .eq("store_id", params.storeId);
      if (inventoryUpdateError) throw inventoryUpdateError;

      if (candidate.finalImages[0]) {
        const { error: productUpdateError } = await params.supabase
          .from("products")
          .update({ image_url: candidate.finalImages[0] })
          .eq("id", candidate.product.id)
          .eq("store_id", params.storeId);
        if (productUpdateError) throw productUpdateError;
      }
      updated += 1;
      imagesAdded += result.added;
      imagesRemoved += result.removed;
    } catch (error) {
      errors.push({
        legacyProductId: Number(candidate.inventory.legacy_product_id),
        error: syncErrorMessage(error, "Unknown image sync error"),
      });
    }
  });

  return {
    checked: candidates.length,
    updated,
    imagesAdded,
    imagesRemoved,
    pagesRead: remote.pagesRead,
    cycleComplete: remote.cycleComplete,
    maxImagesPerListing: 20,
    remainingCandidates: Math.max(allCandidates.length - candidates.length, 0),
    errors,
  };
}
