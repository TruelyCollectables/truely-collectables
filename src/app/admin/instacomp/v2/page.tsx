import Link from "next/link";
import type { Metadata } from "next";
import MobileInstaCompScanner from "../mobile/MobileInstaCompScanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InstaComp 2.0 | Truely Collectables Admin",
  description:
    "InstaComp 2.0 decision workbench for exact card identity, market evidence, deal math, and listing preparation.",
  robots: { index: false, follow: false },
};

export default function InstaCompV2Page() {
  return (
    <main
      data-instacomp-version="2.0"
      className="min-h-screen bg-neutral-100 text-neutral-950"
    >
      <header className="border-b border-white/10 bg-neutral-950 text-white shadow-lg">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              Truely Collectables decision workbench
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              InstaComp™ 2.0
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-300 sm:text-base">
              Identify the exact card, inspect the market evidence, enter the real
              acquisition costs, and get a defensible buy, offer, review, grade,
              list, or pass decision.
            </p>
          </div>
          <nav className="flex shrink-0 flex-wrap gap-2" aria-label="InstaComp navigation">
            <Link
              href="/admin/instacomp"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
            >
              Scan Lab
            </Link>
            <Link
              href="/list"
              className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
            >
              List Cards
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-6 sm:py-7">
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <ValueCard
            label="Decision, not a lookup"
            text="Every completed scan ends with a plain call and the reasons behind it."
          />
          <ValueCard
            label="Real deal math"
            text="Buying price, fees, shipping, supplies, projected profit, margin, and ROI stay editable."
          />
          <ValueCard
            label="Evidence first"
            text="Identity confidence, exact comps, supply, velocity, trends, and graded evidence stay visible."
          />
        </section>

        <MobileInstaCompScanner />
      </div>
    </main>
  );
}

function ValueCard({ label, text }: { label: string; text: string }) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 className="font-black">{label}</h2>
      <p className="mt-1 text-sm font-semibold leading-5 text-neutral-600">
        {text}
      </p>
    </article>
  );
}
