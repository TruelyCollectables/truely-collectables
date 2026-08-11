import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OWNED_BUCKET = "truely-product-images";
const COLLX_BUCKET = "collx-product-images";

type ImageNames = { front?: string; back?: string };
type Copied = { productId: number; sku: string; collxId: string; frontUrl: string | null; backUrl: string | null; errors: string[] };

function ext(name: string) {
  const match = name.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? (match[1] === "jpeg" ? "jpg" : match[1]) : "jpg";
}

async function discover(collxId: string): Promise<ImageNames> {
  const params = new URLSearchParams({ prefix: `${collxId}-`, maxResults: "10", fields: "items(name)" });
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${COLLX_BUCKET}/o?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`lookup ${collxId} HTTP ${response.status}`);
  const payload = await response.json();
  const names = (payload.items || []).map((item: any) => String(item.name || ""));
  return {
    front: names.find((name: string) => name.startsWith(`${collxId}-1-`)),
    back: names.find((name: string) => name.startsWith(`${collxId}-2-`)),
  };
}

async function copyOne(supabase: ReturnType<typeof createSupabaseServerClient>, collxId: string, side: "front" | "back", name?: string) {
  if (!name) return null;
  const sourceUrl = `https://storage.googleapis.com/${COLLX_BUCKET}/${name.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`${side} ${name} HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = ext(name);
  const path = `collx-full/20260811/${collxId}/${side}.${extension}`;
  const contentType = response.headers.get("content-type") || (extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg");
  const { error } = await supabase.storage.from(OWNED_BUCKET).upload(path, bytes, { contentType, upsert: true });
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

async function processProduct(supabase: ReturnType<typeof createSupabaseServerClient>, product: any): Promise<Copied> {
  const sku = String(product.sku || "");
  const collxId = sku.replace(/^COLLX-/, "");
  if (!/^\d+$/.test(collxId)) throw new Error(`Invalid CollX SKU ${sku}`);
  if (product.ebay_item_id) throw new Error(`Refusing eBay-backed ${sku}`);
  const errors: string[] = [];
  let names: ImageNames = {};
  try { names = await discover(collxId); } catch (error: any) { errors.push(error?.message || String(error)); }
  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  try { frontUrl = await copyOne(supabase, collxId, "front", names.front); } catch (error: any) { errors.push(error?.message || String(error)); }
  try { backUrl = await copyOne(supabase, collxId, "back", names.back); } catch (error: any) { errors.push(error?.message || String(error)); }
  if (frontUrl) {
    const { error } = await supabase.from("products").update({ image_url: frontUrl }).eq("id", product.id).eq("sku", sku);
    if (error) throw error;
  }
  return { productId: Number(product.id), sku, collxId, frontUrl, backUrl, errors };
}

async function runBatch(offset: number, limit: number) {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data: products, error: productError } = await supabase.from("products")
    .select("id,sku,image_url,ebay_item_id").eq("store_id", storeId).like("sku", "COLLX-%")
    .order("id", { ascending: true }).range(offset, offset + limit - 1);
  if (productError) throw productError;
  const batch = products || [];
  const copied = await mapLimit(batch, 10, (product) => processProduct(supabase, product));
  const skus = copied.map((entry) => entry.sku);
  const { data: items, error: itemError } = skus.length
    ? await supabase.from("inventory_items").select("id,sku").eq("store_id", storeId).in("sku", skus)
    : { data: [], error: null };
  if (itemError) throw itemError;
  const itemBySku = new Map((items || []).map((item: any) => [String(item.sku), item]));
  const itemIds = Array.from(itemBySku.values()).map((item: any) => String(item.id));
  const { data: currentImages, error: imageReadError } = itemIds.length
    ? await supabase.from("inventory_images").select("inventory_item_id,image_url").in("inventory_item_id", itemIds)
    : { data: [], error: null };
  if (imageReadError) throw imageReadError;
  const existing = new Set((currentImages || []).map((image: any) => `${image.inventory_item_id}|${image.image_url}`));
  const imageRows: any[] = [];
  for (const entry of copied) {
    const item: any = itemBySku.get(entry.sku);
    if (!item) continue;
    for (const image of [
      entry.frontUrl ? { url: entry.frontUrl, side: "front", sort: 0, primary: true } : null,
      entry.backUrl ? { url: entry.backUrl, side: "back", sort: 1, primary: false } : null,
    ].filter(Boolean) as Array<{ url: string; side: string; sort: number; primary: boolean }>) {
      const key = `${item.id}|${image.url}`;
      if (existing.has(key)) continue;
      existing.add(key);
      imageRows.push({ inventory_item_id: item.id, image_url: image.url, alt_text: `${entry.sku} ${image.side}`,
        sort_order: image.sort, is_primary: image.primary });
    }
  }
  if (imageRows.length) {
    const { error } = await supabase.from("inventory_images").insert(imageRows);
    if (error) throw error;
  }
  return {
    success: true,
    offset,
    requested: batch.length,
    completed: copied.length,
    frontsCopied: copied.filter((entry) => Boolean(entry.frontUrl)).length,
    backsCopied: copied.filter((entry) => Boolean(entry.backUrl)).length,
    noFront: copied.filter((entry) => !entry.frontUrl).map((entry) => entry.collxId),
    noBack: copied.filter((entry) => !entry.backUrl).map((entry) => entry.collxId),
    errors: copied.flatMap((entry) => entry.errors.map((error) => ({ collx_id: entry.collxId, error }))).slice(0, 100),
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
