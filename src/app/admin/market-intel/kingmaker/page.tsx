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

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

  const listings =
    dealResult.status === "fulfilled" ? dealResult.value.listings : [];
  const portfolio =
    portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
  const ledger = ledgerResult.status === "fulfilled" ? ledgerResult.value : [];
  const readiness =
    readinessResult.status === "fulfilled" ? readinessResult.value : null;

  const actionable = listings
    .filter((listing) => listing.score?.actionable)
    .sort(
      (left, right) =>
        numberValue(right.score?.expected_net_profit) -
          numberValue(left.score?.expected_net_profit) ||
        numberValue(right.score?.net_roi_pct) -
          numberValue(left.score?.net_roi_pct),
    );

  const sellWindows = ledger.filter(
    (row) => row.signal?.key === "sell_window" || row.signal?.key === "take_profit_watch",
  );
  const needsComps = ledger.filter(
    (row) => row.signal?.key === "needs_comps" || row.signal?.key === "low_confidence",
  );
  const cooling = ledger.filter((row) => row.signal?.key === "cooling");
  const dataHealthy = Boolean(readiness?.ready) &&
    dealResult.status === "fulfilled" &&
    portfolioResult.status === "fulfilled" &&
    ledgerResult.status === "fulfilled";

  return (
    <main className="min-h-screen bg-[#05070a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(16,185,129,0.16),transparent_28%),radial-gradient(circle_at_88%_4%,rgba(217,119,6,0.18),transparent_26%),linear-gradient(180deg,#070b10_0%,#05070a_52%,#020304_100%)]" />

      <div className="relative mx-auto max-w-[1680px] px-4 py-5 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/70 shadow-[0_30px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="border-b border-white/10 px-6 py-5 lg:px-9">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={addAdminHandoff("/admin/market-intel", handoff)}
                    className="rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-200 transition hover:bg-white/10"
                  >
                    ← Market Intel
                  </Link>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">
                    Private Owner System
                  </span>
                </div>
                <p className="mt-7 text-xs font-black uppercase tracking-[0.32em] text-amber-300">
                  Project KINGMAKER™
                </p>
                <h1 className="mt-2 max-w-5xl text-4xl font-black tracking-[-0.04em] sm:text-6xl xl:text-7xl">
                  Capital Intelligence Command
                </h1>
                <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
                  One private decision center for card acquisition, portfolio truth,
                  verified market evidence, capital deployment, exits, risk, and the
                  data-mining engine that will later move into TCOS.
                </p>
              </div>

              <div className="grid min-w-full grid-cols-2 gap-2 sm:min-w-[460px] xl:min-w-[520px]">
                <StatusTile
                  label="Decision Engine"
                  value={dataHealthy ? "ONLINE" : "RESTRICTED"}
                  detail={dataHealthy ? "Core sources synchronized" : "One or more truth gates failed"}
                  good={dataHealthy}
                />
                <StatusTile
                  label="Actionable Buys"
                  value={String(actionable.length)}
                  detail="Verified threshold candidates"
                  good={actionable.length > 0}
                />
                <StatusTile
                  label="Sell Signals"
                  value={String(sellWindows.length)}
                  detail="Positions requiring exit review"
                  good={sellWindows.length > 0}
                />
                <StatusTile
                  label="Research Debt"
                  value={String(needsComps.length)}
                  detail="Positions missing defensible market truth"
                  good={needsComps.length === 0}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-y divide-white/10 sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
            <Metric label="Capital Deployed" value={money(portfolio?.totals.invested)} />
            <Metric label="Realized Return" value={money(portfolio?.totals.realizedNetProceeds)} />
            <Metric label="Realized Gross Profit" value={money(portfolio?.totals.realizedGrossProfit)} />
            <Metric label="Remaining Cost Basis" value={money(portfolio?.totals.remainingCostBasis)} />
            <Metric label="Current Market Value" value={money(portfolio?.totals.currentMarketValue)} />
            <Metric label="Combined Gross Return" value={money(portfolio?.totals.combinedGrossReturn)} />
          </div>
        </header>

        {!dataHealthy ? (
          <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5 shadow-xl shadow-black/20">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-300">
              Truth Gate Warning
            </p>
            <h2 className="mt-1 text-2xl font-black">Decision output is restricted</h2>
            <p className="mt-2 max-w-4xl font-semibold text-rose-100/80">
              KINGMAKER will not present incomplete portfolio or market data as reliable
              capital intelligence. Open readiness and repair the failed source before
              treating totals or recommendations as complete.
            </p>
          </section>
        ) : null}

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.45fr_0.55fr]">
          <div className="rounded-[1.75rem] border border-emerald-300/20 bg-gradient-to-b from-emerald-300/[0.08] to-white/[0.025] p-5 shadow-2xl shadow-black/20 lg:p-7">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
                  Act Now
                </p>
                <h2 className="mt-1 text-3xl font-black tracking-tight">Today’s Money Moves</h2>
              </div>
              <Link
                href={addAdminHandoff("/admin/market-intel/deals", handoff)}
                className="w-fit rounded-full bg-emerald-300 px-4 py-2.5 text-sm font-black text-emerald-950 transition hover:bg-emerald-200"
              >
                Open Full Shark List
              </Link>
            </div>

            {actionable.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-6">
                <p className="text-xl font-black">No verified buy is cleared right now.</p>
                <p className="mt-2 font-semibold text-neutral-400">
                  That is a capital-protection decision, not an empty report. Near-misses,
                  price changes, and research gaps stay visible elsewhere in the command center.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {actionable.slice(0, 6).map((listing, index) => (
                  <article
                    key={listing.id}
                    className="rounded-2xl border border-white/10 bg-black/30 p-4 transition hover:border-emerald-300/30 hover:bg-black/40"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-emerald-300 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-950">
                            #{index + 1} Buy Candidate
                          </span>
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-500">
                            {listing.marketplace?.name || "Marketplace"}
                          </span>
                        </div>
                        <h3 className="mt-2 truncate text-xl font-black">
                          {listing.title || "Verified listing"}
                        </h3>
                        <p className="mt-1 text-sm font-semibold text-neutral-400">
                          Delivered {money(listing.score?.delivered_cost)} · Expected net {money(listing.score?.expected_net_profit)} · ROI {percent(listing.score?.net_roi_pct)}
                        </p>
                      </div>
                      {listing.direct_url ? (
                        <a
                          href={listing.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-full border border-emerald-300/35 bg-emerald-300/10 px-4 py-2.5 text-sm font-black text-emerald-200 transition hover:bg-emerald-300 hover:text-emerald-950"
                        >
                          Open Listing ↗
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <CommandCard
              eyebrow="Portfolio Exit Desk"
              title={`${sellWindows.length} sell-window signal${sellWindows.length === 1 ? "" : "s"}`}
              detail="Positions above cost, cooling, or otherwise ready for an owner exit decision."
              href={addAdminHandoff("/admin/market-intel/purchases", handoff)}
              action="Review Positions"
            />
            <CommandCard
              eyebrow="Capital at Risk"
              title={`${cooling.length} cooling position${cooling.length === 1 ? "" : "s"}`}
              detail="Exact-card markets moving down enough to require verification before holding or averaging down."
              href={addAdminHandoff("/admin/market-intel/portfolio", handoff)}
              action="Open Risk View"
            />
            <CommandCard
              eyebrow="Research Queue"
              title={`${needsComps.length} evidence gap${needsComps.length === 1 ? "" : "s"}`}
              detail="Missing or low-confidence sold evidence. These positions remain research-only until the truth gate clears."
              href={addAdminHandoff("/admin/market-intel/comps", handoff)}
              action="Build Market Truth"
            />
          </aside>
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-4">
          <Module
            code="01"
            title="Acquisition Radar"
            detail="Search families, exact-card identities, mislistings, lots, seller sweeps, price drops, ending-soon urgency, and verified acquisition economics."
            href={addAdminHandoff("/admin/market-intel/deals", handoff)}
          />
          <Module
            code="02"
            title="Capital Ledger"
            detail="Canonical purchases, delivered cost, receiving, units remaining, sales, realized returns, unrealized spread, and portfolio aging."
            href={addAdminHandoff("/admin/market-intel/purchases", handoff)}
          />
          <Module
            code="03"
            title="Market Truth Lab"
            detail="Exact completed-sale evidence, identity confidence, liquidity, market movement, break-even prices, and scenario valuation."
            href={addAdminHandoff("/admin/market-intel/comps", handoff)}
          />
          <Module
            code="04"
            title="Operations Control"
            detail="Source freshness, stale records, failed targets, reconciliation, alert delivery, report fingerprints, and audit-grade system health."
            href={addAdminHandoff("/admin/market-intel/readiness", handoff)}
          />
        </section>

        <footer className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4 text-sm font-semibold text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Project KINGMAKER™ is the Truely Collectables private capital-intelligence codename.
          </p>
          <p>Built as a portable decision layer for future TCOS integration.</p>
        </footer>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.025] px-5 py-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-xl font-black tracking-tight text-white">{value}</p>
    </div>
  );
}

function StatusTile({
  label,
  value,
  detail,
  good,
}: {
  label: string;
  value: string;
  detail: string;
  good: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-black ${good ? "text-emerald-300" : "text-amber-300"}`}>
        {value}
      </p>
      <p className="mt-1 text-xs font-semibold text-neutral-500">{detail}</p>
    </div>
  );
}

function CommandCard({
  eyebrow,
  title,
  detail,
  href,
  action,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  href: string;
  action: string;
}) {
  return (
    <article className="rounded-[1.5rem] border border-amber-300/20 bg-gradient-to-br from-amber-300/[0.08] to-white/[0.02] p-5 shadow-xl shadow-black/20">
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
        {eyebrow}
      </p>
      <h3 className="mt-2 text-2xl font-black">{title}</h3>
      <p className="mt-2 text-sm font-semibold leading-6 text-neutral-400">{detail}</p>
      <Link href={href} className="mt-4 inline-flex text-sm font-black text-amber-200 hover:text-amber-100">
        {action} →
      </Link>
    </article>
  );
}

function Module({
  code,
  title,
  detail,
  href,
}: {
  code: string;
  title: string;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5 shadow-xl shadow-black/20 transition hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.055]"
    >
      <p className="text-xs font-black tracking-[0.2em] text-neutral-600">{code}</p>
      <h3 className="mt-4 text-2xl font-black tracking-tight group-hover:text-emerald-300">
        {title}
      </h3>
      <p className="mt-3 text-sm font-semibold leading-6 text-neutral-400">{detail}</p>
      <p className="mt-5 text-sm font-black text-neutral-300">Enter module →</p>
    </Link>
  );
}
