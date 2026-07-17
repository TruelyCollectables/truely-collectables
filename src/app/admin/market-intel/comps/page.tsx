import Link from "next/link";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import { getMarketIntelCompOverview } from "../../../../../lib/market-intel-comps";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black";

function money(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

export default async function MarketIntelCompsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const { identities, subjects } = await getMarketIntelCompOverview();
  const pricedCount = identities.filter((identity) => identity.latestValue?.conservative_value).length;

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black">Exact-Card Sold Comps</h1>
          <p className="mt-2 max-w-3xl font-semibold text-neutral-300">
            Raw and graded cards stay separate. Every market value can be traced to the exact verified sales underneath it.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900">
            {query.error}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Exact Identities" value={String(identities.length)} />
          <Metric label="With Market Value" value={String(pricedCount)} />
          <Metric
            label="Verified Comp Rows"
            value={String(
              identities.reduce(
                (sum, identity) => sum + identity.verifiedCompCount,
                0,
              ),
            )}
          />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Create Exact Card</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Every field changes the market identity. Base, parallel, raw, PSA 10, autograph, and numbered cards never share comps.
            </p>

            {subjects.length === 0 ? (
              <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 font-bold text-amber-950">
                Add players to the watchlist before creating card identities.
              </p>
            ) : (
              <form
                method="post"
                action={addAdminHandoff("/api/admin/market-intel/identities", handoff)}
                className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                <label className="text-sm font-black sm:col-span-2">
                  Player
                  <select name="subjectId" required className={fieldClass}>
                    <option value="">Select player</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name} — {subject.sport_or_category || "Unknown category"}
                      </option>
                    ))}
                  </select>
                </label>
                <Input name="seasonYear" label="Year / season" placeholder="2025-26" required />
                <Input name="manufacturer" label="Manufacturer" defaultValue="Upper Deck" required />
                <Input name="brand" label="Brand" placeholder="Upper Deck" />
                <Input name="productLine" label="Product line" placeholder="Extended Series" />
                <Input name="setName" label="Set" placeholder="1st Round Rookies" />
                <Input name="insertName" label="Insert" />
                <Input name="cardNumber" label="Card number" placeholder="743" required />
                <Input name="parallelName" label="Parallel" defaultValue="Base" required />
                <Input name="variationName" label="Variation" />
                <Input name="serialNumberedTo" label="Numbered to" type="number" min="1" />
                <label className="text-sm font-black">
                  Condition type
                  <select name="conditionType" className={fieldClass} defaultValue="raw">
                    <option value="raw">Raw</option>
                    <option value="graded">Graded</option>
                    <option value="sealed">Sealed</option>
                    <option value="authenticated">Authenticated</option>
                  </select>
                </label>
                <Input name="gradingCompany" label="Grading company" placeholder="PSA" />
                <Input name="grade" label="Grade" placeholder="10" />
                <div className="flex flex-wrap gap-4 text-sm font-black sm:col-span-2">
                  <Check name="rookieDesignation" label="Rookie" />
                  <Check name="autograph" label="Autograph" />
                  <Check name="memorabilia" label="Memorabilia" />
                </div>
                <button
                  type="submit"
                  className="rounded-md bg-black px-5 py-3 font-black text-white sm:col-span-2"
                >
                  Create Exact Identity
                </button>
              </form>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Card Markets</h2>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                Open a card to enter sales and recalculate its defensible market value.
              </p>
            </div>

            {identities.length === 0 ? (
              <p className="p-6 font-semibold text-neutral-600">No exact card identities yet.</p>
            ) : (
              <div className="divide-y divide-neutral-200">
                {identities.map((identity) => {
                  const value = identity.latestValue;
                  return (
                    <Link
                      key={identity.id}
                      href={addAdminHandoff(
                        `/admin/market-intel/comps/${identity.id}`,
                        handoff,
                      )}
                      className="block p-5 hover:bg-neutral-50"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <h3 className="text-lg font-black">{identity.display_name}</h3>
                          <p className="mt-1 text-sm font-semibold text-neutral-600">
                            {identity.verifiedCompCount} verified comp{identity.verifiedCompCount === 1 ? "" : "s"} · {identity.condition_type.toUpperCase()}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <SmallStat label="Market" value={money(value?.conservative_value)} />
                          <SmallStat label="Confidence" value={value ? `${value.confidence_score.toFixed(0)}%` : "—"} />
                          <SmallStat label="Liquidity" value={value ? `${value.liquidity_score.toFixed(0)}` : "—"} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  min?: string;
  required?: boolean;
}) {
  const { label, ...inputProps } = props;
  return (
    <label className="text-sm font-black">
      {label}
      <input {...inputProps} className={fieldClass} />
    </label>
  );
}

function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2">
      <input name={name} type="checkbox" /> {label}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}
