import Link from "next/link";
import QuickListWorkbench from "./QuickListWorkbench";

export const dynamic = "force-dynamic";

export default function QuickListPage() {
  return (
    <main className="min-h-screen bg-[#f6f4ef] px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-white shadow-xl">
          <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1fr_auto] lg:items-end lg:px-10 lg:py-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">
                Truely Collectables inventory intake
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Quick List + InstaComp™
              </h1>
              <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-300">
                Drop front and back card photos. AI identifies the exact card while InstaComp™ finds pricing evidence. Review the result, choose the price, and create a private inventory draft without filling out a long listing form.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide">
                <span className="rounded-full bg-white/10 px-3 py-2">Front/back pairing</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Adaptive multi-AI</span>
                <span className="rounded-full bg-white/10 px-3 py-2">InstaComp™ price ready</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Serials shown as /print-run</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Draft-only safety</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/products"
                className="rounded-xl border border-neutral-700 px-5 py-3 text-sm font-black text-white hover:border-white"
              >
                Inventory
              </Link>
              <Link
                href="/admin/instacomp"
                className="rounded-xl bg-yellow-300 px-5 py-3 text-sm font-black text-neutral-950 hover:bg-yellow-200"
              >
                Full Scan Lab
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold leading-6 text-amber-950">
          <strong>Listing rule:</strong> a stamped card read as <span className="line-through opacity-60">50/89</span> is titled as <strong>/89</strong>. Quick List keeps the exact stamped copy number in scan evidence but uses only the print run in the customer-facing title.
        </section>

        <QuickListWorkbench />
      </div>
    </main>
  );
}
