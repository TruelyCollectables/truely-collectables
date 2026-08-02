import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { getMarketIntelDealWorkbench } from "../../../../lib/market-intel-deals";
import { getMarketIntelPortfolio } from "../../../../lib/market-intel-portfolio";
import { getPurchaseLedgerIntelligence } from "../../../../lib/market-intel-purchase-intelligence";
import { getMarketIntelReadiness } from "../../../../lib/market-intel-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
}

function roi(cost: number | null | undefined, profit: number | null | undefined) {
  const costNumber = Number(cost);
  const profitNumber = Number(profit);
  return Number.isFinite(costNumber) && costNumber > 0 && Number.isFinite(profitNumber)
    ? (profitNumber / costNumber) * 100
    : null;
}

export default async function KingmakerPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const [dealResult, portfolioResult, ledgerResult, readinessResult] =
    await Promise.allSettled([
      getMarketIntelDealWorkbench(),
      getMarketIntelPortfolio(),
      getPurchaseLedgerIntelligence(),
      getMarketIntelReadiness(),
    ]);

  const listings = dealResult.status === "fulfilled" ? dealResult.value.listings : [];
  const portfolio = portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
  const ledger = ledgerResult.status === "fulfilled" ? ledgerResult.value : [];
  const readiness = readinessResult.status === "fulfilled" ? readinessResult.value : null;
  const actionable = listings
    .filter((listing) => listing.score?.actionable)
    .sort(
      (a, b) =>
        Number(b.score?.expected_net_profit || 0) - Number(a.score?.expected_net_profit || 0) ||
        Number(b.score?.buy_score || 0) - Number(a.score?.buy_score || 0),
    );
  const sellSignals = ledger.filter((row) =>
    ["sell_window", "take_profit_watch"].includes(row.signal?.key || ""),
  );
  const researchDebt = ledger.filter((row) =>
    ["needs_comps", "low_confidence"].includes(row.signal?.key || ""),
  );
  const cooling = ledger.filter((row) => row.signal?.key === "cooling");
  const healthy = Boolean(readiness?.ready) &&
    dealResult.status === "fulfilled" &&
    portfolioResult.status === "fulfilled" &&
    ledgerResult.status === "fulfilled";

  return (
    <main className="min-h-screen bg-[#05070a] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_10%_5%,rgba(16,185,129,.16),transparent_28%),radial-gradient(circle_at_90%_5%,rgba(245,158,11,.15),transparent_27%),linear-gradient(180deg,#080c11,#030405)]" />
      <div className="relative mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/70 shadow-2xl backdrop-blur-xl">
          <div className="border-b border-white/10 p-6 lg:p-9">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <Link href={addAdminHandoff("/admin/market-intel", handoff)} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-neutral-300 hover:bg-white/10">
                  ← Market Intel
                </Link>
                <p className="mt-7 text-xs font-black uppercase tracking-[.32em] text-amber-300">Project KINGMAKER™</p>
                <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-6xl xl:text-7xl">Capital Intelligence Command</h1>
                <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
                  Truely Collectables’ private acquisition, portfolio, market-truth, risk, and data-mining command center—designed as the portable decision layer for TCOS.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:min-w-[480px]">
                <Status label="Decision Engine" value={healthy ? "ONLINE" : "RESTRICTED"} good={healthy} />
                <Status label="Actionable Buys" value={String(actionable.length)} good={actionable.length > 0} />
                <Status label="Sell Signals" value={String(sellSignals.length)} good={sellSignals.length > 0} />
                <Status label="Research Debt" value={String(researchDebt.length)} good={researchDebt.length === 0} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y divide-white/10 sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
            <Metric label="Capital Deployed" value={money(portfolio?.totals.invested)} />
            <Metric label="Realized Proceeds" value={money(portfolio?.totals.realizedNetProceeds)} />
            <Metric label="Realized Gross Profit" value={money(portfolio?.totals.realizedGrossProfit)} />
            <Metric label="Remaining Cost Basis" value={money(portfolio?.totals.remainingCostBasis)} />
            <Metric label="Verified Market Value" value={money(portfolio?.totals.estimatedRemainingMarketValue)} />
            <Metric label="Combined Return" value={money(portfolio?.totals.combinedGrossReturn)} />
          </div>
        </header>

        {!healthy ? (
          <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
            <p className="text-xs font-black uppercase tracking-[.2em] text-rose-300">Truth Gate Warning</p>
            <h2 className="mt-1 text-2xl font-black">Incomplete data is being withheld from decision-grade output.</h2>
            <p className="mt-2 font-semibold text-rose-100/75">KINGMAKER fails closed when readiness, listings, portfolio, or the canonical Purchase Ledger cannot be loaded cleanly.</p>
          </section>
        ) : null}

        <section className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_.55fr]">
          <div className="rounded-[1.75rem] border border-emerald-300/20 bg-gradient-to-b from-emerald-300/[.08] to-white/[.025] p-5 lg:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[.22em] text-emerald-300">Act Now</p>
                <h2 className="mt-1 text-3xl font-black">Today’s Money Moves</h2>
              </div>
              <Link href={addAdminHandoff("/admin/market-intel/deals", handoff)} className="w-fit rounded-full bg-emerald-300 px-4 py-2.5 text-sm font-black text-emerald-950 hover:bg-emerald-200">Open Shark List</Link>
            </div>
            {actionable.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-6">
                <p className="text-xl font-black">No verified buy is cleared right now.</p>
                <p className="mt-2 font-semibold text-neutral-400">That is a capital-protection decision. KINGMAKER does not manufacture activity to fill a report.</p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {actionable.slice(0, 6).map((listing, index) => (
                  <article key={listing.id} className="rounded-2xl border border-white/10 bg-black/30 p-4 hover:border-emerald-300/30">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <span className="rounded-full bg-emerald-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-950">#{index + 1} Buy Candidate</span>
                        <h3 className="mt-3 truncate text-xl font-black">{listing.original_title || "Verified listing"}</h3>
                        <p className="mt-1 text-sm font-semibold text-neutral-400">
                          Delivered {money(listing.score?.delivered_cost)} · Expected net {money(listing.score?.expected_net_profit)} · ROI {percent(roi(listing.score?.delivered_cost, listing.score?.expected_net_profit))} · Score {listing.score?.buy_score ?? "—"}
                        </p>
                      </div>
                      {listing.direct_url ? <a href={listing.direct_url} target="_blank" rel="noreferrer" className="shrink-0 rounded-full border border-emerald-300/35 bg-emerald-300/10 px-4 py-2.5 text-sm font-black text-emerald-200 hover:bg-emerald-300 hover:text-emerald-950">Open Listing ↗</a> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <CommandCard eyebrow="Portfolio Exit Desk" title={`${sellSignals.length} sell-window signal${sellSignals.length === 1 ? "" : "s"}`} detail="Positions above cost or cooling enough to require an owner exit review." href={addAdminHandoff("/admin/market-intel/purchases", handoff)} />
            <CommandCard eyebrow="Capital at Risk" title={`${cooling.length} cooling position${cooling.length === 1 ? "" : "s"}`} detail="Verified markets declining enough to block automatic averaging down." href={addAdminHandoff("/admin/market-intel/portfolio", handoff)} />
            <CommandCard eyebrow="Research Queue" title={`${researchDebt.length} evidence gap${researchDebt.length === 1 ? "" : "s"}`} detail="Missing or low-confidence exact sold evidence remains research-only." href={addAdminHandoff("/admin/market-intel/comps", handoff)} />
          </aside>
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
          <Module code="01" title="Acquisition Radar" detail="Search families, seller sweeps, lots, mislistings, price drops, ending-soon urgency, and verified buy economics." href={addAdminHandoff("/admin/market-intel/deals", handoff)} />
          <Module code="02" title="Capital Ledger" detail="Canonical purchases, delivered cost, receiving, units remaining, sales, returns, and portfolio aging." href={addAdminHandoff("/admin/market-intel/purchases", handoff)} />
          <Module code="03" title="Market Truth Lab" detail="Exact completed sales, identity confidence, liquidity, scenario values, break-even points, and market movement." href={addAdminHandoff("/admin/market-intel/comps", handoff)} />
          <Module code="04" title="Operations Control" detail="Freshness, stale records, failed targets, reconciliation, delivery, fingerprints, and audit-grade health." href={addAdminHandoff("/admin/market-intel/readiness", handoff)} />
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-white/[.025] px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[.18em] text-neutral-500">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div>;
}

function Status({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><p className="text-[10px] font-black uppercase tracking-[.16em] text-neutral-500">{label}</p><p className={`mt-1 text-2xl font-black ${good ? "text-emerald-300" : "text-amber-300"}`}>{value}</p></div>;
}

function CommandCard({ eyebrow, title, detail, href }: { eyebrow: string; title: string; detail: string; href: string }) {
  return <article className="rounded-[1.5rem] border border-amber-300/20 bg-gradient-to-br from-amber-300/[.08] to-white/[.02] p-5"><p className="text-[10px] font-black uppercase tracking-[.2em] text-amber-300">{eyebrow}</p><h3 className="mt-2 text-2xl font-black">{title}</h3><p className="mt-2 text-sm font-semibold leading-6 text-neutral-400">{detail}</p><Link href={href} className="mt-4 inline-flex text-sm font-black text-amber-200 hover:text-amber-100">Review →</Link></article>;
}

function Module({ code, title, detail, href }: { code: string; title: string; detail: string; href: string }) {
  return <Link href={href} className="group rounded-[1.5rem] border border-white/10 bg-white/[.035] p-5 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[.055]"><p className="text-xs font-black tracking-[.2em] text-neutral-600">{code}</p><h3 className="mt-4 text-2xl font-black group-hover:text-emerald-300">{title}</h3><p className="mt-3 text-sm font-semibold leading-6 text-neutral-400">{detail}</p><p className="mt-5 text-sm font-black text-neutral-300">Enter module →</p></Link>;
}
