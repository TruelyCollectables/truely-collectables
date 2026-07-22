import Link from "next/link";
import TruelyAccuracyWorkbench from "./TruelyAccuracyWorkbench";

export const dynamic = "force-dynamic";

export default function QuickListPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f5f3ff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
          <div className="grid gap-8 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.28),transparent_34%),linear-gradient(135deg,#0f172a,#111827_55%,#1f2937)] px-6 py-8 lg:grid-cols-[1fr_auto] lg:items-end lg:px-10 lg:py-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">
                Truely Collectables private inventory system
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Accuracy Council + InstaComp™
              </h1>
              <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-300">
                Accuracy comes before speed. Every card receives two independent front/back courtroom scans, up to ten AI judgments, OCR and checklist referees, exact-comp filtering, and a disagreement report before it can earn a green approval.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide">
                <span className="rounded-full bg-white/10 px-3 py-2">Truely Collectables only</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Two independent councils</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Up to 10 AI judgments</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Exact-card comp gate</span>
                <span className="rounded-full bg-white/10 px-3 py-2">100-card 98% benchmark</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/products"
                className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
              >
                Inventory
              </Link>
              <Link
                href="/admin/instacomp"
                className="rounded-full bg-violet-200 px-5 py-3 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-violet-100"
              >
                Full Scan Lab
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50/90 px-5 py-4 text-sm font-bold leading-6 text-amber-950 shadow-sm">
          <strong>Serial rule:</strong> a stamped card read as <span className="line-through opacity-60">50/89</span> is titled as <strong>/89</strong>. The exact stamped copy number stays in private scan evidence. AI can identify an autograph card, but it does not authenticate who physically signed the item.
        </section>

        <TruelyAccuracyWorkbench />
      </div>
    </main>
  );
}
