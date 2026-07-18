import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import { seedDillonHeadHoardTarget } from "../../../../lib/market-intel-hoard-target-seed";
import { getMarketIntelWatchlist } from "../../../../lib/market-intel-watchlist";
import {
  GROWTH_PROSPECT_COUNT,
  GROWTH_PROSPECT_SEED_VERSION,
  seedMarketIntelGrowthProspects,
} from "../../../../lib/market-intel-prospect-seed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isGrowthProspect(notes: string | null | undefined) {
  return String(notes || "").includes("[GROWTH_PROSPECT]");
}

function isCurrentCoreSeed(notes: string | null | undefined) {
  return String(notes || "").includes(
    `Seed version: ${GROWTH_PROSPECT_SEED_VERSION}`,
  );
}

export default async function GrowthSpecsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let rows = await getMarketIntelWatchlist();
  const coreProspects = rows.filter(
    (row) => row.active && isGrowthProspect(row.notes) && isCurrentCoreSeed(row.notes),
  );

  if (coreProspects.length !== GROWTH_PROSPECT_COUNT) {
    await seedMarketIntelGrowthProspects();
  }

  await seedDillonHeadHoardTarget();
  rows = await getMarketIntelWatchlist();
  const prospects = rows.filter(
    (row) => row.active && isGrowthProspect(row.notes),
  );

  const categories = new Set(
    prospects
      .map((row) => row.subject?.league_or_brand)
      .filter((value): value is string => Boolean(value)),
  );

  return (
    <>
      <section className="border-b border-fuchsia-200 bg-fuchsia-50 px-6 py-4 text-fuchsia-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em]">
              Licensed Pro Value Universe
            </p>
            <p className="mt-1 font-black">
              {prospects.length} active targets across {categories.size} categories ·
              baseball-first · WNBA value · non-base only
            </p>
            <p className="mt-1 text-xs font-bold text-fuchsia-800">
              Dillon Head: 1st Bowman Chrome non-base hoard lane only.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/market-intel/discovery"
              className="rounded-md bg-cyan-900 px-4 py-2 text-sm font-black text-white"
            >
              Discover Exact Cards
            </Link>
            <Link
              href="/admin/market-intel/purchases/ebay-intake"
              className="rounded-md bg-lime-800 px-4 py-2 text-sm font-black text-white"
            >
              Add eBay Purchase
            </Link>
            <Link
              href="/admin/market-intel/growth-specs/prospects"
              className="rounded-md bg-fuchsia-800 px-4 py-2 text-sm font-black text-white"
            >
              View Value Watchlists
            </Link>
            <form method="post" action="/api/admin/market-intel/growth-specs/seed-prospects">
              <AdminSubmitButton
                className="rounded-md border border-fuchsia-300 bg-white px-4 py-2 text-sm font-black"
                pendingChildren="Refreshing lists..."
                title="Refresh the curated Market Intel value watchlists while preserving exact-card research and history."
              >
                Refresh Value Lists
              </AdminSubmitButton>
              <p className="w-full text-xs font-bold text-fuchsia-950">
                Reapplies prospect priorities and card-scope rules; saved exact cards, comps, purchases, and sales stay intact.
              </p>
            </form>
          </div>
        </div>
      </section>
      {children}
    </>
  );
}
