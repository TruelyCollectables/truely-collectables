import type { SupabaseClient } from "@supabase/supabase-js";
import {
  companionBackListingImageUrl,
  listingImageAltText,
  listingImageIdentity,
  listingImageSide,
} from "./listing-image-utils";

const DATABASE_PAGE_SIZE = 1000;
const MAX_DATABASE_PAGES = 50;
const INVENTORY_ID_CHUNK_SIZE = 20;
const VERIFY_CONCURRENCY = 12;

type InventoryItemRow = {
  id: string;
  title: string;
};

type InventoryImageRow = {
  id: string;
  inventory_item_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
};

type Candidate = {
  inventory: InventoryItemRow;
  image: InventoryImageRow;
  companionUrl: string;
  insert: boolean;
  nextSortOrder: number;
};

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function readStoreInventoryItems(params: {
  supabase: SupabaseClient;
  storeId: string;
}) {
  const rows: InventoryItemRow[] = [];
  for (let page = 0; page < MAX_DATABASE_PAGES; page += 1) {
    const from = page * DATABASE_PAGE_SIZE;
    const { data, error } = await params.supabase
      .from("inventory_items")
      .select("id,title")
      .eq("store_id", params.storeId)
      .order("id", { ascending: true })
      .range(from, from + DATABASE_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data || []) as InventoryItemRow[];
    rows.push(...batch);
    if (batch.length < DATABASE_PAGE_SIZE) return rows;
  }
  throw new Error(
    `Inventory pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows.`,
  );
}

async function readInventoryImages(params: {
  supabase: SupabaseClient;
  inventoryIds: string[];
}) {
  const rows: InventoryImageRow[] = [];
  for (const inventoryIds of chunkValues(
    params.inventoryIds,
    INVENTORY_ID_CHUNK_SIZE,
  )) {
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
      if (page === MAX_DATABASE_PAGES - 1) {
        throw new Error(
          `Image pagination exceeded ${MAX_DATABASE_PAGES * DATABASE_PAGE_SIZE} rows for one inventory chunk.`,
        );
      }
    }
  }
  return rows;
}

async function verifyRemoteImage(url: string) {
  const request = async (method: "HEAD" | "GET") =>
    fetch(url, {
      method,
      redirect: "follow",
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      signal: AbortSignal.timeout(15_000),
    });

  let response = await request("HEAD");
  if (response.status === 405 || response.status === 501) {
    response = await request("GET");
  }

  const contentType = response.headers.get("content-type") || "";
  return (
    (response.status === 200 || response.status === 206) &&
    contentType.toLowerCase().startsWith("image/")
  );
}

async function runWorkers<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(VERIFY_CONCURRENCY, Math.max(items.length, 1)) },
      () => run(),
    ),
  );
}

function buildCandidates(params: {
  inventories: InventoryItemRow[];
  imageRows: InventoryImageRow[];
}) {
  const imagesByInventoryId = new Map<string, InventoryImageRow[]>();
  for (const image of params.imageRows) {
    const rows = imagesByInventoryId.get(image.inventory_item_id) || [];
    rows.push(image);
    imagesByInventoryId.set(image.inventory_item_id, rows);
  }

  const candidates: Candidate[] = [];
  for (const inventory of params.inventories) {
    const rows = (imagesByInventoryId.get(inventory.id) || []).slice().sort(
      (left, right) => left.sort_order - right.sort_order,
    );
    if (!rows.length) continue;

    const identities = new Set(
      rows.map((row) => listingImageIdentity(row.image_url)).filter(Boolean),
    );
    if (rows.some((row) => listingImageSide(row.image_url) === "back")) {
      continue;
    }

    const source =
      rows.find(
        (row) =>
          !row.is_primary && listingImageSide(row.image_url) === "front",
      ) || rows.find((row) => listingImageSide(row.image_url) === "front");
    if (!source) continue;

    const companionUrl = companionBackListingImageUrl(source.image_url);
    const companionIdentity = listingImageIdentity(companionUrl);
    if (
      !companionUrl ||
      !companionIdentity ||
      identities.has(companionIdentity)
    ) {
      continue;
    }

    candidates.push({
      inventory,
      image: source,
      companionUrl,
      insert: source.is_primary || source.sort_order === 0,
      nextSortOrder: Math.max(...rows.map((row) => row.sort_order), 0) + 1,
    });
  }
  return candidates;
}

export async function syncVerifiedCompanionBackImages(params: {
  supabase: SupabaseClient;
  storeId: string;
  limit?: number;
}) {
  const inventories = await readStoreInventoryItems(params);
  const imageRows = inventories.length
    ? await readInventoryImages({
        supabase: params.supabase,
        inventoryIds: inventories.map((inventory) => inventory.id),
      })
    : [];
  const allCandidates = buildCandidates({ inventories, imageRows });
  const candidates = allCandidates.slice(0, params.limit ?? allCandidates.length);

  let verified = 0;
  let updated = 0;
  let inserted = 0;
  let missing = 0;
  const errors: Array<{
    inventoryItemId: string;
    legacyImageUrl: string;
    error: string;
  }> = [];

  await runWorkers(candidates, async (candidate) => {
    try {
      const exists = await verifyRemoteImage(candidate.companionUrl);
      if (!exists) {
        missing += 1;
        return;
      }
      verified += 1;

      if (candidate.insert) {
        const { error } = await params.supabase.from("inventory_images").insert({
          inventory_item_id: candidate.inventory.id,
          image_url: candidate.companionUrl,
          alt_text: listingImageAltText(candidate.inventory.title, 1),
          sort_order: candidate.nextSortOrder,
          is_primary: false,
        });
        if (error) throw error;
        inserted += 1;
        return;
      }

      const { error } = await params.supabase
        .from("inventory_images")
        .update({
          image_url: candidate.companionUrl,
          alt_text: listingImageAltText(candidate.inventory.title, 1),
        })
        .eq("id", candidate.image.id)
        .eq("inventory_item_id", candidate.inventory.id);
      if (error) throw error;
      updated += 1;
    } catch (error) {
      errors.push({
        inventoryItemId: candidate.inventory.id,
        legacyImageUrl: candidate.image.image_url,
        error: error instanceof Error ? error.message.slice(0, 400) : String(error),
      });
    }
  });

  return {
    inventoryItems: inventories.length,
    imageRows: imageRows.length,
    checkedCandidates: candidates.length,
    verified,
    updated,
    inserted,
    missing,
    remainingCandidates: Math.max(allCandidates.length - candidates.length, 0),
    errors,
  };
}
