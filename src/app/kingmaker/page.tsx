import Link from "next/link";
import KingmakerInstaCompQueue from "./KingmakerInstaCompQueue";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const workflow = [
  ["1", "Resale Pending", "Scanned or received cards enter Resale Pending, separate from your Investment Stash."],
  ["2", "Identify", "Confirm exact year, set, player, card #, parallel, and serial with front + back photos."],
  ["3", "Comping", "Pull 365-day sold comps, apply markup or manual price, and sync all 3 marketplace prices."],
  ["4", "Resale Pending → List", "Publish to Website, eBay, Mercari, or All 3 — or run bulk sales by channel or sport."],
] as const;

const queues = [
  {
    href: "/kingmaker/listings?folder=pending",
    title: "Master Listings",
    description: "Resale Pending, Investment Stash, all live channel folders, recomping, and bulk sales.",
  },
  {
    href: "/kingmaker/scan",
    title: "Scan Cards",
    description: "Drop front + back card scans to identify, comp, and stage into Resale Pending.",
  },
  {
    href: "/kingmaker/inventory",
    title: "Inventory",
    description: "Full catalog of active, draft, and investment cards.",
  },
  {
    href: "/kingmaker/orders",
    title: "Orders",
    description: "Sold-card fulfillment and order management.",
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
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Command Center
          </h1>
          <p className="mt-2 max-w-3xl text-base leading-7 text-slate-300">
            Resale Pending → Identify → Comping → Resale Pending. Keep Investment Stash separate, audit every channel folder, and run recomping or targeted sales across Website, eBay, and Mercari.
          </p>
        </section>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="KINGMAKER card workflow">
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
          <h2 className="text-xl font-black">Workspaces</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
      </div>
    </main>
  );
}
