import Link from "next/link";
import KingmakerInstaCompQueue from "./KingmakerInstaCompQueue";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const healthCards = [
  {
    href: "/kingmaker/inventory",
    label: "Active Inventory",
    action: "Check live catalog →",
    detail: "Canonical cards synced across TCOS",
    borderClass: "border-t-4 border-t-[#22c55e]",
    badgeClass: "bg-emerald-500/15 text-emerald-300",
    badge: "LIVE",
  },
  {
    href: "/kingmaker/listings",
    label: "Master Listings",
    action: "Review channel queue →",
    detail: "Website, eBay & Mercari readiness",
    borderClass: "border-t-4 border-t-[#facc15]",
    badgeClass: "bg-yellow-400/15 text-yellow-300",
    badge: "QUEUE",
  },
  {
    href: "/kingmaker/pending",
    label: "Pending Review",
    action: "Open review queue →",
    detail: "0-comp items, condition & price locks",
    borderClass: "border-t-4 border-t-[#2563eb]",
    badgeClass: "bg-blue-500/15 text-blue-300",
    badge: "REVIEW",
  },
  {
    href: "/kingmaker/missing-picture",
    label: "Blocked / Missing Photo",
    action: "Fix blockers →",
    detail: "Missing front/back scan or repair",
    borderClass: "border-t-4 border-t-[#dc2626]",
    badgeClass: "bg-red-500/15 text-red-300",
    badge: "CHECK",
  },
] as const;

const workflow = [
  ["1", "Drop front + back", "KINGMAKER sends each card pair into InstaComp intake."],
  ["2", "InstaComp AI identifies", "Visual inspection locks year, set, player, parallel, and serial."],
  ["3", "365d comps + markup", "Live sold comps + 25% markup rounded to .99 (or 0-comp flag)."],
  ["4", "Master listing review", "Verify photos, lock operator price, and keep publish gated."],
  ["5", "Approve + publish", "Push selected cards to Website, eBay ($2.00+), and Mercari."],
] as const;

const queues = [
  {
    href: "/kingmaker/pending-receipts",
    title: "Pending Receipts",
    description: "Receive arrivals immediately; add front/back photos later without creating another purchase.",
  },
  {
    href: "/kingmaker/listings",
    title: "Master Listings",
    description: "Correct identity, review images and comps, lock operator price, and push to channels.",
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
    description: "Diagnostics and comp intelligence without creating a second scanner.",
  },
  {
    href: "/kingmaker/settings",
    title: "Settings & Logins",
    description: "Check eBay OAuth, Mercari TC profile, operator login, and engine guardrails.",
  },
] as const;

export default function KingmakerHomePage() {
  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#facc15]">
              KINGMAKER COMMAND CENTER
            </p>
            <h1 className="font-display mt-1 text-4xl font-extrabold uppercase tracking-tight text-white sm:text-5xl">
              One Card Workflow. One Source of Truth.
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
              Scan once, verify visual identity and 365-day comps, lock your operator price, and check every channel before publishing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/kingmaker/scan"
              className="rounded-lg bg-[#facc15] px-4 py-2.5 text-sm font-bold text-[#0f172a] hover:bg-[#eab308]"
            >
              Open Scan Intake
            </Link>
            <Link
              href="/kingmaker/listings"
              className="rounded-lg border border-slate-700 bg-[#1e293b] px-4 py-2.5 text-sm font-bold text-white hover:border-[#facc15]"
            >
              Master Listings
            </Link>
          </div>
        </section>

        <section
          className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Inventory and channel health"
        >
          {healthCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className={`group rounded-xl border border-slate-800 bg-[#0f172a] p-4 transition hover:-translate-y-0.5 hover:border-slate-600 ${card.borderClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  {card.label}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${card.badgeClass}`}>
                  {card.badge}
                </span>
              </div>
              <p className="font-display mt-3 text-xl font-extrabold uppercase tracking-wide text-white group-hover:text-[#facc15]">
                {card.action}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{card.detail}</p>
            </Link>
          ))}
        </section>

        <section
          className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="KINGMAKER card workflow"
        >
          {workflow.map(([number, title, description]) => (
            <div key={number} className="rounded-xl border border-slate-800 bg-[#0f172a]/80 p-4">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#facc15] font-display text-sm font-extrabold text-[#0f172a]">
                {number}
              </div>
              <h2 className="mt-2.5 text-sm font-bold text-white">{title}</h2>
              <p className="mt-1.5 text-xs leading-5 text-slate-400">{description}</p>
            </div>
          ))}
        </section>

        <KingmakerInstaCompQueue />

        <section className="mt-8">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              Work queues
            </p>
            <h2 className="font-display mt-1 text-2xl font-extrabold uppercase tracking-wide text-white">
              Jump straight to any stage
            </h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {queues.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl border border-slate-800 bg-[#0f172a] p-5 transition hover:-translate-y-0.5 hover:border-[#facc15]"
              >
                <h3 className="font-bold text-white">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-400">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-7 rounded-xl border border-amber-500/30 bg-amber-950/20 p-5 text-amber-100">
          <h2 className="font-bold text-[#facc15]">Seller approval remains the publication gate</h2>
          <p className="mt-1.5 text-sm leading-6 text-amber-100/80">
            InstaComp identifies, comps, and prepares the draft. Operator Price Locks are never overwritten, and cards are never published without explicit seller action.
          </p>
        </section>
      </div>
    </main>
  );
}
