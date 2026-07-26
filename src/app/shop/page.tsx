import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import type { UniversalInventoryItem } from "../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shop Collectibles",
  description:
    "Shop live inventory from Truely Collectables with current pricing, secure checkout, clear shipping choices, and best offers where available.",
  alternates: { canonical: "/shop" },
  openGraph: {
    title: "Shop Collectibles | Truely Collectables",
    description:
      "Browse current Truely Collectables inventory and check out securely.",
    url: "/shop",
    type: "website",
  },
};

function categoryLabel(value: string | null | undefined) {
  return String(value || "Collectible")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function Shop({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; sport?: string }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const category = (params?.sport || "").trim();
  let products: UniversalInventoryItem[] = [];
  let categories: string[] = [];
  let error: Error | null = null;

  try {
    const inventoryEngine = createServerInventoryEngine();
    products = await inventoryEngine.listAvailable({ query: q, sport: category });
    categories = await inventoryEngine.listAvailableSports();
  } catch (caught: any) {
    error = caught;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-black">Inventory is temporarily unavailable</h1>
        <p className="mt-3 text-sm text-red-700">{error.message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <ClearCartOnSuccess />

      <section className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-bold uppercase text-neutral-500">
            Current Inventory
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl md:text-5xl">
            Shop Collectibles
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-600">
            Current prices and availability are synchronized from our active
            inventory. Best Offer appears only on listings that accept offers.
          </p>
        </div>
        <p className="rounded bg-white px-4 py-2 text-sm font-bold text-neutral-700">
          {products.length} available item{products.length === 1 ? "" : "s"}
        </p>
      </section>

      <form className="mb-8 grid grid-cols-1 gap-3 rounded border bg-white p-3 sm:p-4 md:grid-cols-4">
        <input
          type="text"
          name="q"
          placeholder="Search inventory…"
          defaultValue={q}
          className="min-h-12 rounded border px-4 py-3 text-base md:col-span-2"
        />
        <select
          name="sport"
          defaultValue={category}
          className="min-h-12 rounded border px-4 py-3 text-base"
        >
          <option value="">All Categories</option>
          {categories.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="min-h-12 rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800"
        >
          Search
        </button>
      </form>

      {products.length === 0 ? (
        <p className="rounded border bg-white p-6 text-neutral-600">
          No matching inventory is currently available.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => {
            const imageUrl =
              preferHighResolutionListingImage(product.imageUrl) ||
              "/placeholder.png";
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
                      src={imageUrl}
                      alt={product.title}
                      fill
                      sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      quality={90}
                      className="object-contain p-2"
                    />
                  </div>
                </Link>
                <div className="p-4">
                  <h2 className="line-clamp-2 min-h-14 text-lg font-black leading-7">
                    {product.title}
                  </h2>
                  <p className="mt-2 text-sm text-neutral-500">
                    {categoryLabel(product.sport)}
                    {product.player ? ` · ${product.player}` : ""}
                  </p>
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
      )}
    </main>
  );
}
