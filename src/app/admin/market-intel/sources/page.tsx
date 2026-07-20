import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelSourceRegistry,
  marketIntelSourceStatusTone,
  marketIntelSourceValuationPolicyLabel,
  type MarketIntelSourceCapability,
  type MarketIntelSourceDefinition,
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

function profitHunterHref(
  source: MarketIntelSourceDefinition,
  handoff: string | null | undefined,
) {
  if (source.slug !== "blowout_forums") return null;
  return `${addAdminHandoff("/admin/market-intel/deals", handoff)}#blowout-research`;
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
            Honest marketplace access. No fake automation.
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Every marketplace declares exactly how TCOS may use it. LIVE API means approved
            automation is working. MANUAL, INDEXED, or PRICE GUIDE RESEARCH means an operator
            must open links or provide attributed evidence. ACCESS NEEDED means nothing runs
            until approved access is verified.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid gap-5 lg:grid-cols-2">
          {sources.map((source) => {
            const integratedHref = profitHunterHref(source, handoff);
            return (
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
                    <dt className="font-black text-neutral-500">Valuation policy</dt>
                    <dd className="font-semibold">
                      {marketIntelSourceValuationPolicyLabel(source)}
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

                {integratedHref ? (
                  <Link
                    href={integratedHref}
                    className="mt-5 inline-flex rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-black"
                  >
                    OPEN BLOWOUT INSIDE PROFIT HUNTER →
                  </Link>
                ) : null}

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
            );
          })}
        </section>

        <section className="rounded-xl border border-neutral-300 bg-neutral-100 p-5">
          <h2 className="text-xl font-black">Runtime scan history comes next</h2>
          <p className="mt-2 font-semibold leading-7 text-neutral-700">
            This registry locks allowed access modes and valuation policy. A later
            database-backed status layer may attach last successful scan, last error,
            request counts, and authorization health without weakening these safety rules.
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
