import Link from "next/link";
import CardListingWorkbench from "./CardListingWorkbench";

export const dynamic = "force-dynamic";

export default function QuickListPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#f5f3ff_0,#f8fafc_40%,#fff7ed_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
          <div className="grid gap-8 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.28),transparent_34%),linear-gradient(135deg,#0f172a,#111827_55%,#1f2937)] px-6 py-8 lg:grid-cols-[1fr_auto] lg:items-end lg:px-10 lg:py-10">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-violet-300">
                Truely Collectables listing workbench
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Multi-card InstaComp™ → inventory → eBay
              </h1>
              <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-300">
                Drop a batch of front-and-back card photos, visually verify every pair,
                run two independent InstaComp passes, set the direct-site and eBay prices,
                and decide card-by-card whether it belongs on TruelyCollectables, eBay, or both.
              </p>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-wide">
                <span className="rounded-full bg-white/10 px-3 py-2">Front/back confirmation</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Manual swap control</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Two InstaComp passes</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Separate channel pricing</span>
                <span className="rounded-full bg-white/10 px-3 py-2">Selected eBay publishing</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/ebay/publish"
                className="rounded-full bg-emerald-300 px-5 py-3 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-emerald-200"
              >
                eBay Channel Manager
              </Link>
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
          <strong>Front/back safety:</strong> filename pairs such as <strong>card-001-front.jpg</strong> and <strong>card-001-back.jpg</strong> are trusted automatically. Unnamed upload-order pairs are blocked from InstaComp until you confirm them. If the sides are reversed, use <strong>Swap Front ↔ Back</strong>; that resets the scan so the corrected images are the ones analyzed and saved.
        </section>

        <CardListingWorkbench />
      </div>
    </main>
  );
}
