import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../lib/admin-handoff";
import { getMarketIntelPurchaseLedger } from "../../../lib/market-intel";
import { getMarketIntelWatchlist } from "../../../lib/market-intel-watchlist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function MarketIntelAdminPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const [purchaseResult, watchlistResult] = await Promise.allSettled([
    getMarketIntelPurchaseLedger(),
    getMarketIntelWatchlist(),
  ]);

  const purchases = purchaseResult.status === "fulfilled" ? purchaseResult.value : [];
  const watchlist = watchlistResult.status === "fulfilled" ? watchlistResult.value : [];
  const activeTargets = watchlist.filter((row) => row.active);
  const totals = purchases.reduce(
    (sum, row) => {
      sum.invested += Number(row.lot.total_acquisition_cost || 0);
      sum.remaining += Number(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      sum.profit += Number(row.performance?.realized_gross_profit || 0);
      return sum;
    },
    { invested: 0, remaining: 0, profit: 0 },
  );

  const errors = [
    purchaseResult.status === "rejected" ? purchaseResult.reason : null,
    watchlistResult.status === "rejected" ? watchlistResult.reason : null,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Main Admin
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Private Market Intelligence
          </h1>
          <p className="mt-3 max-w-3xl font-semibold text-neutral-300">
            One operating system for what we track, what we buy, what it costs,
            and whether the research produces real gross profit.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {errors.length > 0 ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-950">
            <h2 className="font-black">Some Market Intel data could not load</h2>
            <p className="mt-1 text-sm font-semibold">
              The command center is still available. Check the service-role permissions
              and database tables before using the affected workbench.
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Active Targets" value={String(activeTargets.length)} />
          <Metric label="Purchase Lots" value={String(purchases.length)} />
          <Metric label="Capital Deployed" value={money(totals.invested)} />
          <Metric label="Realized GP" value={money(totals.profit)} />
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Workbench
            eyebrow="Portfolio"
            title="Purchase Ledger"
            detail={`${totals.remaining} units remain across ${purchases.length} tracked purchase lot${purchases.length === 1 ? "" : "s"}.`}
            href={addAdminHandoff("/admin/market-intel/purchases", handoff)}
            action="Open Ledger"
            tone="amber"
          />
          <Workbench
            eyebrow="Research Targets"
            title="Player Watchlist"
            detail={`${activeTargets.length} active player target${activeTargets.length === 1 ? "" : "s"} use shared deal thresholds.`}
            href={addAdminHandoff("/admin/market-intel/watchlist", handoff)}
            action="Manage Watchlist"
            tone="cyan"
          />
          <Workbench
            eyebrow="Next Build Slice"
            title="Sold Comp Engine"
            detail="Verified exact-card sales, market values, confidence, liquidity, and trend history."
            href="#roadmap"
            action="Queued Next"
            tone="neutral"
          />
          <Workbench
            eyebrow="Next Build Slice"
            title="Shark List™"
            detail="Ranked actionable buys, mislistings, wholesale lots, and cross-market arbitrage."
            href="#roadmap"
            action="After Comps"
            tone="neutral"
          />
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Active Research Desk
              </p>
              <h2 className="mt-1 text-3xl font-black">Who we are watching</h2>
            </div>
            <Link
              href={addAdminHandoff("/admin/market-intel/watchlist", handoff)}
              className="w-fit rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
            >
              Add or Pause Players
            </Link>
          </div>

          {activeTargets.length === 0 ? (
            <p className="mt-5 font-semibold text-neutral-600">
              No active database watchlist yet. Load the current Demidov and WNBA list.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeTargets.slice(0, 12).map((row) => (
                <div key={row.id} className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-lg font-black">{row.subject?.name || "Unmatched target"}</p>
                  <p className="mt-1 text-sm font-semibold text-neutral-600">
                    {row.subject?.sport_or_category || "Category not set"} · Priority {row.priority}
                  </p>
                  <p className="mt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
                    {row.minimum_discount_pct}% below market · ${row.minimum_estimated_net_profit.toFixed(2)} net
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section id="roadmap" className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
            Beta One Build Order
          </p>
          <h2 className="mt-1 text-3xl font-black">Foundation first, money engine next</h2>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Purchase tracking is live. Watchlist management is this slice. The next
            workbench is exact-card sold comps and defensible market value, followed by
            deal scoring and the Shark List™.
          </p>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function Workbench({
  eyebrow,
  title,
  detail,
  href,
  action,
  tone,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "amber" | "cyan" | "neutral";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : tone === "cyan"
        ? "border-cyan-200 bg-cyan-50"
        : "border-neutral-200 bg-white";

  return (
    <article className={`rounded-xl border p-6 shadow-sm ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-600">{eyebrow}</p>
      <h2 className="mt-1 text-3xl font-black">{title}</h2>
      <p className="mt-3 font-semibold leading-6 text-neutral-700">{detail}</p>
      <Link href={href} className="mt-5 inline-block rounded-md bg-black px-4 py-2.5 text-sm font-black text-white">
        {action}
      </Link>
    </article>
  );
}
