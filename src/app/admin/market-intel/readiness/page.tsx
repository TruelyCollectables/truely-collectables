import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelReadiness,
  type MarketIntelReadinessStatus,
} from "../../../../lib/market-intel-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function tone(status: MarketIntelReadinessStatus) {
  if (status === "pass") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }
  if (status === "warn") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }
  return "border-rose-200 bg-rose-50 text-rose-950";
}

function label(status: MarketIntelReadinessStatus) {
  return status === "pass" ? "PASS" : status === "warn" ? "WARNING" : "BLOCKED";
}

export default async function MarketIntelReadinessPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const readiness = await getMarketIntelReadiness();

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
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
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            System Readiness
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Live configuration, database coverage, marketplace scanning, scoring,
            purchase tracking, alerts, delivery, and report persistence in one audit.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section
          className={
            readiness.ready
              ? "rounded-xl border border-emerald-300 bg-emerald-100 p-6 text-emerald-950"
              : "rounded-xl border border-rose-300 bg-rose-100 p-6 text-rose-950"
          }
        >
          <p className="text-xs font-black uppercase tracking-[0.18em]">
            Beta One Core Status
          </p>
          <h2 className="mt-1 text-3xl font-black">
            {readiness.ready
              ? "Core engine is operational"
              : `${readiness.requiredFailures} required blocker${
                  readiness.requiredFailures === 1 ? "" : "s"
                } remain`}
          </h2>
          <p className="mt-2 font-semibold">
            {readiness.warnings} warning{readiness.warnings === 1 ? "" : "s"} are
            visible below. Warnings usually mean the system is installed but still needs
            research data or an optional migration.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Watchlist Targets"
            value={String(readiness.counts.tcos_mi_watchlist || 0)}
          />
          <Metric
            label="Exact Identities"
            value={String(
              readiness.counts.tcos_mi_collectible_identities || 0,
            )}
          />
          <Metric
            label="Sold Comps"
            value={String(readiness.counts.tcos_mi_sold_comps || 0)}
          />
          <Metric
            label="Market Values"
            value={String(readiness.counts.tcos_mi_market_values || 0)}
          />
          <Metric
            label="Marketplace Listings"
            value={String(readiness.counts.tcos_mi_listings || 0)}
          />
          <Metric
            label="Deal Scores"
            value={String(readiness.counts.tcos_mi_deal_scores || 0)}
          />
          <Metric
            label="Purchase Lots"
            value={String(readiness.counts.tcos_mi_purchase_lots || 0)}
          />
          <Metric
            label="Persistent Alerts"
            value={String(readiness.counts.tcos_mi_alerts || 0)}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {readiness.checks.map((check) => (
            <article
              key={check.key}
              className={`rounded-xl border p-5 shadow-sm ${tone(check.status)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em]">
                    {label(check.status)}
                  </p>
                  <h2 className="mt-1 text-xl font-black">{check.label}</h2>
                </div>
                {check.count !== undefined && check.count !== null ? (
                  <span className="rounded-full border border-current px-3 py-1 text-sm font-black">
                    {check.count}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm font-semibold leading-6">{check.detail}</p>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
            Beta One Operating Loop
          </p>
          <h2 className="mt-1 text-3xl font-black">
            Watch → Identify → Comp → Scan → Score → Alert → Deliver → Buy → Measure
          </h2>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href={addAdminHandoff("/admin/market-intel/watchlist", handoff)}
              className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black"
            >
              Watchlist
            </Link>
            <Link
              href={addAdminHandoff("/admin/market-intel/comps", handoff)}
              className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black"
            >
              Sold Comps
            </Link>
            <Link
              href={addAdminHandoff("/admin/market-intel/ebay", handoff)}
              className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black"
            >
              eBay Scanner
            </Link>
            <Link
              href={addAdminHandoff("/admin/market-intel/deals", handoff)}
              className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black"
            >
              Shark List™
            </Link>
            <Link
              href={addAdminHandoff("/admin/market-intel/buy", handoff)}
              className="rounded-md bg-lime-300 px-4 py-2.5 text-sm font-black text-black"
            >
              Buy + Track
            </Link>
          </div>
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
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}
