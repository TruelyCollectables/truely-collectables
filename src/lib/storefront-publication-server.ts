import { createSupabaseServerClient } from "./supabase-server";
import { getActiveStoreId } from "./stores";

export type StorefrontProductRow = {
  id: number;
  sku: string | null;
  title: string | null;
  player: string | null;
  sport?: string | null;
  description?: string | null;
  price: number | null;
  quantity: number | null;
  image_url: string | null;
  listing_status: string | null;
  archived_at: string | null;
  ebay_item_id?: string | null;
};

function client() {
  return {
    supabase: createSupabaseServerClient({ admin: true }),
    storeId: getActiveStoreId(),
  };
}

export async function findStorefrontProductsBySku(
  sku: string,
  limit = 2,
): Promise<StorefrontProductRow[]> {
  const { supabase, storeId } = client();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,sku,title,player,sport,description,price,quantity,image_url,listing_status,archived_at,ebay_item_id",
    )
    .eq("store_id", storeId)
    .eq("sku", sku)
    .limit(limit);
  if (error) throw error;
  return (data || []) as StorefrontProductRow[];
}

export async function getStorefrontProduct(
  productId: number,
): Promise<StorefrontProductRow | null> {
  if (!Number.isFinite(productId) || productId <= 0) return null;
  const { supabase, storeId } = client();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,sku,title,player,sport,description,price,quantity,image_url,listing_status,archived_at,ebay_item_id",
    )
    .eq("store_id", storeId)
    .eq("id", productId)
    .maybeSingle();
  if (error) throw error;
  return (data as StorefrontProductRow | null) || null;
}

export async function createStorefrontProduct(input: {
  sellerAccountId: string;
  sku: string;
  title: string;
  description: string;
  player?: string | null;
  sport?: string | null;
  price: number;
  quantity?: number;
  imageUrl?: string | null;
}): Promise<StorefrontProductRow> {
  const { supabase, storeId } = client();
  const { data, error } = await supabase
    .from("products")
    .insert({
      store_id: storeId,
      seller_account_id: input.sellerAccountId,
      sku: input.sku,
      title: input.title,
      description: input.description,
      player: input.player || null,
      sport: input.sport || null,
      price: input.price,
      quantity: Math.max(0, Math.floor(Number(input.quantity || 0))),
      image_url: input.imageUrl || null,
      listing_status: "draft",
      archived_at: null,
    })
    .select(
      "id,sku,title,player,sport,description,price,quantity,image_url,listing_status,archived_at,ebay_item_id",
    )
    .single();
  if (error || !data) {
    throw error || new Error("Website product could not be created.");
  }
  return data as StorefrontProductRow;
}

export async function updateStorefrontProduct(
  productId: number,
  patch: Record<string, unknown>,
): Promise<StorefrontProductRow> {
  const { supabase, storeId } = client();
  const { data, error } = await supabase
    .from("products")
    .update(patch)
    .eq("store_id", storeId)
    .eq("id", productId)
    .select(
      "id,sku,title,player,sport,description,price,quantity,image_url,listing_status,archived_at,ebay_item_id",
    )
    .single();
  if (error || !data) {
    throw error || new Error("Website product could not be updated.");
  }
  return data as StorefrontProductRow;
}

export async function archiveStorefrontProduct(productId: number) {
  return updateStorefrontProduct(productId, {
    quantity: 0,
    listing_status: "draft",
    archived_at: new Date().toISOString(),
  });
}

export async function ensureStorefrontProduct(input: {
  sellerAccountId: string;
  sku: string;
  title: string;
  description: string;
  player?: string | null;
  sport?: string | null;
  price: number;
  imageUrl?: string | null;
}) {
  const existing = await findStorefrontProductsBySku(input.sku, 2);
  if (existing.length > 1) {
    const error = new Error(
      "Multiple website product rows already use this KINGMAKER SKU.",
    ) as Error & { code?: string; productIds?: number[] };
    error.code = "MULTIPLE_WEBSITE_PRODUCTS_FOR_SKU";
    error.productIds = existing.map((row) => row.id);
    throw error;
  }
  if (existing[0]) return existing[0];
  return createStorefrontProduct({
    ...input,
    quantity: 0,
  });
}

export async function publishStorefrontProduct(input: {
  productId: number;
  sku: string;
  title: string;
  description: string;
  player?: string | null;
  sport?: string | null;
  price: number;
  quantity: number;
  imageUrl?: string | null;
}) {
  return updateStorefrontProduct(input.productId, {
    sku: input.sku,
    title: input.title,
    description: input.description,
    player: input.player || null,
    sport: input.sport || null,
    price: input.price,
    quantity: Math.max(0, Math.floor(input.quantity)),
    image_url: input.imageUrl || null,
    archived_at: null,
    listing_status: "live",
  });
}

export async function verifyStorefrontProduct(input: {
  productId: number;
  sku: string;
  title: string;
  price: number;
  quantity: number;
  imageUrl?: string | null;
}) {
  const product = await getStorefrontProduct(input.productId);
  const checks = {
    exists: Boolean(product),
    sku: product?.sku === input.sku,
    title: String(product?.title || "").trim() === input.title.trim(),
    quantity: Number(product?.quantity || 0) === input.quantity,
    price: Math.abs(Number(product?.price || 0) - input.price) < 0.011,
    live:
      product?.listing_status === "live" &&
      product?.archived_at == null &&
      Number(product?.quantity || 0) > 0,
    image:
      !input.imageUrl ||
      String(product?.image_url || "").trim() === input.imageUrl.trim(),
  };
  const failed = Object.entries(checks)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  return {
    verified: failed.length === 0,
    checkedAt: new Date().toISOString(),
    source: "storefront_product_readback",
    productId: input.productId,
    checks,
    failed,
    product,
  };
}
