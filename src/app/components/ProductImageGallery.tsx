import Image from "next/image";
import SoldOverlay from "../../components/SoldOverlay";
import {
  companionBackListingImageUrl,
  listingImageAltText,
  listingImageLabel,
  selectFrontBackListingImages,
} from "../../lib/listing-image-utils";
import { getActiveStoreId } from "../../lib/stores";
import { createSupabaseServerClient } from "../../lib/supabase-server";

function displayLabel(index: number) {
  const label = listingImageLabel(index);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

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

async function loadFrontBackImages(params: {
  inventoryItemId: string | null;
  legacyProductId?: number | null;
  primaryImageUrl: string | null;
}) {
  const companionBack = companionBackListingImageUrl(params.primaryImageUrl);
  const fallback = selectFrontBackListingImages([
    params.primaryImageUrl,
    companionBack,
  ]);

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    let inventoryItemId = params.inventoryItemId;
    let itemMetadata: Record<string, unknown> | null = null;

    if (!inventoryItemId && params.legacyProductId) {
      const { data: invRow } = await supabase
        .from("inventory_items")
        .select("id,metadata")
        .eq("store_id", getActiveStoreId())
        .eq("legacy_product_id", params.legacyProductId)
        .maybeSingle();
      if (invRow?.id) inventoryItemId = String(invRow.id);
      if (invRow?.metadata && typeof invRow.metadata === "object") {
        itemMetadata = invRow.metadata as Record<string, unknown>;
      }
    } else if (inventoryItemId) {
      const { data: invRow } = await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", inventoryItemId)
        .maybeSingle();
      if (invRow?.metadata && typeof invRow.metadata === "object") {
        itemMetadata = invRow.metadata as Record<string, unknown>;
      }
    }

    let dbImages: string[] = [];
    if (inventoryItemId) {
      const { data, error } = await supabase
        .from("inventory_images")
        .select("image_url,sort_order,is_primary")
        .eq("inventory_item_id", inventoryItemId)
        .order("sort_order", { ascending: true });

      if (!error && data) {
        const ordered = [
          ...data.filter((row: any) => row.is_primary === true),
          ...data.filter((row: any) => row.is_primary !== true),
        ];
        dbImages = ordered.map((row: any) => String(row.image_url || ""));
      }
    }

    return selectFrontBackListingImages([
      ...dbImages,
      params.primaryImageUrl,
      companionBack,
      ...metadataImageCandidates(itemMetadata),
    ]);
  } catch {
    return fallback;
  }
}

export default async function ProductImageGallery({
  inventoryItemId,
  legacyProductId = null,
  primaryImageUrl,
  title,
  sold = false,
}: {
  inventoryItemId: string | null;
  legacyProductId?: number | null;
  primaryImageUrl: string | null;
  title: string;
  sold?: boolean;
}) {
  const images = await loadFrontBackImages({
    inventoryItemId,
    legacyProductId,
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
            className={`group overflow-hidden rounded-xl border bg-white shadow-xs transition hover:shadow-md ${
              sold ? "border-red-300" : "border-slate-200"
            }`}
          >
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open full-size ${displayLabel(index)} photo`}
              className="relative block aspect-[4/5] min-h-[320px] bg-[#f8fafc] lg:min-h-[480px]"
            >
              <Image
                src={imageUrl}
                alt={listingImageAltText(title, index)}
                fill
                sizes="(min-width: 1024px) 34vw, (min-width: 640px) 50vw, 100vw"
                unoptimized
                className="object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
              />
              {sold ? <SoldOverlay compact /> : null}
              <span className="absolute right-2.5 bottom-2.5 rounded-md bg-[#0f172a]/85 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white opacity-0 transition group-hover:opacity-100">
                Zoom ↗
              </span>
            </a>
            <figcaption
              className={`border-t px-4 py-2.5 text-center text-xs font-bold uppercase tracking-[0.16em] ${
                sold
                  ? "border-red-200 bg-red-50 text-[#dc2626]"
                  : "border-slate-100 bg-white text-slate-600"
              }`}
            >
              {displayLabel(index)} photo
            </figcaption>
          </figure>
        ))}

        {!backImageAvailable ? (
          <div
            className={`flex aspect-[4/5] min-h-[320px] items-center justify-center rounded-xl border border-dashed p-6 text-center lg:min-h-[480px] ${
              sold
                ? "border-red-300 bg-red-50 text-[#dc2626]"
                : "border-slate-300 bg-white text-slate-500"
            }`}
            aria-label={`${title} back photo unavailable`}
          >
            <div>
              <p className="font-display text-lg font-extrabold uppercase tracking-wide">
                Back photo unavailable
              </p>
              <p className="mt-2 text-xs font-medium leading-5">
                A verified back image is not currently available for this item.
                Review the front scan and listing details before purchase.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
