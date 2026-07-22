import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { getMarketIntelPortfolio } from "../../../../lib/market-intel-portfolio";

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

function percentage(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

function label(value: string | null | undefined) {
  return String(value || "not set").replaceAll("_", " ").toUpperCase();
}

export default async function MarketIntelPortfolioPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const { positions, totals } = await getMarketIntelPortfolio();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.13),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Portfolio Intelligence
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Actual cash invested and realized GP stay separate from estimated market
            value. Unsold inventory is marked as unrealized gross spread until a real
            sale locks the number in.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Capital Invested" value={money(totals.invested)} />
          <Metric
            label="Realized Net Proceeds"
            value={money(totals.realizedNetProceeds)}
          />
          <Metric
            label="Realized Gross Profit"
            value={money(totals.realizedGrossProfit)}
          />
          <Metric label="Units Remaining" value={String(totals.unitsRemaining)} />
          <Metric
            label="Remaining Cost Basis"
            value={money(totals.remainingCostBasis)}
          />
          <Metric
            label="Estimated Market Value"
            value={money(totals.estimatedRemainingMarketValue)}
          />
          <Metric
            label="Unrealized Gross Spread"
            value={money(totals.unrealizedGrossSpread)}
          />
          <Metric
            label="Combined Gross Return"
            value={`${money(totals.combinedGrossReturn)} · ${percentage(
              totals.combinedRoiPct,
            )}`}
          />
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
          <h2 className="text-xl font-black">Actual GP rule</h2>
          <p className="mt-1 text-sm font-semibold leading-6">
            Realized GP uses actual net sale proceeds minus the cost basis of units sold.
            Estimated market value and unrealized spread are research signals only and
            never replace actual sale results.
          </p>
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-col gap-4 border-b border-neutral-200 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-black">Tracked Positions</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                Every purchase, remaining unit, current exact-card value, and realized result.
              </p>
            </div>
            <Link
              href={addAdminHandoff("/admin/market-intel/buy", handoff)}
              className="w-fit rounded-full bg-black px-4 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
            >
              Open Buy Desk
            </Link>
          </div>

          {positions.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">
              No purchase positions have been recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1450px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Purchase</th>
                    <th className="px-5 py-3">Collectible</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Invested</th>
                    <th className="px-5 py-3">Qty Sold / Left</th>
                    <th className="px-5 py-3">Market / Unit</th>
                    <th className="px-5 py-3">Market Evidence</th>
                    <th className="px-5 py-3">Remaining Cost</th>
                    <th className="px-5 py-3">Estimated Value</th>
                    <th className="px-5 py-3">Realized GP</th>
                    <th className="px-5 py-3">Unrealized Spread</th>
                    <th className="px-5 py-3">Combined Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {positions.map((position) => (
                    <tr key={position.lot.id}>
                      <td className="px-5 py-4">
                        <Link
                          href={addAdminHandoff(
                            `/admin/market-intel/purchases/${position.lot.id}`,
                            handoff,
                          )}
                          className="font-black text-cyan-800 hover:underline"
                        >
                          #{position.lot.purchase_number}
                        </Link>
                        <p className="mt-1 text-xs font-semibold text-neutral-500">
                          {new Date(position.lot.purchased_at).toLocaleDateString()}
                        </p>
                      </td>
                      <td className="max-w-sm px-5 py-4">
                        <p className="font-black">
                          {position.lot.collectible?.display_name ||
                            "Unmatched collectible"}
                        </p>
                        <p className="mt-1 text-xs font-semibold text-neutral-500">
                          {position.lot.marketplace?.name || "Unknown source"}
                        </p>
                      </td>
                      <td className="px-5 py-4 font-black">
                        {label(position.lot.status)}
                      </td>
                      <td className="px-5 py-4">
                        {money(position.lot.total_acquisition_cost)}
                      </td>
                      <td className="px-5 py-4">
                        {position.performance?.quantity_sold || 0} /{" "}
                        {position.performance?.quantity_remaining ??
                          position.lot.quantity_purchased}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(position.current_market_unit)}
                      </td>
                      <td className="px-5 py-4">
                        {position.market_sample_size} comps ·{" "}
                        {position.market_confidence.toFixed(0)}% confidence
                      </td>
                      <td className="px-5 py-4">
                        {money(position.remaining_cost_basis)}
                      </td>
                      <td className="px-5 py-4">
                        {money(position.estimated_remaining_market_value)}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(position.performance?.realized_gross_profit)}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(position.unrealized_gross_spread)}
                      </td>
                      <td className="px-5 py-4 font-black">
                        {money(position.combined_gross_return)} ·{" "}
                        {percentage(position.combined_roi_pct)}
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
