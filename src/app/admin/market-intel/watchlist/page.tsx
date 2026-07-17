import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../lib/admin-handoff";
import { getMarketIntelWatchlist } from "../../../../lib/market-intel-watchlist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    seeded?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black";

export default async function MarketIntelWatchlistPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const rows = await getMarketIntelWatchlist();
  const activeCount = rows.filter((row) => row.active).length;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black">Player Watchlist</h1>
          <p className="mt-2 max-w-3xl font-semibold text-neutral-300">
            Add a player once and every future scanner, comp engine, and alert uses the same rules.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "1" ? <Notice>Player saved.</Notice> : null}
        {query?.seeded === "1" ? <Notice>Current Demidov and WNBA list loaded.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Active Targets" value={String(activeCount)} />
          <Metric label="Paused Targets" value={String(rows.length - activeCount)} />
          <Metric label="Default Rule" value="20% Below" detail="$15 net-profit target" />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">Add Player</h2>
              <form
                method="post"
                action={addAdminHandoff("/api/admin/market-intel/watchlist", handoff)}
                className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <Input name="name" label="Player name" required wide />
                <Input name="sportOrCategory" label="Sport / category" placeholder="Hockey" />
                <Input name="leagueOrBrand" label="League / brand" placeholder="NHL" />
                <Input name="teamOrAffiliation" label="Team / affiliation" />
                <Input name="priority" label="Priority" type="number" defaultValue="50" min="0" max="100" />
                <Input name="minimumDiscountPct" label="Minimum discount %" type="number" defaultValue="20" min="0" step="0.1" />
                <Input name="minimumNetProfit" label="Minimum net profit" type="number" defaultValue="15" min="0" step="0.01" />
                <Input name="notes" label="Notes" wide />
                <div className="flex flex-wrap gap-5 text-sm font-black sm:col-span-2">
                  <Check name="includeRaw" label="Raw" />
                  <Check name="includeGraded" label="Graded" />
                  <Check name="includeLots" label="Lots / wholesale" />
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-black px-5 py-3 font-black text-white sm:col-span-2">
                  Add to Watchlist
                </button>
              </form>
            </section>

            <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-6">
              <h2 className="text-xl font-black">Load Current Research List</h2>
              <p className="mt-2 text-sm font-semibold text-cyan-950">
                Ivan Demidov plus the current Caitlin Clark, Paige Bueckers, Angel Reese,
                and WNBA future-stars list.
              </p>
              <form
                method="post"
                action={addAdminHandoff("/api/admin/market-intel/watchlist/seed", handoff)}
                className="mt-4"
              >
                <button
                  type="submit"
                  className="rounded-md bg-cyan-700 px-4 py-2.5 text-sm font-black text-white">
                  Load Current Watchlist
                </button>
              </form>
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Tracked Players</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                Pause a player without deleting its history.
              </p>
            </div>
            {rows.length === 0 ? (
              <p className="p-6 font-semibold text-neutral-600">No watchlist entries yet.</p>
            ) : (
              <div className="divide-y divide-neutral-200">
                {rows.map((row) => (
                  <article key={row.id} className={row.active ? "p-5" : "bg-neutral-50 p-5 opacity-70"}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black">{row.subject?.name || "Unmatched target"}</h3>
                          <span className={row.active ? "rounded-full bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-800" : "rounded-full bg-neutral-200 px-2 py-1 text-xs font-black"}>
                            {row.active ? "ACTIVE" : "PAUSED"}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">
                          {[row.subject?.sport_or_category, row.subject?.league_or_brand].filter(Boolean).join(" · ") || "Category not set"}
                        </p>
                        <p className="mt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
                          Priority {row.priority} · {row.minimum_discount_pct}% discount · ${row.minimum_estimated_net_profit.toFixed(2)} net
                        </p>
                      </div>
                      <form
                        method="post"
                        action={addAdminHandoff(`/api/admin/market-intel/watchlist/${row.id}/toggle`, handoff)}
                      >
                        <button
                          type="submit"
                          className={row.active ? "rounded-md border border-neutral-300 px-4 py-2 text-sm font-black" : "rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white"}>
                          {row.active ? "Pause" : "Reactivate"}
                        </button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
  wide?: boolean;
}) {
  const { label, wide, ...inputProps } = props;
  return (
    <label className={`text-sm font-black text-neutral-700 ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input {...inputProps} className={`mt-1 ${fieldClass}`} />
    </label>
  );
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input name={name} type="checkbox" defaultChecked /> {label}
    </label>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      {detail ? <p className="mt-1 text-xs font-bold text-neutral-500">{detail}</p> : null}
    </div>
  );
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div className={error ? "rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900" : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"}>
      {children}
    </div>
  );
}
