import { NextResponse } from "next/server";
import { normalizeListingImageUrls } from "../../../../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../../../../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const legacyProductId = Number(id);

  if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
    return NextResponse.json({ error: "Invalid product ID." }, { status: 400 });
  }

  const product = await createServerInventoryEngine().getByLegacyProductId(
    legacyProductId,
  );

  if (
    !product ||
    !product.inventoryItemId ||
    !product.imageUrl ||
    product.quantity <= 0 ||
    product.status !== "active"
  ) {
    return NextResponse.json({ error: "Product not available." }, { status: 404 });
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("inventory_images")
    .select("image_url,sort_order,is_primary")
    .eq("inventory_item_id", product.inventoryItemId)
    .order("sort_order", { ascending: true });

  if (error) throw error;

  const imageRows = data || [];
  const orderedRows = [
    ...imageRows.filter((image: any) => image.is_primary === true),
    ...imageRows.filter((image: any) => image.is_primary !== true),
  ];
  const images = normalizeListingImageUrls([
    ...orderedRows.map((image: any) => image.image_url),
    product.imageUrl,
  ]);

  return NextResponse.json(
    {
      productId: legacyProductId,
      images,
      imageCount: images.length,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
