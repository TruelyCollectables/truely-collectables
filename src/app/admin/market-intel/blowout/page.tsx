import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  BLOWOUT_RESEARCH_POLICY,
  buildBlowoutResearchLinks,
} from "../../../../lib/blowout-research";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    player?: string;
    year?: string;
    setName?: string;
    cardNumber?: string;
    parallel?: string;
    sport?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const inputClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-semibold outline-none focus:border-black";

export default async function BlowoutResearchPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const links = buildBlowoutResearchLinks({
    player: query?.player,
    year: query?.year,
    setName: query?.setName,
    cardNumber: query?.cardNumber,
    parallel: query?.parallel,
    sport: query?.sport,
  });

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="border-b border-neutral-800 bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel/sources", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Marketplace Source Registry
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-amber-300">
            Profit Hunter manual research
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Blowout Cards Forums Research Desk
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Generate public search-index links for priced threads, lots, collection sales,
            price drops, and possible mislists. TCOS does not crawl the forum or automate a
            member account.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
          <p className="text-xs font-black uppercase tracking-[0.18em]">
            Safe operating mode
          </p>
          <h2 className="mt-1 text-2xl font-black">
            Public index links + manual thread review
          </h2>
          <p className="mt-2 max-w-4xl font-semibold leading-7">
            This desk only creates links that you choose to open. It does not log in,
            solve verification prompts, scrape pages, poll threads, post, bump, reply,
            or message sellers.
          </p>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <form
            method="get"
            action="/admin/market-intel/blowout"
            className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-2xl font-black">Build research links</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Enter as many exact-card fields as you know. Broader searches are included
              for lots and buried-card opportunities.
            </p>

            {handoff ? (
              <input
                type="hidden"
                name={ADMIN_HANDOFF_PARAM}
                value={handoff}
              />
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field name="player" label="Player or subject" defaultValue={query?.player} wide />
              <Field name="sport" label="Sport or category" defaultValue={query?.sport} />
              <Field name="year" label="Year" defaultValue={query?.year} />
              <Field name="setName" label="Set or product" defaultValue={query?.setName} wide />
              <Field name="cardNumber" label="Card number" defaultValue={query?.cardNumber} />
              <Field name="parallel" label="Parallel or variation" defaultValue={query?.parallel} />
            </div>

            <button
              type="submit"
              className="mt-5 rounded-md bg-black px-5 py-3 font-black text-white hover:bg-neutral-800"
            >
              Generate Safe Search Links
            </button>
          </form>

          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
                  Indexed research results
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {links.length
                    ? `${links.length} controlled search families`
                    : "Enter a player, set, or card"}
                </h2>
              </div>
              <Link
                href={addAdminHandoff("/admin/market-intel/deals", handoff)}
                className="rounded-md bg-amber-300 px-4 py-2 text-sm font-black text-black"
              >
                OPEN PROFIT HUNTER →
              </Link>
            </div>

            {links.length ? (
              <div className="mt-5 space-y-4">
                {links.map((link) => (
                  <article
                    key={link.id}
                    className="rounded-xl border border-neutral-200 bg-neutral-50 p-4"
                  >
                    <h3 className="text-lg font-black">{link.label}</h3>
                    <p className="mt-1 text-sm font-semibold leading-6 text-neutral-600">
                      {link.reason}
                    </p>
                    <p className="mt-3 break-words rounded-md bg-white p-3 font-mono text-xs text-neutral-700">
                      {link.query}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <a
                        href={link.googleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white"
                      >
                        Search Google
                      </a>
                      <a
                        href={link.bingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-neutral-400 bg-white px-4 py-2 text-sm font-black"
                      >
                        Search Bing
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-lg border border-dashed border-neutral-300 p-6 font-semibold text-neutral-600">
                This page never launches searches automatically. Submit the form, then open
                only the research links you want to review.
              </p>
            )}
          </section>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <PolicyList
            title="Never automate"
            items={BLOWOUT_RESEARCH_POLICY.prohibitedActions}
            tone="rose"
          />
          <PolicyList
            title="Manual checks before saving a deal"
            items={BLOWOUT_RESEARCH_POLICY.operatorChecks}
            tone="amber"
          />
        </section>

        <section className="rounded-xl border border-violet-300 bg-violet-50 p-5 text-violet-950">
          <h2 className="text-xl font-black">Bargain discovery only</h2>
          <p className="mt-2 font-semibold leading-7">
            A forum thread may become a Profit Hunter candidate after manual review, but
            Blowout asking prices, claimed sales, replies, and sold markings can never
            create or change an InstaComp™ sold-comp market value.
          </p>
        </section>
      </div>
    </main>
  );
}

function Field({
  name,
  label,
  defaultValue,
  wide = false,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  wide?: boolean;
}) {
  return (
    <label className={`text-sm font-black ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      <input
        name={name}
        defaultValue={defaultValue}
        className={inputClass}
      />
    </label>
  );
}

function PolicyList({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "rose" | "amber";
}) {
  const classes =
    tone === "rose"
      ? "border-rose-300 bg-rose-50 text-rose-950"
      : "border-amber-300 bg-amber-50 text-amber-950";
  return (
    <section className={`rounded-xl border p-5 ${classes}`}>
      <h2 className="text-xl font-black">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm font-semibold leading-6">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </section>
  );
}
