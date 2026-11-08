import Link from "next/link";
import EbayPublisher from "./EbayPublisher";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EbayPublishPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">
              eBay outbound publishing
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Pitch Black listing launcher
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-300">
              Your exact front-and-back scans are loaded. Create reviewable eBay drafts or
              deliberately publish each listing live without retyping titles, prices, or
              item specifics.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/ebay"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
            >
              eBay dashboard
            </Link>
            <Link
              href="/admin"
              className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-amber-200"
            >
              Command Center
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] py-6">
        <section className="mb-6 rounded-3xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
          <p className="text-xs font-black uppercase tracking-[0.16em]">Safety lock</p>
          <h2 className="mt-1 text-xl font-black">Nothing goes live automatically</h2>
          <p className="mt-2 text-sm font-bold leading-6">
            The publisher prevents duplicate SKUs and requires a separate confirmation for
            every live listing. Start with “Create eBay draft” when reviewing a policy for
            the first time.
          </p>
        </section>
        <EbayPublisher />
      </div>
    </main>
  );
}
