import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import type { StorefrontSort } from "../../lib/storefront-taxonomy";
import type { UniversalInventoryItem } from "../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop Sports Cards",
  description:
    "Shop live sports-card inventory from Truely Collectables by player, sport, league, rookie, autograph, grade, parallel, or card number.",
  alternates: { canonical: "/shop" },
};

const QUICK_SECTIONS = ["Baseball", "WNBA", "Basketball", "Football", "Hockey"];

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
  if (params.feature === "autograph") return "Autographs";
  if (params.feature === "rookie") return "Rookie Cards";
  if (params.feature === "graded") return "Graded Cards";
  if (params.feature === "numbered") return "Numbered Cards";
  return params.section || "Shop Sports Cards";
}

function FeatureBadges({ product }: { product: UniversalInventoryItem }) {
  const badges = [
    product.features.autograph ? "Autograph" : null,
    product.features.rookie ? "Rookie" : null,
    product.features.graded ? "Graded" : null,
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
  let sections: string[] = [];
  let error: Error | null = null;

  try {
    const inventoryEngine = createServerInventoryEngine();
    products = await inventoryEngine.listAvailable({
      query: q,
      section,
      feature,
      sort,
    });
    sections = await inventoryEngine.listAvailableSections();
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
  const quickSections = QUICK_SECTIONS.filter((name) => sections.includes(name));

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ClearCartOnSuccess />

      <section className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-bold uppercase text-neutral-500">Active Inventory</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl md:text-5xl">
            {heading({ section, feature })}
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-600">
            Cards and memorabilia stay in their correct section. Autographs can be
            filtered across sports cards, pucks, balls, jerseys, photos, and more.
          </p>
        </div>
        <p className="rounded bg-white px-4 py-2 text-sm font-bold text-neutral-700">
          {products.length.toLocaleString()} active cards & collectibles
        </p>
      </section>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Popular collectible sections">
        <Link href="/shop" className="rounded-full border-2 border-neutral-950 bg-white px-4 py-2 text-sm font-black hover:bg-yellow-300">
          All Cards & Collectibles
        </Link>
        {quickSections.map((name) => (
          <Link
            key={name}
            href={shopHref({ section: name })}
            className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${section === name && !feature ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
          >
            {name}
          </Link>
        ))}
        <Link
          href={shopHref({ feature: "autograph" })}
          className={`rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black ${feature === "autograph" ? "bg-yellow-300" : "bg-white hover:bg-yellow-300"}`}
        >
          Autographs
        </Link>
      </nav>

      <form className="mb-8 grid grid-cols-1 gap-3 rounded border bg-white p-3 sm:p-4 md:grid-cols-6">
        <input
          type="search"
          name="q"
          placeholder="Player, team, set, item, card number..."
          defaultValue={q}
          className="min-h-12 rounded border px-4 py-3 text-base md:col-span-2"
        />

        <select name="section" defaultValue={section} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="">All Sections</option>
          {sections.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <select name="feature" defaultValue={feature} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="">All Features</option>
          <option value="autograph">Autographs</option>
          <option value="rookie">Rookies</option>
          <option value="graded">Graded</option>
          <option value="numbered">Numbered</option>
        </select>

        <select name="sort" defaultValue={sort} className="min-h-12 rounded border px-3 py-3 text-base">
          <option value="section">Section, Player, Title</option>
          <option value="newest">Newest First</option>
          <option value="price_low">Price: Low to High</option>
          <option value="price_high">Price: High to Low</option>
          <option value="title">Title A–Z</option>
        </select>

        <button type="submit" className="min-h-12 rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800">
          Apply
        </button>
      </form>

      {activeFilters ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-bold">
          <span>Filtered inventory</span>
          <Link href="/shop" className="underline decoration-yellow-300 decoration-4 underline-offset-4">
            Clear all filters
          </Link>
        </div>
      ) : null}

      {products.length === 0 ? <p className="text-gray-600">No cards or collectibles found.</p> : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => {
          const storefrontImage = preferHighResolutionListingImage(product.imageUrl) || "/placeholder.png";

          return (
            <article key={product.legacyProductId} className="overflow-hidden rounded border bg-white">
              <Link href={`/product/${product.legacyProductId}`} className="block" aria-label={`View ${product.title}`}>
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
                <p className="mt-2 text-sm text-neutral-500">
                  {product.player || product.league || product.category?.replaceAll("_", " ") || "Collectible"}
                </p>
                <FeatureBadges product={product} />

                <div className="mt-4 flex items-center justify-between gap-3">
                  <p className="text-2xl font-black">${Number(product.price).toFixed(2)}</p>
                  <p className="rounded bg-neutral-100 px-2 py-1 text-xs font-bold text-neutral-600">
                    Qty {product.quantity}
                  </p>
                </div>

                <Link href={`/product/${product.legacyProductId}`} className="mt-4 flex min-h-11 w-full items-center justify-center rounded border border-neutral-950 px-4 py-2 text-center font-bold hover:bg-neutral-950 hover:text-white">
                  View Item
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
