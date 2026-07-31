import Link from "next/link";
import type { Metadata, Viewport } from "next";
import InstaCompScanner from "../InstaCompScanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mobile InstaComp Scan | Truely Collectables",
  description:
    "Phone-first InstaComp workspace for scanning, identifying, comping, and pricing trading cards.",
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function MobileInstaCompPage() {
  return (
    <main className="min-h-dvh bg-neutral-100 pb-[max(1rem,env(safe-area-inset-bottom))] text-neutral-950">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">
              Phone scan workspace
            </p>
            <h1 className="truncate text-xl font-black tracking-tight">
              InstaComp™ Mobile
            </h1>
          </div>

          <Link
            href="/admin/instacomp"
            className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white active:bg-white/20"
          >
            Full Lab
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-3 py-3 sm:px-4">
        <section className="mb-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">
            Scan from your phone
          </p>
          <p className="mt-1 text-sm font-semibold leading-5 text-cyan-950">
            Take clear front and back photos, add detail shots for serial numbers,
            autographs, patches, or grading labels, then run InstaComp to identify
            the exact card and pull pricing evidence.
          </p>
        </section>

        <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm [&_button]:min-h-11 [&_input]:text-base [&_select]:text-base [&_textarea]:text-base">
          <InstaCompScanner />
        </section>

        <nav className="mt-3 grid grid-cols-2 gap-3" aria-label="Mobile InstaComp shortcuts">
          <Link
            href="/admin/products"
            className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-center text-sm font-black shadow-sm active:bg-neutral-50"
          >
            Products
          </Link>
          <Link
            href="/admin"
            className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-center text-sm font-black shadow-sm active:bg-neutral-50"
          >
            Command Center
          </Link>
        </nav>
      </div>
    </main>
  );
}
