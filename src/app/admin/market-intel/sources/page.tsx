import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelSourceRegistry,
  marketIntelSourceStatusTone,
  type MarketIntelSourceCapability,
} from "../../../../lib/market-intel-sources";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{ [ADMIN_HANDOFF_PARAM]?: string }>;
};

function capabilityLabel(value: MarketIntelSourceCapability) {
  if (value === "live") return "LIVE";
  if (value === "manual") return "MANUAL";
  if (value === "planned") return "PLANNED";
  return "NONE";
}

export default async function MarketIntelSourcesPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const sources = getMarketIntelSourceRegistry();

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            Profit Hunter source registry
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Bargain sources stay separate from sold comps.
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Every marketplace declares exactly how TCOS may use it. Etsy, Mercari,
            Facebook Marketplace, and Sportlots are bargain-discovery sources only and
            are permanently blocked from InstaComp™ sold-comp valuation.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="rounded-xl border border-violet-300 bg-violet-50 p-5 text-violet-950">
          <p className="text-xs font-black uppercase tracking-[0.18em]">
            Hard valuation rule
          </p>
          <h2 className="mt-1 text-2xl font-black">
            Active bargains are not market-value evidence.
          </h2>
          <p className="mt-2 font-semibold leading-7">
            Profit Hunter may use these sources to locate underpriced cards, weak titles,
            lots, and local opportunities. Their asking prices, claimed sales, and history
            cannot create, confirm, or alter an InstaComp™ market value.
          </p>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          {sources.map((source) => (
            <article
              key={source.slug}
              className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                    {source.accessMode.replaceAll("_", " ")}
                  </p>
                  <h2 className="mt-1 text-3xl font-black">{source.displayName}</h2>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-black ${marketIntelSourceStatusTone(
                    source.status,
                  )}`}
                >
                  {source.statusLabel}
                </span>
              </div>

              <div
                className={`mt-4 rounded-lg border p-3 text-sm font-black ${
                  source.soldCompValuationAllowed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                    : "border-violet-300 bg-violet-50 text-violet-950"
                }`}
              >
                {source.soldCompValuationAllowed
                  ? "VERIFIED SOLD-COMP VALUATION ALLOWED"
                  : "BARGAIN DISCOVERY ONLY — SOLD COMPS BLOCKED"}
              </div>

              <p className="mt-4 font-semibold leading-7 text-neutral-700">
                {source.authorizationStatus}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Capability label="Active listings" value={source.activeListingSupport} />
                <Capability label="Sold history" value={source.soldHistorySupport} />
                <Capability label="Images" value={source.imageSupport} />
                <Capability label="Checklists" value={source.checklistSupport} />
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="font-black text-neutral-500">Automated search</dt>
                  <dd className="font-semibold">
                    {source.automatedSearchEnabled ? "Enabled" : "Disabled"}
                  </dd>
                </div>
                <div>
                  <dt className="font-black text-neutral-500">Allowed TCOS use</dt>
                  <dd className="font-semibold">
                    {source.usagePolicy === "bargain_discovery_only"
                      ? "Profit Hunter bargain discovery only"
                      : "Verified valuation evidence and bargain discovery"}
                  </dd>
                </div>
                <div>
                  <dt className="font-black text-neutral-500">Direct listing links</dt>
                  <dd className="font-semibold">
                    {source.directLinkSupport ? "Supported" : "Not supported"}
                  </dd>
                </div>
                <div>
                  <dt className="font-black text-neutral-500">Rate-limit / usage rule</dt>
                  <dd className="font-semibold leading-6">{source.rateLimitNotes}</dd>
                </div>
              </dl>

              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-900">
                  Source warnings
                </p>
                <ul className="mt-2 space-y-2 text-sm font-semibold leading-6 text-amber-950">
                  {source.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>

        <section className="rounded-xl border border-neutral-300 bg-neutral-100 p-5">
          <h2 className="text-xl font-black">Runtime scan history comes next</h2>
          <p className="mt-2 font-semibold leading-7 text-neutral-700">
            This registry locks the allowed access mode and valuation policy. A later
            database-backed status layer may attach last successful scan, last error,
            request counts, and authorization health without weakening the sold-comp block.
          </p>
        </section>
      </div>
    </main>
  );
}

function Capability({
  label,
  value,
}: {
  label: string;
  value: MarketIntelSourceCapability;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black">{capabilityLabel(value)}</p>
    </div>
  );
}
