import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelPurchaseDesk,
  type MarketIntelPurchaseCandidate,
} from "../../../../lib/market-intel-portfolio";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

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

function label(value: string | null | undefined) {
  return String(value || "watch").replaceAll("_", " ").toUpperCase();
}

export default async function MarketIntelPurchaseDeskPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const { candidates, totals } = await getMarketIntelPurchaseDesk();

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
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Buy + Track Desk
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Review only actionable Shark List opportunities, verify the direct live
            listing, enter the real out-the-door purchase cost, and create the tracked
            inventory position in one step.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900">
            {query.error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Actionable Listings" value={String(totals.actionable)} />
          <Metric label="Wholesale / Lots" value={String(totals.wholesale)} />
          <Metric label="Capital for All" value={money(totals.capitalRequired)} />
          <Metric
            label="Expected Net Profit"
            value={money(totals.expectedNetProfit)}
          />
        </section>

        {candidates.length === 0 ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-black">Nothing qualifies for purchase yet.</h2>
            <p className="mt-2 font-semibold text-neutral-600">
              The Buy Desk only shows listings that passed exact-card identity,
              market-confidence, minimum-discount, and expected-profit rules.
            </p>
            <Link
              href={addAdminHandoff("/admin/market-intel/deals", handoff)}
              className="mt-5 inline-block rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
            >
              Open Shark List™
            </Link>
          </section>
        ) : (
          <section className="space-y-5">
            {candidates.map((candidate, index) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                rank={index + 1}
                handoff={handoff}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function CandidateCard({
  candidate,
  rank,
  handoff,
}: {
  candidate: MarketIntelPurchaseCandidate;
  rank: number;
  handoff: string | null | undefined;
}) {
  const score = candidate.score!;
  const marketUnit = candidate.identity?.latest_value?.conservative_value;
  const unitCost =
    candidate.quantity > 0
      ? Number(score.delivered_cost || 0) / candidate.quantity
      : 0;

  return (
    <article className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 bg-[#101418] p-5 text-white">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-lime-300 text-xl font-black text-black">
              {rank}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <Badge value={score.deal_label} />
                {candidate.quantity > 1 ? <Badge value="wholesale" /> : null}
                {candidate.suspected_mislisting ? (
                  <Badge value="mislisted" />
                ) : null}
              </div>
              <a
                href={candidate.direct_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block text-xl font-black hover:text-lime-300 hover:underline"
              >
                {candidate.original_title}
              </a>
              <p className="mt-1 text-sm font-semibold text-neutral-300">
                {candidate.marketplace?.name || "Unknown marketplace"} ·{" "}
                {candidate.identity?.display_name || "Unmatched identity"}
              </p>
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
            <DarkStat label="Delivered" value={money(score.delivered_cost)} />
            <DarkStat label="Unit Cost" value={money(unitCost)} />
            <DarkStat label="Market / Unit" value={money(marketUnit)} />
            <DarkStat label="Buy Score" value={score.buy_score.toFixed(0)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 xl:grid-cols-[1fr_0.8fr]">
        <section>
          <h2 className="text-xl font-black">Economics</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Quantity" value={String(candidate.quantity)} />
            <Stat
              label="Discount"
              value={percentage(score.discount_pct)}
            />
            <Stat
              label="Expected Net GP"
              value={money(score.expected_net_profit)}
            />
            <Stat
              label="Expected ROI"
              value={percentage(candidate.expected_roi_pct)}
            />
            <Stat
              label="Break-even Units"
              value={
                candidate.break_even_units === null
                  ? "—"
                  : String(candidate.break_even_units)
              }
            />
            <Stat
              label="Safety Units"
              value={
                candidate.margin_of_safety_units === null
                  ? "—"
                  : String(candidate.margin_of_safety_units)
              }
            />
            <Stat
              label="Net / Sold Unit"
              value={money(candidate.expected_net_per_sold_unit)}
            />
            <Stat
              label="Expected Units Sold"
              value={String(candidate.expected_units_sold)}
            />
          </div>
          <p className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold leading-6 text-neutral-700">
            {score.reason || "No scoring explanation saved."}
          </p>
          <p className="mt-2 text-xs font-bold text-neutral-500">
            {score.risk_notes || "No risk note saved."}
          </p>
          <a
            href={candidate.direct_url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block rounded-md border border-neutral-300 px-4 py-2.5 text-sm font-black hover:bg-neutral-100"
          >
            OPEN EXACT LIVE LISTING
          </a>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-xl font-black">Record Actual Purchase</h2>
          {candidate.existing_purchase_lot_id ? (
            <div className="mt-4">
              <p className="font-semibold text-amber-950">
                This listing is already Purchase #{candidate.existing_purchase_number}.
              </p>
              <Link
                href={addAdminHandoff(
                  `/admin/market-intel/purchases/${candidate.existing_purchase_lot_id}`,
                  handoff,
                )}
                className="mt-4 inline-block rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
              >
                Open Tracked Purchase
              </Link>
            </div>
          ) : (
            <form
              method="post"
              action={addAdminHandoff(
                `/api/admin/market-intel/listings/${candidate.id}/purchase`,
                handoff,
              )}
              className="mt-4 space-y-4"
            >
              <label className="block text-sm font-black">
                Actual total out-the-door cost
                <input
                  name="totalAcquisitionCost"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={Number(score.delivered_cost || 0).toFixed(2)}
                  className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2.5 outline-none focus:border-black"
                />
              </label>
              <label className="block text-sm font-black">
                Quantity purchased
                <input
                  name="quantityPurchased"
                  type="number"
                  min="1"
                  required
                  defaultValue={candidate.quantity}
                  className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2.5 outline-none focus:border-black"
                />
              </label>
              <label className="block text-sm font-black">
                Purchase date
                <input
                  name="purchaseDate"
                  type="date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2.5 outline-none focus:border-black"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-black">
                <input name="alreadyReceived" type="checkbox" />
                Already received and in inventory
              </label>
              <button
                type="submit"
                className="w-full rounded-md bg-black px-4 py-3 font-black text-white">
                CREATE PURCHASE POSITION
              </button>
              <p className="text-xs font-semibold leading-5 text-amber-950">
                Use the final amount you actually paid after accepted offers, shipping,
                buyer fees, and tax. Beta One uses this as the real cost basis.
              </p>
            </form>
          )}
        </section>
      </div>
    </article>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-28 rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 font-black text-white">{value}</p>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return (
    <span className="rounded-full border border-lime-400 bg-lime-100 px-2.5 py-1 text-xs font-black text-lime-950">
      {label(value)}
    </span>
  );
}
