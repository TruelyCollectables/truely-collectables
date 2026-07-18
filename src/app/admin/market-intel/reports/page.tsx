import Link from "next/link";
import AdminSubmitButton from "../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import {
  getMarketIntelReportsAndAlerts,
  type MarketIntelAlertRow,
} from "../../../../lib/market-intel-reporting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    generated?: string;
    synced?: string;
    created?: string;
    expired?: string;
    alertUpdated?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "—"
    : `$${Number(value).toFixed(2)}`;
}

function time(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function label(value: string | null | undefined) {
  return String(value || "not set").replaceAll("_", " ").toUpperCase();
}

function alertTone(value: string | null | undefined) {
  if (value === "too_good_to_be_true") {
    return "border-fuchsia-300 bg-fuchsia-100 text-fuchsia-950";
  }
  if (value === "steal") {
    return "border-emerald-300 bg-emerald-100 text-emerald-950";
  }
  if (value === "great_buy") {
    return "border-lime-300 bg-lime-100 text-lime-950";
  }
  if (value === "good_buy") {
    return "border-cyan-300 bg-cyan-100 text-cyan-950";
  }
  if (value === "wholesale_opportunity") {
    return "border-amber-300 bg-amber-100 text-amber-950";
  }
  if (value === "mislisted") {
    return "border-violet-300 bg-violet-100 text-violet-950";
  }
  return "border-neutral-300 bg-neutral-100 text-neutral-800";
}

export default async function MarketIntelReportsPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];

  let reports: Awaited<ReturnType<typeof getMarketIntelReportsAndAlerts>>["reports"] = [];
  let alerts: Awaited<ReturnType<typeof getMarketIntelReportsAndAlerts>>["alerts"] = [];
  let loadError: string | null = null;

  try {
    const data = await getMarketIntelReportsAndAlerts();
    reports = data.reports;
    alerts = data.alerts;
  } catch (error) {
    loadError =
      error instanceof Error ? error.message : "Unable to load reports and alerts.";
  }

  const latestReport = reports[0] || null;
  const pendingAlerts = alerts.filter((alert) => alert.status === "pending");
  const sentAlerts = alerts.filter((alert) => alert.status === "sent");
  const dismissedAlerts = alerts.filter(
    (alert) => alert.status === "dismissed",
  );
  const expiredAlerts = alerts.filter((alert) => alert.status === "expired");

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
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Daily Intelligence + Alert Outbox
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Qualified deals persist here with direct links and duplicate suppression.
            Daily reports are generated from the same watchlists, sold comps, listings,
            scores, and purchase ledger used by the rest of Beta One.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.generated === "1" ? (
          <Notice>Today’s Market Intelligence report was generated.</Notice>
        ) : null}
        {query?.synced === "1" ? (
          <Notice>
            Alert outbox synced: {query.created || "0"} new and {query.expired || "0"} expired.
          </Notice>
        ) : null}
        {query?.alertUpdated ? (
          <Notice>Alert marked {label(query.alertUpdated)}.</Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {loadError ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-xl font-black">Alert/report migration required</h2>
            <p className="mt-2 font-semibold leading-6">
              {loadError}
            </p>
            <p className="mt-3 text-sm font-bold">
              Apply <code>supabase/migrations/20260717_tcos_market_intel_beta_one_alerts_reports.sql</code> in Supabase SQL Editor, then reload this page.
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Metric label="Pending" value={String(pendingAlerts.length)} />
          <Metric label="Sent" value={String(sentAlerts.length)} />
          <Metric label="Dismissed" value={String(dismissedAlerts.length)} />
          <Metric label="Expired" value={String(expiredAlerts.length)} />
          <Metric label="Report Runs" value={String(reports.length)} />
        </section>

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <form
            method="post"
            action={addAdminHandoff(
              "/api/admin/market-intel/alerts/sync",
              handoff,
            )}
            className="rounded-xl border border-cyan-200 bg-cyan-50 p-6"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
              Hourly Operation
            </p>
            <h2 className="mt-1 text-2xl font-black">Sync Alert Outbox</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-cyan-950">
              Creates new alerts for currently actionable listings, refreshes still-valid
              opportunities, and expires pending alerts whose deal state no longer qualifies.
            </p>
            <AdminSubmitButton
              className="mt-4 rounded-md bg-cyan-800 px-4 py-2.5 text-sm font-black text-white"
              pendingChildren="Syncing alerts..."
            >
              Sync Alerts Now
            </AdminSubmitButton>
          </form>

          <form
            method="post"
            action={addAdminHandoff(
              "/api/admin/market-intel/reports/generate",
              handoff,
            )}
            className="rounded-xl border border-amber-200 bg-amber-50 p-6"
          >
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Daily Operation
            </p>
            <h2 className="mt-1 text-2xl font-black">Generate Daily Intelligence</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-amber-950">
              Rebuilds today’s Top 10 Shark List, market movers, portfolio summary,
              and alert status from the latest Beta One database state.
            </p>
            <AdminSubmitButton
              className="mt-4 rounded-md bg-black px-4 py-2.5 text-sm font-black text-white"
              pendingChildren="Generating report..."
            >
              Generate Today’s Report
            </AdminSubmitButton>
          </form>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 p-5">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
                Instant Deal Queue
              </p>
              <h2 className="mt-1 text-3xl font-black">Pending Alerts</h2>
            </div>

            {pendingAlerts.length === 0 ? (
              <div className="p-6">
                <h3 className="text-xl font-black">No pending alerts.</h3>
                <p className="mt-2 font-semibold text-neutral-600">
                  Sync the outbox after listings are ingested and scored. Only actionable
                  deals create alerts.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-200">
                {pendingAlerts.map((alert) => (
                  <AlertCard key={alert.id} alert={alert} handoff={handoff} />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
                  Latest Generated Report
                </p>
                <h2 className="mt-1 text-3xl font-black">
                  {latestReport?.report_date || "Not generated"}
                </h2>
              </div>
              {latestReport ? (
                <span className="text-xs font-black uppercase text-neutral-400">
                  {time(latestReport.generated_at)}
                </span>
              ) : null}
            </div>

            {latestReport ? (
              <>
                <p className="mt-4 rounded-lg border border-neutral-700 bg-neutral-900 p-4 font-black text-lime-300">
                  {latestReport.headline || "Daily Market Intelligence"}
                </p>
                <pre className="mt-4 max-h-[900px] overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-700 bg-black p-4 text-xs leading-6 text-neutral-200">
                  {latestReport.report_markdown}
                </pre>
              </>
            ) : (
              <p className="mt-4 font-semibold text-neutral-300">
                Generate the first daily report after the alert/report migration is applied.
              </p>
            )}
          </section>
        </section>

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Report History</h2>
          </div>
          {reports.length === 0 ? (
            <p className="p-6 font-semibold text-neutral-600">No report runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">Report Date</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Headline</th>
                    <th className="px-5 py-3">Generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {reports.map((report) => (
                    <tr key={report.id}>
                      <td className="px-5 py-4 font-black">{report.report_date}</td>
                      <td className="px-5 py-4">{label(report.report_type)}</td>
                      <td className="px-5 py-4">{label(report.status)}</td>
                      <td className="max-w-xl px-5 py-4">{report.headline || "—"}</td>
                      <td className="px-5 py-4">{time(report.generated_at)}</td>
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

function AlertCard({
  alert,
  handoff,
}: {
  alert: MarketIntelAlertRow;
  handoff: string | null | undefined;
}) {
  const discount = Number(alert.metadata.discount_pct || 0);
  const confidence = Number(alert.metadata.confidence_score || 0);
  const liquidity = Number(alert.metadata.liquidity_score || 0);
  const risk = Number(alert.metadata.risk_score || 0);

  return (
    <article className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <span
            className={`inline-block rounded-full border px-2.5 py-1 text-xs font-black ${alertTone(
              alert.deal_label,
            )}`}
          >
            {label(alert.deal_label)}
          </span>
          <a
            href={alert.direct_url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-xl font-black hover:underline"
          >
            {alert.title}
          </a>
          <p className="mt-2 text-sm font-semibold leading-6 text-neutral-700">
            {alert.summary || "No alert summary saved."}
          </p>
          <p className="mt-2 text-xs font-black uppercase tracking-wide text-neutral-500">
            {discount.toFixed(1)}% below market · confidence {confidence.toFixed(0)} · liquidity {liquidity.toFixed(0)} · risk {risk.toFixed(0)}
          </p>
        </div>

        <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
          <SmallStat label="Delivered" value={money(alert.delivered_cost)} />
          <SmallStat label="Net Profit" value={money(alert.expected_net_profit)} />
          <SmallStat label="Buy Score" value={alert.buy_score?.toFixed(0) || "—"} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={alert.direct_url}
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-black px-4 py-2 text-sm font-black text-white"
        >
          OPEN LISTING
        </a>
        <form
          method="post"
          action={addAdminHandoff(
            `/api/admin/market-intel/alerts/${alert.id}/status`,
            handoff,
          )}
        >
          <input type="hidden" name="status" value="sent" />
          <AdminSubmitButton
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white"
            pendingChildren="Marking sent..."
          >
            Mark Sent
          </AdminSubmitButton>
        </form>
        <form
          method="post"
          action={addAdminHandoff(
            `/api/admin/market-intel/alerts/${alert.id}/status`,
            handoff,
          )}
        >
          <input type="hidden" name="status" value="dismissed" />
          <AdminSubmitButton
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-black"
            pendingChildren="Dismissing..."
          >
            Dismiss
          </AdminSubmitButton>
        </form>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-black">{value}</p>
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

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      className={
        error
          ? "rounded-lg border border-rose-200 bg-rose-50 p-4 font-bold text-rose-900"
          : "rounded-lg border border-emerald-200 bg-emerald-50 p-4 font-bold text-emerald-900"
      }
    >
      {children}
    </div>
  );
}
