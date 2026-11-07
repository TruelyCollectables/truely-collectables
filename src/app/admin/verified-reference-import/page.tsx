import Link from "next/link";
import VerifiedReferenceImportWorkbench from "./VerifiedReferenceImportWorkbench";

export const dynamic = "force-dynamic";

export default function VerifiedReferenceImportPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#ecfdf5_0,#f8fafc_45%,#f5f3ff_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-7">
        <header className="rounded-[2rem] border border-neutral-900 bg-neutral-950 px-6 py-8 text-white shadow-2xl shadow-neutral-950/10 lg:px-10">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
            Truely Collectables private inventory intake
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
            Verified Reference → Pending Listings
          </h1>
          <p className="mt-4 max-w-4xl font-semibold leading-7 text-neutral-300">
            Import cards that were already reviewed in the InstaComp grading
            harness. Every result remains a private draft until price and final
            listing review are complete.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/admin/quick-list"
              className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-black"
            >
              Accuracy Council
            </Link>
            <Link
              href="/seller/inventory?status=draft&source=instacomp"
              className="rounded-full bg-emerald-300 px-5 py-3 text-sm font-black text-neutral-950"
            >
              Pending Listings
            </Link>
          </div>
        </header>

        <VerifiedReferenceImportWorkbench />
      </div>
    </main>
  );
}
