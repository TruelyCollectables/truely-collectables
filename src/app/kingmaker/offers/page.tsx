import Link from "next/link";

export default function KingmakerOffersPage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-fuchsia-300">
          Offers lane
        </p>
        <h1 className="mt-2 text-4xl font-black">Recommendations do not accept offers.</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">
          InstaComp may research identity, market evidence, margin, and likely sale outcomes. KINGMAKER must enforce seller authentication, permissions, review, and explicit approval before any offer action.
        </p>

        <section className="mt-8 rounded-2xl border border-fuchsia-900 bg-fuchsia-950/20 p-6">
          <h2 className="text-xl font-black">Current integration boundary</h2>
          <p className="mt-3 leading-7 text-fuchsia-100/80">
            This shell does not create a second offer engine. Existing inventory and order workspaces remain the operational source until the shared recommendation contract is connected to the authorized offer workflow.
          </p>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/kingmaker/inventory" className="rounded-xl bg-fuchsia-300 px-5 py-3 font-black text-slate-950">
            Open inventory
          </Link>
          <Link href="/kingmaker/orders" className="rounded-xl border border-slate-700 px-5 py-3 font-bold">
            Open orders
          </Link>
          <Link href="/kingmaker/intelligence" className="rounded-xl border border-slate-700 px-5 py-3 font-bold">
            Review intelligence boundary
          </Link>
        </div>
      </div>
    </main>
  );
}
