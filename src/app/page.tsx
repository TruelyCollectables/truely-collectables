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

function CardImage({ card, sizes }: { card: UniversalInventoryItem; sizes: string }) {
  return (
    <Image
      src={card.imageUrl || "/placeholder.png"}
      alt={card.title}
      fill
      unoptimized
      sizes={sizes}
      className="object-contain p-3 transition duration-300 group-hover:scale-[1.025]"
    />
  );
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
  const heroCards = featured.slice(0, 4);
  const sportCounts = Array.from(
    products.reduce((counts, product) => {
      const sport = product.sport?.trim();
      if (sport) counts.set(sport, (counts.get(sport) || 0) + 1);
      return counts;
    }, new Map<string, number>()),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

  const heroPositions = [
    "left-0 top-24 z-10 -rotate-6",
    "left-[24%] top-3 z-30 -rotate-1",
    "right-[16%] top-16 z-20 rotate-4",
    "right-0 top-32 z-10 rotate-[8deg]",
  ];

  return (
    <main className="flex-1 bg-[#f6f2e8] text-[#111318]">
      <section className="overflow-hidden border-b-2 border-neutral-950 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-16">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-700 sm:text-sm">
              Real cards · live inventory · ready to ship
            </p>
            <h1 className="mt-4 max-w-4xl text-5xl font-black leading-[0.91] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Find the card your collection is missing.
            </h1>
            <p className="mt-6 max-w-2xl text-lg font-semibold leading-8 text-neutral-700">
              Search {products.length.toLocaleString()} active sports cards from {storeSettings.displayName}. Buy securely, get careful packaging, and receive tracking when your order ships.
            </p>

            <form action="/shop" method="get" className="mt-8 flex max-w-2xl flex-col sm:flex-row">
              <label htmlFor="home-card-search" className="sr-only">
                Search sports cards
              </label>
              <input
                id="home-card-search"
                name="q"
                type="search"
                placeholder="Search player, set, team, card number..."
                className="min-w-0 flex-1 border-2 border-neutral-950 bg-white px-5 py-4 text-base font-bold text-neutral-950 outline-none placeholder:font-semibold placeholder:text-neutral-500 focus:ring-4 focus:ring-yellow-300"
              />
              <button
                type="submit"
                className="border-2 border-t-0 border-neutral-950 bg-yellow-300 px-7 py-4 font-black text-neutral-950 transition hover:bg-yellow-200 sm:border-l-0 sm:border-t-2"
              >
                Search Cards
              </button>
            </form>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["Shop All", "/shop"],
                ["Rookie Cards", "/shop?q=rookie"],
                ["Autographs", "/shop?q=autograph"],
                ["Numbered", "/shop?q=%2F"],
                ["Graded", "/shop?q=PSA"],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="border-2 border-neutral-950 bg-white px-4 py-2 text-sm font-black shadow-[2px_2px_0_#111318] transition hover:-translate-y-0.5 hover:bg-yellow-300"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="relative hidden min-h-[500px] lg:block">
            <div className="absolute inset-8 bg-yellow-300/35 blur-3xl" />
            {heroCards.length ? (
              <div className="relative h-[500px]">
                {heroCards.map((card, index) => (
                  <Link
                    key={card.legacyProductId}
                    href={`/product/${card.legacyProductId}`}
                    className={`group absolute block w-[38%] max-w-[220px] border-4 border-neutral-950 bg-white p-2 shadow-[10px_10px_0_rgba(17,19,24,0.16)] transition hover:z-40 hover:-translate-y-3 ${heroPositions[index]}`}
                  >
                    <div className="relative aspect-[3/4] border-2 border-neutral-950 bg-[#efede7]">
                      <CardImage card={card} sizes="220px" />
                    </div>
                    <div className="px-1 pb-1 pt-3">
                      <p className="line-clamp-2 min-h-9 text-xs font-black leading-[1.15]">
                        {card.title}
                      </p>
                      <p className="mt-2 text-xl font-black">${Number(card.price).toFixed(2)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="relative flex min-h-[420px] items-center justify-center border-4 border-neutral-950 bg-neutral-950 p-8 text-center text-white shadow-[10px_10px_0_#ffd633]">
                <div>
                  <p className="text-4xl font-black text-yellow-300">The Card Wall is loading.</p>
                  <p className="mt-3 font-semibold text-neutral-300">Open the shop while the eBay inventory sync finishes.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-b-2 border-neutral-950 bg-yellow-300">
        <div className="mx-auto grid max-w-7xl sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Live Inventory", "eBay and site stock stay connected"],
            ["Secure Checkout", "Protected payment through Stripe"],
            ["Ready to Ship", "Orders enter the shipping queue"],
            ["Tracking Included", "Follow your package after shipment"],
          ].map(([title, body], index) => (
            <div
              key={title}
              className={`p-5 text-center ${index ? "border-t-2 border-neutral-950 sm:border-l-2 sm:border-t-0" : ""} ${index === 2 ? "sm:border-l-0 lg:border-l-2" : ""}`}
            >
              <p className="text-sm font-black uppercase tracking-wide">{title}</p>
              <p className="mt-1 text-xs font-bold leading-5 text-neutral-700">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Fresh inventory</p>
            <h2 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">New cards on the wall</h2>
          </div>
          <Link
            href="/shop"
            className="border-2 border-neutral-950 bg-neutral-950 px-5 py-3 text-sm font-black text-white shadow-[4px_4px_0_#ffd633] transition hover:-translate-y-0.5"
          >
            Shop every card →
          </Link>
        </div>

        {featured.length ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((card) => (
              <article key={card.legacyProductId} className="group border-2 border-neutral-950 bg-white p-2 shadow-[5px_5px_0_rgba(17,19,24,0.12)] transition hover:-translate-y-1 hover:shadow-[7px_7px_0_#ffd633]">
                <Link href={`/product/${card.legacyProductId}`} className="block">
                  <div className="relative aspect-[4/5] border-2 border-neutral-950 bg-[#efede7]">
                    <CardImage card={card} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw" />
                  </div>
                  <div className="p-3">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-blue-700">
                      {card.sport || "Sports Card"}
                    </p>
                    <h3 className="mt-2 line-clamp-2 min-h-12 font-black leading-6">{card.title}</h3>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t-2 border-neutral-950 pt-3">
                      <p className="text-2xl font-black">${Number(card.price).toFixed(2)}</p>
                      <span className="bg-yellow-300 px-2 py-1 text-[11px] font-black">QTY {card.quantity}</span>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-8 border-4 border-dashed border-neutral-950 bg-white p-10 text-center">
            <p className="text-2xl font-black">Inventory is syncing from eBay.</p>
            <Link href="/shop" className="mt-3 inline-block font-black underline decoration-yellow-300 decoration-4 underline-offset-4">Open the live shop</Link>
          </div>
        )}
      </section>

      {sportCounts.length ? (
        <section className="border-y-2 border-neutral-950 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-700">Browse the wall</p>
                <h2 className="mt-2 text-4xl font-black tracking-tight">Shop by sport</h2>
              </div>
              <p className="max-w-xl text-sm font-bold leading-6 text-neutral-600">Jump straight into the largest sections of the live inventory.</p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sportCounts.map(([sport, count]) => (
                <Link
                  key={sport}
                  href={sportHref(sport)}
                  className="group flex items-center justify-between gap-4 border-2 border-neutral-950 bg-[#f6f2e8] p-5 shadow-[4px_4px_0_#111318] transition hover:-translate-y-1 hover:bg-yellow-300"
                >
                  <div>
                    <h3 className="text-2xl font-black">{sport}</h3>
                    <p className="mt-1 text-sm font-bold text-neutral-600">{count.toLocaleString()} active cards</p>
                  </div>
                  <span className="text-3xl font-black transition group-hover:translate-x-1">→</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-neutral-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">Built to sell cards</p>
            <h2 className="mt-2 text-3xl font-black sm:text-4xl">Search it. Buy it. We’ll pack it and send the tracking.</h2>
            <p className="mt-3 max-w-2xl font-semibold leading-7 text-neutral-300">No marketplace maze—just live inventory, secure checkout, and a clear shipping trail.</p>
          </div>
          <Link href="/shop" className="shrink-0 border-2 border-white bg-yellow-300 px-7 py-4 font-black text-neutral-950 shadow-[5px_5px_0_#ffffff] transition hover:-translate-y-1">
            Start shopping
          </Link>
        </div>
      </section>
    </main>
  );
}
