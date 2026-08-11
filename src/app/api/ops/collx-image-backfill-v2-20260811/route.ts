import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { COLLX_IMAGE_OBJECT_OVERRIDES_GZIP_BASE64 } from "../../../../lib/collx-image-object-overrides-20260811";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OWNED_BUCKET = "truely-product-images";
const COLLX_BUCKET = "collx-product-images";
const COLLX_USER_BUCKET = "collx-user-cards";
const OWNED_PATH_MARKER = "/storage/v1/object/public/truely-product-images/collx-full/20260811/";

type ImageNames = { front?: string; back?: string };
type OverrideMap = Record<string, ImageNames>;
type RepairResult = {
  productId: number;
  sku: string;
  collxId: string;
  frontAlreadyPresent: boolean;
  backAlreadyPresent: boolean;
  frontUrl: string | null;
  backUrl: string | null;
  noFront: boolean;
  noBack: boolean;
  errors: string[];
};

const OVERRIDES = JSON.parse(
  gunzipSync(Buffer.from(COLLX_IMAGE_OBJECT_OVERRIDES_GZIP_BASE64, "base64")).toString("utf8"),
) as OverrideMap;

function extension(name: string) {
  const match = name.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? (match[1] === "jpeg" ? "jpg" : match[1]) : "jpg";
}

function ownedSideUrl(url: unknown, collxId: string, side: "front" | "back") {
  const value = String(url || "");
  return value.includes(`${OWNED_PATH_MARKER}${collxId}/${side}.`);
}

function sourceParts(name: string) {
  const clean = String(name || "").replace(/^\/+/, "");
  if (clean.startsWith(`${COLLX_USER_BUCKET}/`)) {
    return { bucket: COLLX_USER_BUCKET, object: clean.slice(COLLX_USER_BUCKET.length + 1) };
  }
  if (clean.startsWith(`${COLLX_BUCKET}/`)) {
    return { bucket: COLLX_BUCKET, object: clean.slice(COLLX_BUCKET.length + 1) };
  }
  return { bucket: COLLX_BUCKET, object: clean };
}

function rawSourceUrl(name: string) {
  const { bucket, object } = sourceParts(name);
  return `https://storage.googleapis.com/${bucket}/${object}`;
}

function fetchSourceUrl(name: string) {
  const { bucket, object } = sourceParts(name);
  return `https://storage.googleapis.com/${bucket}/${object.split("/").map(encodeURIComponent).join("/")}`;
}

async function discoverStandard(collxId: string): Promise<ImageNames> {
  const params = new URLSearchParams({
    prefix: `${collxId}-`,
    maxResults: "10",
    fields: "items(name)",
  });
  const response = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${COLLX_BUCKET}/o?${params}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`lookup ${collxId} HTTP ${response.status}`);
  const payload = await response.json();
  const names = (payload.items || []).map((item: any) => String(item.name || ""));
  return {
    front: names.find((name: string) => name.startsWith(`${collxId}-1-`)),
    back: names.find((name: string) => name.startsWith(`${collxId}-2-`)),
  };
}

async function sourceBytes(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  side: "front" | "back",
  name: string,
) {
  const sourceUrl = fetchSourceUrl(name);
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (response.ok) {
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type"),
      source: sourceUrl,
    };
  }

  const ext = extension(name);
  const mirrorHash = createHash("sha256").update(rawSourceUrl(name)).digest("hex");
  const mirrorPath = `collx-mirror/${mirrorHash}.${ext}`;
  const { data, error } = await supabase.storage.from(OWNED_BUCKET).download(mirrorPath);
  if (!error && data) {
    return {
      bytes: Buffer.from(await data.arrayBuffer()),
      contentType: data.type || null,
      source: `owned:${mirrorPath}`,
    };
  }

  throw new Error(
    `${side} ${name} HTTP ${response.status}; owned mirror ${mirrorPath} unavailable${error?.message ? `: ${error.message}` : ""}`,
  );
}

async function copyOne(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  collxId: string,
  side: "front" | "back",
  name?: string,
) {
  if (!name) return null;
  const source = await sourceBytes(supabase, side, name);
  const ext = extension(name);
  const path = `collx-full/20260811/${collxId}/${side}.${ext}`;
  const contentType =
    source.contentType ||
    (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const { error } = await supabase.storage
    .from(OWNED_BUCKET)
    .upload(path, source.bytes, { contentType, upsert: true });
  if (error) throw error;
  return supabase.storage.from(OWNED_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>) {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await fn(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function repairOne(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  product: any,
  item: any,
  currentUrls: string[],
): Promise<RepairResult> {
  const sku = String(product.sku || "");
  const collxId = sku.replace(/^COLLX-/, "");
  if (!/^\d+$/.test(collxId)) throw new Error(`Invalid CollX SKU ${sku}`);
  if (product.ebay_item_id) throw new Error(`Refusing eBay-backed ${sku}`);
  if (!item) throw new Error(`Missing inventory item for ${sku}`);

  const frontAlreadyPresent =
    ownedSideUrl(product.image_url, collxId, "front") ||
    currentUrls.some((url) => ownedSideUrl(url, collxId, "front"));
  const backAlreadyPresent = currentUrls.some((url) => ownedSideUrl(url, collxId, "back"));

  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  let noFront = false;
  let noBack = false;
  const errors: string[] = [];

  let standard: ImageNames | null = null;
  const namesFor = async () => {
    if (standard === null) standard = await discoverStandard(collxId);
    return standard;
  };

  if (!frontAlreadyPresent) {
    try {
      const override = OVERRIDES[collxId]?.front;
      const name = override || (await namesFor()).front;
      if (name) frontUrl = await copyOne(supabase, collxId, "front", name);
      else noFront = true;
    } catch (error: any) {
      errors.push(`front:${error?.message || String(error)}`);
    }
  }

  if (!backAlreadyPresent) {
    try {
      const override = OVERRIDES[collxId]?.back;
      const name = override || (await namesFor()).back;
      if (name) backUrl = await copyOne(supabase, collxId, "back", name);
      else noBack = true;
    } catch (error: any) {
      errors.push(`back:${error?.message || String(error)}`);
    }
  }

  if (frontUrl) {
    const { error } = await supabase
      .from("products")
      .update({ image_url: frontUrl })
      .eq("id", product.id)
      .eq("sku", sku);
    if (error) throw error;
  }

  const newImages = [
    frontUrl
      ? {
          inventory_item_id: item.id,
          image_url: frontUrl,
          alt_text: `${sku} front`,
          sort_order: 0,
          is_primary: true,
        }
      : null,
    backUrl
      ? {
          inventory_item_id: item.id,
          image_url: backUrl,
          alt_text: `${sku} back`,
          sort_order: 1,
          is_primary: false,
        }
      : null,
  ].filter(Boolean) as any[];

  if (newImages.length) {
    const { error } = await supabase.from("inventory_images").insert(newImages);
    if (error) throw error;
  }

  return {
    productId: Number(product.id),
    sku,
    collxId,
    frontAlreadyPresent,
    backAlreadyPresent,
    frontUrl,
    backUrl,
    noFront,
    noBack,
    errors,
  };
}

async function runBatch(offset: number, limit: number) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id,sku,image_url,ebay_item_id")
    .eq("store_id", storeId)
    .like("sku", "COLLX-%")
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (productError) throw productError;
  const batch = products || [];
  const skus = batch.map((product: any) => String(product.sku));

  const { data: items, error: itemError } = skus.length
    ? await supabase
        .from("inventory_items")
        .select("id,sku,status")
        .eq("store_id", storeId)
        .in("sku", skus)
    : { data: [], error: null };
  if (itemError) throw itemError;
  const itemBySku = new Map((items || []).map((item: any) => [String(item.sku), item]));
  for (const item of items || []) {
    if (item.status !== "draft") throw new Error(`Refusing non-draft ${item.sku}`);
  }

  const itemIds = Array.from(itemBySku.values()).map((item: any) => String(item.id));
  const { data: imageRows, error: imageError } = itemIds.length
    ? await supabase
        .from("inventory_images")
        .select("inventory_item_id,image_url")
        .in("inventory_item_id", itemIds)
    : { data: [], error: null };
  if (imageError) throw imageError;
  const urlsByItem = new Map<string, string[]>();
  for (const image of imageRows || []) {
    const key = String(image.inventory_item_id);
    urlsByItem.set(key, [...(urlsByItem.get(key) || []), String(image.image_url || "")]);
  }

  const repaired = await mapLimit(batch, 8, (product: any) => {
    const item: any = itemBySku.get(String(product.sku));
    return repairOne(supabase, product, item, item ? urlsByItem.get(String(item.id)) || [] : []);
  });

  return {
    success: true,
    offset,
    requested: batch.length,
    completed: repaired.length,
    frontsAlreadyPresent: repaired.filter((entry) => entry.frontAlreadyPresent).length,
    backsAlreadyPresent: repaired.filter((entry) => entry.backAlreadyPresent).length,
    frontsCopied: repaired.filter((entry) => Boolean(entry.frontUrl)).length,
    backsCopied: repaired.filter((entry) => Boolean(entry.backUrl)).length,
    noFront: repaired.filter((entry) => entry.noFront).map((entry) => entry.collxId),
    noBack: repaired.filter((entry) => entry.noBack).map((entry) => entry.collxId),
    errors: repaired
      .flatMap((entry) => entry.errors.map((error) => ({ collx_id: entry.collxId, error })))
      .slice(0, 100),
  };
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0)));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || 50))));
    return NextResponse.json(await runBatch(offset, limit));
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0)));
    const limit = Math.min(100, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || 50))));
    return NextResponse.json(await runBatch(offset, limit));
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
