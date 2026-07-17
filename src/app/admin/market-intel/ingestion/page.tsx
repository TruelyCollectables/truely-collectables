import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { getMarketIntelIngestionHealth } from "../../../../lib/market-intel-health";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    cleaned?: string;
    stale?: string;
    ended?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function money(value: number) {
  return `$${value.toFixed(2)}`;
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

const samplePayload = `{
  "items": [
    {
      "marketplaceSlug": "ebay",
      "collectibleIdentityKey": "sports-card|...exact identity key...",
      "externalListingId": "1234567890",
      "directUrl": "https://www.ebay.com/itm/1234567890",
      "originalTitle": "Exact marketplace title",
      "listingFormat": "fixed_price",
      "askingPrice": 72.00,
      "shippingPrice": 4.99,
      "buyerFee": 0,
      "quantity": 1,
      "identityMatchConfidence": 100,
      "suspectedMislisting": false,
      "metadata": {
        "resale_fee_pct": 13.5,
        "sell_through_pct": 100,
        "expected_outbound_shipping": 5.50,
        "expected_supplies": 0.25
      }
    }
  ]
}`;

export default async function MarketIntelIngestionPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const health = await getMarketIntelIngestionHealth();

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
            Ingestion Health
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            One authenticated gateway for hourly marketplace research, exact-card
            matching, deduplication, price changes, rescoring, and stale-listing cleanup.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.cleaned === "1" ? (
          <Notice>
            Cleanup complete: {query.stale || "0"} marked stale and {query.ended || "0"} expired auctions ended.
          </Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section
          className={
            health.ingestSecretConfigured
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"
              : "rounded-xl border border-rose-200 bg-rose-50 p-5 text-rose-950"
          }
        >
          <h2 className="text-xl font-black">
            {health.ingestSecretConfigured
              ? "Ingestion authentication is configured"
              : "Ingestion secret is missing"}
          </h2>
          <p className="mt-1 text-sm font-semibold">
            {health.ingestSecretConfigured
              ? "The gateway will accept requests authenticated with MARKET_INTEL_INGEST_SECRET or the existing CRON_SECRET."
              : "Add MARKET_INTEL_INGEST_SECRET in Vercel Production before connecting hourly research automation. Never expose the value in browser code."}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Metric label="All Listings" value={String(health.totals.all)} />
          <Metric label="Active" value={String(health.totals.active)} />
          <Metric label="Fresh <2h" value={String(health.totals.fresh)} />
          <Metric label="Stale" value={String(health.totals.stale)} />
          <Metric label="Ended" value={String(health.totals.ended)} />
          <Metric label="Unmatched" value={String(health.totals.unmatched)} />
          <Metric label="Unscored" value={String(health.totals.unscored)} />
          <Metric label="Price Changed" value={String(health.totals.priceChanged)} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                  Marketplace Coverage
                </p>
                <h2 className="mt-1 text-2xl font-black">Feed Status by Source</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  Latest gateway ingest: {time(health.latestIngestAt)}
                </p>
              </div>
              <Link
                href={addAdminHandoff("/admin/market-intel/deals", handoff)}
                className="w-fit rounded-md bg-black px-4 py-2 text-sm font-black text-white"
              >
                Open Shark List
              </Link>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[650px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Marketplace</th>
                    <th className="px-4 py-3">Active</th>
                    <th className="px-4 py-3">Stale</th>
                    <th className="px-4 py-3">Ended</th>
                    <th className="px-4 py-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {health.marketplaceHealth.map((marketplace) => (
                    <tr key={marketplace.id}>
                      <td className="px-4 py-3 font-black">{marketplace.name}</td>
                      <td className="px-4 py-3">{marketplace.activeCount}</td>
                      <td className="px-4 py-3">{marketplace.staleCount}</td>
                      <td className="px-4 py-3">{marketplace.endedCount}</td>
                      <td className="px-4 py-3">{time(marketplace.latestSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black">Stale Cleanup</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
                Any active listing not seen within the selected window becomes STALE.
                Auctions whose end time passed become ENDED.
              </p>
              <form
                method="post"
                action={addAdminHandoff(
                  "/api/admin/market-intel/ingestion/cleanup",
                  handoff,
                )}
                className="mt-5"
              >
                <label className="text-sm font-black">
                  Stale after hours
                  <input
                    name="staleAfterHours"
                    type="number"
                    min="1"
                    defaultValue="26"
                    required
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-black"
                  />
                </label>
                <button
                  type="submit"
                  className="mt-4 w-full rounded-md bg-black px-4 py-3 font-black text-white">
                  Run Cleanup Now
                </button>
              </form>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-xl font-black">Gateway Endpoints</h2>
              <p className="mt-2 break-all font-mono text-xs font-bold text-amber-950">
                POST /api/cron/market-intel/ingest
              </p>
              <p className="mt-2 break-all font-mono text-xs font-bold text-amber-950">
                GET /api/cron/market-intel/cleanup?staleAfterHours=26
              </p>
              <p className="mt-3 text-sm font-semibold leading-6 text-amber-950">
                Authenticate with <code>Authorization: Bearer ...</code> or
                <code> x-market-intel-key</code>. Unknown identities are rejected rather
                than guessed.
              </p>
            </div>
          </section>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Recent Listing Activity</h2>
          </div>
          {health.recentListings.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">
              No listing activity yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Listing</th>
                    <th className="px-5 py-3">Marketplace</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Delivered</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Match</th>
                    <th className="px-5 py-3">Scored</th>
                    <th className="px-5 py-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {health.recentListings.map((listing) => (
                    <tr key={listing.id}>
                      <td className="max-w-md px-5 py-4">
                        <a
                          href={listing.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-black hover:underline"
                        >
                          {listing.original_title}
                        </a>
                      </td>
                      <td className="px-5 py-4">{listing.marketplaceName}</td>
                      <td className="px-5 py-4 font-black uppercase">
                        {listing.listing_status}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(listing.delivered_price)}
                      </td>
                      <td className="px-5 py-4">{listing.quantity}</td>
                      <td className="px-5 py-4">
                        {listing.identity_match_confidence === null
                          ? "—"
                          : `${listing.identity_match_confidence.toFixed(0)}%`}
                      </td>
                      <td className="px-5 py-4">
                        {listing.scored ? "YES" : "NO"}
                      </td>
                      <td className="px-5 py-4">{time(listing.last_seen_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
            Normalized Ingest Example
          </p>
          <h2 className="mt-1 text-2xl font-black">One format for every marketplace</h2>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-700 bg-black p-4 text-xs leading-6 text-neutral-200">
            {samplePayload}
          </pre>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
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
