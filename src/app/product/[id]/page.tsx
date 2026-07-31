import Link from "next/link";
import type { Metadata } from "next";
import ProductImageGallery from "../../components/ProductImageGallery";
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
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { configuredSiteOrigin } from "../../../lib/site-origin";
import { getStoreSettings } from "../../../lib/store-settings";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getProduct = cache(async (id: string) => {
  const numericId = Number(id);

  if (!Number.isFinite(numericId)) return null;

  const inventoryEngine = createServerInventoryEngine();
  return inventoryEngine.getByLegacyProductId(numericId);
});

function isPublicProduct(
  product: Awaited<ReturnType<typeof getProduct>>,
): product is NonNullable<Awaited<ReturnType<typeof getProduct>>> {
  return Boolean(
    product &&
      product.inventoryItemId &&
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
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  const title = `${product.title} | Truely Collectables`;
  const description = productDescription(product);
  const image = absoluteUrl(product.imageUrl);
  const canonicalPath = `/product/${product.legacyProductId}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title,
      description,
      url: `${origin}${canonicalPath}`,
      type: "website",
      images: image
        ? [
            {
              url: image,
              alt: product.title,
            },
          ]
        : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

function statusLabel(status: string, quantity: number) {
  if (quantity <= 0) return "Sold Out";
  return status.replaceAll("_", " ").toUpperCase();
}

function authenticityToneClasses(tone: "neutral" | "emerald" | "amber" | "sky") {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (tone === "sky") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
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
      <main className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Product Not Found</h1>

        <p className="mb-2">
          Product ID checked: <strong>{id}</strong>
        </p>

        <p className="mb-6">
          This item may have been sold, removed, or no longer exists.
        </p>

        <Link href="/shop" className="inline-block border rounded px-4 py-2">
          Back to Shop
        </Link>
      </main>
    );
  }

  const quantity = Number(product.quantity || 0);
  const isSoldOut = quantity <= 0 || product.status !== "active";
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);
  const productUrl = `${configuredSiteOrigin()}/product/${product.legacyProductId}`;
  const imageUrl = absoluteUrl(product.imageUrl);
  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: productDescription(product),
    image: imageUrl ? [imageUrl] : undefined,
    sku: product.sku || String(product.legacyProductId),
    mpn: product.ebayItemId || product.sku || String(product.legacyProductId),
    category: product.sport || "Collectibles",
    brand: {
      "@type": "Brand",
      name: "Truely Collectables",
    },
    url: productUrl,
    offers: {
      "@type": "Offer",
      url: productUrl,
      priceCurrency: "USD",
      price: Number(product.price).toFixed(2),
      availability: isSoldOut
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
      itemCondition: "https://schema.org/UsedCondition",
      seller: {
        "@type": "Organization",
        name: storeSettings.displayName,
      },
    },
  };
  const authenticityCallout = getAuthenticityCallout(product.authenticity);
  const authenticityBadges = buildAuthenticityBadges(product.authenticity);
  const facts = [
    ["Category", product.sport || "Not cataloged"],
    ["Player / Subject", product.player || "Not cataloged"],
    ["Availability", `${quantity} in stock`],
    ["Status", statusLabel(product.status, quantity)],
    ["SKU", product.sku || "Not assigned"],
    ["eBay", product.ebayItemId ? `#${product.ebayItemId}` : "Not linked"],
  ];

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />

      <Link href="/shop" className="inline-block text-sm font-bold underline">
        Back to Shop
      </Link>

      <section className="mt-6 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_420px]">
        <ProductImageGallery
          inventoryItemId={product.inventoryItemId}
          primaryImageUrl={product.imageUrl}
          title={product.title}
        />

        <div className="space-y-6">
          <section>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-3 py-1 text-xs font-bold uppercase ${
                  isSoldOut
                    ? "bg-red-100 text-red-700"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {statusLabel(product.status, quantity)}
              </span>
            </div>

            <h1 className="text-4xl font-black leading-tight md:text-5xl">
              {product.title}
            </h1>

            <p className="mt-4 text-neutral-600">
              {[product.sport, product.player].filter(Boolean).join(" - ") ||
                "Collectable"}
            </p>

            <p className="mt-5 text-5xl font-black">
              ${Number(product.price).toFixed(2)}
            </p>
          </section>

          <section className="rounded border bg-white p-5">
            <h2 className="text-xl font-bold">Collector Snapshot</h2>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="rounded bg-neutral-50 px-3 py-2">
                  <dt className="font-bold text-neutral-500">{label}</dt>
                  <dd className="mt-1 break-words text-neutral-950">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {hasAuthenticityDetails(product.authenticity) ? (
            <section className="rounded border bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold">Authenticity Disclosure</h2>
                  <p className="mt-2 text-sm text-neutral-600">
                    Truely Collectables shows the seller&apos;s certification,
                    guarantee, and provenance disclosure here so buyers can make an
                    informed call.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {authenticityBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className={`rounded border px-3 py-1 text-xs font-bold ${authenticityToneClasses(
                        badge.tone,
                      )}`}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              </div>

              <div
                className={`mt-4 rounded border px-4 py-3 text-sm ${authenticityToneClasses(
                  authenticityCallout.tone,
                )}`}
              >
                <p className="font-bold">{authenticityCallout.title}</p>
                <p className="mt-1 leading-6">{authenticityCallout.detail}</p>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="rounded bg-neutral-50 px-3 py-2">
                  <dt className="font-bold text-neutral-500">Authenticity Status</dt>
                  <dd className="mt-1 text-neutral-950">
                    {authenticityStatusLabel(product.authenticity.status)}
                  </dd>
                </div>

                {product.authenticity.autographSource !== "none" ? (
                  <div className="rounded bg-neutral-50 px-3 py-2">
                    <dt className="font-bold text-neutral-500">Autograph Source</dt>
                    <dd className="mt-1 text-neutral-950">
                      {autographSourceLabel(product.authenticity.autographSource)}
                    </dd>
                  </div>
                ) : null}

                {product.authenticity.certProvider ? (
                  <div className="rounded bg-neutral-50 px-3 py-2">
                    <dt className="font-bold text-neutral-500">Certification Provider</dt>
                    <dd className="mt-1 text-neutral-950">
                      {product.authenticity.certProvider}
                    </dd>
                  </div>
                ) : null}

                {product.authenticity.certNumber ? (
                  <div className="rounded bg-neutral-50 px-3 py-2">
                    <dt className="font-bold text-neutral-500">Certification Number</dt>
                    <dd className="mt-1 break-words text-neutral-950">
                      {product.authenticity.certNumber}
                    </dd>
                  </div>
                ) : null}

                {product.authenticity.guaranteedAuthenticators.length > 0 ? (
                  <div className="rounded bg-neutral-50 px-3 py-2 sm:col-span-2">
                    <dt className="font-bold text-neutral-500">
                      Seller Pass Guarantee Authenticators
                    </dt>
                    <dd className="mt-1 text-neutral-950">
                      {product.authenticity.guaranteedAuthenticators.join(", ")}
                    </dd>
                  </div>
                ) : null}

                {product.authenticity.provenanceEvidence ? (
                  <div className="rounded bg-neutral-50 px-3 py-2 sm:col-span-2">
                    <dt className="font-bold text-neutral-500">Provenance Evidence</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-neutral-950">
                      {product.authenticity.provenanceEvidence}
                    </dd>
                  </div>
                ) : null}

                {product.authenticity.authenticityNotes ? (
                  <div className="rounded bg-neutral-50 px-3 py-2 sm:col-span-2">
                    <dt className="font-bold text-neutral-500">Seller Disclosure Notes</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-neutral-950">
                      {product.authenticity.authenticityNotes}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          {product.description ? (
            <section className="rounded border bg-white p-5">
              <h2 className="text-xl font-bold">Description</h2>
              <p className="mt-3 whitespace-pre-wrap leading-7 text-neutral-700">
                {product.description}
              </p>
            </section>
          ) : null}

          <section className="rounded border bg-white p-5">
            {product.authenticity.status === "unverified_as_is" ? (
              <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-bold">Unverified autograph disclosure</p>
                <p className="mt-1 leading-6">
                  This listing is marked unverified and sold as-is. Review the
                  description, photos, and provenance before you make it yours.
                </p>
              </div>
            ) : null}

            {isSoldOut ? (
              <div className="w-full rounded bg-red-600 py-3 text-center font-bold text-white">
                SOLD OUT
              </div>
            ) : (
              <>
                <ProductActions
                  product={{
                    id: product.legacyProductId,
                    title: product.title,
                    price: Number(product.price),
                    image_url: product.imageUrl || undefined,
                  }}
                />

                <OfferForm
                  productId={product.legacyProductId}
                  price={Number(product.price)}
                />
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
