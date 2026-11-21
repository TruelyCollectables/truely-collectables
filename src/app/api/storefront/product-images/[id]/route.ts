import { NextResponse } from "next/server";
import {
  companionBackListingImageUrl,
  selectFrontBackListingImages,
} from "../../../../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../../../../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

function metadataImageCandidates(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== "object") return [];
  const ic =
    metadata.instacomp && typeof metadata.instacomp === "object"
      ? (metadata.instacomp as Record<string, unknown>)
      : {};
  const recovered =
    ic.recoveredImageUrls && typeof ic.recoveredImageUrls === "object"
      ? (ic.recoveredImageUrls as Record<string, unknown>)
      : {};
  const ebayUrls = Array.isArray(metadata.ebay_image_urls)
    ? metadata.ebay_image_urls
    : [];
  const sourceUrls = Array.isArray(ic.sourceImageUrls) ? ic.sourceImageUrls : [];

  return [
    ic.frontImageUrl,
    ic.backImageUrl,
    recovered.front,
    recovered.back,
    ...ebayUrls,
    ...sourceUrls,
  ];
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

  const product = await createServerInventoryEngine().getByLegacyProductId(
    legacyProductId,
  );

  if (
    !product ||
    !product.imageUrl ||
    product.quantity <= 0 ||
    product.status !== "active"
  ) {
    return NextResponse.json({ error: "Product not available." }, { status: 404 });
  }

  const supabase = createSupabaseServerClient({ admin: true });
  let inventoryItemId = product.inventoryItemId;
  let itemMetadata: Record<string, unknown> | null = null;

  if (!inventoryItemId) {
    const { data: invRow } = await supabase
      .from("inventory_items")
      .select("id,metadata")
      .eq("store_id", getActiveStoreId())
      .eq("legacy_product_id", legacyProductId)
      .maybeSingle();
    if (invRow?.id) inventoryItemId = String(invRow.id);
    if (invRow?.metadata && typeof invRow.metadata === "object") {
      itemMetadata = invRow.metadata as Record<string, unknown>;
    }
  } else {
    const { data: invRow } = await supabase
      .from("inventory_items")
      .select("metadata")
      .eq("id", inventoryItemId)
      .maybeSingle();
    if (invRow?.metadata && typeof invRow.metadata === "object") {
      itemMetadata = invRow.metadata as Record<string, unknown>;
    }
  }

  let orderedRows: Array<{ image_url: string | null }> = [];
  if (inventoryItemId) {
    const { data, error } = await supabase
      .from("inventory_images")
      .select("image_url,sort_order,is_primary")
      .eq("inventory_item_id", inventoryItemId)
      .order("sort_order", { ascending: true });

    if (!error && data) {
      orderedRows = [
        ...data.filter((image: any) => image.is_primary === true),
        ...data.filter((image: any) => image.is_primary !== true),
      ];
    }
  }

  const images = selectFrontBackListingImages([
    ...orderedRows.map((image) => image.image_url),
    product.imageUrl,
    companionBackListingImageUrl(product.imageUrl),
    ...metadataImageCandidates(itemMetadata),
  ]);

  return NextResponse.json(
    {
      productId: legacyProductId,
      images,
      hasFront: images.length >= 1,
      hasBack: images.length >= 2,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=120, stale-while-revalidate=600",
      },
    },
  );
}
