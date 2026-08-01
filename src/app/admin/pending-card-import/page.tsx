import Link from "next/link";
import PendingCardImportClient from "./PendingCardImportClient";
import SimpleListingQueue from "../../list/SimpleListingQueue";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PendingCardImportPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f2e8_0%,#ffffff_36%,#f6f2e8_100%)] px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-[1500px]">
        <header className="rounded-3xl border-2 border-neutral-950 bg-neutral-950 p-6 text-white shadow-[9px_9px_0_#facc15] sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-yellow-300">
                Permanent owner card workflow
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-6xl">
                Card Intake & Listing
              </h1>
              <p className="mt-3 max-w-4xl text-lg font-semibold leading-8 text-neutral-300">
                Import any future front/back card package as unpublished drafts, watch live progress, review the pending queue, run InstaComp 2.0, set pricing, and publish selected cards from one workflow.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/instacomp/v2"
                className="inline-flex min-h-12 items-center justify-center rounded-xl bg-yellow-300 px-5 py-3 font-black text-neutral-950"
              >
                InstaComp 2.0
              </Link>
              <Link
                href="/admin"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border-2 border-white bg-white px-5 py-3 font-black text-neutral-950"
              >
                Back to Admin
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["1", "Load any card package"],
              ["2", "Watch live import status"],
              ["3", "Review, price, and list"],
            ].map(([number, label]) => (
              <div key={number} className="rounded-2xl border border-white/20 bg-white/10 p-4">
                <span className="text-2xl font-black text-yellow-300">{number}</span>
                <p className="mt-1 font-black">{label}</p>
              </div>
            ))}
          </div>
        </header>

        <div className="mt-8 grid gap-8">
          <PendingCardImportClient />
          <SimpleListingQueue />
        </div>
      </div>
    </main>
  );
}
