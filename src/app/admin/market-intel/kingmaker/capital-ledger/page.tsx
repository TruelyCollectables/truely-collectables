import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../lib/admin-handoff";
import { getPurchaseLedgerIntelligence } from "../../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function KingmakerCapitalLedgerPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];

  let rows: Awaited<ReturnType<typeof getPurchaseLedgerIntelligence>> = [];
  let loadError: string | null = null;
  try {
    rows = await getPurchaseLedgerIntelligence();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Purchase Ledger could not load.";
  }

  const totals = rows.reduce(
    (sum, row) => {
      const remaining = numberValue(
        row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
      );
      sum.invested += numberValue(row.lot.total_acquisition_cost);
      sum.realizedNet += numberValue(row.performance?.realized_net_proceeds);
      sum.realizedProfit += numberValue(row.performance?.realized_gross_profit);
      sum.unitsRemaining += remaining;
      if (row.current_market?.conservative_value !== null && row.current_market) {
        sum.currentValue +=
          numberValue(row.current_market.conservative_value) * remaining;
      }
      return sum;
    },
    {
      invested: 0,
      realizedNet: 0,
      realizedProfit: 0,
      unitsRemaining: 0,
      currentValue: 0,
    },
  );

  const resale = rows.filter((row) => row.bucket === "resale");
  const hold = rows.filter((row) => row.bucket === "hold");
  const pc = rows.filter((row) => row.bucket === "pc");
  const sellSignals = rows.filter((row) =>
    ["sell_window", "take_profit_watch"].includes(row.signal.key),
  );
  const researchDebt = rows.filter((row) =>
    ["needs_comps", "low_confidence"].includes(row.signal.key),
  );

  return (
    <main className="min-h-screen bg-[#05070a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_5%,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(217,119,6,0.17),transparent_28%),linear-gradient(180deg,#070b10_0%,#020304_100%)]" />
      <div className="relative mx-auto max-w-[1650px]">
        <header className="rounded-[2rem] border border-white/10 bg-black/70 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.6)] backdrop-blur-xl lg:p-9">
          <Link
            href={addAdminHandoff("/admin/market-intel/kingmaker", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-200 transition hover:bg-white/10"
          >
            ← Project KINGMAKER Beta 1.0
          </Link>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.3em] text-amber-300">
            Capital Ledger
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
            Purchase Ledger Command
          </h1>
          <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
            The Purchase Ledger is now the canonical money record under KINGMAKER. Every
            confirmed deal-watch purchase becomes a position here with delivered cost,
            receiving, units sold, units remaining, realized return, current verified value,
            and an owner decision signal.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Capital Deployed" value={money(totals.invested)} />
            <Metric label="Current Verified Value" value={money(totals.currentValue)} />
            <Metric label="Realized Net" value={money(totals.realizedNet)} />
            <Metric label="Realized Gross Profit" value={money(totals.realizedProfit)} />
            <Metric label="Units Remaining" value={String(totals.unitsRemaining)} />
            <Metric label="Tracked Positions" value={String(rows.length)} />
          </div>
        </header>

        {loadError ? (
          <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-300">
              Truth Gate Failure
            </p>
            <h2 className="mt-1 text-2xl font-black">Portfolio totals withheld</h2>
            <p className="mt-2 font-semibold text-rose-100/80">{loadError}</p>
          </section>
        ) : null}

        <section className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DeskCard title="Resale Positions" value={String(resale.length)} detail="Inventory intended for active resale and capital rotation." />
          <DeskCard title="Hold / Investment" value={String(hold.length)} detail="Longer-duration positions separated from immediate flip capital." />
          <DeskCard title="Personal Collection" value={String(pc.length)} detail="Tracked for value and movement without automatic sell pressure." />
          <DeskCard title="Research Debt" value={String(researchDebt.length)} detail="Positions missing enough exact verified evidence for a defensible market value." />
        </section>

        <section className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_0.42fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/20 lg:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
                  Canonical Positions
                </p>
                <h2 className="mt-1 text-3xl font-black">Latest Capital Positions</h2>
              </div>
              <Link
                href={addAdminHandoff("/admin/market-intel/purchases", handoff)}
                className="w-fit rounded-full bg-amber-300 px-4 py-2.5 text-sm font-black text-black transition hover:bg-amber-200"
              >
                Open Full Ledger
              </Link>
            </div>

            {rows.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-6">
                <p className="text-xl font-black">No canonical purchase positions loaded.</p>
                <p className="mt-2 font-semibold text-neutral-400">
                  Deal-watch discoveries remain opportunities until you confirm the purchase
                  and actual out-the-door cost.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {rows.slice(0, 10).map((row) => {
                  const remaining = numberValue(
                    row.performance?.quantity_remaining ?? row.lot.quantity_purchased,
                  );
                  return (
                    <article
                      key={row.lot.id}
                      className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">
                              Purchase #{row.lot.purchase_number}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
                              {row.bucket}
                            </span>
                            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-300">
                              {row.signal.label}
                            </span>
                          </div>
                          <h3 className="mt-2 truncate text-xl font-black">
                            {row.lot.collectible?.display_name || "Unresolved collectible position"}
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-neutral-400">
                            Cost {money(row.lot.total_acquisition_cost)} · Unit {money(row.lot.unit_cost_basis)} · Remaining {remaining} · Current unit {money(row.current_market?.conservative_value)}
                          </p>
                        </div>
                        <Link
                          href={addAdminHandoff(`/admin/market-intel/purchases/${row.lot.id}`, handoff)}
                          className="shrink-0 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10"
                        >
                          Open Position
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="space-y-5">
            <CommandCard
              eyebrow="Exit Desk"
              title={`${sellSignals.length} sell signal${sellSignals.length === 1 ? "" : "s"}`}
              detail="Positions above cost or cooling enough to require an owner exit review."
              href={addAdminHandoff("/admin/market-intel/purchases?bucket=resale", handoff)}
            />
            <CommandCard
              eyebrow="Add Position"
              title="Record a confirmed purchase"
              detail="Use the real total out-the-door cost. Search results never create purchases automatically."
              href={addAdminHandoff("/admin/market-intel/purchases/new", handoff)}
            />
            <CommandCard
              eyebrow="eBay Intake"
              title="Import an actual eBay purchase"
              detail="Convert a confirmed marketplace buy into a canonical capital position."
              href={addAdminHandoff("/admin/market-intel/purchases/ebay-intake", handoff)}
            />
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/35 px-5 py-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-black text-white">{value}</p>
    </div>
  );
}

function DeskCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <article className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-5">
      <p className="text-3xl font-black text-amber-300">{value}</p>
      <h2 className="mt-2 text-xl font-black">{title}</h2>
      <p className="mt-2 text-sm font-semibold leading-6 text-neutral-500">{detail}</p>
    </article>
  );
}

function CommandCard({ eyebrow, title, detail, href }: { eyebrow: string; title: string; detail: string; href: string }) {
  return (
    <article className="rounded-[1.4rem] border border-white/10 bg-white/[0.035] p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black">{title}</h2>
      <p className="mt-2 font-semibold leading-6 text-neutral-500">{detail}</p>
      <Link href={href} className="mt-5 inline-flex rounded-full border border-white/15 bg-white/[0.06] px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/10">
        Open
      </Link>
    </article>
  );
}
