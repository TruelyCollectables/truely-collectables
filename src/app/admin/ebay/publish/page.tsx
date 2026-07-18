import Link from "next/link";
import EbayPublisher from "./EbayPublisher";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EbayPublishPage() {
  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-7 lg:flex-row lg:items-end lg:justify-between">
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
              className="rounded-lg border border-neutral-600 px-4 py-2 text-sm font-black hover:bg-neutral-800"
            >
              eBay dashboard
            </Link>
            <Link
              href="/admin"
              className="rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
            >
              Command Center
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-6 py-7">
        <section className="mb-6 rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 text-amber-950">
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
