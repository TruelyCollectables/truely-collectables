import Link from "next/link";
import { getKingmakerTruthHealth } from "../../../../lib/kingmaker-truth-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const modules = [
  ["Acquisition Radar", "/admin/market-intel/deals", "Verified opportunities, price drops, mislistings, and ending-soon targets."],
  ["Capital Ledger", "/admin/market-intel/kingmaker/capital-ledger", "Canonical purchases, delivered cost basis, receiving, sales, and position aging."],
  ["Market Truth Lab", "/admin/market-intel/comps", "Exact-card sold evidence, liquidity, confidence, break-even values, and direction."],
  ["Operations Control", "/admin/market-intel/readiness", "Freshness, reconciliation, ingestion failures, warnings, and fail-closed health."],
] as const;

export default async function KingmakerPage() {
  const healthResult = await getKingmakerTruthHealth()
    .then((value) => ({ ok: true as const, value }))
    .catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }));
  const health = healthResult.ok ? healthResult.value : null;
  const ready = Boolean(health?.ready);

  return (
    <main className="min-h-screen bg-[#05070a] text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_12%_4%,rgba(16,185,129,.16),transparent_30%),radial-gradient(circle_at_88%_4%,rgba(245,158,11,.14),transparent_28%),linear-gradient(180deg,#080c11,#020304)]" />
      <div className="relative mx-auto max-w-[1680px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/70 shadow-2xl backdrop-blur-xl">
          <div className="p-6 lg:p-10">
            <Link href="/admin/market-intel" className="inline-flex rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-neutral-300 hover:bg-white/10">← Market Intel</Link>
            <p className="mt-8 text-xs font-black uppercase tracking-[.34em] text-amber-300">Project KINGMAKER Beta 1.0</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-6xl xl:text-7xl">Capital Intelligence Command</h1>
            <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">Truely Collectables’ private command center for acquisition intelligence, portfolio truth, risk control, and owner-approved decisions.</p>
          </div>
          <div className="grid divide-y divide-white/10 border-t border-white/10 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <Metric label="Truth Engine" value={ready ? "ONLINE" : "RESTRICTED"} good={ready} />
            <Metric label="Opportunities" value={String(health?.opportunities ?? 0)} good />
            <Metric label="Inconsistencies" value={String(health?.inconsistent ?? 0)} good={(health?.inconsistent ?? 1) === 0} />
            <Metric label="Last Truth Update" value={health?.lastUpdatedAt ? new Date(health.lastUpdatedAt).toLocaleString() : "No verified update"} good={Boolean(health?.lastUpdatedAt)} />
          </div>
        </header>

        {!ready ? (
          <section className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
            <p className="text-xs font-black uppercase tracking-[.2em] text-rose-300">Truth Gate Warning</p>
            <h2 className="mt-1 text-2xl font-black">Decision-grade output is restricted.</h2>
            <p className="mt-2 font-semibold text-rose-100/75">{healthResult.ok ? `${health?.inconsistent ?? 0} lifecycle record(s) require reconciliation.` : `KINGMAKER truth health could not load: ${healthResult.error}`}</p>
          </section>
        ) : null}

        <section className="mt-5 grid gap-5 lg:grid-cols-2 2xl:grid-cols-4">
          {modules.map(([title, href, detail], index) => (
            <Link key={title} href={href} className="group rounded-[1.6rem] border border-white/10 bg-white/[.035] p-6 transition hover:-translate-y-0.5 hover:border-emerald-300/30 hover:bg-white/[.055]">
              <p className="text-xs font-black tracking-[.22em] text-neutral-600">0{index + 1}</p>
              <h2 className="mt-5 text-2xl font-black group-hover:text-emerald-300">{title}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-neutral-400">{detail}</p>
              <p className="mt-6 text-sm font-black text-neutral-200">Enter command module →</p>
            </Link>
          ))}
        </section>

        <section className="mt-5 rounded-[1.75rem] border border-amber-300/20 bg-gradient-to-r from-amber-300/[.08] to-emerald-300/[.05] p-6 lg:p-8">
          <p className="text-xs font-black uppercase tracking-[.22em] text-amber-300">Operating Doctrine</p>
          <h2 className="mt-2 text-3xl font-black">Searches discover. KINGMAKER decides. Purchase Ledger owns. Outcomes teach.</h2>
          <p className="mt-3 max-w-5xl font-semibold leading-7 text-neutral-400">No opportunity becomes owned inventory without a real Purchase Ledger lot. No buy clears without exact identity, verified completed-sale truth, and explicit owner authorization.</p>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good: boolean }) {
  return <div className="bg-white/[.025] px-5 py-5"><p className="text-[10px] font-black uppercase tracking-[.18em] text-neutral-500">{label}</p><p className={`mt-2 text-xl font-black ${good ? "text-emerald-300" : "text-amber-300"}`}>{value}</p></div>;
}
