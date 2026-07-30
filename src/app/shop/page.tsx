import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import SoldOverlay from "../../components/SoldOverlay";
import {
  listRecentSoldStorefrontItems,
  type SaleEvidenceStatus,
} from "../../lib/collectible-sale-history";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import { getActiveStoreId } from "../../lib/stores";
import { createSupabaseServerClient } from "../../lib/supabase-server";
import {
  COLLECTIBLE_SECTIONS,
  SPORT_SECTIONS,
  sortStorefrontSections,
  type StorefrontSort,
} from "../../lib/storefront-taxonomy";
import type { UniversalInventoryItem } from "../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop Sports Cards & Collectibles",
  description:
    "Shop live sports cards, autographs, memorabilia, pucks, balls, jerseys, comics, coins, toys, and other collectibles from Truely Collectables.",
  alternates: { canonical: "/shop" },
};

const FEATURE_LINKS = [
  { key: "autograph", label: "Autographs" },
  { key: "memorabilia", label: "Memorabilia Cards" },
  { key: "graded", label: "Graded Cards" },
  { key: "rookie", label: "Rookie Cards" },
  { key: "numbered", label: "Numbered Cards" },
] as const;

function shopHref(params: {
  section?: string;
  feature?: string;
  sort?: string;
}) {
  const search = new URLSearchParams();
  if (params.section) search.set("section", params.section);
  if (params.feature) search.set("feature", params.feature);
  if (params.sort && params.sort !== "section") search.set("sort", params.sort);
  const query = search.toString();
  return query ? `/shop?${query}` : "/shop";
}

function heading(params: { section: string; feature: string }) {
  if (params.feature === "autograph") return "Autographed Items";
  if (params.feature === "memorabilia") return "Memorabilia Cards";
  if (params.feature === "rookie") return "Rookie Cards";
  if (params.feature === "graded") return "Graded Cards";
  if (params.feature === "numbered") return "Numbered Cards";
  return params.section || "Shop Sports Cards & Collectibles";
}

function FeatureBadges({ product }: { product: UniversalInventoryItem }) {
  const badges = [
    product.features.autograph ? "Autograph" : null,
    product.features.memorabilia ? "Memorabilia Card" : null,
    product.features.graded ? "Graded Card" : null,
    product.features.rookie ? "Rookie Card" : null,
    product.features.numbered ? "Numbered" : null,
  ].filter(Boolean) as string[];

  if (!badges.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-neutral-300 bg-neutral-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide"
        >
          {badge}
        </span>
      ))}
    </div>
  );
}

function soldPriceLabel(product: UniversalInventoryItem) {
  const status: SaleEvidenceStatus =
    product.soldPriceStatus === "verified" || product.soldPriceStatus === "manual"
      ? product.soldPriceStatus
      : "unresolved";

  if (product.soldPrice !== null && product.soldPrice !== undefined && status !== "unresolved") {
    return `Sold for $${Number(product.soldPrice).toFixed(2)}`;
  }

  return "Sold price pending verification";
}

function SoldProductCard({ product }: { product: UniversalInventoryItem }) {
  const storefrontImage =
    preferHighResolutionListingImage(product.imageUrl) || "/placeholder.png";
  const subtitle = product.player || product.league;
  const soldDate = product.soldAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(product.soldAt))
    : null;

  return (
    <article className="overflow-hidden rounded border-2 border-red-700 bg-white">
      <Link
        href={`/product/${product.legacyProductId}`}
        className="block"
        aria-label={`View sold item ${product.title}`}
      >
        <div className="relative aspect-[4/5] bg-neutral-100">
          <Image
            src={storefrontImage}
            alt={product.title}
            fill
            sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            quality={90}
            className="object-contain p-2"
          />
          <SoldOverlay compact />
        </div>
      </Link>

      <div className="p-4">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-red-700">
          {product.storefrontSection} · Recently sold
        </p>
        <h2 className="mt-2 line-clamp-2 min-h-14 text-lg font-black leading-7">
          {product.title}
        </h2>
        {subtitle ? (
          <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>
        ) : null}
        <FeatureBadges product={product} />

        <div className="mt-4 border-t border-neutral-200 pt-3">
          <p className="text-lg font-black text-red-800">
            {soldPriceLabel(product)}
          </p>
          <p className="mt-1 text-xs font-bold text-neutral-600">
            {[soldDate, product.soldSource]
              .filter(Boolean)
              .join(" · ") || "Sale recorded"}
          </p>
        </div>

        <Link
          href={`/product/${product.legacyProductId}`}
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded border border-red-800 px-4 py-2 text-center font-bold text-red-800 hover:bg-red-800 hover:text-white"
        >
          View Sold Item
        </Link>
      </div>
    </article>
  );
}

export default async function Shop({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    sport?: string;
    section?: string;
    feature?: string;
    sort?: StorefrontSort;
  }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const section = (params?.section || params?.sport || "").trim();
  const feature = (params?.feature || "").trim();
  const sort: StorefrontSort = params?.sort || "section";

  let products: UniversalInventoryItem[] = [];
  let soldProducts: UniversalInventoryItem[] = [];
  let sections: string[] = [];
  let error: Error | null = null;

  try {
    const inventoryEngine = createServerInventoryEngine();
    const supabase = createSupabaseServerClient();
    const storeId = getActiveStoreId();
    [products, soldProducts, sections] = await Promise.all([
      inventoryEngine.listAvailable({
        query: q,
        section,
        feature,
        sort,
      }),
      listRecentSoldStorefrontItems({
        supabase,
        storeId,
        query: q,
        section,
        feature,
        sort,
      }),
      inventoryEngine.listAvailableSections(),
    ]);
  } catch (err: any) {
    error = err;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-black">Error loading products</h1>
        <p className="mt-3 break-words text-sm text-red-700">{error.message}</p>
      </main>
    );
  }

  const activeFilters = Boolean(q || section || feature || sort !== "section");
  const sectionOptions = sortStorefrontSections([
    ...SPORT_SECTIONS,
    ...COLLECTIBLE_SECTIONS,
    ...sections,
  ]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ClearCartOnSuccess />

      <section className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-bold uppercase text-neutral-500">
            Live inventory and recent sales
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl md:text-5xl">
            {heading({ section, feature })}
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-600">
            Browse cards by sport, with NBA and WNBA kept separate. Sold items
            remain visible for seven days as market history but cannot be bought,
            offered on, or added to cart.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-bold">
          <p className="rounded bg-white px-4 py-2 text-neutral-700">
            {products.length.toLocaleString()} active
          </p>
          {soldProducts.length ? (
            <p className="rounded bg-red-100 px-4 py-2 text-red-800">
              {soldProducts.length.toLocaleString()} recently sold
            </p>
          ) : null}
        </div>
      </section>

      <section className="mb-8 space-y-5">
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Shop by sport
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Shop by sport">
            <Link
              href="/shop"
              className="rounded-full border-2 border-neutral-950 bg-white px-4 py-2 text-sm font-black hover:bg-yellow-300"
            >
              All Inventory
            </Link>
            {SPORT_SECTIONS.map((name) => (
              <Link
                key={name}
                href={shopHref({ section: name })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Collectible types
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Collectible types">
            {COLLECTIBLE_SECTIONS.map((name) => (
              <Link
                key={name}
                href={shopHref({ section: name })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {name}
              </Link>
            ))}
          </nav>
        </div>

        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            Card features
          </p>
          <nav className="flex flex-wrap gap-2" aria-label="Card features">
            {FEATURE_LINKS.map((item) => (
              <Link
                key={item.key}
                href={shopHref({ feature: item.key })}
                className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${feature === item.key ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <form className="mb-8 grid grid-cols-1 gap-3 rounded border bg-white p-3 sm:p-4 md:grid-cols-6">
        <label htmlFor="shop-search" className="sr-only">
          Search inventory
        </label>
        <input
          id="shop-search"
          type="search"
          name="q"
          placeholder="Player, team, set, item, card number..."
          defaultValue={q}
          className="min-h-12 rounded border px-4 py-3 text-base md:col-span-2"
        />

        <label htmlFor="shop-section" className="sr-only">
          Filter by section
        </label>
        <select
          id="shop-section"
          name="section"
          defaultValue={section}
          className="min-h-12 rounded border px-3 py-3 text-base"
        >
          <option value="">All Sections</option>
          {sectionOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <label htmlFor="shop-feature" className="sr-only">
          Filter by card feature
        </label>
        <select
          id="shop-feature"
          name="feature"
          defaultValue={feature}
          className="min-h-12 rounded border px-3 py-3 text-base"
        >
          <option value="">All Features</option>
          <option value="autograph">Autographs</option>
          <option value="memorabilia">Memorabilia Cards</option>
          <option value="graded">Graded Cards</option>
          <option value="rookie">Rookie Cards</option>
          <option value="numbered">Numbered Cards</option>
        </select>

        <label htmlFor="shop-sort" className="sr-only">
          Sort inventory
        </label>
        <select
          id="shop-sort"
          name="sort"
          defaultValue={sort}
          className="min-h-12 rounded border px-3 py-3 text-base"
        >
          <option value="section">Section, Player, Title</option>
          <option value="newest">Newest First</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
          <option value="title">Title A–Z</option>
        </select>

        <button
          type="submit"
          className="min-h-12 rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800"
        >
          Apply
        </button>
      </form>

      {activeFilters ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-bold">
          <span>Filtered inventory</span>
          <Link
            href="/shop"
            className="underline decoration-yellow-300 decoration-4 underline-offset-4"
          >
            Clear all filters
          </Link>
        </div>
      ) : null}

      {products.length === 0 ? (
        <p className="text-gray-600">No active cards or collectibles found.</p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => {
          const storefrontImage =
            preferHighResolutionListingImage(product.imageUrl) ||
            "/placeholder.png";
          const subtitle = product.player || product.league;

          return (
            <article
              key={product.legacyProductId}
              className="overflow-hidden rounded border bg-white"
            >
              <Link
                href={`/product/${product.legacyProductId}`}
                className="block"
                aria-label={`View ${product.title}`}
              >
                <div className="relative aspect-[4/5] bg-neutral-100">
                  <Image
                    src={storefrontImage}
                    alt={product.title}
                    fill
                    sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    quality={90}
                    className="object-contain p-2"
                  />
                </div>
              </Link>

              <div className="p-4">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-blue-700">
                  {product.storefrontSection}
                </p>
                <h2 className="mt-2 line-clamp-2 min-h-14 text-lg font-black leading-7">
                  {product.title}
                </h2>
                {subtitle ? (
                  <p className="mt-2 text-sm text-neutral-500">{subtitle}</p>
                ) : null}
                <FeatureBadges product={product} />

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-2xl font-black">
                    ${Number(product.price).toFixed(2)}
                  </p>
                  <p className="rounded bg-neutral-100 px-2 py-1 text-xs font-bold text-neutral-600">
                    Qty {product.quantity}
                  </p>
                </div>

                <Link
                  href={`/product/${product.legacyProductId}`}
                  className="mt-4 flex min-h-11 w-full items-center justify-center rounded border border-neutral-950 px-4 py-2 text-center font-bold hover:bg-neutral-950 hover:text-white"
                >
                  View Item
                </Link>
              </div>
            </article>
          );
        })}
      </div>

      {soldProducts.length ? (
        <section className="mt-12 border-t-4 border-red-700 pt-8">
          <div className="mb-6">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">
              Seven-day sale wall
            </p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">
              Recently sold collectibles
            </h2>
            <p className="mt-2 max-w-3xl font-semibold text-neutral-600">
              These items are retained as visible sale history only. They are
              locked from checkout, offers, and cart actions, and move to the
              InstaComp archive after seven days.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {soldProducts.map((product) => (
              <SoldProductCard
                key={`sold-${product.legacyProductId}`}
                product={product}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
