import Link from "next/link";
import { notFound } from "next/navigation";
import AdminSubmitButton from "../../../AdminSubmitButton";
import { addAdminHandoff, ADMIN_HANDOFF_PARAM } from "../../../../../lib/admin-handoff";
import { getMarketIntelCompDetail } from "../../../../../lib/market-intel-comps";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    saved?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const fieldClass =
  "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-black";

function money(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value).toFixed(1)}%`;
}

export default async function MarketIntelCompDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const data = await getMarketIntelCompDetail(id);
  if (!data) notFound();

  const { identity, comps, values, marketplaces } = data;
  const latest = values[0] || null;
  const includedComps = comps.filter(
    (comp) => comp.verified && !comp.excluded && !comp.outlier_flag,
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <header className="bg-[#101418] text-white">
        <div className="mx-auto max-w-7xl px-6 py-8">
          <Link
            href={addAdminHandoff("/admin/market-intel/comps", handoff)}
            className="text-sm font-black text-amber-300 hover:underline"
          >
            ← Exact-Card Markets
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            {identity.subject?.name || "Unmatched subject"} · {identity.condition_type.toUpperCase()}
          </p>
          <h1 className="mt-2 max-w-5xl text-3xl font-black md:text-5xl">
            {identity.display_name}
          </h1>
          <p className="mt-3 break-all text-xs font-semibold text-neutral-400">
            {identity.identity_key}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.saved === "identity" ? <Notice>Exact identity created.</Notice> : null}
        {query?.saved === "comp" ? <Notice>Verified sale saved and market value recalculated.</Notice> : null}
        {query?.saved === "value" ? <Notice>Market value recalculated.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric label="Conservative Value" value={money(latest?.conservative_value)} />
          <Metric label="Median" value={money(latest?.median_value)} />
          <Metric label="Average" value={money(latest?.average_value)} />
          <Metric label="Verified Sample" value={String(latest?.sample_size ?? 0)} />
          <Metric label="Confidence" value={latest ? `${latest.confidence_score.toFixed(0)}%` : "—"} />
          <Metric label="Liquidity" value={latest ? latest.liquidity_score.toFixed(0) : "—"} />
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-6">
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black">Market Value</h2>
                  <p className="mt-1 text-sm font-semibold text-neutral-600">
                    Only verified, included, non-outlier exact-card sales count.
                  </p>
                </div>
                <form
                  method="post"
                  action={addAdminHandoff(
                    `/api/admin/market-intel/comps/${identity.id}/recalculate`,
                    handoff,
                  )}
                >
                  <AdminSubmitButton
                    className="rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
                    pendingChildren="Recalculating..."
                  >
                    Recalculate
                  </AdminSubmitButton>
                </form>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <Stat label="90-Day Low" value={money(latest?.low_value)} />
                <Stat label="90-Day High" value={money(latest?.high_value)} />
                <Stat label="7-Day Move" value={percent(latest?.seven_day_change_pct)} />
                <Stat label="30-Day Move" value={percent(latest?.thirty_day_change_pct)} />
                <Stat label="90-Day Move" value={percent(latest?.ninety_day_change_pct)} />
                <Stat label="Included Rows" value={String(includedComps.length)} />
              </div>

              <p className="mt-5 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm font-semibold leading-6 text-neutral-700">
                {latest?.calculation_notes || "No market-value snapshot yet. Add a verified sale and Beta One will calculate it."}
              </p>
            </section>

            <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-6">
              <h2 className="text-xl font-black">Exact Identity Guard</h2>
              <dl className="mt-4 space-y-2 text-sm font-semibold text-cyan-950">
                <Row label="Player" value={identity.subject?.name || "Not matched"} />
                <Row label="Card number" value={identity.card_number || "Not set"} />
                <Row label="Parallel" value={identity.parallel_name} />
                <Row label="Variation" value={identity.variation_name || "None"} />
                <Row label="Numbered" value={identity.serial_numbered_to ? `/${identity.serial_numbered_to}` : "No"} />
                <Row label="Condition" value={identity.condition_type.toUpperCase()} />
                <Row label="Grade" value={identity.grading_company && identity.grade ? `${identity.grading_company} ${identity.grade}` : "Not graded"} />
              </dl>
            </section>
          </div>

          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-black">Add Verified Sold Comp</h2>
            <p className="mt-1 text-sm font-semibold text-neutral-600">
              Enter the actual sold price. Shipping and buyer fees are included in delivered value.
            </p>

            <form
              method="post"
              action={addAdminHandoff("/api/admin/market-intel/comps", handoff)}
              className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <input type="hidden" name="identityId" value={identity.id} />
              <label className="text-sm font-black">
                Marketplace
                <select name="marketplaceId" required className={fieldClass}>
                  <option value="">Select marketplace</option>
                  {marketplaces.map((marketplace) => (
                    <option key={marketplace.id} value={marketplace.id}>
                      {marketplace.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                name="soldAt"
                label="Sold date"
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                required
              />
              <Input name="soldPrice" label="Sold price" type="number" min="0" step="0.01" required />
              <Input name="shippingPrice" label="Shipping" type="number" min="0" step="0.01" defaultValue="0" />
              <Input name="buyerFee" label="Buyer fee" type="number" min="0" step="0.01" defaultValue="0" />
              <Input name="quantity" label="Quantity in sale" type="number" min="1" defaultValue="1" required />
              <Input name="matchConfidence" label="Match confidence %" type="number" min="0" max="100" defaultValue="100" required />
              <Input name="externalSaleId" label="Marketplace sale ID" />
              <Input name="sourceUrl" label="Direct sold link" type="url" wide />
              <Input name="originalTitle" label="Original listing title" wide />
              <Input name="exclusionReason" label="Exclusion note" wide />
              <div className="flex flex-wrap gap-5 text-sm font-black sm:col-span-2">
                <Check name="outlierFlag" label="Flag as outlier" />
                <Check name="excluded" label="Exclude from value" />
              </div>
              <AdminSubmitButton
                className="rounded-md bg-black px-5 py-3 font-black text-white sm:col-span-2"
                pendingChildren="Saving comp..."
              >
                Save Verified Comp
              </AdminSubmitButton>
            </form>
          </section>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Verified Sale History</h2>
          </div>
          {comps.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No sold comps recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Sold</th>
                    <th className="px-5 py-3">Marketplace</th>
                    <th className="px-5 py-3">Title</th>
                    <th className="px-5 py-3">Price</th>
                    <th className="px-5 py-3">Shipping</th>
                    <th className="px-5 py-3">Buyer Fee</th>
                    <th className="px-5 py-3">Qty</th>
                    <th className="px-5 py-3">Unit Delivered</th>
                    <th className="px-5 py-3">Match</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {comps.map((comp) => (
                    <tr key={comp.id} className={comp.excluded || comp.outlier_flag ? "bg-amber-50" : ""}>
                      <td className="px-5 py-4">{new Date(comp.sold_at).toLocaleDateString()}</td>
                      <td className="px-5 py-4">{comp.marketplace?.name || "Unknown"}</td>
                      <td className="max-w-sm px-5 py-4">
                        {comp.source_url ? (
                          <a href={comp.source_url} target="_blank" rel="noreferrer" className="font-bold hover:underline">
                            {comp.original_title || "Open sold record"}
                          </a>
                        ) : (
                          comp.original_title || "No title"
                        )}
                      </td>
                      <td className="px-5 py-4">{money(comp.sold_price)}</td>
                      <td className="px-5 py-4">{money(comp.shipping_price)}</td>
                      <td className="px-5 py-4">{money(comp.buyer_fee)}</td>
                      <td className="px-5 py-4">{comp.quantity}</td>
                      <td className="px-5 py-4 font-black">{money(comp.unit_delivered_price)}</td>
                      <td className="px-5 py-4">{comp.match_confidence.toFixed(0)}%</td>
                      <td className="px-5 py-4 font-black">
                        {comp.excluded ? "EXCLUDED" : comp.outlier_flag ? "OUTLIER" : "INCLUDED"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Input(props: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  step?: string;
  required?: boolean;
  wide?: boolean;
}) {
  const { label, wide, ...inputProps } = props;
  return (
    <label className={`text-sm font-black ${wide ? "sm:col-span-2" : ""}`}>
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
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-cyan-200 pb-2">
      <dt>{label}</dt>
      <dd className="font-black">{value}</dd>
    </div>
  );
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={error ? "rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900" : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"}
    >
      {children}
    </div>
  );
}
