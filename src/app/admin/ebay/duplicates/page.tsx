import Link from "next/link";
import EbayDuplicateFinderClient from "./EbayDuplicateFinderClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function EbayDuplicateFinderPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff7ed_0,#f4f1ea_34%,#eef2ff_100%)] text-neutral-950">
      <section className="border-b border-white/10 bg-[#101418] text-white shadow-2xl shadow-neutral-950/20">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">
              Duplicate Cleanup Desk
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Duplicate Finder
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-300">
              Find exact same-title/same-price active rows, keep one listing,
              end/archive the duplicate, and roll the quantity into the keeper.
            </p>
            <div className="mt-5 grid max-w-3xl gap-3 text-xs font-black uppercase tracking-[0.12em] text-neutral-200 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                Exact-match only
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                Quantity-safe merge
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 shadow-inner shadow-white/5">
                Bounded eBay cleanup
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/admin" label="Command Center" />
            <HeaderLink href="/admin/ebay/inventory-intake" label="Inventory Intake" primary />
            <HeaderLink href="/admin/ebay/import-runner" label="Import Runner" />
          </div>
        </div>
      </section>

      <EbayDuplicateFinderClient />
    </main>
  );
}

function HeaderLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-sm font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
        primary
          ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
          : "border border-white/20 bg-white/[0.03] text-white hover:bg-white/10"
      }`}
    >
      {label}
    </Link>
  );
}
