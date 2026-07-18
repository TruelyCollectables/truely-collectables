import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { getMarketIntelCompOverview } from "../../../../lib/market-intel-comps";
import { getMarketIntelDealWorkbench } from "../../../../lib/market-intel-deals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    scanned?: string;
    targets?: string;
    accepted?: string;
    created?: string;
    updated?: string;
    priceChanges?: string;
    errors?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function time(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function label(value: string | null | undefined) {
  return String(value || "unscored").replaceAll("_", " ").toUpperCase();
}

export default async function MarketIntelEbayPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const [compData, dealData] = await Promise.all([
    getMarketIntelCompOverview(),
    getMarketIntelDealWorkbench(),
  ]);

  const ebayListings = dealData.listings.filter(
    (listing) => listing.marketplace?.slug === "ebay",
  );
  const credentialsConfigured = Boolean(
    process.env.EBAY_CLIENT_ID?.trim() &&
      process.env.EBAY_CLIENT_SECRET?.trim(),
  );
  const scanDisabledReason = !credentialsConfigured
    ? "eBay scanner credentials are not configured."
    : compData.identities.length === 0
      ? "Create at least one exact Market Intel identity before scanning eBay."
      : "";
  const latestSeenAt = ebayListings
    .map((listing) => listing.first_seen_at)
    .sort()
    .at(-1);

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
            eBay Active Listing Scanner
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Searches eBay’s active marketplace through the Browse API, scores each
            title against an exact Beta One card identity, ingests accepted matches,
            deduplicates repeat scans, and sends them through the Shark List engine.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.scanned === "1" ? (
          <Notice error={Number(query.errors || 0) > 0}>
            Scanned {query.targets || "0"} exact market
            {query.targets === "1" ? "" : "s"}; accepted {query.accepted || "0"}
            candidates, created {query.created || "0"}, updated {query.updated || "0"},
            and found {query.priceChanges || "0"} price changes. Errors: {query.errors || "0"}.
          </Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section
          className={
            credentialsConfigured
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
              : "rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-950"
          }
        >
          <h2 className="text-xl font-black">
            {credentialsConfigured
              ? "eBay application credentials are configured"
              : "eBay credentials are missing"}
          </h2>
          <p className="mt-1 text-sm font-semibold">
            {credentialsConfigured
              ? "The scanner can request an eBay application token and search active EBAY_US listings."
              : "Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel Production before scanning."}
          </p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Exact Card Markets" value={String(compData.identities.length)} />
          <Metric label="eBay Active Rows" value={String(ebayListings.length)} />
          <Metric
            label="Actionable eBay Deals"
            value={String(
              ebayListings.filter((listing) => listing.score?.actionable).length,
            )}
          />
          <Metric label="Latest eBay Row" value={time(latestSeenAt)} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Run Scanner</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              Scan one exact card for focused testing or leave it blank to scan the
              oldest catalog identities first. Accepted candidates still need at least
              90% identity confidence before GOOD BUY or better labels are allowed.
            </p>

            <form
              method="post"
              action={addAdminHandoff(
                "/api/admin/market-intel/ebay/scan",
                handoff,
              )}
              className="mt-5 space-y-4"
            >
              <label className="block text-sm font-black">
                Exact card identity
                <select
                  name="identityId"
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black"
                >
                  <option value="">Scan catalog batch</option>
                  {compData.identities.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {identity.display_name} — market {money(
                        identity.latestValue?.conservative_value,
                      )}
                    </option>
                  ))}
                </select>
              </label>

              <NumberField
                name="maxTargets"
                label="Maximum identities"
                defaultValue="10"
                min="1"
                max="25"
              />
              <NumberField
                name="resultsPerTarget"
                label="eBay results per identity"
                defaultValue="10"
                min="1"
                max="25"
              />
              <NumberField
                name="minimumConfidence"
                label="Minimum ingest confidence"
                defaultValue="70"
                min="0"
                max="100"
              />

              <AdminSubmitButton
                disabled={Boolean(scanDisabledReason)}
                disabledReason={scanDisabledReason}
                title={
                  scanDisabledReason ||
                  "Scan eBay and score results against exact Market Intel identities."
                }
                className="w-full rounded-md bg-black px-4 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                pendingChildren="Scanning and scoring..."
              >
                Scan eBay and Score Results
              </AdminSubmitButton>
            </form>

            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-950">
              <strong>Confidence guard:</strong> candidates below the ingest threshold
              never enter Beta One. Candidates between 70–89 can be stored for review,
              but the Deal Engine suppresses strong buy labels until identity confidence
              reaches 90% and exact sold-comp evidence is strong enough.
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-neutral-200 p-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Recent eBay Candidates</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  Exact live links, identity match, delivered price, market value, and deal score.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={addAdminHandoff("/admin/market-intel/deals", handoff)}
                  className="rounded-md bg-black px-3 py-2 text-xs font-black text-white"
                >
                  Shark List
                </Link>
                <Link
                  href={addAdminHandoff("/admin/market-intel/ingestion", handoff)}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black"
                >
                  Ingestion Health
                </Link>
              </div>
            </div>

            {ebayListings.length === 0 ? (
              <p className="p-6 font-semibold text-neutral-600">
                No eBay candidates ingested yet.
              </p>
            ) : (
              <div className="divide-y divide-neutral-200">
                {ebayListings.slice(0, 25).map((listing) => (
                  <article key={listing.id} className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-xs font-black">
                            {label(listing.score?.deal_label)}
                          </span>
                          <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-xs font-black text-cyan-900">
                            MATCH {listing.identity_match_confidence?.toFixed(0) || "—"}%
                          </span>
                        </div>
                        <a
                          href={listing.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block text-lg font-black hover:underline"
                        >
                          {listing.original_title}
                        </a>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">
                          {listing.identity?.display_name || "Unmatched identity"}
                        </p>
                        <p className="mt-2 text-xs font-bold text-neutral-500">
                          First seen {time(listing.first_seen_at)} · seller {listing.seller_name || "unknown"}
                        </p>
                      </div>

                      <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
                        <SmallStat label="Delivered" value={money(listing.delivered_price)} />
                        <SmallStat
                          label="Market"
                          value={money(
                            listing.identity?.latest_value?.conservative_value,
                          )}
                        />
                        <SmallStat
                          label="Buy Score"
                          value={listing.score?.buy_score.toFixed(0) || "—"}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
            Hourly Automation Endpoint
          </p>
          <p className="mt-2 break-all font-mono text-xs font-bold text-neutral-200">
            GET /api/cron/market-intel/ebay/scan?maxTargets=10&amp;resultsPerTarget=10&amp;minimumConfidence=70
          </p>
          <p className="mt-3 text-sm font-semibold leading-6 text-neutral-300">
            The route uses the same CRON_SECRET protection as the existing scheduled
            reconciliation jobs. The Vercel cron configuration will call it hourly.
          </p>
        </section>
      </div>
    </main>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
}: {
  name: string;
  label: string;
  defaultValue: string;
  min: string;
  max: string;
}) {
  return (
    <label className="block text-sm font-black">
      {label}
      <input
        name={name}
        type="number"
        defaultValue={defaultValue}
        min={min}
        max={max}
        required
        className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-black"
      />
    </label>
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

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={
        error
          ? "rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900"
          : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"
      }
    >
      {children}
    </div>
  );
}
