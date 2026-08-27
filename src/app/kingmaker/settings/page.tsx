import Link from "next/link";

const settingsLinks = [
  {
    href: "/account",
    title: "Account and seller profile",
    detail: "Authentication, seller profile, collection, and account settings.",
  },
  {
    href: "/kingmaker/marketplaces",
    title: "Marketplace connections",
    detail: "Review marketplace connector status and staged import operations.",
  },
  {
    href: "/kingmaker/payouts",
    title: "Payouts",
    detail: "Review onboarding, holds, cash-out readiness, and payout requests.",
  },
] as const;

export default function KingmakerSettingsPage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-black uppercase tracking-[0.24em] text-slate-400">
          KINGMAKER settings
        </p>
        <h1 className="mt-2 text-4xl font-black">One account and permission system.</h1>
        <p className="mt-4 max-w-3xl leading-7 text-slate-300">
          KINGMAKER and InstaComp do not create separate seller accounts. Seller-facing configuration stays in Truely Collectables; private Mac runtime configuration stays in the local owner cockpit.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {settingsLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 transition hover:border-slate-600"
            >
              <h2 className="font-black">{item.title}</h2>
              <p className="mt-2 leading-6 text-slate-400">{item.detail}</p>
            </Link>
          ))}
        </section>

        <section className="mt-6 rounded-2xl border border-blue-900 bg-blue-950/20 p-6">
          <h2 className="font-black text-blue-100">Mac owner control plane</h2>
          <p className="mt-2 leading-7 text-blue-100/75">
            Ollama, backup roots, local cache paths, diagnostics, and service restart remain private on the Mac at the authenticated local `/control` endpoint. Sellers never interact with the Mac service directly.
          </p>
        </section>
      </div>
    </main>
  );
}
