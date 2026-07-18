import Link from "next/link";
import { getMarketIntelWatchlist } from "../../../../lib/market-intel-watchlist";
import { seedMarketIntelGrowthProspects } from "../../../../lib/market-intel-prospect-seed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function isGrowthProspect(notes: string | null | undefined) {
  return String(notes || "").includes("[GROWTH_PROSPECT]");
}

export default async function GrowthSpecsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let rows = await getMarketIntelWatchlist();
  let prospects = rows.filter((row) => isGrowthProspect(row.notes));

  if (prospects.length === 0) {
    await seedMarketIntelGrowthProspects();
    rows = await getMarketIntelWatchlist();
    prospects = rows.filter((row) => isGrowthProspect(row.notes));
  }

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
              Growth Prospect Universe
            </p>
            <p className="mt-1 font-black">
              {prospects.length} active prospects across {categories.size} categories · non-base cards only
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/market-intel/growth-specs/prospects"
              className="rounded-md bg-fuchsia-800 px-4 py-2 text-sm font-black text-white"
            >
              View Top 5 Lists
            </Link>
            <form method="post" action="/api/admin/market-intel/growth-specs/seed-prospects">
              <button
                type="submit"
                className="rounded-md border border-fuchsia-300 bg-white px-4 py-2 text-sm font-black"
              >
                Refresh Prospect Lists
              </button>
            </form>
          </div>
        </div>
      </section>
      {children}
    </>
  );
}
