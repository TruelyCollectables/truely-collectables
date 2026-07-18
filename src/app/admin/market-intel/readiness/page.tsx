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

function checkDestination(key: string) {
  const destinations: Record<string, string> = {
    "supabase-url": "/admin/settings",
    "service-role": "/admin/settings",
    "ebay-credentials": "/admin/market-intel/ebay",
    "cron-secret": "/admin/settings",
    "ingest-secret": "/admin/settings",
    resend: "/admin/market-intel/delivery",
    "core-schema": "/admin/market-intel/readiness#database-checks",
    "alert-schema": "/admin/market-intel/reports",
    "growth-spec-schema": "/admin/market-intel/growth-specs",
    "identity-discovery-schema": "/admin/market-intel/discovery",
    tcos_mi_watchlist: "/admin/market-intel/watchlist",
    tcos_mi_identity_candidates: "/admin/market-intel/discovery",
    tcos_mi_collectible_identities: "/admin/market-intel/comps",
    tcos_mi_sold_comps: "/admin/market-intel/comps",
    tcos_mi_market_values: "/admin/market-intel/comps",
    tcos_mi_listings: "/admin/market-intel/deals#active-listings",
    tcos_mi_deal_scores: "/admin/market-intel/deals#shark-list",
    tcos_mi_growth_specs: "/admin/market-intel/growth-specs",
    tcos_mi_purchase_lots: "/admin/market-intel/purchases",
  };
  return destinations[key] || "/admin/market-intel";
}

export default async function MarketIntelReadinessPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const href = (value: string) => addAdminHandoff(value, handoff);
  const readiness = await getMarketIntelReadiness();

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={href("/admin/market-intel")}
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
          id="core-status"
          className={
            readiness.ready
              ? "scroll-mt-6 rounded-xl border border-emerald-300 bg-emerald-100 p-6 text-emerald-950"
              : "scroll-mt-6 rounded-xl border border-rose-300 bg-rose-100 p-6 text-rose-950"
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
            href={href("/admin/market-intel/watchlist")}
          />
          <Metric
            label="Exact Identities"
            value={String(readiness.counts.tcos_mi_collectible_identities || 0)}
            href={href("/admin/market-intel/comps#card-markets")}
          />
          <Metric
            label="Sold Comps"
            value={String(readiness.counts.tcos_mi_sold_comps || 0)}
            href={href("/admin/market-intel/comps#card-markets")}
          />
          <Metric
            label="Market Values"
            value={String(readiness.counts.tcos_mi_market_values || 0)}
            href={href("/admin/market-intel/comps#card-markets")}
          />
          <Metric
            label="Marketplace Listings"
            value={String(readiness.counts.tcos_mi_listings || 0)}
            href={href("/admin/market-intel/deals#active-listings")}
          />
          <Metric
            label="Deal Scores"
            value={String(readiness.counts.tcos_mi_deal_scores || 0)}
            href={href("/admin/market-intel/deals#shark-list")}
          />
          <Metric
            label="Purchase Lots"
            value={String(readiness.counts.tcos_mi_purchase_lots || 0)}
            href={href("/admin/market-intel/purchases")}
          />
          <Metric
            label="Persistent Alerts"
            value={String(readiness.counts.tcos_mi_alerts || 0)}
            href={href("/admin/market-intel/reports#pending-alerts")}
          />
        </section>

        <section id="database-checks" className="scroll-mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {readiness.checks.map((check) => (
            <Link
              key={check.key}
              href={href(checkDestination(check.key))}
              className={`block rounded-xl border p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-500 ${tone(check.status)}`}
              aria-label={`Open ${check.label}`}
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
              <p className="mt-3 text-xs font-black text-cyan-800">DRILL IN →</p>
            </Link>
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
            <Link href={href("/admin/market-intel/watchlist")} className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black">
              Watchlist
            </Link>
            <Link href={href("/admin/market-intel/comps")} className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black">
              Sold Comps
            </Link>
            <Link href={href("/admin/market-intel/ebay")} className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black">
              eBay Scanner
            </Link>
            <Link href={href("/admin/market-intel/deals")} className="rounded-md border border-neutral-600 px-4 py-2.5 text-sm font-black">
              Shark List™
            </Link>
            <Link href={href("/admin/market-intel/buy")} className="rounded-md bg-lime-300 px-4 py-2.5 text-sm font-black text-black">
              Buy + Track
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-cyan-500"
      aria-label={`Open ${label}`}
    >
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-2 text-xs font-black text-cyan-700">DRILL IN →</p>
    </Link>
  );
}
