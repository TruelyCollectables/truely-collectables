import Link from "next/link";
import { getMarketIntelPurchaseLedger } from "../../../../lib/market-intel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

export default async function MarketIntelPurchaseLedgerPage() {
  let rows;

  try {
    rows = await getMarketIntelPurchaseLedger();
  } catch (error) {
    return <MarketIntelRuntimeError error={error} />;
  }

  const totals = rows.reduce(
    (sum, row) => {
      sum.invested += Number(row.lot.total_acquisition_cost || 0);
      sum.netProceeds += Number(row.performance?.realized_net_proceeds || 0);
      sum.realizedProfit += Number(row.performance?.realized_gross_profit || 0);
      sum.remaining += Number(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      return sum;
    },
    { invested: 0, netProceeds: 0, realizedProfit: 0, remaining: 0 },
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                TCOS Market Intel™ Beta One
              </p>
              <h1 className="mt-2 text-4xl font-black">Purchase Ledger</h1>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
                Track delivered cost, quantity sold, net proceeds, break-even progress,
                and actual gross profit for every Beta One purchase.
              </p>
            </div>
            <Link
              href="/admin"
              className="w-fit rounded-md border border-neutral-600 px-4 py-2 text-sm font-black hover:bg-white hover:text-black"
            >
              Back to Admin
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total Invested" value={money(totals.invested)} />
          <Metric label="Realized Net Proceeds" value={money(totals.netProceeds)} />
          <Metric label="Realized Gross Profit" value={money(totals.realizedProfit)} />
          <Metric label="Units Remaining" value={String(totals.remaining)} />
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Active Purchase Lots</h2>
          </div>

          {rows.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No purchases recorded.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Purchase</th>
                    <th className="px-5 py-3">Collectible</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Cost</th>
                    <th className="px-5 py-3">Unit Cost</th>
                    <th className="px-5 py-3">Sold / Left</th>
                    <th className="px-5 py-3">Net Proceeds</th>
                    <th className="px-5 py-3">Realized GP</th>
                    <th className="px-5 py-3">Break-even</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {rows.map(({ lot, performance }) => {
                    const progress = Number(
                      performance?.cash_break_even_progress_pct || 0,
                    );
                    return (
                      <tr key={lot.id} className="align-top hover:bg-amber-50/40">
                        <td className="px-5 py-4">
                          <Link
                            href={`/admin/market-intel/purchases/${lot.id}`}
                            className="font-black text-blue-700 hover:underline"
                          >
                            #{lot.purchase_number}
                          </Link>
                          <div className="mt-1 text-xs text-neutral-500">
                            {new Date(lot.purchased_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="max-w-md px-5 py-4">
                          <div className="font-black">
                            {lot.collectible?.display_name || "Unmatched collectible"}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-neutral-500">
                            {lot.marketplace?.name || "Unknown source"}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-bold">{label(lot.status)}</td>
                        <td className="px-5 py-4 font-bold">
                          {money(lot.total_acquisition_cost)}
                        </td>
                        <td className="px-5 py-4">{money(lot.unit_cost_basis)}</td>
                        <td className="px-5 py-4">
                          {performance?.quantity_sold || 0} /{" "}
                          {performance?.quantity_remaining ?? lot.quantity_purchased}
                        </td>
                        <td className="px-5 py-4">
                          {money(performance?.realized_net_proceeds)}
                        </td>
                        <td className="px-5 py-4 font-black">
                          {money(performance?.realized_gross_profit)}
                        </td>
                        <td className="px-5 py-4">
                          <div className="w-40">
                            <div className="mb-1 flex justify-between text-xs font-bold text-neutral-500">
                              <span>{progress.toFixed(1)}%</span>
                              <span>
                                {money(
                                  Math.max(
                                    0,
                                    Number(
                                      performance?.dollars_to_cash_break_even || 0,
                                    ),
                                  ),
                                )}{" "}
                                left
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-neutral-200">
                              <div
                                className="h-2 rounded-full bg-emerald-500"
                                style={{ width: `${Math.min(100, progress)}%` }}
                              />
                            </div>
                          </div>
                        </td>
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

function MarketIntelRuntimeError({ error }: { error: unknown }) {
  const serviceKeyPresent = Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  const message = error instanceof Error ? error.message : "Unknown database error";

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-10 text-neutral-950">
      <div className="mx-auto max-w-3xl rounded-xl border border-rose-300 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">
          TCOS Market Intel™ Beta One
        </p>
        <h1 className="mt-2 text-3xl font-black">Ledger connection failed</h1>
        <p className="mt-3 font-semibold text-neutral-700">
          The application deployed correctly, but the server could not read the private
          Market Intel database tables.
        </p>
        <dl className="mt-6 space-y-3 rounded-lg bg-neutral-100 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="font-black">Server Supabase key present</dt>
            <dd>{serviceKeyPresent ? "YES" : "NO"}</dd>
          </div>
          <div>
            <dt className="font-black">Database response</dt>
            <dd className="mt-1 break-words font-mono text-xs text-rose-800">{message}</dd>
          </div>
        </dl>
        <p className="mt-5 text-sm font-semibold text-neutral-700">
          Apply the Beta One service-role grant migration and confirm
          SUPABASE_SERVICE_ROLE_KEY is set in the Vercel Production environment, then
          redeploy.
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded-md bg-black px-4 py-2 font-black text-white"
        >
          Back to Admin
        </Link>
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
