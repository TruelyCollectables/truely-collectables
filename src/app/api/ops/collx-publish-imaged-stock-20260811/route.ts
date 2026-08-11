import { NextResponse } from "next/server";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;
const DEFAULT_BATCH = 300;
const CONFIRM_HEADER = "collx-publish-imaged-stock-20260811";

type Row = Record<string, any>;
type ImageRow = {
  inventory_item_id: string;
  image_url: string;
  is_primary?: boolean | null;
  sort_order?: number | null;
};

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanUrl(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function isExternalCollxImage(url: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return (
      host.includes("collx") ||
      (host === "storage.googleapis.com" && path.startsWith("/collx-product-images/"))
    );
  } catch {
    return false;
  }
}

function visibleDescription(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return null;
  return (
    text
      .replace(/\n*Migrated as DRAFT \/ NOT FOR SALE pending owner review\.?/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || null
  );
}

function activatedNotes(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "Activated for sale 2026-08-11";
  const cleaned = text.replace(/\s*\|\s*DRAFT \/ NOT FOR SALE/gi, "").trim();
  return cleaned.includes("Activated for sale 2026-08-11")
    ? cleaned
    : `${cleaned} | Activated for sale 2026-08-11`;
}

function mergeActivationMetadata(
  metadata: unknown,
  state: "active" | "quarantined_no_image" | "quarantined_no_price",
  at: string,
) {
  const base =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    ...base,
    collx_sale_activation_20260811: {
      state,
      recorded_at: at,
    },
  };
}

async function readAllBySkuPrefix(
  table: "products" | "inventory_items",
  storeId: string,
) {
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
    if (chunk.length === 0) continue;
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
      if (primary !== 0) return primary;
      return numberValue(a.sort_order) - numberValue(b.sort_order);
    });
  }
  return byItem;
}

function ownedImages(product: Row | null, imageRows: ImageRow[]) {
  const candidates = [
    cleanUrl(product?.image_url),
    ...imageRows.map((image) => cleanUrl(image.image_url)),
  ].filter((entry): entry is string => Boolean(entry));
  return Array.from(new Set(candidates)).filter((url) => !isExternalCollxImage(url));
}

function classify(items: Row[], products: Row[], imagesByItem: Map<string, ImageRow[]>) {
  const productById = new Map(products.map((row) => [Number(row.id), row]));
  const productBySku = new Map(
    products
      .map((row) => [String(row.sku || "").trim(), row] as const)
      .filter(([sku]) => Boolean(sku)),
  );

  const stockRows: Array<{
    item: Row;
    product: Row | null;
    images: string[];
    price: number;
    quantity: number;
    reason: "eligible" | "no_image" | "no_price" | "missing_product" | "ebay_backed";
  }> = [];

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

    stockRows.push({ item, product, images, price, quantity, reason });
  }

  return stockRows;
}

function isActivationAligned(row: ReturnType<typeof classify>[number]) {
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

function isQuarantineAligned(row: ReturnType<typeof classify>[number]) {
  if (!row.product || (row.reason !== "no_image" && row.reason !== "no_price")) return true;
  return row.item.status === "draft" && numberValue(row.product.price) === 0;
}

function summarize(rows: ReturnType<typeof classify>) {
  const eligible = rows.filter((row) => row.reason === "eligible");
  const noImage = rows.filter((row) => row.reason === "no_image");
  const noPrice = rows.filter((row) => row.reason === "no_price");
  const missingProduct = rows.filter((row) => row.reason === "missing_product");
  const ebayBacked = rows.filter((row) => row.reason === "ebay_backed");
  const active = eligible.filter(isActivationAligned);
  const remainingEligible = eligible.filter((row) => !isActivationAligned(row));
  const quarantinePending = rows.filter(
    (row) => (row.reason === "no_image" || row.reason === "no_price") && !isQuarantineAligned(row),
  );
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
    quarantinePending: quarantinePending.length,
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

export async function GET() {
  try {
    const state = await snapshot();
    return NextResponse.json({
      success: true,
      operation: "collx-publish-imaged-stock-20260811",
      ...state.summary,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("x-ops-confirm") !== CONFIRM_HEADER) {
      return NextResponse.json({ success: false, error: "confirmation header required" }, { status: 403 });
    }

    const url = new URL(request.url);
    const requestedBatch = Math.trunc(numberValue(url.searchParams.get("batch")));
    const batchSize = Math.min(500, Math.max(1, requestedBatch || DEFAULT_BATCH));
    const before = await snapshot();
    const now = new Date().toISOString();

    const quarantineCandidates = before.rows.filter(
      (row) =>
        (row.reason === "no_image" || row.reason === "no_price") &&
        !isQuarantineAligned(row),
    );
    const activationCandidates = before.rows.filter(
      (row) => row.reason === "eligible" && !isActivationAligned(row),
    );
    const selected = [...quarantineCandidates, ...activationCandidates].slice(0, batchSize);

    const inventoryUpdates: Row[] = [];
    const productUpdates: Row[] = [];

    for (const row of selected) {
      if (!row.product) continue;
      if (row.reason === "eligible") {
        const primary = row.images[0];
        inventoryUpdates.push({
          id: row.item.id,
          store_id: before.storeId,
          status: "active",
          description: visibleDescription(row.item.description),
          notes: activatedNotes(row.item.notes),
          metadata: mergeActivationMetadata(row.item.metadata, "active", now),
          updated_at: now,
        });
        productUpdates.push({
          id: row.product.id,
          store_id: before.storeId,
          image_url: primary,
          price: row.price,
          quantity: row.quantity,
          description: visibleDescription(row.product.description),
          archived_at: null,
        });
      } else if (row.reason === "no_image" || row.reason === "no_price") {
        inventoryUpdates.push({
          id: row.item.id,
          store_id: before.storeId,
          status: "draft",
          metadata: mergeActivationMetadata(
            row.item.metadata,
            row.reason === "no_image" ? "quarantined_no_image" : "quarantined_no_price",
            now,
          ),
          updated_at: now,
        });
        productUpdates.push({
          id: row.product.id,
          store_id: before.storeId,
          price: 0,
          quantity: row.quantity,
          ...(row.reason === "no_image" ? { image_url: null } : {}),
        });
      }
    }

    const supabase = createSupabaseServerClient({ admin: true });
    if (inventoryUpdates.length > 0) {
      const { error } = await supabase.from("inventory_items").upsert(inventoryUpdates, { onConflict: "id" });
      if (error) throw error;
    }
    if (productUpdates.length > 0) {
      const { error } = await supabase.from("products").upsert(productUpdates, { onConflict: "id" });
      if (error) throw error;
    }

    const after = await snapshot();
    return NextResponse.json({
      success: true,
      operation: "collx-publish-imaged-stock-20260811",
      batchSize,
      changedThisCall: selected.length,
      activatedThisCall: selected.filter((row) => row.reason === "eligible").length,
      quarantinedThisCall: selected.filter(
        (row) => row.reason === "no_image" || row.reason === "no_price",
      ).length,
      before: before.summary,
      after: after.summary,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
