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
  const backImageAvailable = visibleImages.length > 1;

  return (
    <section aria-label={`${title} front and back photos`}>
      <div className="grid gap-4 sm:grid-cols-2">
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
                sizes="(min-width: 1024px) 34vw, (min-width: 640px) 50vw, 100vw"
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

        {!backImageAvailable ? (
          <div
            className={`flex aspect-[4/5] min-h-[320px] items-center justify-center rounded border-2 border-dashed p-6 text-center lg:min-h-[520px] ${
              sold
                ? "border-red-300 bg-red-50 text-red-800"
                : "border-neutral-300 bg-white text-neutral-600"
            }`}
            aria-label={`${title} back photo unavailable`}
          >
            <div>
              <p className="text-sm font-black uppercase tracking-[0.14em]">
                Back photo unavailable
              </p>
              <p className="mt-2 text-sm font-semibold leading-6">
                The source listing does not currently include a verified back
                image. We will add it automatically when one becomes available.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
