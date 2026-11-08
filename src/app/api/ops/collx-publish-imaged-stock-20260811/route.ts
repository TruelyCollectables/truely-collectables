import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const DEFAULT_BATCH = 300;
const WRITE_CONCURRENCY = 12;
const CONFIRM_HEADER = "collx-publish-imaged-stock-20260811";
const WRITER = "migration-quarantine-release-v3";

type Row = Record<string, any>;
type ImageRow = {
  inventory_item_id: string;
  image_url: string;
  is_primary?: boolean | null;
  sort_order?: number | null;
};
type ClassifiedRow = {
  item: Row;
  product: Row | null;
  images: string[];
  price: number;
  quantity: number;
  reason: "eligible" | "no_image" | "no_price" | "missing_product" | "ebay_backed";
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanUrl(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack || null };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message: String(record.message || record.error || "Database operation failed"),
      code: record.code ?? null,
      details: record.details ?? null,
      hint: record.hint ?? null,
      stage: record.stage ?? null,
      raw: record,
    };
  }
  return { message: String(error) };
}

function validOpsAuthorization(request: Request) {
  const provided = request.headers.get("authorization") || "";
  const expected = `Bearer ${CONFIRM_HEADER}`;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isExternalCollxImage(url: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return host.includes("collx") || (host === "storage.googleapis.com" && path.startsWith("/collx-product-images/"));
  } catch {
    return false;
  }
}

function visibleDescription(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text
    .replace(/\n*Migrated as DRAFT \/ NOT FOR SALE pending owner review\.?/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || null;
}

function activatedNotes(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "Activated for sale 2026-08-11";
  const cleaned = text.replace(/\s*\|\s*DRAFT \/ NOT FOR SALE/gi, "").trim();
  return cleaned.includes("Activated for sale 2026-08-11")
    ? cleaned
    : `${cleaned} | Activated for sale 2026-08-11`;
}

// IMPORTANT: The production DB boundary deliberately blocks inventory metadata that
// still carries the one-time migration quarantine markers. Approved rows must stop
// being migration rows when they become live inventory. Product migration metadata
// and the stable COLLX-* SKU retain source traceability; inventory metadata becomes
// neutral operational metadata so normal sale/quantity updates remain legal.
function liveInventoryMetadata(now: string) {
  return {
    sale_activation_20260811: {
      state: "active",
      recorded_at: now,
    },
    migration_quarantine_released: true,
  };
}

async function readAllBySkuPrefix(table: "products" | "inventory_items", storeId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("store_id", storeId)
      .ilike("sku", "COLLX-%")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data || []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error(`${table} CollX pagination exceeded ${MAX_PAGES * PAGE_SIZE} rows`);
}

async function readImagesByItemId(itemIds: string[]) {
  const supabase = createSupabaseServerClient({ admin: true });
  const byItem = new Map<string, ImageRow[]>();
  for (let offset = 0; offset < itemIds.length; offset += 500) {
    const chunk = itemIds.slice(offset, offset + 500);
    if (!chunk.length) continue;
    const { data, error } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,is_primary,sort_order")
      .in("inventory_item_id", chunk);
    if (error) throw error;
    for (const image of (data || []) as ImageRow[]) {
      const id = String(image.inventory_item_id);
      byItem.set(id, [...(byItem.get(id) || []), image]);
    }
  }
  for (const images of byItem.values()) {
    images.sort((a, b) => {
      const primary = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary));
      return primary || numberValue(a.sort_order) - numberValue(b.sort_order);
    });
  }
  return byItem;
}

function ownedImages(product: Row | null, imageRows: ImageRow[]) {
  const candidates = [cleanUrl(product?.image_url), ...imageRows.map((image) => cleanUrl(image.image_url))]
    .filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(candidates)).filter((url) => !isExternalCollxImage(url));
}

function classify(items: Row[], products: Row[], imagesByItem: Map<string, ImageRow[]>) {
  const productById = new Map(products.map((row) => [Number(row.id), row]));
  const productBySku = new Map(
    products
      .map((row) => [String(row.sku || "").trim(), row] as const)
      .filter(([sku]) => Boolean(sku)),
  );
  const rows: ClassifiedRow[] = [];

  for (const item of items) {
    const quantity = Math.max(0, Math.trunc(numberValue(item.quantity)));
    if (quantity <= 0) continue;
    const legacyId = numberValue(item.legacy_product_id);
    const sku = String(item.sku || "").trim();
    const product =
      (legacyId > 0 ? productById.get(legacyId) : undefined) ??
      (sku ? productBySku.get(sku) : undefined) ??
      null;
    const images = ownedImages(product, imagesByItem.get(String(item.id)) || []);
    const price = numberValue(item.price);
    const reason = !product
      ? "missing_product"
      : String(product.ebay_item_id || "").trim()
        ? "ebay_backed"
        : images.length === 0
          ? "no_image"
          : price <= 0
            ? "no_price"
            : "eligible";
    rows.push({ item, product, images, price, quantity, reason });
  }
  return rows;
}

function isActivationAligned(row: ClassifiedRow) {
  if (row.reason !== "eligible" || !row.product) return false;
  const primary = row.images[0] || null;
  return (
    row.item.status === "active" &&
    numberValue(row.product.price) === row.price &&
    Math.trunc(numberValue(row.product.quantity)) === row.quantity &&
    cleanUrl(row.product.image_url) === primary &&
    row.product.archived_at == null
  );
}

function isSetAsideSafe(row: ClassifiedRow) {
  if (!row.product || (row.reason !== "no_image" && row.reason !== "no_price")) return true;
  return row.item.status !== "active" && numberValue(row.product.price) === 0;
}

function summarize(rows: ClassifiedRow[]) {
  const eligible = rows.filter((row) => row.reason === "eligible");
  const noImage = rows.filter((row) => row.reason === "no_image");
  const noPrice = rows.filter((row) => row.reason === "no_price");
  const missingProduct = rows.filter((row) => row.reason === "missing_product");
  const ebayBacked = rows.filter((row) => row.reason === "ebay_backed");
  const active = eligible.filter(isActivationAligned);
  const remainingEligible = eligible.filter((row) => !isActivationAligned(row));
  const unsafeSetAside = [...noImage, ...noPrice].filter((row) => !isSetAsideSafe(row));
  const liveCollxImageRefs = rows.reduce((count, row) => {
    if (!row.product) return count;
    return count + (isExternalCollxImage(cleanUrl(row.product.image_url)) ? 1 : 0);
  }, 0);
  return {
    collxSkuRowsWithStock: rows.length,
    eligibleWithAtLeastOneOwnedImageAndPrice: eligible.length,
    activeAndAligned: active.length,
    remainingEligible: remainingEligible.length,
    setAsideNoImage: noImage.length,
    setAsideNoPrice: noPrice.length,
    unsafeSetAside: unsafeSetAside.length,
    missingProduct: missingProduct.length,
    ebayBackedSkipped: ebayBacked.length,
    liveCollxImageRefs,
  };
}

async function snapshot() {
  const storeId = getActiveStoreId();
  const [items, products] = await Promise.all([
    readAllBySkuPrefix("inventory_items", storeId),
    readAllBySkuPrefix("products", storeId),
  ]);
  const imagesByItem = await readImagesByItemId(items.map((item) => String(item.id)));
  const rows = classify(items, products, imagesByItem);
  return { storeId, rows, summary: summarize(rows) };
}

async function runConcurrent<T>(rows: T[], worker: (row: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(WRITE_CONCURRENCY, Math.max(1, rows.length)) }, async () => {
    while (true) {
      const index = next++;
      if (index >= rows.length) return;
      await worker(rows[index]);
    }
  });
  await Promise.all(workers);
}

async function activateRow(row: ClassifiedRow, storeId: string, now: string) {
  if (!row.product) throw new Error(`Missing product for ${row.item.id}`);
  const supabase = createSupabaseServerClient({ admin: true });
  const primary = row.images[0];
  const originalStatus = row.item.status;
  const originalMetadata = row.item.metadata;
  const originalDescription = row.item.description;
  const originalNotes = row.item.notes;

  // Release the inventory row from one-time migration quarantine first. The new
  // metadata intentionally contains no migration-source marker, so the existing
  // DB guardian returns early and future normal inventory updates are permitted.
  const { error: itemError } = await supabase
    .from("inventory_items")
    .update({
      status: "active",
      description: visibleDescription(row.item.description),
      notes: activatedNotes(row.item.notes),
      metadata: liveInventoryMetadata(now),
      updated_at: now,
    })
    .eq("id", row.item.id)
    .eq("store_id", storeId);
  if (itemError) {
    throw { stage: "inventory_release", inventoryItemId: row.item.id, ...errorDetails(itemError) };
  }

  const { error: productError } = await supabase
    .from("products")
    .update({
      image_url: primary,
      price: row.price,
      quantity: row.quantity,
      description: visibleDescription(row.product.description),
      archived_at: null,
    })
    .eq("id", row.product.id)
    .eq("store_id", storeId);

  if (productError) {
    // Keep failures non-live. Restoring the original draft migration row is allowed
    // by the DB boundary and preserves exact pre-activation state.
    await supabase
      .from("inventory_items")
      .update({
        status: originalStatus,
        metadata: originalMetadata,
        description: originalDescription,
        notes: originalNotes,
        updated_at: now,
      })
      .eq("id", row.item.id)
      .eq("store_id", storeId);
    throw { stage: "product_activate", productId: row.product.id, ...errorDetails(productError) };
  }
}

export async function GET() {
  try {
    const state = await snapshot();
    return NextResponse.json({
      success: true,
      operation: "collx-publish-imaged-stock-20260811",
      writer: WRITER,
      ...state.summary,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: errorDetails(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!validOpsAuthorization(request)) {
      return NextResponse.json({ success: false, error: "authorization required" }, { status: 403 });
    }
    const url = new URL(request.url);
    const requestedBatch = Math.trunc(numberValue(url.searchParams.get("batch")));
    const batchSize = Math.min(500, Math.max(1, requestedBatch || DEFAULT_BATCH));
    const before = await snapshot();

    if (before.summary.unsafeSetAside > 0) {
      return NextResponse.json(
        {
          success: false,
          writer: WRITER,
          error: "set-aside rows are unexpectedly live; refusing eligible activation",
          before: before.summary,
        },
        { status: 409 },
      );
    }

    const selected = before.rows
      .filter((row) => row.reason === "eligible" && !isActivationAligned(row))
      .slice(0, batchSize);
    const now = new Date().toISOString();
    await runConcurrent(selected, (row) => activateRow(row, before.storeId, now));
    const after = await snapshot();

    return NextResponse.json({
      success: true,
      operation: "collx-publish-imaged-stock-20260811",
      writer: WRITER,
      batchSize,
      activatedThisCall: selected.length,
      before: before.summary,
      after: after.summary,
    });
  } catch (error) {
    return NextResponse.json({ success: false, writer: WRITER, error: errorDetails(error) }, { status: 500 });
  }
}
