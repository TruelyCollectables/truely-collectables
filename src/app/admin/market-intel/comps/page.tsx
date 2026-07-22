import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../lib/admin-handoff";
import { getMarketIntelCompOverview } from "../../../../lib/market-intel-comps";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 shadow-inner shadow-neutral-100 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10";

function money(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

export default async function MarketIntelCompsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const { identities, subjects } = await getMarketIntelCompOverview();
  const pricedCount = identities.filter((identity) => identity.latestValue?.conservative_value).length;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.13),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
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
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {query?.error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900 shadow-sm ring-1 ring-rose-950/5">
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
          <section className="rounded-3xl border border-neutral-200 bg-white/95 p-6 shadow-sm ring-1 ring-black/[0.02]">
            <h2 className="text-2xl font-black">Create Exact Card</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Every field changes the market identity. Base, parallel, raw, PSA 10, autograph, and numbered cards never share comps.
            </p>

            {subjects.length === 0 ? (
              <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 font-bold text-amber-950 shadow-sm ring-1 ring-amber-950/5">
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
                <AdminSubmitButton
                  className="rounded-2xl bg-black px-5 py-3 font-black text-white shadow-sm transition hover:bg-neutral-800 sm:col-span-2"
                  pendingChildren="Creating identity..."
                  title="Create a reusable exact-card identity for comps, scanner matching, deal scoring, and purchase review."
                >
                  Create Exact Identity
                </AdminSubmitButton>
                <p className="text-xs font-bold text-neutral-600 sm:col-span-2">
                  Saves identity metadata only; sold comps and listing scores are added in later steps.
                </p>
              </form>
            )}
          </section>

          <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
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
                      className="block p-5 transition hover:bg-neutral-50"
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
    <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 shadow-inner shadow-neutral-100">
      <input name={name} type="checkbox" className="accent-black" /> {label}
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-24 rounded-2xl border border-neutral-200 bg-neutral-50 p-3 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-[10px] font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}
