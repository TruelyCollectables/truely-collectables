import { NextResponse } from "next/server";
import {
  COLLX_IMPORT_BUCKET,
  collxIdentityScore,
  isAllowedCollxImageUrl,
  matchCollxImageTarget,
  normalizeCollxImageForStorage,
  parseCollxImageCsv,
  type CollxImageMatchMethod,
  type CollxImageRow,
  type CollxImageTarget,
} from "../../../../lib/collx-image-import";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const PREVIEW_BATCH_LIMIT = 12;
const APPLY_BATCH_LIMIT = 6;

type UnknownRecord = Record<string, unknown>;

type ProductRow = {
  id: number;
  sku: string | null;
  title: string;
  description: string | null;
  image_url: string | null;
  ebay_item_id: string | null;
};

type InventoryRow = {
  id: string;
  legacy_product_id: number | null;
  sku: string | null;
  title: string;
  description: string | null;
  status: string;
  metadata: UnknownRecord | null;
  updated_at: string | null;
};

type InventoryImageRow = {
  inventory_item_id: string;
  image_url: string;
  sort_order: number | null;
  is_primary: boolean | null;
};

type ApplyMatchInput = {
  method: CollxImageMatchMethod;
  inventoryItemId: string;
  legacyProductId: number;
  row: CollxImageRow;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown, maximum = 4_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : "";
}

function safeStoragePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "card";
}

function collxUrlMatchesId(urlValue: string, collxId: string, side: "front" | "back") {
  if (!isAllowedCollxImageUrl(urlValue)) return false;
  const marker = side === "front" ? "-1-" : "-2-";
  try {
    return new URL(urlValue).pathname.includes(`/${collxId}${marker}`);
  } catch {
    return false;
  }
}

async function readAllProducts() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const rows: ProductRow[] = [];

  for (let page = 0; page < 50; page += 1) {
    const from = page * 1_000;
    const { data, error } = await supabase
      .from("products")
      .select("id,sku,title,description,image_url,ebay_item_id")
      .eq("store_id", storeId)
      .not("ebay_item_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    const batch = (data || []) as ProductRow[];
    rows.push(...batch.filter((row) => text(row.ebay_item_id)));
    if (batch.length < 1_000) return rows;
  }

  throw new Error("Product pagination exceeded 50,000 rows.");
}

async function readLinkedInventory(productIds: number[]) {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const rows: InventoryRow[] = [];

  for (let index = 0; index < productIds.length; index += 200) {
    const ids = productIds.slice(index, index + 200);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("inventory_items")
      .select(
        "id,legacy_product_id,sku,title,description,status,metadata,updated_at",
      )
      .eq("store_id", storeId)
      .in("legacy_product_id", ids)
      .order("updated_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    rows.push(...((data || []) as InventoryRow[]));
  }

  const latestByProduct = new Map<number, InventoryRow>();
  for (const row of rows) {
    const productId = Number(row.legacy_product_id || 0);
    if (productId > 0 && !latestByProduct.has(productId)) {
      latestByProduct.set(productId, row);
    }
  }
  return latestByProduct;
}

async function readInventoryImages(inventoryItemIds: string[]) {
  const supabase = createSupabaseServerClient({ admin: true });
  const rows: InventoryImageRow[] = [];

  for (let index = 0; index < inventoryItemIds.length; index += 100) {
    const ids = inventoryItemIds.slice(index, index + 100);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("inventory_images")
      .select("inventory_item_id,image_url,sort_order,is_primary")
      .in("inventory_item_id", ids)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    rows.push(...((data || []) as InventoryImageRow[]));
  }

  const byInventory = new Map<string, InventoryImageRow[]>();
  for (const row of rows) {
    const existing = byInventory.get(row.inventory_item_id) || [];
    existing.push(row);
    byInventory.set(row.inventory_item_id, existing);
  }
  return byInventory;
}

async function loadTargets() {
  const products = await readAllProducts();
  const inventoryByProduct = await readLinkedInventory(
    products.map((product) => Number(product.id)),
  );
  const inventoryIds = Array.from(inventoryByProduct.values()).map((row) => row.id);
  const imagesByInventory = await readInventoryImages(inventoryIds);

  return products
    .map((product): CollxImageTarget | null => {
      const inventory = inventoryByProduct.get(Number(product.id));
      if (!inventory) return null;
      const images = (imagesByInventory.get(inventory.id) || []).slice().sort((left, right) => {
        if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
          return left.is_primary ? -1 : 1;
        }
        return Number(left.sort_order || 0) - Number(right.sort_order || 0);
      });

      return {
        inventoryItemId: inventory.id,
        legacyProductId: Number(product.id),
        title: text(inventory.title || product.title),
        description: text(inventory.description || product.description),
        sku: text(inventory.sku || product.sku),
        productImageUrl: text(product.image_url),
        existingImageUrls: images.map((image) => text(image.image_url)).filter(Boolean),
        metadata: record(inventory.metadata),
      };
    })
    .filter((target): target is CollxImageTarget => Boolean(target))
    .sort((left, right) => left.legacyProductId - right.legacyProductId);
}

async function preview(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose the CollX CSV export first." }, { status: 400 });
  }
  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "CollX CSV must be 8MB or smaller." }, { status: 413 });
  }

  const rows = parseCollxImageCsv(await file.text());
  const targets = await loadTargets();
  const offset = Math.max(0, Number(formData.get("offset") || 0) || 0);
  const requestedLimit = Number(formData.get("limit") || PREVIEW_BATCH_LIMIT) || PREVIEW_BATCH_LIMIT;
  const limit = Math.max(1, Math.min(PREVIEW_BATCH_LIMIT, requestedLimit));
  const batch = targets.slice(offset, offset + limit);
  const results = await Promise.all(
    batch.map((target) => matchCollxImageTarget(target, rows)),
  );

  return NextResponse.json({
    csvRows: rows.length,
    csvFrontImages: rows.filter((row) => row.frontImage).length,
    csvBackImages: rows.filter((row) => isAllowedCollxImageUrl(row.backImage)).length,
    totalTargets: targets.length,
    offset,
    nextOffset: offset + batch.length < targets.length ? offset + batch.length : null,
    results,
  });
}

async function ensureImageBucket(
  supabase: ReturnType<typeof createSupabaseServerClient>,
) {
  const { data, error } = await supabase.storage.getBucket(COLLX_IMPORT_BUCKET);
  if (!error && data) return;

  const { error: createError } = await supabase.storage.createBucket(
    COLLX_IMPORT_BUCKET,
    {
      public: true,
      fileSizeLimit: `${20 * 1024 * 1024}`,
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
    },
  );
  if (
    createError &&
    !createError.message.toLowerCase().includes("already exists")
  ) {
    throw createError;
  }
}

async function loadSingleTarget(input: ApplyMatchInput) {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,sku,title,description,status,metadata")
    .eq("store_id", storeId)
    .eq("id", input.inventoryItemId)
    .eq("legacy_product_id", input.legacyProductId)
    .maybeSingle();
  if (inventoryError) throw inventoryError;
  if (!inventory) throw new Error("The matched inventory item no longer exists.");

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id,sku,title,description,image_url,ebay_item_id")
    .eq("store_id", storeId)
    .eq("id", input.legacyProductId)
    .maybeSingle();
  if (productError) throw productError;
  if (!product || !text(product.ebay_item_id)) {
    throw new Error("The target is not an existing eBay-backed Truely Collectables product.");
  }

  const { data: imageRows, error: imageError } = await supabase
    .from("inventory_images")
    .select("inventory_item_id,image_url,sort_order,is_primary")
    .eq("inventory_item_id", input.inventoryItemId)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;

  const target: CollxImageTarget = {
    inventoryItemId: inventory.id,
    legacyProductId: Number(product.id),
    title: text(inventory.title || product.title),
    description: text(inventory.description || product.description),
    sku: text(inventory.sku || product.sku),
    productImageUrl: text(product.image_url),
    existingImageUrls: ((imageRows || []) as InventoryImageRow[])
      .map((row) => text(row.image_url))
      .filter(Boolean),
    metadata: record(inventory.metadata),
  };

  return { supabase, storeId, inventory, product, target };
}

function validateApplyMatch(input: ApplyMatchInput, target: CollxImageTarget) {
  const row = input.row;
  if (!text(row.collxId, 120) || !/^\d+$/.test(text(row.collxId, 120))) {
    throw new Error("Invalid CollX ID in preview result.");
  }
  if (!collxUrlMatchesId(row.frontImage, row.collxId, "front")) {
    throw new Error("Front image URL does not match the CollX card ID.");
  }
  if (row.backImage && !collxUrlMatchesId(row.backImage, row.collxId, "back")) {
    throw new Error("Back image URL does not match the CollX card ID.");
  }

  if (input.method === "existing_reference") {
    const evidence = JSON.stringify({
      metadata: target.metadata,
      productImageUrl: target.productImageUrl,
      existingImageUrls: target.existingImageUrls,
    });
    if (
      !evidence.includes(row.collxId) &&
      !evidence.includes(row.frontImage) &&
      !evidence.includes(row.backImage)
    ) {
      throw new Error("The existing CollX reference no longer matches this card.");
    }
    return;
  }

  if (collxIdentityScore(target, row) < 80) {
    throw new Error("The CollX identity no longer passes the strict card match gate.");
  }
}

async function applyOne(input: ApplyMatchInput) {
  const { supabase, storeId, inventory, product, target } = await loadSingleTarget(input);
  validateApplyMatch(input, target);
  await ensureImageBucket(supabase);

  const frontBytes = await normalizeCollxImageForStorage(input.row.frontImage);
  const backBytes = input.row.backImage
    ? await normalizeCollxImageForStorage(input.row.backImage)
    : null;
  const basePath = [
    safeStoragePart(storeId),
    "collx-import",
    safeStoragePart(input.inventoryItemId),
  ].join("/");
  const frontPath = `${basePath}/${safeStoragePart(input.row.collxId)}-front.jpg`;
  const backPath = `${basePath}/${safeStoragePart(input.row.collxId)}-back.jpg`;

  const { error: frontUploadError } = await supabase.storage
    .from(COLLX_IMPORT_BUCKET)
    .upload(frontPath, frontBytes, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
      upsert: true,
    });
  if (frontUploadError) throw frontUploadError;

  if (backBytes) {
    const { error: backUploadError } = await supabase.storage
      .from(COLLX_IMPORT_BUCKET)
      .upload(backPath, backBytes, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
        upsert: true,
      });
    if (backUploadError) throw backUploadError;
  }

  const frontUrl = supabase.storage
    .from(COLLX_IMPORT_BUCKET)
    .getPublicUrl(frontPath).data.publicUrl;
  const backUrl = backBytes
    ? supabase.storage.from(COLLX_IMPORT_BUCKET).getPublicUrl(backPath).data.publicUrl
    : "";

  const metadata = record(inventory.metadata);
  const previousImport = record(metadata.collx_image_import);
  const removableUrls = Array.from(
    new Set(
      [
        text(previousImport.frontUrl, 2_000),
        text(previousImport.backUrl, 2_000),
        frontUrl,
        backUrl,
      ].filter(Boolean),
    ),
  );

  if (removableUrls.length) {
    const { error } = await supabase
      .from("inventory_images")
      .delete()
      .eq("inventory_item_id", input.inventoryItemId)
      .in("image_url", removableUrls);
    if (error) throw error;
  }

  const { error: resetError } = await supabase
    .from("inventory_images")
    .update({ is_primary: false })
    .eq("inventory_item_id", input.inventoryItemId);
  if (resetError) throw resetError;

  const imageInserts = [
    {
      inventory_item_id: input.inventoryItemId,
      image_url: frontUrl,
      alt_text: `${target.title} front`,
      sort_order: 0,
      is_primary: true,
    },
    ...(backUrl
      ? [
          {
            inventory_item_id: input.inventoryItemId,
            image_url: backUrl,
            alt_text: `${target.title} back`,
            sort_order: 1,
            is_primary: false,
          },
        ]
      : []),
  ];
  const { error: insertError } = await supabase
    .from("inventory_images")
    .insert(imageInserts);
  if (insertError) throw insertError;

  const { error: productUpdateError } = await supabase
    .from("products")
    .update({ image_url: frontUrl })
    .eq("store_id", storeId)
    .eq("id", product.id);
  if (productUpdateError) throw productUpdateError;

  const nextMetadata = {
    ...metadata,
    collx_image_import: {
      collxId: input.row.collxId,
      matchMethod: input.method,
      importedAt: new Date().toISOString(),
      frontUrl,
      backUrl: backUrl || null,
      frontStoragePath: frontPath,
      backStoragePath: backUrl ? backPath : null,
      previousProductImageUrl: target.productImageUrl || null,
      sourceFrontUrl: input.row.frontImage,
      sourceBackUrl: input.row.backImage || null,
    },
  };
  const { error: metadataError } = await supabase
    .from("inventory_items")
    .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
    .eq("store_id", storeId)
    .eq("id", input.inventoryItemId);
  if (metadataError) throw metadataError;

  return {
    inventoryItemId: input.inventoryItemId,
    legacyProductId: input.legacyProductId,
    collxId: input.row.collxId,
    frontUrl,
    backUrl: backUrl || null,
  };
}

async function apply(request: Request) {
  const body = await request.json().catch(() => null);
  const matches = Array.isArray(body?.matches) ? body.matches : [];
  if (!matches.length || matches.length > APPLY_BATCH_LIMIT) {
    return NextResponse.json(
      { error: `Apply batches must contain 1-${APPLY_BATCH_LIMIT} matched cards.` },
      { status: 400 },
    );
  }

  const applied = [];
  const failed = [];
  for (const rawInput of matches) {
    const input = rawInput as ApplyMatchInput;
    try {
      applied.push(await applyOne(input));
    } catch (error) {
      failed.push({
        inventoryItemId: text(input?.inventoryItemId, 120),
        legacyProductId: Number(input?.legacyProductId || 0),
        collxId: text(input?.row?.collxId, 120),
        error: error instanceof Error ? error.message : "Unknown image import failure.",
      });
    }
  }

  return NextResponse.json({ applied, failed }, { status: failed.length ? 207 : 200 });
}

export async function POST(request: Request) {
  try {
    const mode = new URL(request.url).searchParams.get("mode") || "preview";
    if (mode === "preview") return preview(request);
    if (mode === "apply") return apply(request);
    return NextResponse.json({ error: "Unsupported CollX image import mode." }, { status: 400 });
  } catch (error) {
    console.error("CollX image import failed:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "CollX image import failed.",
      },
      { status: 500 },
    );
  }
}
