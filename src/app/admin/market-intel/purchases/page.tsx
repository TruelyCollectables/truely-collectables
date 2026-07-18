import Link from "next/link";
import { addAdminHandoff } from "../../../../lib/admin-handoff";
import { createAdminSessionValue } from "../../../../lib/admin-session";
import {
  getPurchaseLedgerIntelligence,
  portfolioBucketLabel,
  type PortfolioBucket,
  type PurchaseResearchSignal,
} from "../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ bucket?: string }>;
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
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function strategyTone(bucket: PortfolioBucket) {
  if (bucket === "hold") {
    return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-950";
  }
  if (bucket === "pc") {
    return "border-amber-300 bg-amber-50 text-amber-950";
  }
  return "border-blue-300 bg-blue-50 text-blue-950";
}

function movementTone(value: number | null) {
  if (value === null) return "text-neutral-500";
  if (value > 0) return "text-emerald-700";
  if (value < 0) return "text-rose-700";
  return "text-neutral-700";
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

export default async function MarketIntelPurchaseLedgerPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const bucket: PortfolioBucket | "all" = ["resale", "hold", "pc"].includes(
    String(query?.bucket || ""),
  )
    ? (query?.bucket as PortfolioBucket)
    : "all";
  const adminHandoff = await createAdminSessionValue();
  const adminHref = (href: string) => addAdminHandoff(href, adminHandoff);

  let allRows: Awaited<ReturnType<typeof getPurchaseLedgerIntelligence>>;
  try {
    allRows = await getPurchaseLedgerIntelligence();
  } catch (error) {
    return <MarketIntelRuntimeError adminHref={adminHref} error={error} />;
  }

  const rows =
    bucket === "all" ? allRows : allRows.filter((row) => row.bucket === bucket);
  const totals = rows.reduce(
    (sum, row) => {
      sum.invested += Number(row.lot.total_acquisition_cost || 0);
      sum.netProceeds += Number(row.performance?.realized_net_proceeds || 0);
      sum.realizedProfit += Number(row.performance?.realized_gross_profit || 0);
      sum.remaining += Number(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      if (row.current_market?.conservative_value !== null && row.current_market) {
        const remaining = Number(
          row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
        );
        sum.estimatedMarket +=
          Number(row.current_market.conservative_value || 0) * remaining;
      }
      return sum;
    },
    {
      invested: 0,
      netProceeds: 0,
      realizedProfit: 0,
      remaining: 0,
      estimatedMarket: 0,
    },
  );
  const strategyTotals = allRows.reduce(
    (sum, row) => {
      sum[row.bucket] += Number(row.lot.total_acquisition_cost || 0);
      return sum;
    },
    { resale: 0, hold: 0, pc: 0 },
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-[1500px] px-6 py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
                TCOS Market Intel™ Portfolio Control Center
              </p>
              <h1 className="mt-2 text-4xl font-black">Purchase Ledger</h1>
              <p className="mt-2 max-w-4xl text-sm font-semibold text-neutral-300">
                Edit strategy, open InstaComp™, compare current value with purchase-date
                evidence, watch weekly movement, and manage Resale, Hold, and Personal
                Collection positions from one screen.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={adminHref("/admin/market-intel/purchases/new")}
                className="rounded-md bg-amber-400 px-4 py-2 text-sm font-black text-black"
              >
                Add Card Show / Shop Purchase
              </Link>
              <Link
                href={adminHref("/admin/market-intel/purchases/ebay-intake")}
                className="rounded-md bg-lime-700 px-4 py-2 text-sm font-black text-white"
              >
                Add eBay Purchase
              </Link>
              <Link
                href={adminHref("/admin/market-intel/portfolio")}
                className="rounded-md border border-cyan-400 px-4 py-2 text-sm font-black text-cyan-200"
              >
                Portfolio Intelligence
              </Link>
              <Link
                href={adminHref("/admin")}
                className="rounded-md border border-neutral-600 px-4 py-2 text-sm font-black hover:bg-white hover:text-black"
              >
                Back to Admin
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric
            label={`${bucket === "all" ? "Total" : portfolioBucketLabel(bucket)} Invested`}
            value={money(totals.invested)}
          />
          <Metric label="Estimated Market" value={money(totals.estimatedMarket)} />
          <Metric label="Realized Net Proceeds" value={money(totals.netProceeds)} />
          <Metric label="Realized Gross Profit" value={money(totals.realizedProfit)} />
          <Metric label="Units Remaining" value={String(totals.remaining)} />
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Metric label="Resale Cost Basis" value={money(strategyTotals.resale)} />
          <Metric label="Hold / Investment Cost Basis" value={money(strategyTotals.hold)} />
          <Metric label="Personal Collection Cost Basis" value={money(strategyTotals.pc)} />
        </section>

        <nav className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <BucketLink href={adminHref("/admin/market-intel/purchases")} active={bucket === "all"}>
            All Purchases ({allRows.length})
          </BucketLink>
          <BucketLink
            href={adminHref("/admin/market-intel/purchases?bucket=resale")}
            active={bucket === "resale"}
          >
            Resale ({allRows.filter((row) => row.bucket === "resale").length})
          </BucketLink>
          <BucketLink
            href={adminHref("/admin/market-intel/purchases?bucket=hold")}
            active={bucket === "hold"}
          >
            Hold / Investment ({allRows.filter((row) => row.bucket === "hold").length})
          </BucketLink>
          <BucketLink
            href={adminHref("/admin/market-intel/purchases?bucket=pc")}
            active={bucket === "pc"}
          >
            Personal Collection ({allRows.filter((row) => row.bucket === "pc").length})
          </BucketLink>
        </nav>

        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-5 text-cyan-950">
          <h2 className="text-xl font-black">Research signal boundary</h2>
          <p className="mt-1 text-sm font-semibold leading-6">
            Buy, sell, cooling, and momentum labels are research prompts based on verified
            exact-card comps, cost basis, sample size, and seven-day movement. They are not
            guaranteed outcomes and should always be checked against the newest sales and fees.
          </p>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">
              {bucket === "all" ? "Tracked Purchase Positions" : portfolioBucketLabel(bucket)}
            </h2>
          </div>

          {rows.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">
              No purchases in this strategy bucket.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1750px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Purchase</th>
                    <th className="px-4 py-3">Collectible</th>
                    <th className="px-4 py-3">Strategy</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Cost</th>
                    <th className="px-4 py-3">Unit Cost</th>
                    <th className="px-4 py-3">Current Market</th>
                    <th className="px-4 py-3">7-Day Move</th>
                    <th className="px-4 py-3">Since Purchase</th>
                    <th className="px-4 py-3">Sold / Left</th>
                    <th className="px-4 py-3">TCOS Signal</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {rows.map((row) => {
                    const { lot, performance } = row;
                    return (
                      <tr key={lot.id} className="align-top hover:bg-amber-50/40">
                        <td className="px-4 py-4">
                          <Link
                            href={adminHref(`/admin/market-intel/purchases/${lot.id}`)}
                            className="font-black text-blue-700 hover:underline"
                          >
                            #{lot.purchase_number}
                          </Link>
                          <div className="mt-1 text-xs text-neutral-500">
                            {new Date(lot.purchased_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="max-w-md px-4 py-4">
                          <div className="font-black">
                            {lot.collectible?.display_name || "Unmatched collectible"}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-black ${strategyTone(row.bucket)}`}
                          >
                            {portfolioBucketLabel(row.bucket)}
                          </span>
                        </td>
                        <td className="max-w-52 px-4 py-4 font-bold capitalize">
                          {row.source_label}
                        </td>
                        <td className="px-4 py-4 font-bold">{label(lot.status)}</td>
                        <td className="px-4 py-4 font-bold">
                          {money(lot.total_acquisition_cost)}
                        </td>
                        <td className="px-4 py-4">{money(lot.unit_cost_basis)}</td>
                        <td className="px-4 py-4">
                          <div className="font-black">
                            {money(row.current_market?.conservative_value)}
                          </div>
                          <div className="mt-1 text-xs text-neutral-500">
                            {row.current_market
                              ? `${row.current_market.sample_size} comps · ${row.current_market.confidence_score.toFixed(0)}%`
                              : "No market snapshot"}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-4 text-base font-black ${movementTone(row.weekly_change_pct)}`}
                        >
                          {percentage(row.weekly_change_pct)}
                        </td>
                        <td
                          className={`px-4 py-4 text-base font-black ${movementTone(row.since_purchase_change_pct)}`}
                        >
                          {percentage(row.since_purchase_change_pct)}
                          <div className="mt-1 text-xs font-semibold text-neutral-500">
                            Baseline {money(row.purchase_market?.conservative_value)}
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          {performance?.quantity_sold || 0} /{" "}
                          {performance?.quantity_remaining ?? lot.quantity_purchased}
                        </td>
                        <td className="max-w-64 px-4 py-4">
                          <span
                            title={row.signal.explanation}
                            className={`inline-flex rounded-md border px-3 py-2 text-xs font-black ${signalTone(row.signal)}`}
                          >
                            {row.signal.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex min-w-44 flex-col gap-2">
                            <Link
                              href={adminHref(`/admin/market-intel/purchases/${lot.id}`)}
                              className="rounded-md bg-black px-3 py-2 text-center text-xs font-black text-white"
                            >
                              Open Position
                            </Link>
                            {lot.collectible_identity_id ? (
                              <Link
                                href={adminHref(
                                  `/admin/market-intel/comps/${lot.collectible_identity_id}?from=purchase-ledger`,
                                )}
                                className="rounded-md border border-cyan-500 bg-cyan-50 px-3 py-2 text-center text-xs font-black text-cyan-950"
                              >
                                InstaComp™ / Sold Comps
                              </Link>
                            ) : null}
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

function BucketLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-black px-4 py-2 text-sm font-black text-white"
          : "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-100"
      }
    >
      {children}
    </Link>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function MarketIntelRuntimeError({
  adminHref,
  error,
}: {
  adminHref: (href: string) => string;
  error: unknown;
}) {
  const message = error instanceof Error ? error.message : "Unknown database error";
  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-10 text-neutral-950">
      <div className="mx-auto max-w-3xl rounded-xl border border-rose-300 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-700">
          TCOS Market Intel™
        </p>
        <h1 className="mt-2 text-3xl font-black">Ledger connection failed</h1>
        <p className="mt-3 break-words font-mono text-xs text-rose-800">{message}</p>
        <Link
          href={adminHref("/admin")}
          className="mt-6 inline-block rounded-md bg-black px-4 py-2 font-black text-white"
        >
          Back to Admin
        </Link>
      </div>
    </main>
  );
}
