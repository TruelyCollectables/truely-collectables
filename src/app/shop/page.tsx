import Link from "next/link";
import Image from "next/image";
import ClearCartOnSuccess from "../../components/ClearCartOnSuccess";
import { createServerInventoryEngine } from "../../lib/server-inventory-engine";
import type { UniversalInventoryItem } from "../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Shop({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    sport?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const sport = (params?.sport || "").trim();

  let products: UniversalInventoryItem[] = [];
  let uniqueSports: string[] = [];
  let error: Error | null = null;

  try {
    const inventoryEngine = createServerInventoryEngine();
    products = await inventoryEngine.listAvailable({ query: q, sport });
    uniqueSports = await inventoryEngine.listAvailableSports();
  } catch (err: any) {
    error = err;
  }

  if (error) {
    return (
      <main className="p-8">
        <h1>Error loading products</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <ClearCartOnSuccess />

      <section className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-6">
        <div>
          <p className="text-sm font-bold uppercase text-neutral-500">
            Active Inventory
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Shop Sports Cards
          </h1>
          <p className="mt-3 max-w-2xl text-neutral-600">
            Search by player, card, or category. Every product page includes
            collector research links and exact-match signals.
          </p>
        </div>

        <p className="rounded bg-white px-4 py-2 text-sm font-bold text-neutral-700">
          {products.length} active cards
        </p>
      </section>

      <form className="mb-8 grid grid-cols-1 gap-3 rounded border bg-white p-4 md:grid-cols-4">
        <input
          type="text"
          name="q"
          placeholder="Search player, card, sport..."
          defaultValue={q}
          className="rounded border px-4 py-3 md:col-span-2"
        />

        <select
          name="sport"
          defaultValue={sport}
          className="rounded border px-4 py-3"
        >
          <option value="">All Sports</option>

          {uniqueSports.map((sportName) => (
            <option key={sportName} value={sportName}>
              {sportName}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="rounded bg-neutral-950 px-4 py-3 font-bold text-white hover:bg-neutral-800"
        >
          Search
        </button>
      </form>

      {products.length === 0 && <p className="text-gray-600">No cards found.</p>}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {products.map((product) => (
          <article
            key={product.legacyProductId}
            className="overflow-hidden rounded border bg-white"
          >
            <div className="relative aspect-[4/5] bg-neutral-100">
              <Image
                src={product.imageUrl || "/placeholder.png"}
                alt={product.title}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                unoptimized
                className="object-cover"
              />
            </div>

            <div className="p-4">
              <h2 className="line-clamp-2 min-h-14 text-lg font-black leading-7">
                {product.title}
              </h2>

              <p className="mt-2 text-sm text-neutral-500">
                {product.sport || "Collectable"}
                {product.player ? ` - ${product.player}` : ""}
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
                className="mt-4 block w-full rounded border border-neutral-950 px-4 py-2 text-center font-bold hover:bg-neutral-950 hover:text-white"
              >
                View Research Page
              </Link>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
