import Link from "next/link";

const connectionCards = [
  {
    title: "eBay Seller OAuth",
    badge: "CHECK TOKEN",
    badgeClass: "border-blue-500/30 bg-blue-500/15 text-blue-300",
    detail:
      "Verify your Mac-local eBay seller inventory OAuth token and review staged eBay listings ($2.00+ floor).",
    href: "/kingmaker/marketplaces",
    cta: "Manage eBay Connection",
  },
  {
    title: "Mercari Chrome TC Profile",
    badge: "TC PROFILE",
    badgeClass: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
    detail:
      "Mercari batch drafting uses Chrome Profile TC. Check active marketplace sync and pre-flight asset status.",
    href: "/kingmaker/marketplaces",
    cta: "Open Marketplaces",
  },
  {
    title: "Operator & Seller Account",
    badge: "UNIFIED AUTH",
    badgeClass: "border-yellow-400/30 bg-yellow-400/15 text-yellow-300",
    detail:
      "Manage your Truely Collectables account, admin login session, and seller payout readiness in one place.",
    href: "/account",
    cta: "Open Account Settings",
  },
  {
    title: "TCOS & InstaComp Audit",
    badge: "DIAGNOSTICS",
    badgeClass: "border-slate-600 bg-slate-800 text-slate-200",
    detail:
      "Inspect InstaComp AI audit logs, Supabase image sync, and pending queue hydration checks.",
    href: "/kingmaker/instacomp-audit",
    cta: "View InstaComp Audit",
  },
] as const;

const guardrails = [
  { label: "Operator Price Lock", value: "Enforced (zero auto-overwrites)" },
  { label: "eBay Listing Floor", value: "$2.00 minimum" },
  { label: "Investment Stash", value: "<= $2.99 comps only" },
  { label: "Mercari Floor", value: "$1.00 minimum (whole-dollar web)" },
] as const;

export default function KingmakerSettingsPage() {
  return (
    <main className="px-4 py-8 sm:px-6 lg:px-8" data-kingmaker-settings="safe-v2">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#facc15]">
          KINGMAKER SETTINGS &amp; LOGINS
        </p>
        <h1 className="font-display mt-1 text-4xl font-extrabold uppercase tracking-tight text-white">
          Connections, Logins &amp; Guardrails
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
          One unified hub to verify your operator login, eBay OAuth, Mercari Chrome TC profile, and active pricing rules.
        </p>

        <section className="mt-7 grid gap-4 md:grid-cols-2">
          {connectionCards.map((card) => (
            <div
              key={card.title}
              className="flex flex-col justify-between rounded-xl border border-slate-800 bg-[#0f172a] p-5"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-bold text-white">{card.title}</h2>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${card.badgeClass}`}
                  >
                    {card.badge}
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-6 text-slate-400">{card.detail}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={card.href}
                  className="inline-flex items-center rounded-lg bg-[#facc15] px-3.5 py-2 text-xs font-bold text-[#0f172a] hover:bg-[#eab308]"
                >
                  {card.cta}
                </Link>
              </div>
            </div>
          ))}
        </section>

        <section className="mt-6 rounded-xl border border-slate-800 bg-[#0f172a] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-extrabold uppercase tracking-wide text-white">
              Engine &amp; Pricing Guardrails
            </h2>
            <Link
              href="/kingmaker/payouts"
              className="text-xs font-bold text-[#facc15] hover:underline"
            >
              Review Payouts →
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {guardrails.map((rule) => (
              <div
                key={rule.label}
                className="rounded-lg border border-slate-800 bg-[#0b1120] p-3.5"
              >
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {rule.label}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">{rule.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-blue-800/50 bg-blue-950/20 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-blue-200">
            Mac Owner Control Plane
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-blue-100/75">
            Local SQLite databases, backup roots, and service restarts remain private on your Mac at the authenticated local <code className="font-mono text-blue-200">/control</code> endpoint.
          </p>
        </section>
      </div>
    </main>
  );
}
