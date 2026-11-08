import Link from "next/link";
import FullStoreSyncPanel from "./FullStoreSyncPanel";

export const dynamic = "force-dynamic";

export default function FullStoreSyncPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff7ed_0,#f8fafc_38%,#eef2ff_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-7">
        <section className="rounded-3xl border-2 border-neutral-950 bg-neutral-950 px-6 py-8 text-white shadow-[7px_7px_0_#ffd633] lg:px-10">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-yellow-300">
                Truely Collectables inventory launch
              </p>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Full eBay Store Sync
              </h1>
              <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-300">
                Read every active fixed-price eBay listing, import the sports cards missing from Truely Collectables, and keep the existing Stripe checkout, paid-order, shipping, and tracking workflow intact.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/inventory"
                className="border-2 border-white px-5 py-3 text-sm font-black text-white hover:bg-white hover:text-neutral-950"
              >
                Inventory Bridge
              </Link>
              <Link
                href="/admin/orders"
                className="border-2 border-neutral-950 bg-yellow-300 px-5 py-3 text-sm font-black text-neutral-950"
              >
                Orders & Shipping
              </Link>
            </div>
          </div>
        </section>

        <section className="border-2 border-amber-300 bg-amber-50 px-5 py-4 text-sm font-bold leading-6 text-amber-950">
          Launch sequence: preview the complete eBay store, confirm the missing-card count, apply with ended-listing deactivation off, then inspect several imported products and one controlled checkout before enabling stricter cleanup.
        </section>

        <FullStoreSyncPanel />
      </div>
    </main>
  );
}
