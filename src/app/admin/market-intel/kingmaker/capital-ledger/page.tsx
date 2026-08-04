import Link from "next/link";
import { getPurchaseLedgerIntelligence } from "../../../../../lib/market-intel-purchase-intelligence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `$${Number(value).toFixed(2)}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function KingmakerCapitalLedgerPage() {
  const result = await getPurchaseLedgerIntelligence()
    .then((rows) => ({ ok: true as const, rows }))
    .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
  const rows = result.ok ? result.rows : [];
  const totals = rows.reduce((sum, row) => {
    const remaining = numberValue(row.performance?.quantity_remaining ?? row.lot.quantity_purchased);
    sum.invested += numberValue(row.lot.total_acquisition_cost);
    sum.realizedNet += numberValue(row.performance?.realized_net_proceeds);
    sum.realizedProfit += numberValue(row.performance?.realized_gross_profit);
    sum.unitsRemaining += remaining;
    if (row.current_market?.conservative_value !== null && row.current_market) sum.currentValue += numberValue(row.current_market.conservative_value) * remaining;
    return sum;
  }, { invested: 0, realizedNet: 0, realizedProfit: 0, unitsRemaining: 0, currentValue: 0 });

  const resale = rows.filter((row) => row.bucket === "resale").length;
  const hold = rows.filter((row) => row.bucket === "hold").length;
  const personal = rows.filter((row) => row.bucket === "pc").length;
  const researchDebt = rows.filter((row) => ["needs_comps", "low_confidence"].includes(row.signal.key)).length;

  return (
    <main className="min-h-screen bg-[#05070a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_5%,rgba(16,185,129,.14),transparent_30%),radial-gradient(circle_at_88%_8%,rgba(217,119,6,.17),transparent_28%),linear-gradient(180deg,#070b10,#020304)]" />
      <div className="relative mx-auto max-w-[1650px]">
        <header className="rounded-[2rem] border border-white/10 bg-black/70 p-6 shadow-2xl backdrop-blur-xl lg:p-9">
          <Link href="/admin/market-intel/kingmaker" className="inline-flex rounded-full border border-white/15 bg-white/[.06] px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-neutral-200 hover:bg-white/10">← Project KINGMAKER Beta 1.0</Link>
          <p className="mt-7 text-xs font-black uppercase tracking-[.3em] text-amber-300">Capital Ledger</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-6xl">Purchase Ledger Command</h1>
          <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">Canonical money truth for confirmed purchases, delivered cost, receiving, units sold, units remaining, realized return, verified value, and position signals.</p>
          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Capital Deployed" value={money(totals.invested)} />
            <Metric label="Verified Value" value={money(totals.currentValue)} />
            <Metric label="Realized Net" value={money(totals.realizedNet)} />
            <Metric label="Realized Profit" value={money(totals.realizedProfit)} />
            <Metric label="Units Remaining" value={String(totals.unitsRemaining)} />
            <Metric label="Positions" value={String(rows.length)} />
          </div>
        </header>

        {!result.ok ? <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5"><p className="text-xs font-black uppercase tracking-[.2em] text-rose-300">Truth Gate Failure</p><h2 className="mt-1 text-2xl font-black">Portfolio totals withheld</h2><p className="mt-2 font-semibold text-rose-100/80">{result.error}</p></section> : null}

        <section className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DeskCard title="Resale Positions" value={String(resale)} detail="Active resale inventory and capital rotation." />
          <DeskCard title="Hold / Investment" value={String(hold)} detail="Longer-duration positions separated from flip capital." />
          <DeskCard title="Personal Collection" value={String(personal)} detail="Tracked without automatic sell pressure." />
          <DeskCard title="Research Debt" value={String(researchDebt)} detail="Positions lacking enough exact evidence for decision-grade value." />
        </section>

        <section className="mt-5 rounded-[1.75rem] border border-white/10 bg-white/[.035] p-5 lg:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Canonical Positions</p><h2 className="mt-1 text-3xl font-black">Latest Capital Positions</h2></div><Link href="/admin/market-intel/purchases" className="w-fit rounded-full bg-amber-300 px-4 py-2.5 text-sm font-black text-black hover:bg-amber-200">Open Full Ledger</Link></div>
          {rows.length === 0 ? <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-6"><p className="text-xl font-black">No canonical purchase positions loaded.</p><p className="mt-2 font-semibold text-neutral-400">Discoveries remain opportunities until a real purchase and out-the-door cost are confirmed.</p></div> : <div className="mt-6 space-y-3">{rows.slice(0, 10).map((row) => <article key={row.lot.id} className="rounded-2xl border border-white/10 bg-black/30 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">Purchase #{row.lot.purchase_number}</span><h3 className="mt-3 truncate text-xl font-black">{row.lot.collectible?.display_name || "Unresolved collectible position"}</h3><p className="mt-1 text-sm font-semibold text-neutral-400">Cost {money(row.lot.total_acquisition_cost)} · Unit {money(row.lot.unit_cost_basis)} · Signal {row.signal.label}</p></div><Link href={`/admin/market-intel/purchases/${row.lot.id}`} className="shrink-0 rounded-full border border-white/15 bg-white/[.06] px-4 py-2.5 text-sm font-black hover:bg-white/10">Open Position</Link></div></article>)}</div>}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-black/35 px-5 py-4"><p className="text-[10px] font-black uppercase tracking-[.18em] text-neutral-500">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div>; }
function DeskCard({ title, value, detail }: { title: string; value: string; detail: string }) { return <article className="rounded-[1.4rem] border border-white/10 bg-white/[.035] p-5"><p className="text-3xl font-black text-amber-300">{value}</p><h2 className="mt-2 text-xl font-black">{title}</h2><p className="mt-2 text-sm font-semibold leading-6 text-neutral-500">{detail}</p></article>; }
