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
      product.imageUrl &&
      product.quantity > 0 &&
      product.price > 0 &&
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
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/shop" className="text-sm font-bold underline underline-offset-4">
          ← Back to Shop
        </Link>
        <span className="rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide">
          {statusLabel(product.status, quantity)}
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section>
          <ProductImageGallery
            productId={product.legacyProductId}
            title={product.title}
            primaryImage={product.imageUrl}
          />
        </section>

        <section>
          <p className="text-sm font-black uppercase tracking-[0.14em] text-neutral-500">
            {product.storefrontSection || product.sport || "Collectible"}
          </p>
          <h1 className="mt-2 text-3xl font-black leading-tight sm:text-4xl">
            {product.title}
          </h1>
          {product.player ? (
            <p className="mt-3 text-lg font-bold text-neutral-600">{product.player}</p>
          ) : null}

          <p className="mt-6 text-3xl font-black">${Number(product.price).toFixed(2)}</p>

          <div className="mt-6 grid grid-cols-2 gap-3 rounded border bg-white p-4 text-sm">
            {facts.map(([label, value]) => (
              <div key={label}>
                <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
                  {label}
                </p>
                <p className="mt-1 font-bold break-words">{value}</p>
              </div>
            ))}
          </div>

          {hasAuthenticityDetails(product.authenticity) ? (
            <section className="mt-6 rounded border bg-white p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                Authenticity
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {authenticityBadges.map((badge) => (
                  <span
                    key={badge.label}
                    className={`rounded-full border px-3 py-1 text-xs font-black ${authenticityToneClasses(badge.tone)}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
              {authenticityCallout ? (
                <p className="mt-3 text-sm leading-6 text-neutral-700">
                  {authenticityCallout}
                </p>
              ) : null}
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-black text-neutral-600">Status</dt>
                  <dd className="mt-1">
                    {authenticityStatusLabel(product.authenticity.status)}
                  </dd>
                </div>
                {product.authenticity.autographSource ? (
                  <div>
                    <dt className="font-black text-neutral-600">Autograph Source</dt>
                    <dd className="mt-1">
                      {autographSourceLabel(product.authenticity.autographSource)}
                    </dd>
                  </div>
                ) : null}
                {product.authenticity.certProvider ? (
                  <div>
                    <dt className="font-black text-neutral-600">Certification</dt>
                    <dd className="mt-1">
                      {product.authenticity.certProvider}
                      {product.authenticity.certNumber
                        ? ` #${product.authenticity.certNumber}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {product.authenticity.provenanceEvidence ? (
                  <div className="sm:col-span-2">
                    <dt className="font-black text-neutral-600">Provenance</dt>
                    <dd className="mt-1 whitespace-pre-wrap">
                      {product.authenticity.provenanceEvidence}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          {product.description ? (
            <section className="mt-6 rounded border bg-white p-4">
              <h2 className="font-black">Description</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">
                {product.description}
              </p>
            </section>
          ) : null}

          {!isSoldOut ? (
            <div className="mt-6 space-y-5">
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
                productTitle={product.title}
                price={Number(product.price)}
              />
            </div>
          ) : null}
        </section>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />
    </main>
  );
}
