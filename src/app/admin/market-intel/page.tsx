import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../lib/admin-handoff";
import { getMarketIntelCompOverview } from "../../../lib/market-intel-comps";
import { getMarketIntelDealWorkbench } from "../../../lib/market-intel-deals";
import { getMarketIntelPortfolio } from "../../../lib/market-intel-portfolio";
import { getMarketIntelReadiness } from "../../../lib/market-intel-readiness";
import { getMarketIntelWatchlist } from "../../../lib/market-intel-watchlist";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

export default async function MarketIntelAdminPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];

  const [watchResult, compResult, dealResult, portfolioResult, readinessResult] =
    await Promise.allSettled([
      getMarketIntelWatchlist(),
      getMarketIntelCompOverview(),
      getMarketIntelDealWorkbench(),
      getMarketIntelPortfolio(),
      getMarketIntelReadiness(),
    ]);

  const watchlist = watchResult.status === "fulfilled" ? watchResult.value : [];
  const comps =
    compResult.status === "fulfilled" ? compResult.value.identities : [];
  const listings =
    dealResult.status === "fulfilled" ? dealResult.value.listings : [];
  const portfolio =
    portfolioResult.status === "fulfilled" ? portfolioResult.value : null;
  const readiness =
    readinessResult.status === "fulfilled" ? readinessResult.value : null;

  const activeTargets = watchlist.filter((row) => row.active);
  const actionable = listings.filter((listing) => listing.score?.actionable);
  const errors = [
    watchResult.status === "rejected" ? watchResult.reason : null,
    compResult.status === "rejected" ? compResult.reason : null,
    dealResult.status === "rejected" ? dealResult.reason : null,
    portfolioResult.status === "rejected" ? portfolioResult.reason : null,
    readinessResult.status === "rejected" ? readinessResult.reason : null,
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
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Watch → Identify → Comp → Scan → Score → Alert → Deliver → Buy → Measure.
            Every recommendation and every dollar flows through the same private data engine.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {errors.length > 0 ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-950">
            <h2 className="font-black">Some Market Intel data could not load</h2>
            <p className="mt-1 text-sm font-semibold">
              Open System Readiness for the exact missing table, permission, environment
              variable, or data source.
            </p>
          </section>
        ) : null}

        <section
          className={
            readiness?.ready
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
              : "rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
          }
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em]">
                Beta One Readiness
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {readiness?.ready
                  ? "Core engine operational"
                  : `${readiness?.requiredFailures ?? "?"} required blocker(s)`}
              </h2>
            </div>
            <Link
              href={addAdminHandoff("/admin/market-intel/readiness", handoff)}
              className="w-fit rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
            >
              Open Readiness Audit
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Active Targets" value={String(activeTargets.length)} />
          <Metric label="Exact Markets" value={String(comps.length)} />
          <Metric label="Active Listings" value={String(listings.length)} />
          <Metric label="Actionable Buys" value={String(actionable.length)} />
          <Metric
            label="Capital Invested"
            value={money(portfolio?.totals.invested)}
          />
          <Metric
            label="Combined Gross Return"
            value={money(portfolio?.totals.combinedGrossReturn)}
          />
        </section>

        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
          <Workbench
            eyebrow="Research Targets"
            title="Player Watchlist"
            detail={`${activeTargets.length} active target${
              activeTargets.length === 1 ? "" : "s"
            } with shared deal thresholds.`}
            href={addAdminHandoff("/admin/market-intel/watchlist", handoff)}
            action="Manage Watchlist"
            tone="cyan"
          />
          <Workbench
            eyebrow="Market Truth"
            title="Sold Comp Engine"
            detail="Exact raw, graded, parallel, variation, numbered, autograph, and memorabilia markets."
            href={addAdminHandoff("/admin/market-intel/comps", handoff)}
            action="Open Sold Comps"
            tone="cyan"
          />
          <Workbench
            eyebrow="Live Marketplace Adapter"
            title="eBay Scanner"
            detail="Hourly Browse API scans, deterministic identity matching, dedupe, price changes, and scoring."
            href={addAdminHandoff("/admin/market-intel/ebay", handoff)}
            action="Scan eBay"
            tone="cyan"
          />
          <Workbench
            eyebrow="Deal Engine"
            title="Shark List™"
            detail={`${actionable.length} actionable ${
              actionable.length === 1 ? "opportunity" : "opportunities"
            } ranked by discount, expected GP, confidence, liquidity, and risk.`}
            href={addAdminHandoff("/admin/market-intel/deals", handoff)}
            action="Open Shark List"
            tone="amber"
          />
          <Workbench
            eyebrow="Close the Money Loop"
            title="Buy + Track Desk"
            detail="Verify a live deal, enter the real out-the-door cost, and create the purchase position in one step."
            href={addAdminHandoff("/admin/market-intel/buy", handoff)}
            action="Buy and Track"
            tone="amber"
          />
          <Workbench
            eyebrow="Portfolio"
            title="Portfolio Intelligence"
            detail="Actual realized GP, remaining cost basis, current market value, unrealized spread, and combined return."
            href={addAdminHandoff("/admin/market-intel/portfolio", handoff)}
            action="Open Portfolio"
            tone="amber"
          />
          <Workbench
            eyebrow="Purchase Operations"
            title="Purchase Ledger"
            detail={`${portfolio?.positions.length || 0} tracked purchase position${
              portfolio?.positions.length === 1 ? "" : "s"
            } with unit cost and sale history.`}
            href={addAdminHandoff("/admin/market-intel/purchases", handoff)}
            action="Open Ledger"
            tone="neutral"
          />
          <Workbench
            eyebrow="Data Pipeline"
            title="Ingestion Health"
            detail="Marketplace feed freshness, stale listings, expired auctions, unmatched rows, and price changes."
            href={addAdminHandoff("/admin/market-intel/ingestion", handoff)}
            action="Open Ingestion Health"
            tone="neutral"
          />
          <Workbench
            eyebrow="Operating Reports"
            title="Daily Intelligence + Alerts"
            detail="Duplicate-suppressed alert outbox, direct links, daily Shark List, movers, and portfolio results."
            href={addAdminHandoff("/admin/market-intel/reports", handoff)}
            action="Open Reports + Alerts"
            tone="neutral"
          />
          <Workbench
            eyebrow="Delivery"
            title="Email Delivery Center"
            detail="Send pending qualifying deals and daily intelligence through Resend, with delivery history and duplicate suppression."
            href={addAdminHandoff("/admin/market-intel/delivery", handoff)}
            action="Open Delivery Center"
            tone="cyan"
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
              No active database watchlist yet.
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeTargets.slice(0, 15).map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 p-4"
                >
                  <p className="text-lg font-black">
                    {row.subject?.name || "Unmatched target"}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-neutral-600">
                    {row.subject?.sport_or_category || "Category not set"} · Priority{" "}
                    {row.priority}
                  </p>
                  <p className="mt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
                    {row.minimum_discount_pct}% below market · $
                    {row.minimum_estimated_net_profit.toFixed(2)} minimum net
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
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
      <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-600">
        {eyebrow}
      </p>
      <h2 className="mt-1 text-3xl font-black">{title}</h2>
      <p className="mt-3 font-semibold leading-6 text-neutral-700">{detail}</p>
      <Link
        href={href}
        className="mt-5 inline-block rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
      >
        {action}
      </Link>
    </article>
  );
}
