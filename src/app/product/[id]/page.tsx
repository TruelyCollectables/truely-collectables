import Link from "next/link";
import type { Metadata } from "next";
import { cache } from "react";
import OfferForm from "./OfferForm";
import ProductActions from "./ProductActions";
import ProductGallery from "./ProductGallery";
import {
  authenticityStatusLabel,
  buildAuthenticityBadges,
  getAuthenticityCallout,
  hasAuthenticityDetails,
} from "../../../lib/authenticity";
import { normalizeListingImageUrls } from "../../../lib/listing-image-utils";
import { storefrontCategoryForItem } from "../../../lib/storefront-taxonomy";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { configuredSiteOrigin } from "../../../lib/site-origin";
import { getStoreSettings } from "../../../lib/store-settings";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getProduct = cache(async (id: string) => {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;
  return createServerInventoryEngine().getByLegacyProductId(numericId);
});

function isPublicProduct(
  product: Awaited<ReturnType<typeof getProduct>>,
): product is NonNullable<Awaited<ReturnType<typeof getProduct>>> {
  return Boolean(
    product &&
      product.inventoryItemId &&
      product.quantity > 0 &&
      product.status === "active",
  );
}

function absoluteUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value, configuredSiteOrigin()).toString();
  } catch {
    return null;
  }
}

function productDescription(product: NonNullable<Awaited<ReturnType<typeof getProduct>>>) {
  return (
    product.description ||
    [
      product.title,
      product.player ? `featuring ${product.player}` : "",
      product.sport ? `in ${product.sport}` : "",
      `available from Truely Collectables for $${Number(product.price).toFixed(2)}.`,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300)
  );
}

function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
}

const getProductImages = cache(
  async (inventoryItemId: string, fallbackImage: string | null) => {
    const supabase = createSupabaseServerClient({ admin: true });
    const [imageResult, inventoryResult] = await Promise.all([
      supabase
        .from("inventory_images")
        .select("image_url,alt_text,sort_order,is_primary")
        .eq("inventory_item_id", inventoryItemId)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true }),
      supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", inventoryItemId)
        .maybeSingle(),
    ]);

    if (imageResult.error) {
      console.error("Product gallery image rows could not be loaded", imageResult.error);
    }
    if (inventoryResult.error) {
      console.error("Product gallery metadata could not be loaded", inventoryResult.error);
    }

    const metadata =
      inventoryResult.data?.metadata &&
      typeof inventoryResult.data.metadata === "object" &&
      !Array.isArray(inventoryResult.data.metadata)
        ? (inventoryResult.data.metadata as Record<string, unknown>)
        : {};
    const savedImages = (imageResult.data || []).map((row) => row.image_url);

    return normalizeListingImageUrls([
      ...savedImages,
      fallbackImage,
      ...stringList(metadata.ebay_image_urls),
      ...stringList(metadata.image_urls),
      ...stringList(metadata.source_image_urls),
    ]);
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  const origin = configuredSiteOrigin();

  if (!isPublicProduct(product)) {
    return {
      title: "Product Not Found | Truely Collectables",
      robots: { index: false, follow: true },
    };
  }

  const title = `${product.title} | Truely Collectables`;
  const description = productDescription(product);
  const image = absoluteUrl(product.imageUrl);
  const canonicalPath = `/product/${product.legacyProductId}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title,
      description,
      url: `${origin}${canonicalPath}`,
      type: "website",
      images: image ? [{ url: image, alt: product.title }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProduct(id);

  if (!isPublicProduct(product)) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <h1 className="text-3xl font-bold">Product Not Found</h1>
        <p className="mt-3">This card may have been sold or removed.</p>
        <Link href="/shop" className="mt-6 inline-block font-bold underline">
          Back to Shop
        </Link>
      </main>
    );
  }

  const quantity = Number(product.quantity || 0);
  const supabase = createSupabaseServerClient({ admin: true });
  const storeSettings = await getStoreSettings(supabase);
  const images = await getProductImages(
    product.inventoryItemId,
    product.imageUrl || null,
  );
  const galleryImages = images.length ? images : ["/placeholder.png"];
  const productUrl = `${configuredSiteOrigin()}/product/${product.legacyProductId}`;
  const category = storefrontCategoryForItem(product);
  const imageUrls = galleryImages.map(absoluteUrl).filter(Boolean);
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: productDescription(product),
    image: imageUrls,
    sku: product.sku || String(product.legacyProductId),
    category,
    url: productUrl,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "USD",
      price: Number(product.price).toFixed(2),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "Organization", name: storeSettings.displayName },
    },
  };
  const authenticityCallout = getAuthenticityCallout(product.authenticity);
  const authenticityBadges = buildAuthenticityBadges(product.authenticity);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />

      <Link href="/shop" className="inline-block text-sm font-bold underline">
        Back to Shop
      </Link>

      <section className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
        <ProductGallery title={product.title} images={galleryImages} />

        <div className="space-y-5 lg:sticky lg:top-6">
          <section>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-green-100 px-3 py-1 text-xs font-bold uppercase text-green-700">
                In Stock
              </span>
              <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-700">
                {category}
              </span>
            </div>

            <h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">
              {product.title}
            </h1>

            {product.player ? (
              <p className="mt-3 text-neutral-600">{product.player}</p>
            ) : null}

            <p className="mt-5 text-5xl font-black">
              ${Number(product.price).toFixed(2)}
            </p>
            <p className="mt-2 text-sm font-bold text-neutral-500">
              {quantity} available
            </p>
          </section>

          {product.description ? (
            <section className="rounded border bg-white p-5">
              <h2 className="text-lg font-bold">Description</h2>
              <p className="mt-3 whitespace-pre-wrap leading-7 text-neutral-700">
                {product.description}
              </p>
            </section>
          ) : null}

          {hasAuthenticityDetails(product.authenticity) ? (
            <section className="rounded border bg-white p-5">
              <div className="flex flex-wrap gap-2">
                {authenticityBadges.map((badge) => (
                  <span
                    key={badge.label}
                    className="rounded border bg-neutral-50 px-3 py-1 text-xs font-bold"
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
              <h2 className="mt-4 text-lg font-bold">Authenticity Disclosure</h2>
              <p className="mt-2 text-sm font-bold">
                {authenticityStatusLabel(product.authenticity.status)}
              </p>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                {authenticityCallout.detail}
              </p>
            </section>
          ) : null}

          <section className="rounded border bg-white p-5">
            <ProductActions
              product={{
                id: product.legacyProductId,
                title: product.title,
                price: Number(product.price),
                image_url: galleryImages[0] || undefined,
              }}
            />

            <OfferForm
              productId={product.legacyProductId}
              price={Number(product.price)}
            />
          </section>
        </div>
      </section>
    </main>
  );
}
