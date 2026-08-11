import Link from "next/link";
import CollxImageImporter from "./CollxImageImporter";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminCollxImagesPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-sky-300">
                Truely Collectables media migration
              </p>
              <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">
                CollX Image Import
              </h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-7 text-neutral-300">
                Match the CollX collection export to existing eBay-backed inventory, copy proven front/back photos into Truely Collectables storage, and fail closed on ambiguous physical copies.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/products"
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-black text-white transition hover:bg-white/15"
              >
                Products
              </Link>
              <Link
                href="/admin"
                className="rounded-full bg-white px-4 py-2 text-sm font-black text-neutral-950 transition hover:bg-neutral-100"
              >
                Admin Home
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] py-6">
        <CollxImageImporter />
      </div>
    </main>
  );
}
