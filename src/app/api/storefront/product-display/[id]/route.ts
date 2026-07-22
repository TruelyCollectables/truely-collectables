import { NextResponse } from "next/server";
import { listingShippingSummary } from "../../../../../lib/listing-shipping";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const legacyProductId = Number(id);

  if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
    return NextResponse.json({ error: "Invalid product ID." }, { status: 400 });
  }

  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id,title,price,quantity,image_url")
    .eq("store_id", storeId)
    .eq("id", legacyProductId)
    .maybeSingle();

  if (productError) throw productError;
  if (!product || Number(product.quantity || 0) <= 0) {
    return NextResponse.json({ error: "Product not available." }, { status: 404 });
  }

  const { data: inventoryItem, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("id,status,metadata")
    .eq("store_id", storeId)
    .eq("legacy_product_id", legacyProductId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (inventoryError) throw inventoryError;
  if (!inventoryItem || inventoryItem.status !== "active") {
    return NextResponse.json({ error: "Product not available." }, { status: 404 });
  }

  const { data: inventoryImages, error: imageError } = await supabase
    .from("inventory_images")
    .select("image_url,sort_order,is_primary")
    .eq("inventory_item_id", inventoryItem.id)
    .order("sort_order", { ascending: true });
  if (imageError) throw imageError;

  const metadata = recordValue(inventoryItem.metadata);
  const images = Array.from(
    new Set(
      [
        String(product.image_url || "").trim(),
        ...(inventoryImages || []).map((image: any) =>
          String(image.image_url || "").trim(),
        ),
        ...stringArray(metadata.ebay_image_urls),
      ].filter(Boolean),
    ),
  ).slice(0, 12);
  const shipping = listingShippingSummary(Number(product.price || 0));

  return NextResponse.json(
    {
      productId: legacyProductId,
      title: product.title,
      price: Number(product.price || 0),
      images,
      shipping,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
