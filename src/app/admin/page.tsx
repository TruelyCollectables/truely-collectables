import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const oversight = [
  {
    href: "/admin/launch-readiness",
    title: "Launch Readiness",
    description: "Production blockers, launch checks, and release readiness.",
  },
  {
    href: "/admin/ebay/sync-control",
    title: "eBay Sync",
    description: "Store synchronization and marketplace transport controls.",
  },
  {
    href: "/admin/security",
    title: "Security",
    description: "Admin security, access, and operational protection.",
  },
  {
    href: "/admin/files",
    title: "Files",
    description: "Operational files and retained evidence outside the card workflow.",
  },
] as const;

const systemTools = [
  {
    href: "/admin/instacomp/checklist-sentinel",
    title: "Checklist Sentinel",
    description: "Checklist discovery, recovery, and Registry coverage controls.",
  },
  {
    href: "/admin/production-smoke",
    title: "Production Smoke",
    description: "Run the production-health workbench when something needs diagnosis.",
  },
  {
    href: "/admin/advanced",
    title: "Advanced Admin",
    description: "The full legacy command center is preserved here instead of cluttering Admin Home.",
  },
] as const;

export default function AdminPage() {
  return (
    <main className="min-h-[calc(100vh-72px)] bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="overflow-hidden rounded-3xl border border-neutral-900 bg-neutral-950 p-6 text-white shadow-xl sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-amber-300">
            Truely Collectables Admin
          </p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                Cards live in KINGMAKER. Admin stays simple.
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-neutral-300">
                Use KINGMAKER for scanning, InstaComp AI identification, Pending review,
                exact comps, pricing, listing, approval, and the confirmed learning loop.
                Admin Home is now reserved for store oversight and system tools.
              </p>
            </div>
            <Link
              href="/kingmaker"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-2xl bg-amber-300 px-7 py-4 text-lg font-black text-neutral-950 transition hover:bg-amber-200 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span aria-hidden="true">👑</span>
              Enter KINGMAKER
            </Link>
          </div>
        </section>

        <section className="mt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                Store oversight
              </p>
              <h2 className="mt-1 text-2xl font-black">Admin-only controls</h2>
            </div>
            <p className="max-w-xl text-sm font-semibold text-neutral-600">
              Day-to-day card work is intentionally not duplicated here.
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {oversight.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-neutral-400 hover:shadow-md"
              >
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-7 rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              System & recovery
            </p>
            <h2 className="mt-1 text-2xl font-black">Tools we still need, without the clutter</h2>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {systemTools.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 transition hover:border-neutral-400 hover:bg-white"
              >
                <h3 className="font-black">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
