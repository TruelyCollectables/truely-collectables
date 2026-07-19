import Image from "next/image";
import Link from "next/link";
import { createServerInventoryEngine } from "../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../lib/supabase-server";
import { getStoreSettings } from "../lib/store-settings";
import type { UniversalInventoryItem } from "../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function sportHref(sport: string) {
  return `/shop?sport=${encodeURIComponent(sport)}`;
}

export default async function Home() {
  const supabase = createSupabaseServerClient();
  const storeSettings = await getStoreSettings(supabase);
  let products: UniversalInventoryItem[] = [];

  try {
    products = await createServerInventoryEngine().listAvailable();
  } catch (error) {
    console.error("Homepage inventory load failed:", error);
  }

  const featured = products.slice(0, 8);
  const heroCards = featured.slice(0, 3);
  const sportCounts = Array.from(
    products.reduce((counts, product) => {
      const sport = product.sport?.trim();
      if (sport) counts.set(sport, (counts.get(sport) || 0) + 1);
      return counts;
    }, new Map<string, number>()),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

  return (
    <main className="flex-1">
      <section className="overflow-hidden border-b border-neutral-800 bg-neutral-950 text-white">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-20">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.22em] text-yellow-300">
              Sports cards. Real inventory. Ready to ship.
            </p>
            <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              Find the card your collection is missing.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-neutral-300">
              Shop {products.length.toLocaleString()} active cards from {storeSettings.displayName}.
              Search by player, set, team, sport, parallel, rookie, autograph, or card number.
            </p>

            <form action="/shop" method="get" className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
              <label htmlFor="home-card-search" className="sr-only">
                Search sports cards
              </label>
              <input
                id="home-card-search"
                name="q"
                type="search"
                placeholder="Search player, set, team, card number..."
                className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-white px-5 py-4 text-base font-medium text-neutral-950 outline-none ring-yellow-300 placeholder:text-neutral-500 focus:ring-4"
              />
              <button
                type="submit"
                className="rounded-md bg-yellow-300 px-7 py-4 font-black text-neutral-950 transition hover:bg-yellow-200"
              >
                Search Cards
              </button>
            </form>

            <div className="mt-6 flex flex-wrap gap-3 text-sm font-bold">
              <Link href="/shop" className="rounded-full border border-neutral-700 px-4 py-2 hover:border-yellow-300 hover:text-yellow-300">
                Shop All Cards
              </Link>
              <Link href="/shop?q=rookie" className="rounded-full border border-neutral-700 px-4 py-2 hover:border-yellow-300 hover:text-yellow-300">
                Rookie Cards
              </Link>
              <Link href="/shop?q=autograph" className="rounded-full border border-neutral-700 px-4 py-2 hover:border-yellow-300 hover:text-yellow-300">
                Autographs
              </Link>
              <Link href="/shop?q=PSA" className="rounded-full border border-neutral-700 px-4 py-2 hover:border-yellow-300 hover:text-yellow-300">
                Graded Cards
              </Link>
            </div>
          </div>

          <div className="relative min-h-[390px]">
            <div className="absolute inset-6 rounded-[2rem] bg-yellow-300/20 blur-3xl" />
            {heroCards.length > 0 ? (
              <div className="relative mx-auto flex max-w-[560px] items-center justify-center pt-6">
                {heroCards.map((card, index) => (
                  <Link
                    key={card.legacyProductId}
                    href={`/product/${card.legacyProductId}`}
                    className={`relative block w-[42%] overflow-hidden rounded-xl border-4 border-white bg-white shadow-2xl transition hover:z-20 hover:-translate-y-3 ${
                      index === 0
                        ? "z-10 -mr-10 -rotate-6"
                        : index === 1
                          ? "z-20"
                          : "z-10 -ml-10 rotate-6"
                    }`}
                  >
                    <div className="relative aspect-[3/4] bg-neutral-100">
                      <Image
                        src={card.imageUrl || "/placeholder.png"}
                        alt={card.title}
                        fill
                        unoptimized
                        sizes="220px"
                        className="object-cover"
                      />
                    </div>
                    <div className="border-t border-neutral-200 p-3 text-neutral-950">
                      <p className="line-clamp-2 text-xs font-black leading-4">{card.title}</p>
                      <p className="mt-2 text-lg font-black">${Number(card.price).toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="relative flex min-h-[390px] items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-900 p-8 text-center">
                <div>
                  <p className="text-4xl font-black text-yellow-300">New cards loading</p>
                  <p className="mt-3 text-neutral-300">Browse the live shop while inventory sync finishes.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-b border-neutral-200 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-neutral-200 px-6 sm:grid-cols-4 sm:divide-y-0">
          {[
            ["Live Inventory", "Listings update as cards sell"],
            ["Secure Checkout", "Protected payment through Stripe"],
            ["Careful Shipping", "Cards packed for safe delivery"],
            ["Best Offers", "Make an offer on eligible cards"],
          ].map(([title, body]) => (
            <div key={title} className="px-4 py-6 text-center first:pl-0 last:pr-0">
              <p className="font-black text-neutral-950">{title}</p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {sportCounts.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-neutral-500">Browse the shop</p>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">Shop by sport</h2>
            </div>
            <Link href="/shop" className="font-black underline decoration-yellow-300 decoration-4 underline-offset-4">
              View all inventory
            </Link>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sportCounts.map(([sport, count]) => (
              <Link
                key={sport}
                href={sportHref(sport)}
                className="group rounded-xl border border-neutral-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-neutral-950 hover:shadow-lg"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-black">{sport}</h3>
                    <p className="mt-1 text-sm text-neutral-500">{count.toLocaleString()} active cards</p>
                  </div>
                  <span className="text-3xl font-black transition group-hover:translate-x-1">→</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="border-y border-neutral-200 bg-[#ebe7de]">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.18em] text-neutral-500">Fresh inventory</p>
              <h2 className="mt-2 text-3xl font-black sm:text-4xl">Recently added cards</h2>
            </div>
            <Link href="/shop" className="rounded-md bg-neutral-950 px-5 py-3 font-black text-white hover:bg-neutral-800">
              Shop Every Card
            </Link>
          </div>

          {featured.length > 0 ? (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featured.map((card) => (
                <article key={card.legacyProductId} className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                  <Link href={`/product/${card.legacyProductId}`} className="block">
                    <div className="relative aspect-[4/5] bg-neutral-100">
                      <Image
                        src={card.imageUrl || "/placeholder.png"}
                        alt={card.title}
                        fill
                        unoptimized
                        sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                        className="object-cover transition duration-300 hover:scale-[1.03]"
                      />
                    </div>
                    <div className="p-4">
                      <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
                        {card.sport || "Sports Card"}
                      </p>
                      <h3 className="mt-2 line-clamp-2 min-h-12 font-black leading-6">{card.title}</h3>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <p className="text-2xl font-black">${Number(card.price).toFixed(2)}</p>
                        <span className="rounded-full bg-yellow-300 px-3 py-1 text-xs font-black">View Card</span>
                      </div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-dashed border-neutral-400 bg-white p-10 text-center">
              <p className="text-lg font-black">Inventory is syncing now.</p>
              <Link href="/shop" className="mt-3 inline-block font-bold underline">Open the live shop</Link>
            </div>
          )}
        </div>
      </section>

      <section className="bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-yellow-300">Built for collectors</p>
            <h2 className="mt-2 text-3xl font-black">Your next card is already in the shop.</h2>
            <p className="mt-3 max-w-2xl text-neutral-300">Search the live inventory, review the exact listing, and check out securely.</p>
          </div>
          <Link href="/shop" className="shrink-0 rounded-md bg-yellow-300 px-7 py-4 font-black text-neutral-950 hover:bg-yellow-200">
            Start Shopping
          </Link>
        </div>
      </section>
    </main>
  );
}
