import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getIdentityDiscoveryWorkbench,
  type IdentityCandidate,
} from "../../../../lib/market-intel-identity-candidates";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    scanned?: string;
    created?: string;
    updated?: string;
    parsed?: string;
    approved?: string;
    rejected?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

const inputClass =
  "mt-2 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-semibold shadow-inner shadow-neutral-100 outline-none transition focus:border-black focus:ring-4 focus:ring-black/10";

function money(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `$${Number(value).toFixed(2)}`;
}

function time(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "approved") return "border-emerald-300 bg-emerald-100 text-emerald-950";
  if (status === "rejected") return "border-rose-300 bg-rose-100 text-rose-950";
  return "border-amber-300 bg-amber-100 text-amber-950";
}

export default async function IdentityDiscoveryPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  let data: Awaited<ReturnType<typeof getIdentityDiscoveryWorkbench>> | null = null;
  let loadError: string | null = null;
  try {
    data = await getIdentityDiscoveryWorkbench();
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Unable to load licensed-card discovery candidates.";
  }
  const pending = data?.pending || [];
  const approved = data?.approved || [];

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(217,70,239,0.12),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(217,70,239,0.2),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:p-8">
          <Link
            href={addAdminHandoff("/admin/market-intel", handoff)}
            className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-white/15"
          >
            ← Market Intel Command Center
          </Link>
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Licensed-Card Discovery Desk
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Broadly hunt the active baseball, Marlins, and WNBA value list, block
            base/college/unlicensed junk, parse promising eBay listings, then approve
            only exact licensed professional identities into live scoring.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {query?.scanned === "1" ? (
          <Notice>
            Discovery scan parsed {query.parsed || "0"} candidates, created {query.created || "0"}, and refreshed {query.updated || "0"}.
          </Notice>
        ) : null}
        {query?.approved === "1" ? (
          <Notice>Candidate approved, exact identity created, and live listing sent into scoring.</Notice>
        ) : null}
        {query?.rejected === "1" ? <Notice>Candidate rejected.</Notice> : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {loadError ? (
          <section className="rounded-3xl border border-rose-300 bg-rose-50 p-6 text-rose-950 shadow-sm ring-1 ring-rose-950/5">
            <h2 className="text-2xl font-black">Discovery migration required</h2>
            <p className="mt-2 font-semibold leading-6">{loadError}</p>
            <p className="mt-3 text-sm font-bold">
              Apply <code>supabase/migrations/20260718_tcos_market_intel_identity_discovery.sql</code> in Supabase SQL Editor, then reload.
            </p>
          </section>
        ) : null}

        <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 text-rose-950 shadow-sm ring-1 ring-rose-950/5">
          <p className="text-xs font-black uppercase tracking-[0.18em]">Hard scope</p>
          <h2 className="mt-1 text-2xl font-black">No base. No college. No unlicensed.</h2>
          <p className="mt-2 font-semibold leading-6">
            Approval requires an exact card number plus a real non-base signal and a licensed professional Topps/Bowman/Fanatics baseball or explicit licensed WNBA product. Discovery candidates never become alerts until you approve the exact identity.
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Pending Review" value={String(data?.totals.pending || 0)} />
          <Metric label="Under $5/Card" value={String(data?.totals.underFive || 0)} tone="emerald" />
          <Metric label="Approved" value={String(data?.totals.approved || 0)} tone="cyan" />
          <Metric label="Rejected" value={String(data?.totals.rejected || 0)} />
          <Metric label="All Candidates" value={String(data?.totals.all || 0)} />
        </section>

        <section className="rounded-3xl border border-cyan-200 bg-cyan-50 p-6 text-cyan-950 shadow-sm ring-1 ring-cyan-950/5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em]">Discovery scan</p>
              <h2 className="mt-1 text-3xl font-black">Hunt the next player rotation</h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
                The hourly rotation scans five tracked players at a time. Run it manually here to pull fresh licensed non-base candidates immediately.
              </p>
            </div>
            <form
              method="post"
              action={addAdminHandoff(
                "/api/admin/market-intel/discovery/scan",
                handoff,
              )}
              className="grid min-w-[280px] grid-cols-2 gap-3"
            >
              <label className="text-xs font-black uppercase tracking-wide">
                Players
                <select name="maxSubjects" defaultValue="5" className={inputClass}>
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="15">All 15</option>
                </select>
              </label>
              <label className="text-xs font-black uppercase tracking-wide">
                Results/query
                <select name="resultsPerQuery" defaultValue="15" className={inputClass}>
                  <option value="10">10</option>
                  <option value="15">15</option>
                  <option value="25">25</option>
                </select>
              </label>
              <AdminSubmitButton
                className="col-span-2 rounded-2xl bg-cyan-900 px-4 py-3 font-black text-white shadow-sm transition hover:bg-cyan-800"
                pendingChildren="Scanning eBay..."
                title="Run the Market Intel eBay scanner for the selected watchlist scope and save review candidates."
              >
                Scan eBay Now
              </AdminSubmitButton>
              <p className="col-span-2 text-xs font-bold text-cyan-950">
                Finds and stages candidates for review; it does not approve identities, buy listings, or publish anything.
              </p>
            </form>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-800">Review queue</p>
            <h2 className="mt-1 text-3xl font-black">Pending Exact Identities</h2>
          </div>
          {pending.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-neutral-300 bg-white/95 p-8 text-center shadow-sm ring-1 ring-black/[0.02]">
              <h3 className="text-xl font-black">No pending candidates yet</h3>
              <p className="mt-2 font-semibold text-neutral-600">
                Run Discovery Scan. Results must pass player, professional-license, and non-base filters before appearing here.
              </p>
            </div>
          ) : (
            pending.map((candidate) => (
              <CandidateReview
                key={candidate.id}
                candidate={candidate}
                handoff={handoff}
              />
            ))
          )}
        </section>

        {approved.length > 0 ? (
          <section className="overflow-hidden rounded-3xl border border-emerald-200 bg-white/95 shadow-sm ring-1 ring-emerald-950/5">
            <div className="border-b border-emerald-200 bg-emerald-50 p-5">
              <h2 className="text-2xl font-black text-emerald-950">Recently Approved</h2>
            </div>
            <div className="divide-y divide-neutral-200">
              {approved.slice(0, 12).map((candidate) => (
                <article key={candidate.id} className="p-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-black">{candidate.subject.name}</p>
                      <a
                        href={candidate.direct_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-bold text-cyan-800 hover:underline"
                      >
                        {candidate.original_title}
                      </a>
                    </div>
                    <span className="rounded-full border border-emerald-300 bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                      APPROVED
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function CandidateReview({
  candidate,
  handoff,
}: {
  candidate: IdentityCandidate;
  handoff?: string;
}) {
  const image = candidate.image_urls[0] || null;
  return (
    <article
      id={`candidate-${candidate.id}`}
      className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr]">
        <div className="border-b border-neutral-200 bg-neutral-100 p-4 lg:border-b-0 lg:border-r">
          {image ? (
            // External marketplace images are reviewed only in this private admin tool.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={candidate.original_title}
              className="aspect-square w-full rounded-2xl bg-white object-contain shadow-sm ring-1 ring-black/[0.02]"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white font-bold text-neutral-500 shadow-sm">
              No image
            </div>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <SmallFact label="Lot total" value={money(candidate.delivered_price)} />
            <SmallFact label="Per card" value={money(candidate.unit_delivered_cost)} />
            <SmallFact label="Quantity" value={String(candidate.quantity)} />
            <SmallFact label="Confidence" value={`${candidate.parse_confidence.toFixed(0)}%`} />
          </dl>
        </div>

        <div className="p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(candidate.status)}`}>
                  {candidate.status.toUpperCase()}
                </span>
                <span className="rounded-full border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs font-black">
                  Priority {candidate.subject.priority}
                </span>
                <span className="rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-950">
                  {candidate.marketplace.name}
                </span>
              </div>
              <h3 className="mt-3 text-2xl font-black">{candidate.subject.name}</h3>
              <a
                href={candidate.direct_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block max-w-4xl font-bold leading-6 text-cyan-800 hover:underline"
              >
                {candidate.original_title}
              </a>
              <p className="mt-2 text-xs font-bold text-neutral-500">
                Last seen {time(candidate.last_seen_at)} · {candidate.licensed_scope || "Licensed scope pending"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {candidate.non_base_reasons.map((reason) => (
                  <span
                    key={reason}
                    className="rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-1 text-xs font-black text-fuchsia-900"
                  >
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <form
            method="post"
            action={addAdminHandoff(
              `/api/admin/market-intel/discovery/${candidate.id}/approve`,
              handoff,
            )}
            className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
          >
            <Field name="seasonYear" label="Year" defaultValue={candidate.detected_year || ""} required />
            <Field name="manufacturer" label="Manufacturer" defaultValue={candidate.detected_manufacturer || ""} required />
            <Field name="brand" label="Brand" defaultValue={candidate.detected_brand || ""} />
            <Field name="productLine" label="Product line" defaultValue={candidate.detected_product_line || ""} required />
            <Field name="setName" label="Set" defaultValue={candidate.detected_set_name || ""} />
            <Field name="insertName" label="Insert" defaultValue={candidate.detected_insert_name || ""} />
            <Field name="cardNumber" label="Exact card #" defaultValue={candidate.detected_card_number || ""} required />
            <Field name="parallelName" label="Parallel" defaultValue={candidate.detected_parallel_name || ""} required />
            <Field name="variationName" label="Variation" defaultValue={candidate.detected_variation_name || ""} />
            <Field
              name="serialNumberedTo"
              label="Numbered to"
              defaultValue={candidate.serial_numbered_to?.toString() || ""}
              type="number"
            />
            <Field
              name="quantity"
              label="Cards in lot"
              defaultValue={String(candidate.quantity)}
              type="number"
              required
            />
            <label className="text-sm font-black">
              Condition
              <select name="conditionType" defaultValue={candidate.condition_type} className={inputClass}>
                <option value="raw">Raw</option>
                <option value="graded">Graded</option>
              </select>
            </label>
            <Field name="gradingCompany" label="Grading company" defaultValue={candidate.grading_company || ""} />
            <Field name="grade" label="Grade" defaultValue={candidate.grade || ""} />

            <div className="flex flex-wrap gap-4 md:col-span-2 xl:col-span-4">
              <Check name="autograph" label="Autograph" defaultChecked={candidate.autograph} />
              <Check name="memorabilia" label="Memorabilia" defaultChecked={candidate.memorabilia} />
              <Check name="rookieDesignation" label="Rookie/1st" defaultChecked={candidate.rookie_designation} />
            </div>

            <AdminSubmitButton
              className="rounded-2xl bg-emerald-700 px-4 py-3 font-black text-white shadow-sm transition hover:bg-emerald-600 md:col-span-2 xl:col-span-4"
              pendingChildren="Approving and scoring..."
              title="Approve this candidate as an exact-card identity, attach it to the listing, and calculate the listing score."
            >
              Approve Exact Identity + Score Listing
            </AdminSubmitButton>
            <p className="text-xs font-bold text-neutral-600 md:col-span-2 xl:col-span-4">
              Moves the candidate into exact review data and scoring; it does not buy the listing.
            </p>
          </form>

          <form
            method="post"
            action={addAdminHandoff(
              `/api/admin/market-intel/discovery/${candidate.id}/reject`,
              handoff,
            )}
            className="mt-3 flex flex-col gap-2 sm:flex-row"
          >
            <input
              name="reason"
              className={inputClass.replace("mt-2 ", "")}
              placeholder="Reason: base, wrong player, unlicensed, bad parse…"
            />
            <AdminSubmitButton
              className="shrink-0 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 font-black text-rose-950 shadow-sm transition hover:bg-rose-100"
              pendingChildren="Rejecting..."
              title="Reject this discovery candidate with the entered reason and remove it from the approval queue."
            >
              Reject Candidate
            </AdminSubmitButton>
            <p className="text-xs font-bold text-rose-950 sm:basis-full">
              Rejecting documents the reason and keeps the source listing unchanged.
            </p>
          </form>
        </div>
      </div>
    </article>
  );
}

function Field({
  name,
  label,
  defaultValue,
  required = false,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        min={type === "number" ? 1 : undefined}
        className={inputClass}
      />
    </label>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-black shadow-inner shadow-neutral-100">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 accent-black"
      />
      {label}
    </label>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "emerald" | "cyan";
}) {
  const className =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "cyan"
        ? "border-cyan-200 bg-cyan-50 text-cyan-950"
      : "border-neutral-200 bg-white/95 text-neutral-950";
  return (
    <div className={`rounded-3xl border p-4 shadow-sm ring-1 ring-black/[0.02] ${className}`}>
      <p className="text-xs font-black uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm ring-1 ring-black/[0.02]">
      <dt className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={
        error
          ? "rounded-2xl border border-rose-300 bg-rose-50 p-4 font-bold text-rose-950 shadow-sm ring-1 ring-rose-950/5"
          : "rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-950 shadow-sm ring-1 ring-emerald-950/5"
      }
    >
      {children}
    </div>
  );
}
