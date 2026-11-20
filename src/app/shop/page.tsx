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

const SHOP_PAGE_SIZE = 48;

const FEATURE_LINKS = [
  { key: "autograph", label: "Autographs" },
  { key: "memorabilia", label: "Memorabilia Cards" },
  { key: "graded", label: "Graded Cards" },
  { key: "rookie", label: "Rookie Cards" },
  { key: "numbered", label: "Numbered Cards" },
] as const;

function shopHref(params: {
  q?: string;
  section?: string;
  feature?: string;
  sort?: string;
  page?: number;
}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.section) search.set("section", params.section);
  if (params.feature) search.set("feature", params.feature);
  if (params.sort && params.sort !== "section") search.set("sort", params.sort);
  if (params.page && params.page > 1) search.set("page", String(params.page));
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
    product.features.memorabilia ? "Memorabilia" : null,
    product.features.graded ? "Graded" : null,
    product.features.rookie ? "Rookie" : null,
    product.features.numbered ? "Numbered" : null,
  ].filter(Boolean) as string[];

  if (!badges.length) return null;

  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700"
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

  if (product.soldPrice !== null && product.soldPrice !== undefined && status === "verified") {
    return `Sold for $${Number(product.soldPrice).toFixed(2)}`;
  }

  return null;
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
    <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-red-200 bg-white p-3 shadow-sm">
      <div>
        <Link
          href={`/product/${product.legacyProductId}`}
          className="block"
          aria-label={`View sold item ${product.title}`}
        >
          <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-red-100 bg-slate-50">
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

        <div className="pt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#dc2626]">
            {product.storefrontSection} · Recently sold
          </p>
          <h2 className="mt-1.5 line-clamp-2 min-h-11 text-sm font-bold leading-snug text-[#0f172a]">
            {product.title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-xs font-medium text-slate-500">{subtitle}</p>
          ) : null}
          <FeatureBadges product={product} />
        </div>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="font-display text-xl font-extrabold text-[#dc2626]">
          {soldPriceLabel(product)}
        </p>
        <p className="mt-0.5 text-xs font-medium text-slate-500">
          {[soldDate, product.soldSource].filter(Boolean).join(" · ") || "Sale recorded"}
        </p>

        <Link
          href={`/product/${product.legacyProductId}`}
          className="mt-3 flex min-h-10 w-full items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-[#dc2626] transition hover:bg-[#dc2626] hover:text-white"
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
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const section = (params?.section || params?.sport || "").trim();
  const feature = (params?.feature || "").trim();
  const sort: StorefrontSort = params?.sort || "section";
  const requestedPage = Number.parseInt(params?.page || "1", 10);

  let products: UniversalInventoryItem[] = [];
  let soldProducts: UniversalInventoryItem[] = [];
  let sections: string[] = [];
  let catalogUnavailable = false;

  const inventoryEngine = createServerInventoryEngine();
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();

  const [productsResult, soldResult, sectionsResult] = await Promise.allSettled([
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

  if (productsResult.status === "fulfilled") {
    products = productsResult.value;
  } else {
    catalogUnavailable = true;
    console.error("Shop active catalog unavailable:", productsResult.reason);
  }

  if (soldResult.status === "fulfilled") {
    soldProducts = soldResult.value.filter(
      (item) =>
        item.soldPriceStatus === "verified" &&
        item.soldPrice !== null &&
        item.soldPrice !== undefined,
    );
  } else {
    console.warn("Shop recent-sale history unavailable:", soldResult.reason);
  }

  if (sectionsResult.status === "fulfilled") {
    sections = sectionsResult.value;
  } else {
    console.warn("Shop section list unavailable:", sectionsResult.reason);
  }

  const totalProducts = products.length;
  const totalPages = Math.max(1, Math.ceil(totalProducts / SHOP_PAGE_SIZE));
  const currentPage = Math.min(
    Math.max(Number.isFinite(requestedPage) ? requestedPage : 1, 1),
    totalPages,
  );
  const pageStart = (currentPage - 1) * SHOP_PAGE_SIZE;
  const visibleProducts = products.slice(pageStart, pageStart + SHOP_PAGE_SIZE);
  const pageEnd = Math.min(pageStart + visibleProducts.length, totalProducts);
  const pageHref = (page: number) =>
    shopHref({ q, section, feature, sort, page });

  const activeFilters = Boolean(q || section || feature || sort !== "section");
  const sectionOptions = sortStorefrontSections([
    ...SPORT_SECTIONS,
    ...COLLECTIBLE_SECTIONS,
    ...sections,
  ]);

  return (
    <main className="flex-1 bg-[#f8fafc] text-[#0f172a]">
      <ClearCartOnSuccess />

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {catalogUnavailable ? (
          <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Inventory refresh is temporarily delayed. The storefront remains online while the catalog reconnects; checkout always re-validates live availability before payment.
          </div>
        ) : null}

        <section className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#2563eb]">
              Live inventory and recent sales
            </p>
            <h1 className="font-display mt-1 text-4xl font-extrabold uppercase tracking-tight text-[#0f172a] sm:text-5xl">
              {heading({ section, feature })}
            </h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-600">
              Browse cards by sport, with NBA and WNBA kept separate. Sold items remain visible for seven days as market history.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
            <span className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[#0f172a] shadow-xs">
              {totalProducts.toLocaleString()} Active
            </span>
            {soldProducts.length ? (
              <span className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-[#dc2626]">
                {soldProducts.length.toLocaleString()} Recently Sold
              </span>
            ) : null}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start">
          <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:sticky lg:top-24">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="font-display text-lg font-extrabold uppercase tracking-wide text-[#0f172a]">
                Filters
              </h2>
              {activeFilters ? (
                <Link
                  href="/shop"
                  className="text-xs font-bold text-[#2563eb] hover:underline"
                >
                  Reset All
                </Link>
              ) : null}
            </div>

            <div className="mt-4 space-y-4">
              <details open className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                  <span>Shop by Sport</span>
                  <span className="text-slate-400 group-open:rotate-180">▾</span>
                </summary>
                <nav className="mt-2.5 flex flex-col gap-1" aria-label="Shop by sport">
                  <Link
                    href="/shop"
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                      !section && !feature
                        ? "bg-[#0f172a] text-[#facc15]"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    All Inventory
                  </Link>
                  {SPORT_SECTIONS.map((name) => {
                    const isActive = section === name && !feature;
                    return (
                      <Link
                        key={name}
                        href={shopHref({ q, section: name, sort })}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                          isActive
                            ? "bg-[#0f172a] text-[#facc15]"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {name}
                      </Link>
                    );
                  })}
                </nav>
              </details>

              <details open className="group border-t border-slate-100 pt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                  <span>Card Features</span>
                  <span className="text-slate-400 group-open:rotate-180">▾</span>
                </summary>
                <nav className="mt-2.5 flex flex-col gap-1" aria-label="Card features">
                  {FEATURE_LINKS.map((item) => {
                    const isActive = feature === item.key;
                    return (
                      <Link
                        key={item.key}
                        href={shopHref({ q, section, feature: item.key, sort })}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                          isActive
                            ? "bg-[#0f172a] text-[#facc15]"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </details>

              <details className="group border-t border-slate-100 pt-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
                  <span>Collectible Types</span>
                  <span className="text-slate-400 group-open:rotate-180">▾</span>
                </summary>
                <nav className="mt-2.5 flex flex-col gap-1" aria-label="Collectible types">
                  {COLLECTIBLE_SECTIONS.map((name) => {
                    const isActive = section === name && !feature;
                    return (
                      <Link
                        key={name}
                        href={shopHref({ q, section: name, sort })}
                        className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                          isActive
                            ? "bg-[#0f172a] text-[#facc15]"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {name}
                      </Link>
                    );
                  })}
                </nav>
              </details>
            </div>
          </aside>

          <div className="min-w-0">
            <form className="mb-5 grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xs sm:grid-cols-12">
              <label htmlFor="shop-search" className="sr-only">
                Search inventory
              </label>
              <input
                id="shop-search"
                type="search"
                name="q"
                placeholder="Player, team, set, item, card number..."
                defaultValue={q}
                className="min-h-11 rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2 text-sm font-medium text-[#0f172a] outline-none focus:border-[#0f172a] focus:bg-white sm:col-span-5"
              />

              <label htmlFor="shop-section" className="sr-only">
                Filter by section
              </label>
              <select
                id="shop-section"
                name="section"
                defaultValue={section}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#0f172a] sm:col-span-3"
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
              <input type="hidden" name="feature" value={feature} />

              <label htmlFor="shop-sort" className="sr-only">
                Sort inventory
              </label>
              <select
                id="shop-sort"
                name="sort"
                defaultValue={sort}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#0f172a] sm:col-span-2"
              >
                <option value="section">Section, Player</option>
                <option value="newest">Newest First</option>
                <option value="price_low">Price: Low–High</option>
                <option value="price_high">Price: High–Low</option>
                <option value="title">Title A–Z</option>
              </select>

              <button
                type="submit"
                className="min-h-11 rounded-lg bg-[#facc15] px-4 py-2 text-sm font-extrabold uppercase tracking-wider text-[#0f172a] transition hover:bg-[#eab308] sm:col-span-2"
              >
                Apply
              </button>
            </form>

            {activeFilters ? (
              <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-bold">
                <span className="uppercase tracking-wider text-slate-500">Active:</span>
                {q ? (
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-[#0f172a]">
                    Search: {q}
                  </span>
                ) : null}
                {section ? (
                  <span className="rounded-full bg-[#0f172a] px-3 py-1 text-[#facc15]">
                    {section}
                  </span>
                ) : null}
                {feature ? (
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-[#2563eb]">
                    {feature}
                  </span>
                ) : null}
                <Link
                  href="/shop"
                  className="ml-1 text-[#2563eb] underline underline-offset-4"
                >
                  Clear all
                </Link>
              </div>
            ) : null}

            {totalProducts === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="font-display text-2xl font-extrabold uppercase text-[#0f172a]">
                  {catalogUnavailable
                    ? "Inventory is temporarily refreshing."
                    : "No matching cards or collectibles found."}
                </p>
                <Link
                  href="/shop"
                  className="mt-3 inline-block text-sm font-bold text-[#2563eb] underline underline-offset-4"
                >
                  Reset filters
                </Link>
              </div>
            ) : (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                <p>
                  Showing {pageStart + 1}–{pageEnd} of {totalProducts.toLocaleString()}
                </p>
                <p>
                  Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {visibleProducts.map((product) => {
                const storefrontImage =
                  preferHighResolutionListingImage(product.imageUrl) ||
                  "/placeholder.png";
                const subtitle = product.player || product.league;

                return (
                  <article
                    key={product.legacyProductId}
                    className="group flex flex-col justify-between overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-xs transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
                  >
                    <div>
                      <Link
                        href={`/product/${product.legacyProductId}`}
                        className="block"
                        aria-label={`View ${product.title}`}
                      >
                        <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-slate-100 bg-[#f8fafc]">
                          <Image
                            src={storefrontImage}
                            alt={product.title}
                            fill
                            sizes="(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                            quality={90}
                            className="object-contain p-2 transition duration-300 group-hover:scale-[1.03]"
                          />
                        </div>
                      </Link>

                      <div className="pt-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2563eb]">
                            {product.storefrontSection}
                          </span>
                          {product.promotion?.onSale ? (
                            <span className="rounded bg-[#dc2626] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                              -{product.promotion.discountPercent}% OFF
                            </span>
                          ) : null}
                        </div>

                        <h2 className="mt-2 line-clamp-2 min-h-11 text-sm font-bold leading-snug text-[#0f172a]">
                          {product.title}
                        </h2>
                        {subtitle ? (
                          <p className="mt-1 truncate text-xs font-medium text-slate-500">
                            {subtitle}
                          </p>
                        ) : null}
                        <FeatureBadges product={product} />
                      </div>
                    </div>

                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          {product.promotion?.onSale && product.promotion.originalPrice ? (
                            <p className="text-xs font-bold text-slate-400 line-through">
                              ${Number(product.promotion.originalPrice).toFixed(2)}
                            </p>
                          ) : null}
                          <p
                            className={`font-display text-2xl font-extrabold ${
                              product.promotion?.onSale ? "text-[#dc2626]" : "text-[#0f172a]"
                            }`}
                          >
                            ${Number(product.price).toFixed(2)}
                          </p>
                        </div>
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                          QTY {product.quantity}
                        </span>
                      </div>

                      <Link
                        href={`/product/${product.legacyProductId}`}
                        className="mt-3 flex min-h-10 w-full items-center justify-center rounded-lg bg-[#0f172a] px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-white transition group-hover:bg-[#facc15] group-hover:text-[#0f172a]"
                      >
                        View Item
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {totalPages > 1 ? (
              <nav
                className="mt-8 flex flex-wrap items-center justify-center gap-3"
                aria-label="Shop pagination"
              >
                {currentPage > 1 ? (
                  <Link
                    href={pageHref(currentPage - 1)}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-bold text-[#0f172a] transition hover:border-[#0f172a] hover:bg-[#facc15]"
                  >
                    Previous
                  </Link>
                ) : (
                  <span className="min-h-10 rounded-lg border border-slate-200 bg-slate-100 px-5 py-2 text-sm font-bold text-slate-400">
                    Previous
                  </span>
                )}
                <span className="px-2 text-xs font-bold uppercase tracking-wider text-slate-600">
                  Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()}
                </span>
                {currentPage < totalPages ? (
                  <Link
                    href={pageHref(currentPage + 1)}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-bold text-[#0f172a] transition hover:border-[#0f172a] hover:bg-[#facc15]"
                  >
                    Next
                  </Link>
                ) : (
                  <span className="min-h-10 rounded-lg border border-slate-200 bg-slate-100 px-5 py-2 text-sm font-bold text-slate-400">
                    Next
                  </span>
                )}
              </nav>
            ) : null}

            {soldProducts.length ? (
              <section className="mt-12 border-t-2 border-red-200 pt-8">
                <div className="mb-6">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#dc2626]">
                    Seven-day sale wall
                  </p>
                  <h2 className="font-display mt-1 text-3xl font-extrabold uppercase tracking-tight text-[#0f172a]">
                    Recently Sold Collectibles
                  </h2>
                  <p className="mt-1.5 max-w-3xl text-sm font-medium text-slate-600">
                    Retained as visible sale history for seven days. Locked from checkout, offers, and cart actions.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {soldProducts.map((product) => (
                    <SoldProductCard
                      key={`sold-${product.legacyProductId}`}
                      product={product}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
