import Image from "next/image";
import Link from "next/link";
import { selectRotatingAvailableHomepageItems } from "../lib/homepage-featured-rotation";
import { createServerInventoryEngine } from "../lib/server-inventory-engine";
import { createSupabaseServerClient } from "../lib/supabase-server";
import { getStoreSettings } from "../lib/store-settings";
import type { UniversalInventoryItem } from "../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function sportHref(section: string) {
  return `/shop?section=${encodeURIComponent(section)}`;
}

function CardImage({ card, sizes }: { card: UniversalInventoryItem; sizes: string }) {
  return (
    <Image
      src={card.imageUrl || "/placeholder.png"}
      alt={card.title}
      fill
      unoptimized
      sizes={sizes}
      className="object-contain p-3 transition duration-300 group-hover:scale-[1.03]"
    />
  );
}

export default async function Home() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeSettings = await getStoreSettings(supabase);
  let products: UniversalInventoryItem[] = [];

  try {
    products = await createServerInventoryEngine().listAvailable();
  } catch (error) {
    console.error("Homepage inventory load failed:", error);
  }

  const featured = selectRotatingAvailableHomepageItems(products, {
    count: 8,
  });
  const heroCards = featured.slice(0, 4);
  const sportCounts = Array.from(
    products.reduce((counts, product) => {
      const sport = product.storefrontSection?.trim();
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
    <main className="flex-1 bg-[#f8fafc] text-[#0f172a]">
      <section className="relative overflow-hidden border-b border-slate-800 bg-[#0b1120] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_35%,rgba(34,197,94,0.16),transparent_45%),radial-gradient(circle_at_55%_65%,rgba(250,204,21,0.12),transparent_45%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-6 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:items-center lg:py-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-[#22c55e]">
              <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
              {products.length.toLocaleString()} live cards · ready to ship
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-5xl font-extrabold uppercase leading-[0.94] tracking-tight text-white sm:text-6xl lg:text-7xl">
              Find the card your{" "}
              <span className="text-[#facc15]">collection</span> is missing.
            </h1>
            <p className="mt-5 max-w-2xl text-base font-medium leading-7 text-slate-300 sm:text-lg">
              Search active sports cards and collectibles from {storeSettings.displayName}. Every order ships with careful protection, secure Stripe checkout, and live tracking.
            </p>

            <form action="/shop" method="get" className="mt-7 flex max-w-2xl flex-col gap-2 sm:flex-row sm:gap-0">
              <label htmlFor="home-card-search" className="sr-only">
                Search cards and collectibles
              </label>
              <input
                id="home-card-search"
                name="q"
                type="search"
                placeholder="Search player, team, set, rookie, autograph, card #..."
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-5 py-3.5 text-base font-semibold text-black outline-none placeholder:text-slate-500 focus:border-[#facc15] focus:ring-2 focus:ring-[#facc15]/40 sm:rounded-r-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#facc15] px-7 py-3.5 text-sm font-extrabold uppercase tracking-wider text-[#0f172a] transition hover:bg-[#eab308] sm:rounded-l-none"
              >
                Search Inventory
              </button>
            </form>

            <div className="mt-5 flex flex-wrap gap-2">
              {[
                ["Shop All", "/shop"],
                ["Rookie Cards", "/shop?feature=rookie"],
                ["Autographs", "/shop?feature=autograph"],
                ["Numbered", "/shop?feature=numbered"],
                ["Graded", "/shop?feature=graded"],
              ].map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  className="rounded-full border border-slate-700 bg-[#1e293b] px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-200 transition hover:border-[#facc15] hover:text-[#facc15]"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="relative hidden min-h-[500px] lg:block">
            <div className="absolute inset-8 rounded-full bg-emerald-500/20 blur-3xl" />
            {heroCards.length ? (
              <div className="relative h-[500px]">
                {heroCards.map((card, index) => (
                  <Link
                    key={card.legacyProductId}
                    href={`/product/${card.legacyProductId}`}
                    className={`group absolute block w-[38%] max-w-[220px] rounded-xl border border-slate-700 bg-[#1e293b] p-2.5 shadow-2xl transition duration-300 hover:z-40 hover:-translate-y-3 hover:border-[#facc15] ${heroPositions[index]}`}
                  >
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border border-slate-700 bg-[#0f172a]">
                      <CardImage card={card} sizes="220px" />
                    </div>
                    <div className="px-1 pb-1 pt-3">
                      {card.promotion?.onSale ? (
                        <span className="mb-1 inline-block rounded bg-[#dc2626] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                          ON SALE
                        </span>
                      ) : null}
                      <p className="line-clamp-2 min-h-8 text-xs font-semibold leading-snug text-slate-200">
                        {card.title}
                      </p>
                      <p className="font-display mt-1.5 text-2xl font-extrabold text-[#facc15]">
                        ${Number(card.price).toFixed(2)}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="relative flex min-h-[420px] items-center justify-center rounded-2xl border border-slate-800 bg-[#0f172a] p-8 text-center text-white shadow-2xl">
                <div>
                  <p className="font-display text-4xl font-extrabold uppercase text-[#facc15]">
                    The Card Wall is loading.
                  </p>
                  <p className="mt-3 text-sm font-medium text-slate-300">
                    Open the shop while the live inventory sync finishes.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="border-b border-slate-800 bg-[#0f172a] text-white">
        <div className="mx-auto grid max-w-7xl divide-y divide-slate-800 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          {[
            ["Live Inventory", "eBay and site stock stay connected"],
            ["Secure Checkout", "Protected payment through Stripe"],
            ["Ready to Ship", "Orders enter the shipping queue"],
            ["Tracking Included", "Follow your package after shipment"],
          ].map(([title, body]) => (
            <div key={title} className="px-5 py-4 text-center">
              <p className="font-display text-base font-extrabold uppercase tracking-wider text-[#facc15]">
                {title}
              </p>
              <p className="mt-0.5 text-xs font-medium text-slate-300">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#2563eb]">
              Rotating live inventory
            </p>
            <h2 className="font-display mt-1 text-4xl font-extrabold uppercase tracking-tight text-[#0f172a] sm:text-5xl">
              Just Hit the Wall
            </h2>
          </div>
          <Link
            href="/shop"
            className="rounded-lg bg-[#0f172a] px-5 py-2.5 text-sm font-bold text-[#facc15] transition hover:-translate-y-0.5 hover:bg-[#1e293b]"
          >
            Shop every collectible →
          </Link>
        </div>

        {featured.length ? (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((card) => (
              <article
                key={card.legacyProductId}
                className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition hover:-translate-y-1 hover:border-slate-300 hover:shadow-lg"
              >
                <Link href={`/product/${card.legacyProductId}`} className="block">
                  <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-slate-200 bg-[#f8fafc]">
                    <CardImage
                      card={card}
                      sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                    />
                  </div>
                  <div className="pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#2563eb]">
                        {card.storefrontSection || "Collectible"}
                      </span>
                      {card.promotion?.onSale ? (
                        <span className="rounded bg-[#dc2626] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                          -{card.promotion.discountPercent}% OFF
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 line-clamp-2 min-h-11 text-sm font-bold leading-snug text-[#0f172a]">
                      {card.title}
                    </h3>
                  </div>
                </Link>

                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-2xl font-extrabold text-[#0f172a]">
                      ${Number(card.price).toFixed(2)}
                    </p>
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                      QTY {card.quantity}
                    </span>
                  </div>
                  <Link
                    href={`/product/${card.legacyProductId}`}
                    className="mt-3 block w-full rounded-lg bg-[#0f172a] py-2 text-center text-xs font-bold uppercase tracking-wider text-white transition group-hover:bg-[#facc15] group-hover:text-[#0f172a]"
                  >
                    View Item
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <p className="font-display text-2xl font-extrabold uppercase">
              Inventory is syncing from eBay.
            </p>
            <Link
              href="/shop"
              className="mt-3 inline-block font-bold text-[#2563eb] underline underline-offset-4"
            >
              Open the live shop
            </Link>
          </div>
        )}
      </section>

      {sportCounts.length ? (
        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-6 py-12">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#2563eb]">
                  Browse the wall
                </p>
                <h2 className="font-display mt-1 text-4xl font-extrabold uppercase tracking-tight text-[#0f172a]">
                  Shop by Section
                </h2>
              </div>
              <p className="max-w-xl text-sm font-medium text-slate-600">
                Jump straight into the largest sections of the live inventory.
              </p>
            </div>
            <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sportCounts.map(([sport, count]) => (
                <Link
                  key={sport}
                  href={sportHref(sport)}
                  className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-[#f8fafc] p-5 transition hover:-translate-y-0.5 hover:border-[#0f172a] hover:bg-[#0f172a] hover:text-white"
                >
                  <div>
                    <h3 className="font-display text-2xl font-extrabold uppercase tracking-wide">
                      {sport}
                    </h3>
                    <p className="mt-0.5 text-sm font-medium text-slate-500 group-hover:text-slate-300">
                      {count.toLocaleString()} active items
                    </p>
                  </div>
                  <span className="font-display text-2xl font-extrabold text-[#0f172a] transition group-hover:translate-x-1 group-hover:text-[#facc15]">
                    →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="bg-[#0f172a] text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-6 py-12 md:flex-row md:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#facc15]">
              Built to sell collectibles
            </p>
            <h2 className="font-display mt-1.5 text-3xl font-extrabold uppercase tracking-tight sm:text-4xl">
              Search it. Buy it. We’ll pack it and send the tracking.
            </h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-slate-300 sm:text-base">
              No marketplace maze—just live inventory, secure checkout, and a clear shipping trail.
            </p>
          </div>
          <Link
            href="/shop"
            className="shrink-0 rounded-lg bg-[#facc15] px-7 py-3.5 text-sm font-extrabold uppercase tracking-wider text-[#0f172a] transition hover:-translate-y-0.5 hover:bg-[#eab308]"
          >
            Start Shopping
          </Link>
        </div>
      </section>
    </main>
  );
}
