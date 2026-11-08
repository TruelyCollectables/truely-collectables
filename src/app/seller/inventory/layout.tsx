import Link from "next/link";
import type { ReactNode } from "react";
import InstaCompStoreActions from "./InstaCompStoreActions";
import InventoryQueryNavigationGuard from "./InventoryQueryNavigationGuard";

export default function SellerInventoryLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <InventoryQueryNavigationGuard />
      <section className="border-b-4 border-sky-300 bg-gradient-to-r from-sky-950 via-slate-950 to-emerald-950 px-4 py-5 text-white sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-sky-300/60 bg-sky-300/15 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-sky-200">
                  InstaComp™
                </span>
                <span className="rounded-full border border-emerald-300/50 bg-emerald-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-200">
                  Verified Cards → Pending Listings
                </span>
              </div>
              <h2 className="mt-3 text-2xl font-black tracking-tight sm:text-3xl">
                InstaComp Store Command Center
              </h2>
              <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-200">
                Check inventory rows and run InstaComp Selected, or scan every store
                card with an image. Results are written back to inventory without
                changing price, quantity, status, or publishing anything. Human-approved
                serial numbers and grader certification records remain attached through
                listing, sale, and post-sale tracking.
              </p>
            </div>

            <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
              <Link
                href="/seller/instacomp-pending"
                className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 shadow-sm hover:bg-sky-200"
              >
                Open InstaComp Pending Listings
              </Link>
              <Link
                href="/admin/instacomp"
                className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
              >
                InstaComp Scan Lab
              </Link>
              <Link
                href="/admin/verified-reference-import"
                className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
              >
                Import Verified Cards
              </Link>
              <Link
                href="/seller/collectible-assets"
                className="rounded-full border border-emerald-300/50 bg-emerald-300/10 px-4 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-300/20"
              >
                Collectible Lifecycle
              </Link>
            </div>
          </div>

          <div className="mt-4">
            <InstaCompStoreActions />
          </div>
        </div>
      </section>
      {children}
    </>
  );
}
