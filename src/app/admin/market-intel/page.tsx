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

export default async function MarketIntelAdminPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const adminHref = (href: string) => addAdminHandoff(href, handoff);

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
  const exactMarkets = comps.filter((identity) => identity.latestValue).length;
  const verifiedComps = comps.reduce(
    (sum, identity) => sum + Number(identity.verifiedCompCount || 0),
    0,
  );
  const actionable = listings.filter((listing) => listing.score?.actionable);
  const mislisted = listings.filter((listing) => listing.suspected_mislisting);
  const undervalued = listings.filter((listing) =>
    ["steal", "great_buy", "good_buy", "wholesale_opportunity"].includes(
      String(listing.score?.deal_label || ""),
    ),
  );
  const errors = [
    watchResult.status === "rejected" ? watchResult.reason : null,
    compResult.status === "rejected" ? compResult.reason : null,
    dealResult.status === "rejected" ? dealResult.reason : null,
    portfolioResult.status === "rejected" ? portfolioResult.reason : null,
    readinessResult.status === "rejected" ? readinessResult.reason : null,
  ].filter(Boolean);

  return (
    <main className="min-h-screen bg-[#f2efe7] text-neutral-950">
      <header className="overflow-hidden border-b border-neutral-800 bg-[#0b1015] text-white">
        <div className="mx-auto max-w-[1500px] px-6 py-8 md:py-12">
          <Link
            href={adminHref("/admin")}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Main Admin
          </Link>
          <div className="mt-6 grid gap-8 xl:grid-cols-[1.25fr_0.75fr] xl:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-cyan-300">
                TCOS Market Intel™
              </p>
              <h1 className="mt-3 max-w-5xl text-5xl font-black leading-[0.95] md:text-7xl">
                Value every card.
                <span className="block text-amber-300">Hunt every mistake.</span>
              </h1>
              <p className="mt-5 max-w-4xl text-lg font-semibold leading-8 text-neutral-300">
                One data engine powers InstaComp™ and one profit engine searches for underpriced,
                mislabeled, misspelled, and badly categorized cards. Everything else supports those
                two jobs.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href={adminHref("/admin/market-intel/comps")}
                  className="rounded-md bg-cyan-300 px-5 py-3 font-black text-black hover:bg-cyan-200"
                >
                  Open InstaComp™ Data Engine
                </Link>
                <Link
                  href={adminHref("/admin/market-intel/deals")}
                  className="rounded-md bg-amber-300 px-5 py-3 font-black text-black hover:bg-amber-200"
                >
                  Open Profit Hunter
                </Link>
              </div>
            </div>

            <section
              className={`rounded-2xl border p-6 ${
                readiness?.ready
                  ? "border-emerald-400 bg-emerald-950/50"
                  : "border-amber-400 bg-amber-950/40"
              }`}
            >
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-300">
                System status
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {readiness?.ready
                  ? "Data engine running"
                  : `${readiness?.requiredFailures ?? "?"} blocker(s) need attention`}
              </h2>
              <p className="mt-3 font-semibold text-neutral-300">
                Full market mining runs every six hours. The small Hot Watch hunter checks the
                highest-upside targets during the hourly gaps.
              </p>
              <Link
                href={adminHref("/admin/market-intel/readiness")}
                className="mt-5 inline-flex font-black text-cyan-200 hover:underline"
              >
                Open system details →
              </Link>
            </section>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-6 px-6 py-7">
        {errors.length > 0 ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <h2 className="text-xl font-black">Some Market Intel data is unavailable</h2>
            <p className="mt-1 font-semibold">
              Open System + Setup below for the exact missing table, permission, authorization, or
              data source.
            </p>
          </section>
        ) : null}

        {activeTargets.length > 0 ? (
          <section className="flex flex-col gap-4 rounded-xl border border-fuchsia-300 bg-fuchsia-50 p-5 text-fuchsia-950 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em]">Fresh-search reset pending</p>
              <h2 className="mt-1 text-2xl font-black">
                {activeTargets.length} current player search target
                {activeTargets.length === 1 ? "" : "s"} still loaded
              </h2>
              <p className="mt-1 font-semibold">
                Clear the old list before rebuilding a smaller, higher-quality profit search list.
              </p>
            </div>
            <Link
              href={adminHref("/admin/market-intel/fresh-start")}
              className="w-fit rounded-md bg-fuchsia-900 px-5 py-3 font-black text-white"
            >
              Open Fresh Start
            </Link>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric label="Exact Card Markets" value={String(exactMarkets)} href={adminHref("/admin/market-intel/comps")} />
          <Metric label="Verified Sold Comps" value={String(verifiedComps)} href={adminHref("/admin/market-intel/comps")} />
          <Metric label="Money Opportunities" value={String(actionable.length)} href={adminHref("/admin/market-intel/deals")} />
          <Metric label="Suspected Mislistings" value={String(mislisted.length)} href={adminHref("/admin/market-intel/deals#active-listings")} />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <Category
            number="01"
            eyebrow="Primary engine"
            title="Value Engine + InstaComp™"
            description="Build exact-card market truth from verified sold comps, purchase receipts, card identities, and dated value snapshots. This is the data whore that powers pricing everywhere in TCOS."
            tone="cyan"
            primaryLabel="Open Value Engine"
            primaryHref={adminHref("/admin/market-intel/comps")}
            stats={[
              ["Exact identities", String(comps.length)],
              ["Markets valued", String(exactMarkets)],
              ["Verified comps", String(verifiedComps)],
            ]}
            links={[
              ["Watch Center", adminHref("/admin/market-intel/watch-center")],
              ["Exact-card Discovery", adminHref("/admin/market-intel/discovery")],
              ["Track purchased values", adminHref("/admin/market-intel/purchases")],
            ]}
          />

          <Category
            number="02"
            eyebrow="Primary profit engine"
            title="Profit Hunter + Mislist Search"
            description="Search live marketplaces for cards listed too cheap, spelled wrong, labeled badly, missing card details, or buried in lots. Score the opportunity before somebody else finds it."
            tone="amber"
            primaryLabel="Open Profit Hunter"
            primaryHref={adminHref("/admin/market-intel/deals")}
            stats={[
              ["Actionable", String(actionable.length)],
              ["Undervalued", String(undervalued.length)],
              ["Mislisted", String(mislisted.length)],
            ]}
            links={[
              ["Manage tight search targets", adminHref("/admin/market-intel/watchlist")],
              ["eBay scan controls", adminHref("/admin/market-intel/ebay")],
              ["Growth Spec Lab™", adminHref("/admin/market-intel/growth-specs")],
            ]}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Category
            number="03"
            eyebrow="Money trail"
            title="Buys + Performance"
            description="Import real eBay purchases, manually enter card-show or shop buys, choose Hold or Resale, and measure actual profit against current InstaComp™ value."
            tone="lime"
            primaryLabel="Open Purchase Ledger"
            primaryHref={adminHref("/admin/market-intel/purchases")}
            stats={[
              ["Positions", String(portfolio?.positions.length || 0)],
              ["Capital invested", money(portfolio?.totals.invested)],
              ["Gross return", money(portfolio?.totals.combinedGrossReturn)],
            ]}
            links={[
              ["eBay Purchase Inbox", adminHref("/admin/market-intel/purchases/ebay-intake")],
              ["Manual Card Show / Shop Buy", adminHref("/admin/market-intel/purchases/new")],
              ["Portfolio Intelligence", adminHref("/admin/market-intel/portfolio")],
            ]}
          />

          <Category
            number="04"
            eyebrow="Controls and maintenance"
            title="System + Setup"
            description="Keep the data pipeline healthy, review alerts and delivery, reconnect sources, and use the controlled Fresh Start cleanup when the research list or test data needs to be rebuilt."
            tone="neutral"
            primaryLabel="Open System Readiness"
            primaryHref={adminHref("/admin/market-intel/readiness")}
            stats={[
              ["Search targets", String(activeTargets.length)],
              ["Live listings", String(listings.length)],
              ["Status", readiness?.ready ? "READY" : "CHECK"],
            ]}
            links={[
              ["Fresh Start Cleanup", adminHref("/admin/market-intel/fresh-start")],
              ["Ingestion Health", adminHref("/admin/market-intel/ingestion")],
              ["Alerts + Reports", adminHref("/admin/market-intel/reports")],
              ["Email Delivery", adminHref("/admin/market-intel/delivery")],
            ]}
          />
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-md"
    >
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-2 text-xs font-black text-cyan-700">OPEN →</p>
    </Link>
  );
}

function Category({
  number,
  eyebrow,
  title,
  description,
  tone,
  primaryLabel,
  primaryHref,
  stats,
  links,
}: {
  number: string;
  eyebrow: string;
  title: string;
  description: string;
  tone: "cyan" | "amber" | "lime" | "neutral";
  primaryLabel: string;
  primaryHref: string;
  stats: Array<[string, string]>;
  links: Array<[string, string]>;
}) {
  const classes = {
    cyan: {
      shell: "border-cyan-300 bg-gradient-to-br from-cyan-50 to-white",
      number: "text-cyan-700",
      button: "bg-cyan-900 text-white hover:bg-cyan-800",
      link: "text-cyan-900",
    },
    amber: {
      shell: "border-amber-300 bg-gradient-to-br from-amber-50 to-white",
      number: "text-amber-700",
      button: "bg-amber-400 text-black hover:bg-amber-300",
      link: "text-amber-950",
    },
    lime: {
      shell: "border-lime-300 bg-gradient-to-br from-lime-50 to-white",
      number: "text-lime-700",
      button: "bg-lime-800 text-white hover:bg-lime-700",
      link: "text-lime-950",
    },
    neutral: {
      shell: "border-neutral-300 bg-gradient-to-br from-neutral-100 to-white",
      number: "text-neutral-500",
      button: "bg-neutral-900 text-white hover:bg-black",
      link: "text-neutral-900",
    },
  }[tone];

  return (
    <article className={`rounded-2xl border p-6 shadow-sm ${classes.shell}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-600">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-3xl font-black leading-tight md:text-4xl">{title}</h2>
        </div>
        <span className={`text-5xl font-black ${classes.number}`}>{number}</span>
      </div>
      <p className="mt-4 max-w-3xl font-semibold leading-7 text-neutral-700">{description}</p>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/80 bg-white/75 p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
              {label}
            </p>
            <p className="mt-1 text-xl font-black">{value}</p>
          </div>
        ))}
      </div>

      <Link
        href={primaryHref}
        className={`mt-5 inline-flex rounded-md px-5 py-3 font-black ${classes.button}`}
      >
        {primaryLabel}
      </Link>

      <div className="mt-5 border-t border-neutral-300/70 pt-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
          More inside
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
          {links.map(([label, href]) => (
            <Link key={label} href={href} className={`font-black hover:underline ${classes.link}`}>
              {label} →
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}
