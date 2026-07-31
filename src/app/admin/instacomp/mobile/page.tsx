import Link from "next/link";
import type { Metadata, Viewport } from "next";
import MobileInstaCompScanner from "./MobileInstaCompScanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InstaComp 2.0 | Truely Collectables",
  description:
    "Portrait-first InstaComp 2.0 workspace for exact identification, market evidence, deal math, and card listing decisions.",
  robots: { index: false, follow: false },
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
    <main
      data-instacomp-mobile-revision="portrait-v2"
      data-live-verification="final-pass"
      data-instacomp-version="2.0"
      className="min-h-dvh w-full max-w-full overflow-x-hidden bg-neutral-100 pb-[max(1rem,env(safe-area-inset-bottom))] text-neutral-950"
    >
      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/95 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-lg backdrop-blur">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">
              Scan → verify → decide → list
            </p>
            <h1 className="truncate text-xl font-black tracking-tight">
              InstaComp™ 2.0
            </h1>
          </div>
          <Link
            href="/admin"
            className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white active:bg-white/20"
          >
            Admin
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-3 py-3">
        <section className="mb-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">
            Built for portrait mode · InstaComp 2.0 decisions
          </p>
          <p className="mt-1 text-sm font-semibold leading-5 text-cyan-950">
            Scan one card, verify the exact identity, see sold comps and current
            listings, enter estimated shipping and actual buying costs, then get
            approximate totals plus a buy, offer, review, or pass call.
          </p>
        </section>

        <MobileInstaCompScanner />

        <nav className="mt-4 grid grid-cols-2 gap-3" aria-label="InstaComp shortcuts">
          <Link href="/list" className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-center text-sm font-black shadow-sm">
            List Cards
          </Link>
          <Link href="/admin/products" className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-center text-sm font-black shadow-sm">
            Products
          </Link>
        </nav>
      </div>
    </main>
  );
}
