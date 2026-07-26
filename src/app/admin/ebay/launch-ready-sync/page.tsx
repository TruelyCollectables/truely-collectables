import Link from "next/link";
import LaunchReadySyncClient from "./LaunchReadySyncClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LaunchReadySyncPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-neutral-300 pb-5">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.16em] text-neutral-500">
              Truely Collectables Admin
            </p>
            <h1 className="mt-2 text-4xl font-black">eBay Launch Readiness</h1>
            <p className="mt-2 max-w-3xl text-neutral-600">
              One controlled workflow for catalog synchronization, photos, pricing, Best Offers, shipping policy and exact launch blockers.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ebay"
              className="rounded-xl border border-neutral-300 bg-white px-4 py-3 font-black"
            >
              eBay Reconciliation
            </Link>
            <Link
              href="/admin/ebay/sync-control"
              className="rounded-xl border border-neutral-300 bg-white px-4 py-3 font-black"
            >
              Sync Control
            </Link>
          </div>
        </div>

        <LaunchReadySyncClient />
      </div>
    </main>
  );
}
