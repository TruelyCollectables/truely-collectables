import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelDealWorkbench,
  type MarketIntelDealListing,
} from "../../../../lib/market-intel-deals";
import DealListingActions from "./DealListingActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    ended?: string;
    rescored?: string;
    scoreErrors?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 shadow-inner shadow-neutral-100 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10";

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function percentage(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function dealLabel(value: string | null | undefined) {
  if (!value) return "UNSCORED";
  return value.replaceAll("_", " ").toUpperCase();
}

function labelTone(value: string | null | undefined) {
  if (value === "too_good_to_be_true") {
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950";
  }
  if (value === "steal") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (value === "great_buy") {
    return "border-lime-300 bg-lime-100 text-lime-950";
  }
  if (value === "good_buy") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  if (value === "wholesale_opportunity") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  if (value === "mislisted") {
    return "border-violet-300 bg-violet-100 text-violet-950";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-800";
}

export default async function MarketIntelDealsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const { identities, marketplaces, listings } =
    await getMarketIntelDealWorkbench();

  const scored = listings.filter((listing) => listing.score);
  const actionable = scored
    .filter((listing) => listing.score?.actionable)
    .sort(
      (left, right) =>
        Number(right.score?.buy_score || 0) -
        Number(left.score?.buy_score || 0),
    );
  const sharkList = actionable.slice(0, 10);
  const watchOnly = listings.filter((listing) => !listing.score?.actionable);
  const wholesaleCount = listings.filter(
    (listing) =>
      listing.score?.deal_label === "wholesale_opportunity" ||
      listing.quantity > 1,
  ).length;
  const mislistedCount = listings.filter(
    (listing) => listing.suspected_mislisting,
  ).length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(132,204,22,0.16),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(190,242,100,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Shark List™ Deal Engine
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Exact-card market value, delivered acquisition cost, expected resale
            expenses, net profit, liquidity, confidence, and risk—ranked into one
            private buying desk.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {query?.saved === "1" ? (
          <Notice>Listing saved, scored, and added to the Shark List.</Notice>
        ) : null}
        {query?.ended === "1" ? (
          <Notice>Listing removed from the active deal desk.</Notice>
        ) : null}
        {query?.rescored ? (
          <Notice error={Boolean(query.scoreErrors)}>
            Rescored {query.rescored} active listing
            {query.rescored === "1" ? "" : "s"}
            {query.scoreErrors
              ? `; ${query.scoreErrors} could not be scored.`
              : "."}
          </Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Active Listings" value={String(listings.length)} />
          <Metric label="Actionable" value={String(actionable.length)} />
          <Metric label="Watch Only" value={String(watchOnly.length)} />
          <Metric label="Wholesale / Lots" value={String(wholesaleCount)} />
          <Metric label="Mislisted" value={String(mislistedCount)} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
            <h2 className="text-2xl font-black">Add Live Listing</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Match the listing to an exact card identity. Beta One will calculate
              delivered cost and score it against the latest verified market value.
            </p>

            {identities.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-950 shadow-sm ring-1 ring-amber-950/5">
                Create an exact card and sold-comp market before adding listings.
              </p>
            ) : (
              <form
                method="post"
                action={addAdminHandoff(
                  "/api/admin/market-intel/listings",
                  handoff,
                )}
                className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <label className="text-sm font-black sm:col-span-2">
                  Exact card identity
                  <select
                    name="collectibleIdentityId"
                    required
                    className={fieldClass}
                  >
                    <option value="">Select exact card</option>
                    {identities.map((identity) => (
                      <option key={identity.id} value={identity.id}>
                        {identity.display_name} — market {money(
                          identity.latest_value?.conservative_value,
                        )} — {identity.latest_value?.sample_size || 0} comps
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-black">
                  Marketplace
                  <select name="marketplaceId" required className={fieldClass}>
                    <option value="">Select marketplace</option>
                    {marketplaces.map((marketplace) => (
                      <option key={marketplace.id} value={marketplace.id}>
                        {marketplace.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-black">
                  Listing format
                  <select
                    name="listingFormat"
                    defaultValue="fixed_price"
                    className={fieldClass}
                  >
                    <option value="fixed_price">Fixed price</option>
                    <option value="best_offer">Best offer</option>
                    <option value="auction">Auction</option>
                    <option value="lot">Lot</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>

                <Input
                  name="directUrl"
                  label="Direct live listing URL"
                  type="url"
                  required
                  wide
                />
                <Input
                  name="originalTitle"
                  label="Original listing title"
                  required
                  wide
                />
                <Input name="externalListingId" label="Marketplace listing ID" />
                <Input name="sellerName" label="Seller" />
                <Input
                  name="askingPrice"
                  label="Asking price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                />
                <Input
                  name="shippingPrice"
                  label="Inbound shipping"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
                <Input
                  name="buyerFee"
                  label="Buyer fees"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
                <Input
                  name="quantity"
                  label="Quantity"
                  type="number"
                  min="1"
                  defaultValue="1"
                  required
                />
                <Input
                  name="sellerRating"
                  label="Seller rating %"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                />
                <Input
                  name="identityMatchConfidence"
                  label="Identity-match confidence %"
                  type="number"
                  min="0"
                  max="100"
                  defaultValue="100"
                  required
                />
                <Input
                  name="auctionEndAt"
                  label="Auction ending"
                  type="datetime-local"
                />
                <Input
                  name="resaleFeePct"
                  label="Expected resale fee %"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="13.5"
                />
                <Input
                  name="sellThroughPct"
                  label="Expected sell-through %"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue="100"
                />
                <Input
                  name="expectedOutboundShipping"
                  label="Expected outbound shipping"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
                <Input
                  name="expectedSupplies"
                  label="Expected supplies"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                />
                <Input
                  name="mislistingReason"
                  label="Mislisting reason"
                  wide
                />
                <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-black shadow-inner shadow-neutral-100 sm:col-span-2">
                  <input
                    name="suspectedMislisting"
                    type="checkbox"
                    className="accent-black"
                  />
                  Title, category, card number, parallel, or player appears mislisted
                </label>

                <AdminSubmitButton
                  className="rounded-2xl bg-black px-5 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800 sm:col-span-2"
                  pendingChildren="Saving and scoring..."
                  title="Save this listing, attach its exact identity, and calculate its deal score from current comps and delivered cost."
                >
                  Save Listing and Score Deal
                </AdminSubmitButton>
                <p className="text-xs font-bold text-neutral-600 sm:col-span-2">
                  Records and scores the listing for review; buying and ending listings remain separate actions.
                </p>
              </form>
            )}
          </section>

          <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
            <div className="flex flex-col gap-4 border-b border-neutral-700 p-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
                  Top 10 Actionable Buys
                </p>
                <h2 className="mt-1 text-3xl font-black">The Shark List™</h2>
              </div>
              <form
                method="post"
                action={addAdminHandoff(
                  "/api/admin/market-intel/deals/rescore",
                  handoff,
                )}
              >
                <AdminSubmitButton
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-black shadow-sm transition hover:bg-white hover:text-black"
                  pendingChildren="Rescoring..."
                  title="Recalculate deal scores for saved listings from the latest comps, fees, risk, and delivered-cost data."
                >
                  Rescore All
                </AdminSubmitButton>
                <p className="mt-2 text-xs font-bold text-neutral-300">
                  Refreshes ranking math only; it does not create purchases or end listings.
                </p>
              </form>
            </div>

            {sharkList.length === 0 ? (
              <div className="p-6">
                <h3 className="text-xl font-black">No qualified bites yet.</h3>
                <p className="mt-2 font-semibold text-neutral-300">
                  Add exact sold comps and a live listing. Beta One will suppress
                  GOOD BUY and better labels until market confidence and identity
                  match are strong enough.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-700">
                {sharkList.map((listing, index) => (
                  <SharkCard
                    key={listing.id}
                    rank={index + 1}
                    listing={listing}
                    handoff={handoff}
                  />
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">All Active Listings</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Watch-only rows remain visible so weak samples, thin comps, and
              uncertain identities cannot quietly disappear.
            </p>
          </div>

          {listings.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">
              No active listing records yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1250px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Deal</th>
                    <th className="px-5 py-3">Listing</th>
                    <th className="px-5 py-3">Marketplace</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Delivered</th>
                    <th className="px-5 py-3">Market / Unit</th>
                    <th className="px-5 py-3">Discount</th>
                    <th className="px-5 py-3">Net Profit</th>
                    <th className="px-5 py-3">Score</th>
                    <th className="px-5 py-3">Risk</th>
                    <th className="px-5 py-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {listings.map((listing) => (
                    <tr key={listing.id}>
                      <td className="px-5 py-4">
                        <Badge value={listing.score?.deal_label} />
                      </td>
                      <td className="max-w-md px-5 py-4">
                        <a
                          href={listing.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-black hover:underline"
                        >
                          {listing.original_title}
                        </a>
                        <p className="mt-1 text-xs font-semibold text-neutral-500">
                          {listing.identity?.display_name || "Unmatched identity"}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        {listing.marketplace?.name || "Unknown"}
                      </td>
                      <td className="px-5 py-4">{listing.quantity}</td>
                      <td className="px-5 py-4 font-black">
                        {money(listing.delivered_price)}
                      </td>
                      <td className="px-5 py-4">
                        {money(
                          listing.identity?.latest_value?.conservative_value,
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {percentage(listing.score?.discount_pct)}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(listing.score?.expected_net_profit)}
                      </td>
                      <td className="px-5 py-4">
                        {listing.score?.buy_score.toFixed(0) || "—"}
                      </td>
                      <td className="px-5 py-4">
                        {listing.score?.risk_score.toFixed(0) || "—"}
                      </td>
                      <td className="px-5 py-4">
                        <DealListingActions
                          listingId={listing.id}
                          title={listing.original_title}
                          quantity={listing.quantity}
                          deliveredPrice={listing.delivered_price}
                          handoff={handoff}
                          compact
                          hasExactIdentity={Boolean(listing.collectible_identity_id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SharkCard({
  rank,
  listing,
  handoff,
}: {
  rank: number;
  listing: MarketIntelDealListing;
  handoff: string | null | undefined;
}) {
  const score = listing.score!;
  const marketUnit = listing.identity?.latest_value?.conservative_value;

  return (
    <article className="p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-lime-300 text-xl font-black text-black">
            {rank}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge value={score.deal_label} />
              {listing.quantity > 1 &&
              score.deal_label !== "wholesale_opportunity" ? (
                <span className="rounded-full border border-amber-400 bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-950">
                  WHOLESALE
                </span>
              ) : null}
              {listing.suspected_mislisting &&
              score.deal_label !== "mislisted" ? (
                <span className="rounded-full border border-violet-400 bg-violet-100 px-2.5 py-1 text-xs font-black text-violet-950">
                  MISLISTED
                </span>
              ) : null}
            </div>
            <a
              href={listing.direct_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-xl font-black hover:text-lime-300 hover:underline"
            >
              {listing.original_title}
            </a>
            <p className="mt-1 text-sm font-semibold text-neutral-300">
              {listing.marketplace?.name || "Unknown marketplace"} · {listing.identity?.display_name || "Unmatched identity"}
            </p>
            <p className="mt-3 text-sm font-semibold leading-6 text-neutral-200">
              {score.reason}
            </p>
            <p className="mt-1 text-xs font-semibold text-neutral-400">
              {score.risk_notes}
            </p>
          </div>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[440px]">
          <DarkStat label="Delivered" value={money(score.delivered_cost)} />
          <DarkStat label="Market / Unit" value={money(marketUnit)} />
          <DarkStat label="Net Profit" value={money(score.expected_net_profit)} />
          <DarkStat label="Buy Score" value={score.buy_score.toFixed(0)} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 pl-0 sm:pl-15">
        <a
          href={listing.direct_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-lime-300 px-4 py-2 text-sm font-black text-black shadow-sm transition hover:bg-lime-200"
        >
          OPEN LISTING
        </a>
        <span className="text-xs font-black uppercase text-neutral-400">
          {percentage(score.discount_pct)} discount · confidence {score.confidence_score.toFixed(0)} · liquidity {score.liquidity_score.toFixed(0)} · risk {score.risk_score.toFixed(0)}
        </span>
      </div>
      <div className="mt-4 pl-0 sm:pl-15">
        <DealListingActions
          listingId={listing.id}
          title={listing.original_title}
          quantity={listing.quantity}
          deliveredPrice={score.delivered_cost}
          handoff={handoff}
          dark
          hasExactIdentity={Boolean(listing.collectible_identity_id)}
        />
      </div>
    </article>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
  wide?: boolean;
}) {
  const { label, wide, ...inputProps } = props;
  return (
    <label className={`text-sm font-black ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input {...inputProps} className={fieldClass} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-700 bg-neutral-900 p-3 text-center shadow-inner">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function Badge({ value }: { value: string | null | undefined }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1 text-xs font-black ${labelTone(
        value,
      )}`}
    >
      {dealLabel(value)}
    </span>
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
          ? "rounded-2xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900 shadow-sm ring-1 ring-rose-950/5"
          : "rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900 shadow-sm ring-1 ring-emerald-950/5"
      }
    >
      {children}
    </div>
  );
}
