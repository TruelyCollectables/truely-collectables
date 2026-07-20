import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../lib/admin-handoff";
import { getMarketIntelWatchlist } from "../../../../lib/market-intel-watchlist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:border-black";

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
            ← Market Intel
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Profit Hunter setup
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">Profit Search Targets</h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Keep this list small and intentional. Every active target consumes search attention, so
            only add players with a real chance of mislistings, misspellings, undervalued cards, or
            strong resale demand.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "1" ? <Notice>Search target saved.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Active Search Targets" value={String(activeCount)} />
          <Metric label="Paused Targets" value={String(rows.length - activeCount)} />
          <Metric label="Recommended Starting Size" value="3–5" detail="High-upside players only" />
        </section>

        <section className="flex flex-col gap-4 rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-5 text-fuchsia-950 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em]">Clean-slate control</p>
            <h2 className="mt-1 text-2xl font-black">Start the search list over</h2>
            <p className="mt-1 font-semibold">
              Fresh Start clears every active and paused search target while preserving exact-card
              identities, comps, and market history.
            </p>
          </div>
          <Link
            href={addAdminHandoff("/admin/market-intel/fresh-start", handoff)}
            className="w-fit rounded-md bg-fuchsia-900 px-5 py-3 font-black text-white"
          >
            Open Fresh Start
          </Link>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em]">Before adding anyone</p>
              <h2 className="mt-1 text-2xl font-black">A target needs a money reason</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold leading-6">
                <p>✓ Sellers frequently misspell or shorten the player’s name.</p>
                <p>✓ The player has multiple confusing parallels, inserts, or rookie products.</p>
                <p>✓ Demand is strong enough to resell the card after fees and shipping.</p>
                <p>✓ You know the exact card types worth hunting—not every base card.</p>
              </div>
            </section>

            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Add one deliberate target
              </p>
              <h2 className="mt-1 text-2xl font-black">New Profit Search Target</h2>
              <form
                method="post"
                action={addAdminHandoff("/api/admin/market-intel/watchlist", handoff)}
                className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <Input name="name" label="Player name" required wide />
                <Input name="sportOrCategory" label="Sport / category" placeholder="Hockey" />
                <Input name="leagueOrBrand" label="League / brand" placeholder="NHL" />
                <Input name="teamOrAffiliation" label="Team / affiliation" />
                <Input name="priority" label="Search priority (0–100)" type="number" defaultValue="75" min="0" max="100" />
                <Input name="minimumDiscountPct" label="Minimum discount %" type="number" defaultValue="20" min="0" step="0.1" />
                <Input name="minimumNetProfit" label="Minimum expected net profit" type="number" defaultValue="15" min="0" step="0.01" />
                <Input
                  name="notes"
                  label="Why this player is worth hunting"
                  placeholder="Frequent misspellings, confusing parallels, strong resale demand..."
                  required
                  wide
                />
                <div className="flex flex-wrap gap-5 text-sm font-black sm:col-span-2">
                  <Check name="includeRaw" label="Raw cards" />
                  <Check name="includeGraded" label="Graded cards" />
                  <Check name="includeLots" label="Lots / wholesale" />
                </div>
                <AdminSubmitButton
                  className="rounded-md bg-black px-5 py-3 font-black text-white sm:col-span-2"
                  pendingChildren="Adding target..."
                  title="Add this player to the focused Profit Hunter search list used by the marketplace scanners and alerts."
                >
                  Add Profit Search Target
                </AdminSubmitButton>
                <p className="text-xs font-bold text-neutral-600 sm:col-span-2">
                  The target becomes eligible for the six-hour full miner and the smaller hourly Hot
                  Watch shortlist when its priority and exact-card data justify it.
                </p>
              </form>
            </section>
          </div>

          <section id="tracked-players" className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm scroll-mt-6">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Current Search Targets</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                Pause a target without deleting card history. Use Fresh Start when the entire list
                needs to be rebuilt.
              </p>
            </div>
            {rows.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-2xl font-black">The search list is clean.</p>
                <p className="mt-2 font-semibold text-neutral-600">
                  Add only the first player that has a strong mislist and resale case.
                </p>
              </div>
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
                          {[row.subject?.sport_or_category, row.subject?.league_or_brand]
                            .filter(Boolean)
                            .join(" · ") || "Category not set"}
                        </p>
                        <p className="mt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
                          Priority {row.priority} · {row.minimum_discount_pct}% below market · ${row.minimum_estimated_net_profit.toFixed(2)} minimum net
                        </p>
                        {row.notes ? (
                          <p className="mt-3 max-w-2xl text-sm font-semibold text-neutral-700">
                            {row.notes}
                          </p>
                        ) : null}
                      </div>
                      <form
                        method="post"
                        action={addAdminHandoff(`/api/admin/market-intel/watchlist/${row.id}/toggle`, handoff)}
                      >
                        <AdminSubmitButton
                          className={row.active ? "rounded-md border border-neutral-300 px-4 py-2 text-sm font-black" : "rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white"}
                          pendingChildren={row.active ? "Pausing..." : "Reactivating..."}
                          title={
                            row.active
                              ? `Pause ${row.subject?.name || "this target"} in future scans without deleting card history.`
                              : `Return ${row.subject?.name || "this target"} to Profit Hunter scans.`
                          }
                        >
                          {row.active ? "Pause Search" : "Reactivate Search"}
                        </AdminSubmitButton>
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
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={error ? "rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900" : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"}
    >
      {children}
    </div>
  );
}
