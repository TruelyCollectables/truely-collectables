import { NextResponse } from "next/server";
import { createServerInventoryEngine } from "../../../../../lib/server-inventory-engine";
import { listStorefrontProductImages } from "../../../../../lib/storefront-product-images";
import { getActiveStoreId } from "../../../../../lib/stores";
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

  const images = await listStorefrontProductImages({
    supabase: createSupabaseServerClient({ admin: true }),
    storeId: getActiveStoreId(),
    legacyProductId,
    sku: product.sku,
    preferredInventoryItemId: product.inventoryItemId,
    primaryImageUrl: product.imageUrl,
  });

  return NextResponse.json(
    {
      productId: legacyProductId,
      images,
      hasFront: images.length >= 1,
      hasBack: images.length >= 2,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
