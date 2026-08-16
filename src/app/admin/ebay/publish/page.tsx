import Link from "next/link";
import InventoryEbayPublisher from "./InventoryEbayPublisher";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EbayPublishPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.14),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1600px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.24),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-300">
              Truely Collectables outbound channels
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Inventory → site → eBay listing manager
            </h1>
            <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-neutral-300">
              Work from the real inventory table, choose exactly which cards go to eBay,
              keep a lower direct-site price, and use either the site description or an
              eBay-only override without changing the TruelyCollectables copy.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/quick-list"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
            >
              Scan / InstaComp cards
            </Link>
            <Link
              href="/admin/products"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
            >
              Inventory
            </Link>
            <Link
              href="/admin/ebay"
              className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-emerald-200"
            >
              eBay dashboard
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1600px] py-6">
        <section className="mb-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
          <p className="text-xs font-black uppercase tracking-[0.16em]">Publishing guard</p>
          <h2 className="mt-1 text-xl font-black">Only checked cards are sent to eBay</h2>
          <p className="mt-2 text-sm font-bold leading-6">
            Front and back images are required. Live eBay publishing still requires an
            explicit confirmation, and Buy It Now cards that are also live on
            TruelyCollectables must keep the eBay price above the direct-site price.
          </p>
        </section>
        <InventoryEbayPublisher />
      </div>
    </main>
  );
}
