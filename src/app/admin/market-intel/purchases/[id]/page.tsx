import Link from "next/link";
import { notFound } from "next/navigation";
import AdminSubmitButton from "../../../AdminSubmitButton";
import { addAdminHandoff } from "../../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../../lib/admin-session";
import { getMarketIntelPurchaseDetail } from "../../../../../lib/market-intel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const money = (value: number | null | undefined) =>
  `$${Number(value || 0).toFixed(2)}`;
const label = (value: string | null | undefined) =>
  value ? value.replaceAll("_", " ").toUpperCase() : "NOT SET";
const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:border-black";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
};

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
  const remaining = performance?.quantity_remaining ?? lot.quantity_purchased;
  const unitCost = Number(lot.unit_cost_basis || 0);
  const progress = Number(performance?.cash_break_even_progress_pct || 0);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={adminHref("/admin/market-intel/purchases")}
            className="text-sm font-black text-amber-300 hover:underline"
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
            <span>{lot.marketplace?.name || "Unknown source"}</span>
            <span>•</span>
            <span>{new Date(lot.purchased_at).toLocaleDateString()}</span>
            <span>•</span>
            <span>{label(lot.status)}</span>
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
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "1" ? (
          <Notice tone="success">Sale saved and gross profit recalculated.</Notice>
        ) : null}
        {query?.saved === "received" ? (
          <Notice tone="success">Purchase moved into inventory.</Notice>
        ) : null}
        {query?.error ? <Notice tone="error">{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="Total Cost" value={money(lot.total_acquisition_cost)} />
          <Metric label="Unit Cost" value={money(unitCost)} />
          <Metric label="Units Remaining" value={String(remaining)} />
          <Metric label="Realized GP" value={money(performance?.realized_gross_profit)} />
          <Metric label="Cash Break-even" value={`${progress.toFixed(1)}%`} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Record a Sale</h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  Enter actual sale money and expenses. Beta One calculates net proceeds and GP.
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
                    className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-700"
                    pendingChildren="Marking received..."
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
                disabled={remaining <= 0}
                className="rounded-md bg-black px-5 py-3 font-black text-white hover:bg-neutral-800 disabled:opacity-40 sm:col-span-2"
                pendingChildren="Saving sale..."
              >
                Save Sale and Recalculate GP
              </AdminSubmitButton>
            </form>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-black">Position Summary</h2>
              <dl className="mt-5 space-y-3 text-sm">
                <Row label="Quantity purchased" value={String(lot.quantity_purchased)} />
                <Row label="Quantity sold" value={String(performance?.quantity_sold || 0)} />
                <Row label="Quantity remaining" value={String(remaining)} />
                <Row label="Remaining cost basis" value={money(remaining * unitCost)} />
                <Row label="Gross item sales" value={money(performance?.gross_item_sales)} />
                <Row label="Realized net proceeds" value={money(performance?.realized_net_proceeds)} />
                <Row label="Realized gross profit" value={money(performance?.realized_gross_profit)} strong />
                <Row
                  label="Dollars to break-even"
                  value={money(
                    Math.max(
                      0,
                      Number(
                        performance?.dollars_to_cash_break_even ??
                          lot.total_acquisition_cost,
                      ),
                    ),
                  )}
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
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
              <h2 className="text-xl font-black">Cost Basis Rule</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">
                Every card carries a {money(unitCost)} cost basis. Realized GP equals net proceeds minus sold-unit cost basis.
              </p>
            </section>
          </aside>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
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
                        <td className="px-5 py-4">{new Date(sale.sold_at).toLocaleDateString()}</td>
                        <td className="px-5 py-4">{sale.marketplace?.name || "—"}</td>
                        <td className="px-5 py-4">{sale.quantity_sold}</td>
                        <td className="px-5 py-4">{money(sale.gross_item_sales)}</td>
                        <td className="px-5 py-4">{money(fees)}</td>
                        <td className="px-5 py-4">{money(sale.actual_postage)}</td>
                        <td className="px-5 py-4 font-black">{money(sale.net_proceeds)}</td>
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
        defaultValue="0"
        className={inputClass}
      />
    </Field>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-neutral-200 pb-3">
      <dt className="font-semibold text-neutral-600">{label}</dt>
      <dd className={strong ? "font-black text-emerald-700" : "font-black"}>{value}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={
        tone === "success"
          ? "rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900"
          : "rounded-md border border-rose-300 bg-rose-50 px-4 py-3 font-bold text-rose-900"
      }
    >
      {children}
    </div>
  );
}
