import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../lib/admin-handoff";
import {
  KINGMAKER_SEARCH_CONTRACT,
  KINGMAKER_SEARCH_SOURCES,
} from "../../../../../lib/kingmaker-search-registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

export default async function KingmakerSearchOperationsPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const active = KINGMAKER_SEARCH_SOURCES.filter((source) => source.status === "active");
  const planned = KINGMAKER_SEARCH_SOURCES.filter((source) => source.status === "planned");
  const marketplaces = new Set(
    KINGMAKER_SEARCH_SOURCES.flatMap((source) => source.marketplaces),
  );

  return (
    <main className="min-h-screen bg-[#05070a] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_10%_5%,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_90%_8%,rgba(217,119,6,0.16),transparent_28%),linear-gradient(180deg,#070b10_0%,#030405_100%)]" />
      <div className="relative mx-auto max-w-[1600px]">
        <header className="rounded-[2rem] border border-white/10 bg-black/70 p-6 shadow-[0_30px_100px_rgba(0,0,0,0.55)] backdrop-blur-xl lg:p-9">
          <Link
            href={addAdminHandoff("/admin/market-intel/kingmaker", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-neutral-200 transition hover:bg-white/10"
          >
            ← Project KINGMAKER Beta 1.0
          </Link>
          <p className="mt-7 text-xs font-black uppercase tracking-[0.3em] text-amber-300">
            Search Operations
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em] sm:text-6xl">
            Deal-Watch Command Network
          </h1>
          <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
            Every card, shoe, signed-ball, marketplace, and future trusted-seller search
            reports into one decision pipeline. Searches discover. KINGMAKER decides.
            The Purchase Ledger records. Outcomes teach.
          </p>

          <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-4">
            <Metric label="Active Watches" value={String(active.length)} />
            <Metric label="Planned Lanes" value={String(planned.length)} />
            <Metric label="Marketplaces" value={String(marketplaces.size)} />
            <Metric label="Auto Purchases" value="0" />
          </div>
        </header>

        <section className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {KINGMAKER_SEARCH_SOURCES.map((source) => (
            <article
              key={source.id}
              className="rounded-[1.5rem] border border-white/10 bg-white/[0.035] p-5 shadow-xl shadow-black/20"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500">
                    {source.lane.replaceAll("_", " ")}
                  </p>
                  <h2 className="mt-1 text-2xl font-black">{source.name}</h2>
                </div>
                <span
                  className={
                    source.status === "active"
                      ? "rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-300"
                      : "rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300"
                  }
                >
                  {source.status}
                </span>
              </div>
              <p className="mt-4 font-semibold leading-6 text-neutral-400">
                {source.description}
              </p>
              <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Detail label="Marketplace" value={source.marketplaces.join(", ")} />
                <Detail label="Cadence" value={source.cadence} />
                <Detail label="Decision destination" value="Acquisition Radar" />
                <Detail label="Confirmed purchase" value="Canonical Purchase Ledger" />
              </dl>
            </article>
          ))}
        </section>

        <section className="mt-5 rounded-[1.5rem] border border-emerald-300/20 bg-emerald-300/[0.07] p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
            KINGMAKER Search Contract
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-4">
            <Contract value={KINGMAKER_SEARCH_CONTRACT.discover} />
            <Contract value={KINGMAKER_SEARCH_CONTRACT.decide} />
            <Contract value={KINGMAKER_SEARCH_CONTRACT.record} />
            <Contract value={KINGMAKER_SEARCH_CONTRACT.learn} />
          </div>
          <p className="mt-5 text-sm font-bold text-emerald-100/75">
            No search may create an automatic purchase. Verified card recommendations
            require exact identity and at least two independent completed sales.
          </p>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/35 px-5 py-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black text-white">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.16em] text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 font-bold text-neutral-200">{value}</dd>
    </div>
  );
}

function Contract({ value }: { value: string }) {
  return (
    <div className="rounded-xl border border-emerald-300/15 bg-black/25 p-4 font-black text-emerald-100">
      {value}
    </div>
  );
}
