import Link from "next/link";
import type { Metadata, Viewport } from "next";
import InstaCompScanner from "../InstaCompScanner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "InstaComp Mobile | Truely Collectables",
  description:
    "Phone-first InstaComp workspace for scanning, comping, editing, and preparing trading cards for listing.",
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

const workflow = [
  {
    step: "1",
    title: "Add card photos",
    detail: "Use your phone camera for front, back, serial, autograph, patch, or grading-label images.",
  },
  {
    step: "2",
    title: "Run current InstaComp",
    detail: "The page uses the same live InstaComp scanner and API as the main lab, including every future engine update.",
  },
  {
    step: "3",
    title: "Review market evidence",
    detail: "Check sold comps separately from current listings, including the prices and marketplace links returned by the live providers.",
  },
  {
    step: "4",
    title: "Edit and prepare listing",
    detail: "Correct the title, player, year, brand, set, card number, parallel, serial, sport, team, condition, quantity, and price before creating the website draft.",
  },
];

export default function MobileInstaCompPage() {
  return (
    <main className="min-h-dvh bg-neutral-100 pb-[max(1rem,env(safe-area-inset-bottom))] text-neutral-950">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-neutral-950/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-300">
              Scan → comp → edit → draft
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
            Add cards from your phone
          </p>
          <p className="mt-1 text-sm font-semibold leading-5 text-cyan-950">
            Photograph a card, run the latest InstaComp identification and comp search, review sold and active market evidence, edit the listing fields, and create a website-ready draft.
          </p>
        </section>

        <section className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {workflow.map((item) => (
            <article
              key={item.step}
              className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-neutral-950 text-sm font-black text-white">
                  {item.step}
                </span>
                <div>
                  <h2 className="font-black">{item.title}</h2>
                  <p className="mt-1 text-sm font-semibold leading-5 text-neutral-600">
                    {item.detail}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </section>

        <section className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">
            Market totals
          </p>
          <p className="mt-1 text-sm font-semibold leading-5 text-amber-950">
            Sold results and current listings remain separate. Use sold totals for market value; use current listing prices as availability evidence. When a provider supplies shipping, the displayed marketplace total should be treated as item price plus shipping; otherwise it remains an approximate item-price comparison.
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
