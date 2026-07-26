import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { cache } from "react";
import OfferForm from "./OfferForm";
import ProductActions from "./ProductActions";
import {
  authenticityStatusLabel,
  autographSourceLabel,
  buildAuthenticityBadges,
  getAuthenticityCallout,
  hasAuthenticityDetails,
} from "../../../lib/authenticity";
import { preferHighResolutionListingImage } from "../../../lib/listing-image-utils";
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
    product?.inventoryItemId &&
      product.imageUrl &&
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

function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function categoryLabel(value: string | null | undefined) {
  return String(value || "Collectible")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function productDescription(
  product: NonNullable<Awaited<ReturnType<typeof getProduct>>>,
) {
  return (
    product.description ||
    `${product.title} is available from Truely Collectables for $${Number(product.price).toFixed(2)}.`
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  if (!isPublicProduct(product)) {
    return {
      title: "Product Not Found | Truely Collectables",
      robots: { index: false, follow: true },
    };
  }

  const description = productDescription(product).slice(0, 300);
  const image = absoluteUrl(preferHighResolutionListingImage(product.imageUrl));
  const canonicalPath = `/product/${product.legacyProductId}`;
  return {
    title: `${product.title} | Truely Collectables`,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: product.title,
      description,
      url: `${configuredSiteOrigin()}${canonicalPath}`,
      type: "website",
      images: image ? [{ url: image, alt: product.title }] : undefined,
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
      <main className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6">
        <h1 className="text-4xl font-black">Product Not Found</h1>
        <p className="mt-4 text-neutral-600">
          This item may have sold, ended, or been removed from the launch catalog.
        </p>
        <Link href="/shop" className="mt-6 inline-flex font-black underline">
          Back to Shop
        </Link>
      </main>
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const [settings, inventoryResult, attributesResult] = await Promise.all([
    getStoreSettings(supabase),
    supabase
      .from("inventory_items")
      .select("category,condition,metadata")
      .eq("id", product.inventoryItemId)
      .maybeSingle(),
    supabase
      .from("inventory_attributes")
      .select("attribute_name,attribute_value")
      .eq("inventory_item_id", product.inventoryItemId)
      .order("attribute_name"),
  ]);
  const inventory = inventoryResult.data;
  const metadata = metadataRecord(inventory?.metadata);
  const bestOfferEnabled = metadata.website_best_offer_enabled !== false;
  const shippingProfile =
    metadata.website_shipping_profile === "parcel_only"
      ? "parcel_only"
      : "card_letter_eligible";
  const category = categoryLabel(inventory?.category || product.sport);
  const condition = categoryLabel(inventory?.condition || "Not specified");
  const attributes = (attributesResult.data || []).filter(
    (row) =>
      row.attribute_value &&
      !String(row.attribute_name).includes("source_item_id") &&
      !String(row.attribute_name).includes("listing_id"),
  );
  const imageUrl =
    preferHighResolutionListingImage(product.imageUrl) || "/placeholder.png";
  const productUrl = `${configuredSiteOrigin()}/product/${product.legacyProductId}`;
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: productDescription(product),
    image: [absoluteUrl(imageUrl)].filter(Boolean),
    sku: product.sku || String(product.legacyProductId),
    mpn: product.sku || String(product.legacyProductId),
    category,
    url: productUrl,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "USD",
      price: Number(product.price).toFixed(2),
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/UsedCondition",
      seller: { "@type": "Organization", name: settings.displayName },
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
      <Link href="/shop" className="font-black underline">
        Back to Shop
      </Link>

      <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_430px]">
        <div>
          <div className="relative min-h-[360px] overflow-hidden rounded border bg-neutral-50 lg:min-h-[680px]">
            <Image
              src={imageUrl}
              alt={product.title}
              fill
              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"
              quality={90}
              className="object-contain p-3"
            />
          </div>
        </div>

        <div className="space-y-5">
          <section>
            <span className="rounded bg-emerald-100 px-3 py-1 text-xs font-black uppercase text-emerald-800">
              In Stock
            </span>
            <h1 className="mt-4 text-3xl font-black leading-tight sm:text-4xl">
              {product.title}
            </h1>
            <p className="mt-3 text-neutral-600">
              {category}
              {product.player ? ` · ${product.player}` : ""}
            </p>
            <p className="mt-5 text-5xl font-black">
              ${Number(product.price).toFixed(2)}
            </p>
          </section>

          <section className="rounded border bg-white p-5">
            <h2 className="text-xl font-black">Item Details</h2>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded bg-neutral-50 p-3">
                <dt className="font-bold text-neutral-500">Category</dt>
                <dd className="mt-1 font-black">{category}</dd>
              </div>
              <div className="rounded bg-neutral-50 p-3">
                <dt className="font-bold text-neutral-500">Condition</dt>
                <dd className="mt-1 font-black">{condition}</dd>
              </div>
              <div className="rounded bg-neutral-50 p-3">
                <dt className="font-bold text-neutral-500">Available</dt>
                <dd className="mt-1 font-black">{product.quantity}</dd>
              </div>
              <div className="rounded bg-neutral-50 p-3">
                <dt className="font-bold text-neutral-500">SKU</dt>
                <dd className="mt-1 break-words font-black">
                  {product.sku || `TC-${product.legacyProductId}`}
                </dd>
              </div>
            </dl>
          </section>

          {product.description ? (
            <section className="rounded border bg-white p-5">
              <h2 className="text-xl font-black">Description</h2>
              <div
                className="mt-3 whitespace-pre-wrap break-words leading-7 text-neutral-700"
                dangerouslySetInnerHTML={{ __html: product.description }}
              />
            </section>
          ) : null}

          {hasAuthenticityDetails(product.authenticity) ? (
            <section className="rounded border bg-white p-5">
              <div className="flex flex-wrap gap-2">
                {authenticityBadges.map((badge) => (
                  <span
                    key={badge.label}
                    className="rounded border bg-neutral-50 px-3 py-1 text-xs font-black"
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
              <p className="mt-3 font-black">{authenticityCallout.title}</p>
              <p className="mt-2 text-sm text-neutral-600">
                {authenticityCallout.detail}
              </p>
              <p className="mt-3 text-sm">
                Status: {authenticityStatusLabel(product.authenticity.status)}
                {product.authenticity.autographSource !== "none"
                  ? ` · ${autographSourceLabel(product.authenticity.autographSource)}`
                  : ""}
              </p>
            </section>
          ) : null}

          <section className="rounded border bg-white p-5">
            <ProductActions
              product={{
                id: product.legacyProductId,
                title: product.title,
                price: Number(product.price),
                image_url: imageUrl,
                shipping_profile: shippingProfile,
              }}
            />
            {bestOfferEnabled ? (
              <OfferForm
                productId={product.legacyProductId}
                price={Number(product.price)}
              />
            ) : (
              <p className="mt-4 rounded bg-neutral-100 p-3 text-center text-sm font-bold text-neutral-600">
                Best Offer is not enabled for this item.
              </p>
            )}
          </section>
        </div>
      </section>

      {attributes.length > 0 ? (
        <section className="mt-8 rounded border bg-white p-5">
          <h2 className="text-2xl font-black">Listing Specifications</h2>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attributes.map((attribute) => (
              <div
                key={attribute.attribute_name}
                className="rounded bg-neutral-50 p-3 text-sm"
              >
                <dt className="font-bold text-neutral-500">
                  {String(attribute.attribute_name)
                    .replace(/^ebay_/, "")
                    .replaceAll("_", " ")
                    .replace(/\b\w/g, (letter) => letter.toUpperCase())}
                </dt>
                <dd className="mt-1 break-words font-black">
                  {attribute.attribute_value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </main>
  );
}
