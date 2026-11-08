import Link from "next/link";
import { notFound } from "next/navigation";
import AdminSubmitButton from "../../../AdminSubmitButton";
import { addAdminHandoff } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";
import { getMarketIntelPurchaseDetail } from "../../../../../lib/market-intel";
import {
  getPurchaseDetailIntelligence,
  portfolioBucketLabel,
  purchasePortfolioBucket,
  purchaseSourceLabel,
  type PortfolioBucket,
  type PurchaseResearchSignal,
} from "../../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
const percentage = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
};
const label = (value: string | null | undefined) =>
  value ? value.replaceAll("_", " ").toUpperCase() : "NOT SET";
const inputClass =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 shadow-inner shadow-neutral-100 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
};

function movementTone(value: number | null) {
  if (value === null) return "text-neutral-500";
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-neutral-700";
}

function strategyTone(bucket: PortfolioBucket) {
  if (bucket === "hold") return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950";
  if (bucket === "pc") return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-blue-300 bg-blue-50 text-blue-950";
}

function signalTone(signal: PurchaseResearchSignal) {
  const tones = {
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-950",
    amber: "border-amber-300 bg-amber-50 text-amber-950",
    rose: "border-rose-300 bg-rose-50 text-rose-950",
    cyan: "border-cyan-300 bg-cyan-50 text-cyan-950",
    fuchsia: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950",
    neutral: "border-neutral-300 bg-neutral-50 text-neutral-900",
  };
  return tones[signal.tone];
}

export default async function MarketIntelPurchaseDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const adminHandoff = await createAdminSessionValue();
  const adminHref = (href: string) => addAdminHandoff(href, adminHandoff);
  const data = await getMarketIntelPurchaseDetail(id);
  if (!data) notFound();

  const { lot, performance, sales, marketplaces } = data;
  const intelligence = await getPurchaseDetailIntelligence(lot);
  const remaining = performance?.quantity_remaining ?? lot.quantity_purchased;
  const unitCost = Number(lot.unit_cost_basis || 0);
  const progress = Number(performance?.cash_break_even_progress_pct || 0);
  const bucket = purchasePortfolioBucket(lot.metadata);
  const sourceLabel = purchaseSourceLabel(lot);
  const currentMarket = intelligence.current?.conservative_value ?? null;
  const currentPositionValue =
    currentMarket === null ? null : currentMarket * Number(remaining || 0);
  const remainingCostBasis = Number(remaining || 0) * unitCost;
  const unrealizedSpread =
    currentPositionValue === null ? null : currentPositionValue - remainingCostBasis;
  const saleSaveDisabledReason =
    remaining <= 0 ? "All purchased units have already been recorded as sold." : "";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.13),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <Link
                href={adminHref("/admin/market-intel/purchases")}
                className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
              >
                ← Purchase Ledger
              </Link>
              <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-neutral-400">
                Purchase #{lot.purchase_number}
              </p>
              <h1 className="mt-2 max-w-5xl text-4xl font-black">
                {lot.collectible?.display_name || "Unmatched collectible"}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2 text-sm font-semibold text-neutral-300">
                <span>{sourceLabel}</span>
                <span>•</span>
                <span>{new Date(lot.purchased_at).toLocaleDateString()}</span>
                <span>•</span>
                <span>{label(lot.status)}</span>
                <span>•</span>
                <span>{portfolioBucketLabel(bucket)}</span>
                {lot.source_url ? (
                  <>
                    <span>•</span>
                    <a
                      href={lot.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-300 hover:underline"
                    >
                      Original listing
                    </a>
                  </>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {lot.collectible_identity_id ? (
                <Link
                  href={adminHref(
                    `/admin/market-intel/comps/${lot.collectible_identity_id}?from=purchase-${lot.id}`,
                  )}
                  className="rounded-full bg-cyan-300 px-4 py-3 font-black text-black shadow-sm transition hover:bg-cyan-200"
                >
                  InstaComp™ / Sold Comps
                </Link>
              ) : null}
              <Link
                href={adminHref("/admin/market-intel/purchases/new")}
                className="rounded-full border border-amber-300/60 bg-amber-300/10 px-4 py-3 font-black text-amber-100 shadow-sm transition hover:bg-amber-300/20"
              >
                Add Offline Purchase
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {query?.saved === "1" ? (
          <Notice tone="success">Sale saved and gross profit recalculated.</Notice>
        ) : null}
        {query?.saved === "received" ? (
          <Notice tone="success">Purchase moved into inventory.</Notice>
        ) : null}
        {query?.saved === "strategy" ? (
          <Notice tone="success">Strategy updated.</Notice>
        ) : null}
        {query?.saved === "created" ? (
          <Notice tone="success">
            Offline purchase created with exact identity and full cost basis.
          </Notice>
        ) : null}
        {query?.error ? <Notice tone="error">{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Total Cost" value={money(lot.total_acquisition_cost)} />
          <Metric label="Unit Cost" value={money(unitCost)} />
          <Metric label="Current Market / Unit" value={money(currentMarket)} />
          <Metric
            label="7-Day Move"
            value={percentage(intelligence.weeklyChangePct)}
            valueClassName={movementTone(intelligence.weeklyChangePct)}
          />
          <Metric
            label="Since Purchase"
            value={percentage(intelligence.sincePurchaseChangePct)}
            valueClassName={movementTone(intelligence.sincePurchaseChangePct)}
          />
          <Metric label="Units Remaining" value={String(remaining)} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.75fr_1.25fr]">
          <aside className="space-y-6">
            <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-800">
                Position control
              </p>
              <h2 className="mt-1 text-2xl font-black">Strategy Lane</h2>
              <span
                className={`mt-4 inline-flex rounded-full border px-3 py-1 text-xs font-black ${strategyTone(bucket)}`}
              >
                {portfolioBucketLabel(bucket)}
              </span>
              <form
                method="post"
                action={adminHref(
                  `/api/admin/market-intel/purchases/${lot.id}/strategy`,
                )}
                className="mt-5 space-y-3"
              >
                <label className="text-sm font-black">
                  Move this position to
                  <select
                    name="portfolioBucket"
                    defaultValue={bucket}
                    className={inputClass}
                  >
                    <option value="resale">Resale</option>
                    <option value="hold">Hold / Investment</option>
                    <option value="pc">Personal Collection</option>
                  </select>
                </label>
                <AdminSubmitButton
                  className="w-full rounded-2xl bg-fuchsia-900 px-4 py-3 font-black text-white shadow-sm transition hover:bg-fuchsia-800"
                  pendingChildren="Updating strategy..."
                  title="Move this purchase between Resale, Hold / Investment, and Personal Collection without changing its cost basis."
                >
                  UPDATE STRATEGY
                </AdminSubmitButton>
              </form>
            </section>

            <section
              className={`rounded-3xl border p-6 shadow-sm ring-1 ring-black/[0.02] ${signalTone(intelligence.signal)}`}
            >
              <p className="text-xs font-black uppercase tracking-[0.18em]">
                TCOS research signal
              </p>
              <h2 className="mt-1 text-3xl font-black">{intelligence.signal.label}</h2>
              <p className="mt-3 text-sm font-semibold leading-6">
                {intelligence.signal.explanation}
              </p>
              <p className="mt-3 text-xs font-bold opacity-75">
                Research prompt only. Verify the newest exact sales, fees, liquidity, and your
                own strategy before buying or selling.
              </p>
            </section>

            <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
              <h2 className="text-xl font-black">Position Summary</h2>
              <dl className="mt-5 space-y-3 text-sm">
                <Row label="Acquisition source" value={sourceLabel} />
                <Row label="Quantity purchased" value={String(lot.quantity_purchased)} />
                <Row label="Quantity sold" value={String(performance?.quantity_sold || 0)} />
                <Row label="Quantity remaining" value={String(remaining)} />
                <Row label="Remaining cost basis" value={money(remainingCostBasis)} />
                <Row label="Estimated market value" value={money(currentPositionValue)} />
                <Row label="Unrealized gross spread" value={money(unrealizedSpread)} strong />
                <Row
                  label="Realized gross profit"
                  value={money(performance?.realized_gross_profit)}
                  strong
                />
              </dl>
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs font-black text-neutral-500">
                  <span>Cash break-even</span>
                  <span>{progress.toFixed(1)}%</span>
                </div>
                <div className="h-3 rounded-full bg-neutral-200">
                  <div
                    className="h-3 rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, progress)}%` }}
                  />
                </div>
              </div>
            </section>
          </aside>

          <div className="space-y-6">
            <section className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6 text-cyan-950 shadow-sm ring-1 ring-cyan-950/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em]">
                    InstaComp™ acquisition baseline
                  </p>
                  <h2 className="mt-1 text-2xl font-black">Market when you bought it</h2>
                  <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
                    TCOS uses the market-value snapshot nearest the purchase date and exact
                    verified sales from the 90 days before through seven days after acquisition.
                  </p>
                </div>
                {lot.collectible_identity_id ? (
                  <Link
                    href={adminHref(`/admin/market-intel/comps/${lot.collectible_identity_id}`)}
                    className="rounded-full bg-cyan-950 px-4 py-3 text-center font-black text-white shadow-sm transition hover:bg-cyan-900"
                  >
                    Open Full InstaComp™ Market
                  </Link>
                ) : null}
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label="Purchase Baseline"
                  value={money(intelligence.purchaseBaseline?.conservative_value)}
                />
                <Stat
                  label="Baseline Sample"
                  value={String(intelligence.purchaseBaseline?.sample_size ?? 0)}
                />
                <Stat
                  label="Current Market"
                  value={money(intelligence.current?.conservative_value)}
                />
                <Stat
                  label="Current Confidence"
                  value={
                    intelligence.current
                      ? `${intelligence.current.confidence_score.toFixed(0)}%`
                      : "—"
                  }
                />
              </div>

              {intelligence.purchaseBaselineSource === "nearest_after" ? (
                <p className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-950 shadow-sm ring-1 ring-amber-950/5">
                  No saved market snapshot existed on or before the purchase date, so TCOS is
                  showing the nearest later snapshot and labels it as a fallback.
                </p>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
              <div className="border-b border-neutral-200 p-5">
                <h2 className="text-2xl font-black">Sales Comps Around Purchase Date</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  Exact verified, included, non-outlier sales closest to when this position was acquired.
                </p>
              </div>
              {intelligence.purchaseComps.length === 0 ? (
                <div className="p-6">
                  <p className="font-semibold text-neutral-600">
                    No verified exact-card sales were saved around the purchase date.
                  </p>
                  {lot.collectible_identity_id ? (
                    <Link
                      href={adminHref(`/admin/market-intel/comps/${lot.collectible_identity_id}`)}
                      className="mt-4 inline-flex rounded-full bg-black px-4 py-2.5 font-black text-white shadow-sm transition hover:bg-neutral-800"
                    >
                      Add or Review Sold Comps
                    </Link>
                  ) : null}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left text-sm">
                    <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                      <tr>
                        <th className="px-4 py-3">Sold</th>
                        <th className="px-4 py-3">Marketplace</th>
                        <th className="px-4 py-3">Title</th>
                        <th className="px-4 py-3">Qty</th>
                        <th className="px-4 py-3">Unit Delivered</th>
                        <th className="px-4 py-3">Match</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200">
                      {intelligence.purchaseComps.map((comp) => (
                        <tr key={comp.id}>
                          <td className="px-4 py-4">
                            {new Date(comp.sold_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-4">
                            {comp.marketplace?.name || "Unknown"}
                          </td>
                          <td className="max-w-md px-4 py-4">
                            {comp.source_url ? (
                              <a
                                href={comp.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="font-bold text-blue-700 hover:underline"
                              >
                                {comp.original_title || "Open sold record"}
                              </a>
                            ) : (
                              comp.original_title || "No title"
                            )}
                          </td>
                          <td className="px-4 py-4">{comp.quantity}</td>
                          <td className="px-4 py-4 font-black">
                            {money(comp.unit_delivered_price)}
                          </td>
                          <td className="px-4 py-4">
                            {comp.match_confidence.toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Record a Sale</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  Enter actual sale money and expenses. TCOS calculates net proceeds and GP.
                </p>
              </div>
              {lot.status === "awaiting_receipt" || lot.status === "ordered" ? (
                <form
                  method="post"
                  action={adminHref(
                    `/api/admin/market-intel/purchases/${lot.id}/receive`,
                  )}
                >
                  <AdminSubmitButton
                    className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
                    pendingChildren="Marking received..."
                    disabledReason="Updates receipt status only; sale recording and realized profit stay separate."
                    title="Mark this purchase lot as received so it can move from inbound tracking into inventory review."
                  >
                    Mark Received
                  </AdminSubmitButton>
                </form>
              ) : null}
            </div>

            <form
              method="post"
              action={adminHref("/api/admin/market-intel/sales")}
              className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <input type="hidden" name="purchaseLotId" value={lot.id} />
              <Field label="Marketplace">
                <select name="marketplaceId" className={inputClass}>
                  <option value="">Not specified</option>
                  {marketplaces.map((marketplace) => (
                    <option key={marketplace.id} value={marketplace.id}>
                      {marketplace.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sale date">
                <input
                  name="soldAt"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </Field>
              <Field label="Quantity sold">
                <input
                  name="quantitySold"
                  type="number"
                  min="1"
                  max={remaining}
                  defaultValue="1"
                  required
                  className={inputClass}
                />
              </Field>
              <Field label="Gross item sale">
                <input
                  name="grossItemSales"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder="0.00"
                  className={inputClass}
                />
              </Field>
              <MoneyField name="shippingCharged" label="Shipping charged" />
              <MoneyField name="marketplaceFees" label="Marketplace fees" />
              <MoneyField name="paymentProcessingFees" label="Payment fees" />
              <MoneyField name="actualPostage" label="Actual postage" />
              <MoneyField name="suppliesCost" label="Supplies" />
              <MoneyField name="refundsAndAdjustments" label="Refunds / adjustments" />
              <Field label="Order ID">
                <input name="externalOrderId" className={inputClass} />
              </Field>
              <Field label="Notes">
                <input name="notes" className={inputClass} />
              </Field>
              <AdminSubmitButton
                disabled={Boolean(saleSaveDisabledReason)}
                disabledReason={saleSaveDisabledReason}
                title={
                  saleSaveDisabledReason ||
                  "Save this sale and recalculate realized gross profit."
                }
                className="rounded-2xl bg-black px-5 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-2"
                pendingChildren="Saving sale..."
              >
                Save Sale and Recalculate GP
              </AdminSubmitButton>
            </form>
          </div>

          <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm ring-1 ring-amber-950/5">
            <h2 className="text-xl font-black">Cost Basis Rule</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">
              Every card carries a {money(unitCost)} cost basis. Realized GP equals actual net
              proceeds minus sold-unit cost basis. Market value remains unrealized until a sale
              is recorded.
            </p>
          </section>
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Recorded Sales</h2>
          </div>
          {sales.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No sales recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3">Marketplace</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Gross</th>
                    <th className="px-5 py-3">Fees</th>
                    <th className="px-5 py-3">Postage</th>
                    <th className="px-5 py-3">Net</th>
                    <th className="px-5 py-3">Sale GP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {sales.map((sale) => {
                    const fees =
                      Number(sale.marketplace_fees || 0) +
                      Number(sale.payment_processing_fees || 0);
                    const saleGp =
                      Number(sale.net_proceeds || 0) - sale.quantity_sold * unitCost;
                    return (
                      <tr key={sale.id}>
                        <td className="px-5 py-4">
                          {new Date(sale.sold_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-4">
                          {sale.marketplace?.name || "—"}
                        </td>
                        <td className="px-5 py-4">{sale.quantity_sold}</td>
                        <td className="px-5 py-4">{money(sale.gross_item_sales)}</td>
                        <td className="px-5 py-4">{money(fees)}</td>
                        <td className="px-5 py-4">{money(sale.actual_postage)}</td>
                        <td className="px-5 py-4 font-black">
                          {money(sale.net_proceeds)}
                        </td>
                        <td className="px-5 py-4 font-black">{money(saleGp)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-sm font-black text-neutral-700">
      {label}
      {children}
    </label>
  );
}

function MoneyField({ name, label }: { name: string; label: string }) {
  return (
    <Field label={label}>
      <input
        name={name}
        type="number"
        min="0"
        step="0.01"
        defaultValue="0.00"
        className={inputClass}
      />
    </Field>
  );
}

function Metric({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${valueClassName}`}>{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-cyan-200 bg-white p-3 shadow-sm ring-1 ring-cyan-950/5">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-100 pb-2 last:border-b-0">
      <dt className="font-semibold text-neutral-600">{label}</dt>
      <dd className={strong ? "text-right font-black" : "text-right font-bold"}>{value}</dd>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={
        tone === "success"
          ? "rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-950 shadow-sm ring-1 ring-emerald-950/5"
          : "rounded-2xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950 shadow-sm ring-1 ring-rose-950/5"
      }
    >
      {children}
    </div>
  );
}
