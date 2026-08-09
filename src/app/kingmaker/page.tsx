import Link from "next/link";
import KingmakerInstaCompQueue from "./KingmakerInstaCompQueue";

const workflow = [
  ["1", "Drop front + back", "KINGMAKER sends one card pair into the real InstaComp intake."],
  ["2", "InstaComp AI identifies", "Internal visual intelligence + Checklist Registry lock the exact card identity."],
  ["3", "Exact comps + price", "Approved external market evidence is used only after identity is locked."],
  ["4", "Pending review", "Edit any wrong field, verify images, choose the listing price, and keep publication blocked."],
  ["5", "Approve + learn", "Your final confirmed identity is stored as trusted InstaComp AI teacher truth."],
] as const;

const queues = [
  {
    href: "/kingmaker/pending",
    title: "Pending",
    description: "Correct identity, review images and comps, choose price, and finish the listing.",
  },
  {
    href: "/kingmaker/inventory",
    title: "Inventory",
    description: "Cards that have completed intake and moved into canonical inventory.",
  },
  {
    href: "/kingmaker/orders",
    title: "Orders",
    description: "Sold-card fulfillment and order work after publication.",
  },
  {
    href: "/kingmaker/intelligence",
    title: "InstaComp Intelligence",
    description: "Diagnostics and supporting intelligence without creating a second scanner.",
  },
] as const;

export default function KingmakerHomePage() {
  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <section>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
            KINGMAKER
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
            One card workflow. One permanent UUID. One final truth.
          </h1>
          <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-300">
            Scan once here. InstaComp AI identifies the card in-house, the Registry locks identity,
            the comp engine establishes value, and KINGMAKER carries the same physical card into Pending,
            listing review, publication, and trusted learning.
          </p>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="KINGMAKER card workflow">
          {workflow.map(([number, title, description]) => (
            <div key={number} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 font-black text-slate-950">
                {number}
              </div>
              <h2 className="mt-3 font-black">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
            </div>
          ))}
        </section>

        <KingmakerInstaCompQueue />

        <section className="mt-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
              Work queues
            </p>
            <h2 className="mt-1 text-2xl font-black">Pick up where each card is now</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {queues.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-emerald-500 hover:bg-slate-900"
              >
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-7 rounded-2xl border border-amber-800 bg-amber-950/20 p-5 text-amber-100">
          <h2 className="font-black">Seller approval remains the publication gate</h2>
          <p className="mt-2 leading-7 text-amber-100/80">
            InstaComp can identify, comp, price, and prepare the draft. It cannot publish a card or replace an operator-confirmed identity without an explicit seller action.
          </p>
        </section>
      </div>
    </main>
  );
}
