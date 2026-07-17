import Link from "next/link";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../lib/admin-handoff";
import { getMarketIntelDeliveryConfig } from "../../../../lib/market-intel-delivery";
import { getMarketIntelReportsAndAlerts } from "../../../../lib/market-intel-reporting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    alertsDelivered?: string;
    reportDelivered?: string;
    error?: string;
    [ADMIN_HANDOFF_PARAM]?: string;
  }>;
};

function maskEmail(value: string) {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "Configured recipient";
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(2, local.length - visible.length))}@${domain}`;
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

export default async function MarketIntelDeliveryPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const config = getMarketIntelDeliveryConfig();

  let reports: Awaited<ReturnType<typeof getMarketIntelReportsAndAlerts>>["reports"] = [];
  let alerts: Awaited<ReturnType<typeof getMarketIntelReportsAndAlerts>>["alerts"] = [];
  let loadError: string | null = null;

  try {
    const data = await getMarketIntelReportsAndAlerts();
    reports = data.reports;
    alerts = data.alerts;
  } catch (error) {
    loadError =
      error instanceof Error
        ? error.message
        : "Unable to load alert and report delivery data.";
  }

  const pending = alerts.filter((alert) => alert.status === "pending");
  const sent = alerts.filter((alert) => alert.status === "sent");
  const latestReport = reports[0] || null;
  const deliveredReports = reports.filter(
    (report) => report.status === "delivered",
  );

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
          <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-lime-300">
            TCOS Market Intel™ Beta One
          </p>
          <h1 className="mt-2 text-4xl font-black md:text-5xl">
            Email Delivery Center
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-300">
            Pending deal alerts and the daily intelligence report can be delivered through
            Resend with exact live listing links. Successful sends are written back to the
            alert outbox and report history so nothing unchanged gets sent twice.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {query?.alertsDelivered !== undefined ? (
          <Notice>
            Delivered {query.alertsDelivered} pending alert
            {query.alertsDelivered === "1" ? "" : "s"} by email.
          </Notice>
        ) : null}
        {query?.reportDelivered ? (
          <Notice>
            {query.reportDelivered === "1"
              ? "The latest daily report was delivered by email."
              : "The latest daily report was already delivered."}
          </Notice>
        ) : null}
        {query?.error ? <Notice error>{query.error}</Notice> : null}

        {loadError ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-950">
            <h2 className="text-xl font-black">Alert/report migration required</h2>
            <p className="mt-2 font-semibold leading-6">{loadError}</p>
            <p className="mt-3 text-sm font-bold">
              Apply <code>supabase/migrations/20260717_tcos_market_intel_beta_one_alerts_reports.sql</code> in Supabase SQL Editor before using delivery.
            </p>
          </section>
        ) : null}

        <section
          className={
            config.configured && config.enabled
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950"
              : "rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-950"
          }
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em]">
                Delivery Configuration
              </p>
              <h2 className="mt-1 text-2xl font-black">
                {config.configured && config.enabled
                  ? "Email delivery is ready"
                  : config.enabled
                    ? "Email delivery needs configuration"
                    : "Email delivery is disabled"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm font-semibold leading-6">
                {config.configured
                  ? `Configured for ${config.recipients.length} recipient${config.recipients.length === 1 ? "" : "s"}.`
                  : `Missing: ${config.missing.join(", ") || "No missing values"}.`}
              </p>
            </div>
            <div className="rounded-lg border border-current/20 bg-white/50 p-4 text-sm font-bold">
              <p>Enabled: {config.enabled ? "YES" : "NO"}</p>
              <p>From: {config.from || "Not set"}</p>
              <p>
                To: {config.recipients.length
                  ? config.recipients.map(maskEmail).join(", ")
                  : "Not set"}
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Pending Alerts" value={String(pending.length)} />
          <Metric label="Sent Alerts" value={String(sent.length)} />
          <Metric label="Generated Reports" value={String(reports.length)} />
          <Metric label="Delivered Reports" value={String(deliveredReports.length)} />
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-800">
              Hourly Deal Delivery
            </p>
            <h2 className="mt-1 text-3xl font-black">Send Pending Alerts</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-cyan-950">
              Sends up to 10 highest-scoring pending alerts in one email. Every card includes
              the deal label, delivered cost, exact-card market value, expected net profit,
              Buy Score, risk, and an OPEN LISTING button to the exact live item.
            </p>
            <form
              method="post"
              action={addAdminHandoff(
                "/api/admin/market-intel/alerts/deliver",
                handoff,
              )}
              className="mt-5"
            >
              <input type="hidden" name="limit" value="10" />
              <button
                type="submit"
                disabled={!config.configured || !config.enabled || pending.length === 0}
                className="w-full rounded-md bg-cyan-800 px-4 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send {Math.min(10, pending.length)} Pending Alert
                {Math.min(10, pending.length) === 1 ? "" : "s"}
              </button>
            </form>
            <p className="mt-3 text-xs font-bold text-cyan-900">
              Automatic schedule: every hour at minute 20, after the eBay scan and alert sync.
            </p>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-800">
              Daily Intelligence Delivery
            </p>
            <h2 className="mt-1 text-3xl font-black">Send Latest Report</h2>
            <p className="mt-3 text-sm font-semibold leading-6 text-amber-950">
              Delivers the latest generated daily report with the Top 10 Shark List,
              market movers, portfolio totals, realized GP, and alert activity. Reports
              already marked delivered are not sent again.
            </p>
            <form
              method="post"
              action={addAdminHandoff(
                "/api/admin/market-intel/reports/deliver",
                handoff,
              )}
              className="mt-5"
            >
              {latestReport ? (
                <input type="hidden" name="reportId" value={latestReport.id} />
              ) : null}
              <button
                type="submit"
                disabled={!config.configured || !config.enabled || !latestReport}
                className="w-full rounded-md bg-black px-4 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {latestReport?.status === "delivered"
                  ? "Report Already Delivered"
                  : "Send Latest Daily Report"}
              </button>
            </form>
            <p className="mt-3 text-xs font-bold text-amber-900">
              Latest report: {latestReport ? `${latestReport.report_date} · ${time(latestReport.generated_at)}` : "Not generated"}
            </p>
          </section>
        </section>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 p-5">
              <h2 className="text-2xl font-black">Pending Delivery Queue</h2>
            </div>
            {pending.length === 0 ? (
              <p className="p-6 font-semibold text-neutral-600">No pending deal alerts.</p>
            ) : (
              <div className="divide-y divide-neutral-200">
                {pending.slice(0, 20).map((alert) => (
                  <article key={alert.id} className="p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
                          {alert.deal_label?.replaceAll("_", " ").toUpperCase() || "DEAL"}
                        </p>
                        <a
                          href={alert.direct_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block text-lg font-black hover:underline"
                        >
                          {alert.title}
                        </a>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">
                          Queued {time(alert.created_at)}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <SmallStat
                          label="Net Profit"
                          value={
                            alert.expected_net_profit === null
                              ? "—"
                              : `$${alert.expected_net_profit.toFixed(2)}`
                          }
                        />
                        <SmallStat
                          label="Buy Score"
                          value={alert.buy_score?.toFixed(0) || "—"}
                        />
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-neutral-800 bg-[#101418] p-6 text-white">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
              Required Production Variables
            </p>
            <h2 className="mt-1 text-2xl font-black">Vercel Environment</h2>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-700 bg-black p-4 text-xs leading-6 text-neutral-200">{`MARKET_INTEL_EMAIL_ENABLED=true
MARKET_INTEL_FROM_EMAIL=TCOS Market Intel <alerts@your-verified-domain.com>
MARKET_INTEL_ALERT_EMAIL=your-private-inbox@example.com
RESEND_API_KEY=already-used-by-the-store`}</pre>
            <p className="mt-4 text-sm font-semibold leading-6 text-neutral-300">
              The sender address must use a domain verified in Resend. Recipient values can
              contain multiple addresses separated by commas or semicolons. Do not put these
              values into NEXT_PUBLIC variables.
            </p>
          </section>
        </section>
      </div>
    </main>
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
