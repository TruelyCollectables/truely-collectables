import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : "—";
}

function percent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "—";
}

function time(value: unknown) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(String(value)));
}

function tone(label: string) {
  if (label === "MUST BUY") return "border-emerald-300 bg-emerald-50";
  if (label === "BORDERLINE BUY") return "border-cyan-300 bg-cyan-50";
  if (label === "TOO GOOD TO BE TRUE") return "border-fuchsia-300 bg-fuchsia-50";
  return "border-neutral-200 bg-white";
}

export default async function MacDealHunterPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const [runResult, candidateResult] = await Promise.all([
    supabase
      .from("tcos_deal_hunter_runs")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(20),
    supabase
      .from("tcos_deal_hunter_candidates")
      .select("*")
      .order("alertworthy", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  const runs = runResult.data || [];
  const candidates = candidateResult.data || [];
  const latest = runs[0] || null;
  const actionable = candidates.filter((row) => row.actionable === true);
  const alerts = candidates.filter((row) => row.alertworthy === true);
  const hasReported = Boolean(latest?.completed_at);
  const latestFailed = latest?.status === "failed" || Number(latest?.failure_count || 0) > 0;
  const loadError = runResult.error?.message || candidateResult.error?.message || null;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] rounded-[2rem] border border-neutral-900 bg-neutral-950 p-6 text-white shadow-2xl lg:p-8">
        <Link
          href="/admin/market-intel"
          className="inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black"
        >
          ← Market Intel
        </Link>
        <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
          Mac-Owned Automation
        </p>
        <h1 className="mt-2 text-4xl font-black md:text-5xl">InstaComp AI Deal Hunter</h1>
        <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
          The physical Mac owns discovery, front/back InstaComp identification, exact sold comps,
          economics, duplicate suppression, and alerts. ChatGPT tasks are not part of this runtime.
        </p>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {loadError ? (
          <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 font-bold text-rose-950">
            {loadError}. Apply the 20260806 Mac Deal Hunter scheduler migration.
          </section>
        ) : null}

        <section
          className={`rounded-3xl border p-5 shadow-sm ${
            !hasReported || latestFailed
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-emerald-300 bg-emerald-50 text-emerald-950"
          }`}
        >
          <p className="text-xs font-black uppercase tracking-[0.16em]">Scheduler heartbeat</p>
          <h2 className="mt-1 text-2xl font-black">
            {!hasReported
              ? "Mac scheduler has not reported a completed run yet"
              : latestFailed
                ? "Latest Mac scheduler run reported a failure"
                : "Mac scheduler has reported a completed run"}
          </h2>
          <p className="mt-2 font-semibold">
            Last completed: {time(latest?.completed_at)} · Status: {latest?.status || "none"}
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric label="Runs" value={String(runs.length)} />
          <Metric label="Discovered" value={String(latest?.discovery_count || 0)} />
          <Metric label="Evaluated" value={String(latest?.evaluated_count || 0)} />
          <Metric label="Actionable" value={String(actionable.length)} />
          <Metric label="Alertworthy" value={String(alerts.length)} />
          <Metric label="Failures" value={String(latest?.failure_count || 0)} />
        </section>

        <section className="space-y-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
              Live Decision Queue
            </p>
            <h2 className="text-3xl font-black">Deals and manual-review steals</h2>
          </div>
          {alerts.length === 0 ? (
            <div className="rounded-3xl border border-neutral-200 bg-white p-6 font-semibold text-neutral-600">
              No alertworthy Mac evaluations are stored yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {alerts.map((row) => (
                <article key={row.id} className={`rounded-3xl border p-5 shadow-sm ${tone(row.deal_label)}`}>
                  <p className="text-xs font-black uppercase tracking-[0.16em]">
                    {row.deal_label}
                  </p>
                  <h3 className="mt-1 text-xl font-black">{row.title}</h3>
                  <p className="mt-2 text-sm font-semibold text-neutral-600">
                    {row.watched_person || "Unassigned lane"} · {row.marketplace || "eBay"} · {row.seller_name || "Seller unknown"}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Delivered" value={money(row.delivered_cost)} />
                    <Stat label="Resale" value={money(row.conservative_resale)} />
                    <Stat label="Net Profit" value={money(row.expected_net_profit)} />
                    <Stat label="ROI" value={percent(row.roi_percent)} />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-neutral-700">
                    {row.evaluation?.reason || "Evaluation receipt stored."}
                  </p>
                  <a
                    href={row.listing_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-full bg-black px-4 py-2.5 text-sm font-black text-white"
                  >
                    OPEN LISTING
                  </a>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Mac Run History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[850px] w-full text-left text-sm">
              <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-5 py-3">Completed</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Discovered</th>
                  <th className="px-5 py-3">Evaluated</th>
                  <th className="px-5 py-3">Actionable</th>
                  <th className="px-5 py-3">Review</th>
                  <th className="px-5 py-3">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-5 py-4 font-bold">{time(run.completed_at)}</td>
                    <td className="px-5 py-4 font-black">{run.status}</td>
                    <td className="px-5 py-4">{run.discovery_count}</td>
                    <td className="px-5 py-4">{run.evaluated_count}</td>
                    <td className="px-5 py-4">{run.actionable_count}</td>
                    <td className="px-5 py-4">{run.manual_review_count}</td>
                    <td className="px-5 py-4">{run.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white/70 p-3">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}
