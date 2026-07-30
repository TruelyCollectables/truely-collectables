import Image from "next/image";
import SoldOverlay from "../../components/SoldOverlay";
import {
  listingImageAltText,
  listingImageLabel,
  selectFrontBackListingImages,
} from "../../lib/listing-image-utils";
import { createSupabaseServerClient } from "../../lib/supabase-server";

function displayLabel(index: number) {
  const label = listingImageLabel(index);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

async function loadFrontBackImages(params: {
  inventoryItemId: string | null;
  primaryImageUrl: string | null;
}) {
  const fallback = selectFrontBackListingImages([params.primaryImageUrl]);
  if (!params.inventoryItemId) return fallback;

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { data, error } = await supabase
      .from("inventory_images")
      .select("image_url,sort_order,is_primary")
      .eq("inventory_item_id", params.inventoryItemId)
      .order("sort_order", { ascending: true });

    if (error) return fallback;

    return selectFrontBackListingImages([
      params.primaryImageUrl,
      ...(data || []).map((row: any) => row.image_url),
    ]);
  } catch {
    return fallback;
  }
}

export default async function ProductImageGallery({
  inventoryItemId,
  primaryImageUrl,
  title,
  sold = false,
}: {
  inventoryItemId: string | null;
  primaryImageUrl: string | null;
  title: string;
  sold?: boolean;
}) {
  const images = await loadFrontBackImages({
    inventoryItemId,
    primaryImageUrl,
  });
  const visibleImages = images.length ? images : ["/placeholder.png"];

  return (
    <section aria-label={`${title} front and back photos`}>
      <div
        className={`grid gap-4 ${
          visibleImages.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"
        }`}
      >
        {visibleImages.map((imageUrl, index) => (
          <figure
            key={`${imageUrl}-${index}`}
            className={`overflow-hidden rounded border-2 bg-neutral-50 ${
              sold ? "border-red-800" : "border-neutral-200"
            }`}
          >
            <div className="relative aspect-[4/5] min-h-[320px] lg:min-h-[520px]">
              <Image
                src={imageUrl}
                alt={listingImageAltText(title, index)}
                fill
                sizes={
                  visibleImages.length > 1
                    ? "(min-width: 1024px) 34vw, (min-width: 640px) 50vw, 100vw"
                    : "(min-width: 1024px) calc(100vw - 540px), 100vw"
                }
                unoptimized
                className="object-contain p-3"
              />
              {sold ? <SoldOverlay compact /> : null}
            </div>
            <figcaption
              className={`border-t px-4 py-2 text-center text-xs font-black uppercase tracking-[0.16em] ${
                sold
                  ? "border-red-200 bg-red-50 text-red-800"
                  : "border-neutral-200 bg-white text-neutral-600"
              }`}
            >
              {displayLabel(index)} photo
            </figcaption>
          </figure>
        ))}
      </div>
      {visibleImages.length === 1 ? (
        <p className="mt-3 text-sm font-semibold text-neutral-500">
          A back photo is not available from the source listing yet.
        </p>
      ) : null}
    </section>
  );
}
