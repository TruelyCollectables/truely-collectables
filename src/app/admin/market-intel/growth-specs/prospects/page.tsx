import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
import { getMarketIntelWatchlist } from "../../../../../lib/market-intel-watchlist";
import { GROWTH_PROSPECT_SEED_VERSION } from "../../../../../lib/market-intel-prospect-seed";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noteValue(notes: string | null | undefined, key: string) {
  const prefix = `${key}: `;
  return (
    String(notes || "")
      .split("\n")
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length) || null
  );
}

function isCurrentGrowthProspect(notes: string | null | undefined) {
  const value = String(notes || "");
  return (
    value.includes("[GROWTH_PROSPECT]") &&
    value.includes(`Seed version: ${GROWTH_PROSPECT_SEED_VERSION}`)
  );
}

const categoryOrder = ["MLB Value Risers", "Miami Marlins", "WNBA Value"];

export default async function GrowthProspectUniversePage() {
  const rows = (await getMarketIntelWatchlist()).filter(
    (row) => row.active && isCurrentGrowthProspect(row.notes),
  );

  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const category = row.subject?.league_or_brand || "Other";
    grouped.set(category, [...(grouped.get(category) || []), row]);
  }

  const groups = Array.from(grouped.entries()).sort(
    ([left], [right]) =>
      categoryOrder.indexOf(left) - categoryOrder.indexOf(right),
  );

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,0.12),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(217,70,239,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href="/admin/market-intel/growth-specs"
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
          >
            ← Growth Spec Lab™
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-fuchsia-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Licensed Pro Value Watchlists
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            A baseball-first research universe built around less-hyped MLB risers,
            Miami Marlins position-player prospects, and productive WNBA players whose
            licensed professional cards may still offer value.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 text-rose-950 shadow-sm ring-1 ring-rose-950/5">
          <h2 className="text-2xl font-black">
            Licensed professional non-base cards only
          </h2>
          <p className="mt-2 font-semibold leading-6">
            The Growth Spec engine rejects base cards, college and NCAA cards, NIL,
            high-school or amateur issues, pre-pro cards, Team USA pre-pro products,
            Leaf, Wild Card, Onyx, Sage, Press Pass, custom cards, and other logo-less
            or unlicensed products. Baseball must be licensed Topps/Bowman/Fanatics;
            WNBA cards must be licensed WNBA products.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Active targets" value={String(rows.length)} />
          <Metric label="Value categories" value={String(groups.length)} />
          <Metric label="NBA" value="Removed" />
          <Metric label="College / unlicensed" value="Blocked" />
        </section>

        <form
          method="post"
          action="/api/admin/market-intel/growth-specs/seed-prospects"
          className="rounded-3xl border border-fuchsia-200 bg-fuchsia-50 p-5 shadow-sm ring-1 ring-fuchsia-950/5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black">Refresh the value universe</h2>
              <p className="mt-1 text-sm font-semibold text-fuchsia-950">
                Re-applies the latest priorities, affiliations, card-scope rules, and
                catalyst theses while preserving exact cards, comps, listings,
                purchases, and sales history.
              </p>
            </div>
            <AdminSubmitButton
              className="rounded-full bg-fuchsia-800 px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-fuchsia-700"
              pendingChildren="Refreshing lists..."
              title="Refresh the curated value universe while preserving existing exact cards, comps, listings, purchases, and sales history."
            >
              Refresh Value Lists
            </AdminSubmitButton>
            <p className="text-xs font-bold text-fuchsia-950 sm:text-right">
              Reapplies current prospect priorities and card-scope rules without deleting saved research history.
            </p>
          </div>
        </form>

        {groups.map(([category, prospects]) => (
          <section
            key={category}
            className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]"
          >
            <div className="border-b border-neutral-200 p-5">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-fuchsia-700">
                Five value-focused watch targets
              </p>
              <h2 className="mt-1 text-3xl font-black">{category}</h2>
            </div>
            <div className="divide-y divide-neutral-200">
              {prospects
                .sort((left, right) => right.priority - left.priority)
                .map((row, index) => {
                  const catalyst = noteValue(row.notes, "Catalyst");
                  const source = noteValue(row.notes, "Source");
                  const sourceUrl = noteValue(row.notes, "Source URL");
                  const sourceAsOf = noteValue(row.notes, "Source as of");
                  const cardScope = noteValue(row.notes, "Card scope");
                  return (
                    <article key={row.id} className="p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 font-black text-fuchsia-900">
                            {index + 1}
                          </div>
                          <div>
                            <h3 className="text-xl font-black">
                              {row.subject?.name || "Unmatched prospect"}
                            </h3>
                            <p className="mt-1 text-sm font-semibold text-neutral-600">
                              {row.subject?.team_or_affiliation || "Affiliation pending"}
                            </p>
                            <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-neutral-700">
                              {catalyst || "Catalyst thesis pending."}
                            </p>
                            <p className="mt-2 text-xs font-black uppercase tracking-wide text-emerald-700">
                              {cardScope || "Licensed professional cards only."}
                            </p>
                            <p className="mt-2 text-xs font-bold text-neutral-500">
                              Source as of {sourceAsOf || "not recorded"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <span className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs font-black">
                            Priority {row.priority}
                          </span>
                          {sourceUrl ? (
                            <a
                              href={sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-fuchsia-300 bg-white px-3 py-2 text-xs font-black text-fuchsia-900 shadow-sm transition hover:bg-fuchsia-50"
                            >
                              {source || "Official source"}
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-4 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
