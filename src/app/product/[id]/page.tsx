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
import { buildCollectorIntelligence } from "../../../lib/collector-intelligence";
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

  if (!product) {
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

  if (!product) {
    return (
      <main className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Product Not Found</h1>

        <p className="mb-2">
          Product ID checked: <strong>{id}</strong>
        </p>

        <p className="mb-6">
          This card may have been sold, removed, or no longer exists.
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
  const intelligence = buildCollectorIntelligence(product, {
    storeDisplayName: storeSettings.displayName,
  });
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
      name: product.sport || "Sports Cards",
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
        <div>
          <div className="relative min-h-[320px] overflow-hidden rounded border bg-neutral-50 lg:min-h-[620px]">
            <Image
              src={product.imageUrl || "/placeholder.png"}
              alt={product.title}
              fill
              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"
              unoptimized
              className="object-contain"
            />
          </div>
        </div>

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
              <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
                Collector Research Page
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
                    TCOS shows the seller&apos;s certification, guarantee, and provenance
                    disclosure here so buyers can make an informed call.
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

      <section className="mt-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase text-neutral-500">
              Collector Intelligence
            </p>
            <h2 className="mt-2 text-3xl font-black">
              Research before you make it yours
            </h2>
          </div>

          <span className="rounded border border-yellow-300 bg-yellow-100 px-3 py-1 text-sm font-bold text-yellow-900">
            {intelligence.trendLabel}
          </span>
        </div>

        <p className="mt-4 max-w-4xl text-neutral-700">
          {intelligence.story}
        </p>
        <p className="mt-3 max-w-4xl text-sm text-neutral-600">
          {intelligence.trendDetail}
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <IntelligencePanel title="Market Checks" links={intelligence.marketLinks} />
          <IntelligencePanel title="Find Another" links={intelligence.acquisitionLinks} />
          <IntelligencePanel title="News And Social" links={[...intelligence.newsLinks, ...intelligence.socialLinks]} />
          <section className="rounded border bg-white p-4">
            <h3 className="font-bold">Pop Report</h3>
            <p className="mt-2 text-sm font-semibold">
              {intelligence.populationReport.label}
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              {intelligence.populationReport.detail}
            </p>

            <div className="mt-4 space-y-2">
              {intelligence.populationReport.links.map((link) => (
                <ResearchLink key={link.href} link={link} compact />
              ))}
            </div>
          </section>
        </div>

        <section className="mt-6 rounded border bg-white p-4">
          <h3 className="font-bold">What To Check</h3>
          <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-neutral-700 md:grid-cols-2">
            {intelligence.whatToWatch.map((item) => (
              <li key={item} className="rounded bg-neutral-50 px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-6 rounded border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Exact Match Signals</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                {intelligence.exactMatchDetail}
              </p>
            </div>
            <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
              {intelligence.exactMatchLabel}
            </span>
          </div>

          {intelligence.variantSignals.length > 0 ? (
            <dl className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {intelligence.variantSignals.map((signal) => (
                <div key={`${signal.label}-${signal.value}`} className="rounded bg-neutral-50 px-3 py-2">
                  <dt className="text-xs font-bold uppercase text-neutral-500">
                    {signal.label}
                  </dt>
                  <dd className="mt-1 text-sm font-bold text-neutral-950">
                    {signal.value}
                  </dd>
                  <dd className="mt-1 text-xs text-neutral-500">
                    {signal.confidence === "title_signal"
                      ? "Detected from title"
                      : "Needs checklist/source confirmation"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-4 rounded bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
              Add year, set, card number, serial number, parallel, grade, or
              cert details to improve exact-match identification.
            </p>
          )}
        </section>

        <section className="mt-6 rounded border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Complete The Set Or Run</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-neutral-600">
                Use these links to hunt related cards, missing checklist pieces,
                player runs, team runs, and comparable listings. TCOS searches
                itself first, then sends collectors to clearly labeled external
                research paths.
              </p>
            </div>
            <span className="rounded bg-neutral-100 px-3 py-1 text-xs font-bold uppercase text-neutral-600">
              Set Builder Helper
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {intelligence.setBuilderLinks.map((link) => (
              <ResearchLink key={link.href} link={link} />
            ))}
          </div>
        </section>

        <p className="mt-4 text-xs text-neutral-500">
          Last checked: {new Date(intelligence.lastUpdated).toLocaleString()}.
          TCOS only shows a public trend when verified source data supports it.
        </p>
      </section>
    </main>
  );
}

function IntelligencePanel({
  title,
  links,
}: {
  title: string;
  links: Array<{
    label: string;
    href: string;
    description: string;
  }>;
}) {
  return (
    <section className="rounded border bg-white p-4">
      <h3 className="font-bold">{title}</h3>
      <div className="mt-4 space-y-3">
        {links.map((link) => (
          <ResearchLink key={link.href} link={link} />
        ))}
      </div>
    </section>
  );
}

function ResearchLink({
  link,
  compact = false,
}: {
  link: {
    label: string;
    href: string;
    description: string;
  };
  compact?: boolean;
}) {
  const isExternal = link.href.startsWith("http");

  return (
    <a
      href={link.href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      className="block rounded border px-3 py-2 hover:bg-neutral-50"
    >
      <span className="block text-sm font-bold">{link.label}</span>
      {compact ? null : (
        <span className="mt-1 block text-xs leading-5 text-neutral-600">
          {link.description}
        </span>
      )}
    </a>
  );
}
