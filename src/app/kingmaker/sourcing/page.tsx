import Link from "next/link";
import { INSTACOMP_CAPABILITIES } from "../../../lib/instacomp-capabilities";

export default function KingmakerSourcingPage() {
  const capability = INSTACOMP_CAPABILITIES.sourcing_analysis;
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-amber-300">
          Sourcing lane
        </p>
        <h1 className="mt-2 text-4xl font-black">Research before capital moves.</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">
          {capability.description} A sourcing result is a recommendation and evidence package—not an automatic purchase.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["1", "Lock identity", "Use an exact Registry identity before margin analysis for a specific collectible."],
            ["2", "Research evidence", "Separate verified sold evidence, active competition, fees, and rejected candidates."],
            ["3", "Seller decision", "KINGMAKER presents buy, pass, or review; the seller remains the execution authority."],
          ].map(([step, title, detail]) => (
            <article key={step} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <span className="text-xs font-black text-amber-300">STEP {step}</span>
              <h2 className="mt-2 text-lg font-black">{title}</h2>
              <p className="mt-2 leading-6 text-slate-400">{detail}</p>
            </article>
          ))}
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/kingmaker/scan" className="rounded-xl bg-amber-300 px-5 py-3 font-black text-slate-950">
            Scan a candidate
          </Link>
          <Link href="/kingmaker/intelligence" className="rounded-xl border border-slate-700 px-5 py-3 font-bold">
            Review capabilities
          </Link>
        </div>
      </div>
    </main>
  );
}
