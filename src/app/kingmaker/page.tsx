import Link from "next/link";

const primaryActions = [
  {
    href: "/kingmaker/scan",
    title: "Scan Cards",
    description:
      "Capture front and back photos, lock exact Registry identity, run verified comps, and create a Pending Listing.",
  },
  {
    href: "/kingmaker/pending",
    title: "Pending Listings",
    description:
      "Review identity, evidence, listing content, price, readiness blockers, and publish decisions.",
  },
  {
    href: "/kingmaker/inventory",
    title: "Inventory",
    description:
      "Manage seller inventory through the existing canonical inventory workspace.",
  },
  {
    href: "/kingmaker/intelligence",
    title: "Intelligence",
    description:
      "See the shared InstaComp capabilities that research, compare, score, and recommend.",
  },
] as const;

const operatingLanes = [
  ["Identity", "Central Checklist Registry"],
  ["Intelligence", "InstaComp AI"],
  ["Workflow and approval", "KINGMAKER"],
  ["Seller actions", "Authenticated and audited"],
] as const;

export default function KingmakerHomePage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
          KINGMAKER Command Center
        </p>
        <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
          Run the seller workflow from one place.
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
          Scan, identify, research, price, review, list, and manage the sale without creating a second intelligence engine or identity authority.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-2">
          {primaryActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 transition hover:border-emerald-500 hover:bg-slate-900"
            >
              <h2 className="text-xl font-black">{action.title}</h2>
              <p className="mt-2 leading-7 text-slate-400">{action.description}</p>
            </Link>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
          <h2 className="text-xl font-black">One authority chain</h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {operatingLanes.map(([term, value]) => (
              <div key={term} className="rounded-xl bg-slate-950 p-4">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {term}
                </dt>
                <dd className="mt-2 font-black text-slate-100">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-6 rounded-2xl border border-amber-800 bg-amber-950/20 p-6 text-amber-100">
          <h2 className="font-black">Consequential actions remain seller-controlled</h2>
          <p className="mt-2 leading-7 text-amber-100/80">
            InstaComp can analyze and recommend. It cannot publish, activate inventory, accept offers, change orders, or bypass seller review.
          </p>
        </section>
      </div>
    </main>
  );
}
