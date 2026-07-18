import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelGrowthWorkbench,
  type MarketIntelGrowthProjection,
  type MarketIntelGrowthSpec,
} from "../../../../lib/market-intel-growth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    saved?: string;
    status?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black";

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toFixed(0)}%`;
}

function multiple(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `${Number(value).toFixed(1)}×`;
}

function classificationTone(value: string) {
  if (value === "big_money_maker") {
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950";
  }
  if (value === "strong_growth_spec") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (value === "growth_spec") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  if (value === "speculative_watch") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  return "border-rose-300 bg-rose-100 text-rose-950";
}

export default async function MarketIntelGrowthSpecsPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  let data: Awaited<ReturnType<typeof getMarketIntelGrowthWorkbench>> | null = null;
  let loadError: string | null = null;

  try {
    data = await getMarketIntelGrowthWorkbench();
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load Growth Spec Lab.";
  }

  const specs = data?.specs || [];
  const autoCandidates = data?.autoCandidates || [];
  const eligibleIdentities = data?.eligibleIdentities || [];
  const eligibleListings = (data?.listings || []).filter(
    (listing) =>
      listing.identity?.eligible_for_growth &&
      listing.delivered_price / Math.max(1, listing.quantity) <= 5,
  );

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
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-fuchsia-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Growth Spec Lab™
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Model cheap non-base Silvers, Holos, inserts, numbered cards, autos,
            memorabilia, and real parallels as controlled future-upside positions.
            Lots are broken down to delivered cost per card before they qualify.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "1" ? (
          <Notice>Growth Spec saved and future-exit math calculated.</Notice>
        ) : null}
        {query?.status ? (
          <Notice>Growth Spec marked {query.status.replaceAll("_", " ")}.</Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {loadError ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-xl font-black">Growth Spec migration required</h2>
            <p className="mt-2 font-semibold leading-6">{loadError}</p>
            <p className="mt-3 text-sm font-bold">
              Apply <code>supabase/migrations/20260717_tcos_market_intel_growth_specs.sql</code>
              in Supabase SQL Editor, then reload.
            </p>
          </section>
        ) : null}

        <section className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
          <p className="text-xs font-black uppercase tracking-[0.18em]">
            Hard rule
          </p>
          <h2 className="mt-1 text-2xl font-black">No base cards. Period.</h2>
          <p className="mt-2 font-semibold leading-6">
            An exact identity must contain a named parallel, insert, variation,
            serial numbering, autograph, or memorabilia signal. The server rejects
            base cards even if someone tries to bypass the form.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Active Specs" value={String(data?.totals.active || 0)} />
          <Metric
            label="Capital at Risk"
            value={money(data?.totals.capitalAtRisk || 0)}
          />
          <Metric
            label="Projected Net Profit"
            value={money(data?.totals.projectedNetProfit || 0)}
          />
          <Metric
            label="Big Money Models"
            value={String(data?.totals.projectedBigMoneyMakers || 0)}
          />
          <Metric label="Auto Lot Candidates" value={String(autoCandidates.length)} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-700">
              Create scenario
            </p>
            <h2 className="mt-1 text-3xl font-black">Model a Future Grower</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              Choose a scanned listing or enter a manual exact card. For lots, enter
              the entire delivered cost and total quantity; Beta One calculates cost
              per card automatically.
            </p>

            <form
              method="post"
              action={addAdminHandoff(
                "/api/admin/market-intel/growth-specs",
                handoff,
              )}
              className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <label className="text-sm font-black sm:col-span-2">
                Scanned non-base listing or lot (optional)
                <select name="sourceListingId" className={fieldClass}>
                  <option value="">Manual scenario</option>
                  {eligibleListings.map((listing) => (
                    <option key={listing.id} value={listing.id}>
                      {listing.original_title} — {listing.quantity} card
                      {listing.quantity === 1 ? "" : "s"} — {money(
                        listing.delivered_price / Math.max(1, listing.quantity),
                      )}/card
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-black sm:col-span-2">
                Exact non-base card identity
                <select name="collectibleIdentityId" className={fieldClass}>
                  <option value="">Use the source listing identity</option>
                  {eligibleIdentities.map((identity) => (
                    <option key={identity.id} value={identity.id}>
                      {identity.display_name} — {identity.non_base_reasons.join(" + ")}
                    </option>
                  ))}
                </select>
              </label>

              <Input
                name="quantity"
                label="Quantity in lot"
                type="number"
                min="1"
                placeholder="10"
              />
              <Input
                name="totalDeliveredCost"
                label="Total delivered cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="30.00"
              />
              <Input
                name="targetExitPrice"
                label="Target exit per card"
                type="number"
                min="0.01"
                step="0.01"
                defaultValue="25"
                required
              />
              <Input
                name="sellThroughPct"
                label="Expected sell-through %"
                type="number"
                min="0"
                max="100"
                step="0.1"
                defaultValue="80"
                required
              />
              <Input
                name="resaleFeePct"
                label="Expected resale fee %"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue="13.5"
                required
              />
              <Input
                name="outboundShippingPerCard"
                label="Shipping per sold card"
                type="number"
                min="0"
                step="0.01"
                defaultValue="1.25"
                required
              />
              <Input
                name="suppliesPerCard"
                label="Supplies per sold card"
                type="number"
                min="0"
                step="0.01"
                defaultValue="0.15"
                required
              />
              <Input
                name="holdMonths"
                label="Expected hold months"
                type="number"
                min="1"
                defaultValue="24"
                required
              />
              <Input
                name="convictionScore"
                label="Thesis conviction 0–100"
                type="number"
                min="0"
                max="100"
                defaultValue="50"
                required
              />
              <Input
                name="thesisExpiresAt"
                label="Thesis expiration"
                type="date"
              />
              <Input
                name="catalyst"
                label="Player catalyst"
                placeholder="Starter role, trade, playoffs, award, national team"
                wide
              />
              <TextArea
                name="thesis"
                label="Why this card could grow"
                placeholder="Explain the player path, card desirability, scarcity, and likely buyer demand."
              />
              <TextArea
                name="notes"
                label="Risk / exit notes"
                placeholder="Maximum copies, sell-on-spike plan, grading plan, or reasons to abandon."
              />

              <button
                type="submit"
                className="rounded-md bg-black px-5 py-3 font-black text-white sm:col-span-2"
              >
                Save Growth Spec Scenario
              </button>
            </form>
          </section>

          <section className="overflow-hidden rounded-xl border border-neutral-800 bg-[#101418] text-white shadow-sm">
            <div className="border-b border-neutral-700 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-300">
                Scanned lots under $5 per card
              </p>
              <h2 className="mt-1 text-3xl font-black">Automatic Growth Candidates</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-300">
                These are scenario candidates—not guaranteed winners. The default model
                assumes an $25 exit, 80% sell-through, 13.5% fees, and individual-card
                fulfillment costs.
              </p>
            </div>

            {autoCandidates.length === 0 ? (
              <div className="p-6">
                <h3 className="text-xl font-black">No eligible scanned lots yet.</h3>
                <p className="mt-2 font-semibold text-neutral-300">
                  Add exact Silver, Holo, parallel, insert, numbered, autograph, or
                  memorabilia identities, then run the eBay scanner.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-700">
                {autoCandidates.slice(0, 20).map(({ listing, projection }) => (
                  <article key={listing.id} className="p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <ClassificationBadge projection={projection} />
                        <a
                          href={listing.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 block text-lg font-black hover:text-fuchsia-300 hover:underline"
                        >
                          {listing.original_title}
                        </a>
                        <p className="mt-1 text-sm font-semibold text-neutral-300">
                          {listing.identity?.display_name}
                        </p>
                        <p className="mt-2 text-xs font-bold text-neutral-400">
                          {listing.quantity} card{listing.quantity === 1 ? "" : "s"} · {money(
                            listing.delivered_price,
                          )} delivered · {money(projection.unit_delivered_cost)} per card
                        </p>
                      </div>
                      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[430px]">
                        <DarkStat label="Target" value="$25/card" />
                        <DarkStat
                          label="Projected Profit"
                          value={money(projection.projected_net_profit)}
                        />
                        <DarkStat
                          label="Break Even"
                          value={
                            projection.break_even_units === null
                              ? "—"
                              : `${projection.break_even_units} cards`
                          }
                        />
                        <DarkStat
                          label="Future Score"
                          value={projection.growth_score.toFixed(0)}
                        />
                      </div>
                    </div>
                    <p className="mt-3 text-sm font-semibold leading-6 text-neutral-300">
                      {projection.explanation}
                    </p>
                    <form
                      method="post"
                      action={addAdminHandoff(
                        "/api/admin/market-intel/growth-specs",
                        handoff,
                      )}
                      className="mt-4"
                    >
                      <input type="hidden" name="sourceListingId" value={listing.id} />
                      <input type="hidden" name="targetExitPrice" value="25" />
                      <input type="hidden" name="sellThroughPct" value="80" />
                      <input type="hidden" name="resaleFeePct" value="13.5" />
                      <input
                        type="hidden"
                        name="outboundShippingPerCard"
                        value="1.25"
                      />
                      <input type="hidden" name="suppliesPerCard" value="0.15" />
                      <input type="hidden" name="holdMonths" value="24" />
                      <input type="hidden" name="convictionScore" value="50" />
                      <button
                        type="submit"
                        className="rounded-md bg-fuchsia-300 px-4 py-2 text-sm font-black text-black hover:bg-fuchsia-200"
                      >
                        Save Default $25 Model
                      </button>
                    </form>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-700">
              Saved theses
            </p>
            <h2 className="mt-1 text-3xl font-black">Future Money Models</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              Projected values depend on your target price, sell-through, fees, hold
              period, and catalyst thesis. They are scenario math—not guaranteed returns.
            </p>
          </div>

          {specs.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">
              No Growth Spec scenarios saved yet.
            </p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {specs.map((spec) => (
                <SavedSpec key={spec.id} spec={spec} handoff={handoff} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SavedSpec({
  spec,
  handoff,
}: {
  spec: MarketIntelGrowthSpec;
  handoff: string | null | undefined;
}) {
  const projection = spec.projection;

  return (
    <article className={spec.status === "passed" ? "bg-neutral-50 p-5 opacity-70" : "p-5"}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ClassificationBadge projection={projection} />
            <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2.5 py-1 text-xs font-black uppercase">
              {spec.status}
            </span>
            <span className="rounded-full border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-950">
              NO BASE · {spec.identity.non_base_reasons.join(" + ")}
            </span>
          </div>
          <h3 className="mt-3 text-2xl font-black">{spec.identity.display_name}</h3>
          {spec.source_listing ? (
            <a
              href={spec.source_listing.direct_url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-sm font-bold text-cyan-700 hover:underline"
            >
              Open source listing
            </a>
          ) : null}
          <p className="mt-3 font-semibold leading-6 text-neutral-700">
            {projection.explanation}
          </p>
          {spec.catalyst ? (
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              <strong>Catalyst:</strong> {spec.catalyst}
            </p>
          ) : null}
          {spec.thesis ? (
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              <strong>Thesis:</strong> {spec.thesis}
            </p>
          ) : null}
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[560px]">
          <SmallStat label="Lot Cost" value={money(spec.total_delivered_cost)} />
          <SmallStat label="Cost / Card" value={money(projection.unit_delivered_cost)} />
          <SmallStat label="Target / Card" value={money(spec.target_exit_price)} />
          <SmallStat label="Expected Sold" value={`${projection.expected_units_sold}/${spec.quantity}`} />
          <SmallStat label="Projected Net" value={money(projection.projected_net_profit)} />
          <SmallStat label="Projected ROI" value={percent(projection.projected_roi_pct)} />
          <SmallStat label="Upside" value={multiple(projection.upside_multiple)} />
          <SmallStat
            label="Break Even"
            value={
              projection.break_even_units === null
                ? "—"
                : `${projection.break_even_units} cards`
            }
          />
          <SmallStat label="Growth Score" value={projection.growth_score.toFixed(0)} />
          <SmallStat label="Risk" value={projection.risk_score.toFixed(0)} />
          <SmallStat label="Hold" value={`${spec.hold_months} mo`} />
          <SmallStat label="Conviction" value={spec.conviction_score.toFixed(0)} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {spec.status === "passed" ? (
          <StatusButton id={spec.id} status="active" label="Reactivate" handoff={handoff} />
        ) : (
          <StatusButton id={spec.id} status="passed" label="Pass / Reject" handoff={handoff} />
        )}
        <StatusButton id={spec.id} status="bought" label="Mark Bought" handoff={handoff} />
        <StatusButton id={spec.id} status="sold" label="Mark Sold" handoff={handoff} />
        <StatusButton id={spec.id} status="expired" label="Thesis Expired" handoff={handoff} />
      </div>
    </article>
  );
}

function StatusButton({
  id,
  status,
  label,
  handoff,
}: {
  id: string;
  status: string;
  label: string;
  handoff: string | null | undefined;
}) {
  return (
    <form
      method="post"
      action={addAdminHandoff(
        `/api/admin/market-intel/growth-specs/${id}/status`,
        handoff,
      )}
    >
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-black hover:bg-neutral-100"
      >
        {label}
      </button>
    </form>
  );
}

function ClassificationBadge({
  projection,
}: {
  projection: MarketIntelGrowthProjection;
}) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-1 text-xs font-black ${classificationTone(
        projection.classification,
      )}`}
    >
      {projection.classification_label}
    </span>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
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

function TextArea({
  name,
  label,
  placeholder,
}: {
  name: string;
  label: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-black sm:col-span-2">
      {label}
      <textarea
        name={name}
        placeholder={placeholder}
        rows={3}
        className={fieldClass}
      />
    </label>
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

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}

function DarkStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-400">
        {label}
      </p>
      <p className="mt-1 font-black text-white">{value}</p>
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
