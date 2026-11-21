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
  return Boolean(product && product.imageUrl);
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
  const quantity = Number(product.quantity || 0);
  const isSoldOut = quantity <= 0 || product.status !== "active";

  return (
    product.description ||
    [
      product.title,
      product.player ? `featuring ${product.player}` : "",
      product.sport ? `in ${product.sport}` : "",
      isSoldOut
        ? "Previously sold by Truely Collectables."
        : `available from Truely Collectables for $${Number(product.price).toFixed(2)}.`,
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

  return "border-slate-200 bg-slate-100 text-slate-700";
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
      <main className="flex-1 bg-[#f8fafc] px-6 py-12 text-[#0f172a]">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-xs">
          <h1 className="font-display text-3xl font-extrabold uppercase">
            Product Not Found
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Product ID checked: <strong>{id}</strong>. This item may have been removed or sold.
          </p>
          <Link
            href="/shop"
            className="mt-5 inline-block rounded-lg bg-[#0f172a] px-5 py-2.5 text-sm font-bold text-[#facc15] hover:bg-[#1e293b]"
          >
            Back to Shop
          </Link>
        </div>
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
    ["Availability", isSoldOut ? "Sold out" : `${quantity} in stock`],
    ["Status", statusLabel(product.status, quantity)],
    ["SKU", product.sku || "Not assigned"],
    ["eBay", product.ebayItemId ? `#${product.ebayItemId}` : "Direct site listing"],
  ];

  return (
    <main className="flex-1 bg-[#f8fafc] text-[#0f172a]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productJsonLd) }}
      />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <Link
            href="/shop"
            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-[#0f172a]"
          >
            ← Back to Shop
          </Link>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-800">
            Actual Card Scans · Ships Tracked
          </span>
        </div>

        <section className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          <ProductImageGallery
            inventoryItemId={product.inventoryItemId}
            legacyProductId={product.legacyProductId}
            primaryImageUrl={product.imageUrl}
            title={product.title}
            sold={isSoldOut}
          />

          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#2563eb]">
                  {product.storefrontSection || product.sport || "Collectible"}
                </span>
                <span
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${
                    isSoldOut
                      ? "bg-red-100 text-[#dc2626]"
                      : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {statusLabel(product.status, quantity)}
                </span>
                {product.promotion?.onSale ? (
                  <span className="rounded bg-[#dc2626] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                    ON SALE · {product.promotion.discountPercent}% OFF
                  </span>
                ) : null}
              </div>

              <h1 className="font-display mt-3 text-3xl font-extrabold uppercase leading-tight tracking-tight text-[#0f172a] sm:text-4xl">
                {product.title}
              </h1>

              <p className="mt-2 text-sm font-medium text-slate-500">
                {[product.sport, product.player].filter(Boolean).join(" · ") ||
                  "Collectable"}
              </p>

              <div className="mt-5 flex items-baseline gap-3 border-t border-slate-100 pt-4">
                <p
                  className={`font-display text-5xl font-extrabold ${
                    product.promotion?.onSale ? "text-[#dc2626]" : "text-[#0f172a]"
                  }`}
                >
                  ${Number(product.price).toFixed(2)}
                </p>
                {product.promotion?.onSale && product.promotion.originalPrice ? (
                  <p className="text-lg font-bold text-slate-400 line-through">
                    ${Number(product.promotion.originalPrice).toFixed(2)}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              {product.authenticity.status === "unverified_as_is" ? (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-bold">Unverified autograph disclosure</p>
                  <p className="mt-1 leading-6">
                    This listing is marked unverified and sold as-is. Review the
                    description, photos, and provenance before purchasing.
                  </p>
                </div>
              ) : null}

              {isSoldOut ? (
                <div className="w-full rounded-lg bg-[#dc2626] py-3 text-center text-sm font-extrabold uppercase tracking-wider text-white">
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
                      original_price:
                        product.promotion?.onSale && product.promotion.originalPrice
                          ? Number(product.promotion.originalPrice)
                          : undefined,
                      discount_percent: product.promotion?.onSale
                        ? Number(product.promotion.discountPercent)
                        : undefined,
                    }}
                  />

                  <OfferForm
                    productId={product.legacyProductId}
                    price={Number(product.price)}
                  />
                </>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-[#0f172a]">
                Collector Snapshot
              </h2>
              <dl className="mt-3 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {label}
                    </dt>
                    <dd className="mt-0.5 break-words font-semibold text-[#0f172a]">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {hasAuthenticityDetails(product.authenticity) ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-[#0f172a]">
                      Authenticity Disclosure
                    </h2>
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      Certification, guarantee, and provenance disclosure.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {authenticityBadges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${authenticityToneClasses(
                          badge.tone,
                        )}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  className={`mt-4 rounded-lg border px-4 py-3 text-sm ${authenticityToneClasses(
                    authenticityCallout.tone,
                  )}`}
                >
                  <p className="font-bold">{authenticityCallout.title}</p>
                  <p className="mt-1 leading-6">{authenticityCallout.detail}</p>
                </div>

                <dl className="mt-4 grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Authenticity Status
                    </dt>
                    <dd className="mt-0.5 font-semibold text-[#0f172a]">
                      {authenticityStatusLabel(product.authenticity.status)}
                    </dd>
                  </div>

                  {product.authenticity.autographSource !== "none" ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Autograph Source
                      </dt>
                      <dd className="mt-0.5 font-semibold text-[#0f172a]">
                        {autographSourceLabel(product.authenticity.autographSource)}
                      </dd>
                    </div>
                  ) : null}

                  {product.authenticity.certProvider ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Certification Provider
                      </dt>
                      <dd className="mt-0.5 font-semibold text-[#0f172a]">
                        {product.authenticity.certProvider}
                      </dd>
                    </div>
                  ) : null}

                  {product.authenticity.certNumber ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Certification Number
                      </dt>
                      <dd className="mt-0.5 break-words font-mono font-semibold text-[#0f172a]">
                        {product.authenticity.certNumber}
                      </dd>
                    </div>
                  ) : null}

                  {product.authenticity.guaranteedAuthenticators.length > 0 ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 sm:col-span-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Seller Pass Guarantee Authenticators
                      </dt>
                      <dd className="mt-0.5 font-semibold text-[#0f172a]">
                        {product.authenticity.guaranteedAuthenticators.join(", ")}
                      </dd>
                    </div>
                  ) : null}

                  {product.authenticity.provenanceEvidence ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 sm:col-span-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Provenance Evidence
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap font-medium text-[#0f172a]">
                        {product.authenticity.provenanceEvidence}
                      </dd>
                    </div>
                  ) : null}

                  {product.authenticity.authenticityNotes ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 sm:col-span-2">
                      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        Seller Disclosure Notes
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap font-medium text-[#0f172a]">
                        {product.authenticity.authenticityNotes}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </section>
            ) : null}

            {product.description ? (
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-[#0f172a]">
                  Description
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {product.description}
                </p>
              </section>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
