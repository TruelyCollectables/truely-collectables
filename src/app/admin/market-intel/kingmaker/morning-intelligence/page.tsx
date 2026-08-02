import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../lib/admin-handoff";
import { getMarketIntelDeliveryConfig } from "../../../../../lib/market-intel-delivery";
import { buildLiveKingmakerMorningIntelligence } from "../../../../../lib/kingmaker-morning-intelligence-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    sent?: string;
    dryRun?: string;
    skipped?: string;
    reason?: string;
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

export default async function KingmakerMorningIntelligencePage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const config = getMarketIntelDeliveryConfig();
  const deliveryReady = config.configured && config.enabled;
  const preview = await buildLiveKingmakerMorningIntelligence({ forceFull: true })
    .then((payload) => ({ ok: true as const, payload }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));

  const payload = preview.ok ? preview.payload : null;
  const disabledReason = !deliveryReady
    ? `Email delivery is unavailable: ${config.missing.join(", ") || "disabled"}.`
    : !payload
      ? "A decision-grade preview could not be built."
      : payload.mode === "withheld"
        ? "Truth gates are restricted. Resolve the warnings before sending buying guidance."
        : "";

  return (
    <main className="min-h-screen bg-[#05070a] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_4%,rgba(16,185,129,.16),transparent_30%),radial-gradient(circle_at_88%_4%,rgba(245,158,11,.15),transparent_28%),linear-gradient(180deg,#080c11,#020304)]" />
      <div className="relative mx-auto max-w-6xl space-y-5">
        <Link
          href={addAdminHandoff("/admin/market-intel/kingmaker", handoff)}
          className="inline-flex rounded-full border border-white/15 bg-white/[.06] px-4 py-2 text-xs font-black uppercase tracking-[.16em] text-neutral-200 hover:bg-white/10"
        >
          ← Project KINGMAKER Beta 1.0
        </Link>

        <header className="rounded-[2rem] border border-white/10 bg-black/70 p-6 shadow-2xl backdrop-blur-xl lg:p-9">
          <p className="text-xs font-black uppercase tracking-[.3em] text-amber-300">Morning Intelligence</p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-6xl">Controlled Delivery Console</h1>
          <p className="mt-4 max-w-4xl text-base font-semibold leading-7 text-neutral-400 sm:text-lg">
            Preview the exact live decision payload, prove duplicate suppression, and deliberately send one full verification email before the 7:00 AM Mountain schedule is trusted.
          </p>
        </header>

        {query?.sent === "1" ? (
          <Notice tone="success" title="KINGMAKER email accepted by Resend" detail="The forced verification delivery was submitted. Confirm the subject, links, portfolio signals, warnings, and recipient inbox before relying on the scheduled run." />
        ) : null}
        {query?.dryRun === "1" ? (
          <Notice tone="success" title="Dry run completed" detail={`The live payload was built without sending email. ${query.reason ? `Result: ${query.reason}.` : ""}`} />
        ) : null}
        {query?.skipped === "1" ? (
          <Notice tone="warning" title="Delivery intentionally skipped" detail={query.reason || "No material change required delivery."} />
        ) : null}
        {query?.error ? (
          <Notice tone="error" title="Controlled run failed" detail={query.error} />
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
          <div className="rounded-[1.75rem] border border-white/10 bg-white/[.035] p-5 lg:p-7">
            <p className="text-xs font-black uppercase tracking-[.2em] text-emerald-300">Live Preview</p>
            <h2 className="mt-1 text-3xl font-black">Decision payload now</h2>

            {!preview.ok ? (
              <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-400/10 p-5">
                <p className="font-black text-rose-200">Preview withheld</p>
                <p className="mt-2 font-semibold text-rose-100/75">{preview.error}</p>
              </div>
            ) : (
              <>
                <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-5">
                  <Metric label="Mode" value={preview.payload.mode.toUpperCase()} />
                  <Metric label="Actions" value={String(preview.payload.actionableDeals.length)} />
                  <Metric label="Changes" value={String(preview.payload.meaningfulChanges.length)} />
                  <Metric label="Portfolio" value={String(preview.payload.portfolioMovements.length)} />
                  <Metric label="Warnings" value={String(preview.payload.warnings.length)} />
                </div>
                <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-5">
                  <p className="text-xs font-black uppercase tracking-[.16em] text-neutral-500">Subject</p>
                  <p className="mt-2 text-xl font-black">{preview.payload.subject}</p>
                  <p className="mt-3 font-semibold leading-6 text-neutral-400">{preview.payload.headline}</p>
                  <p className="mt-4 break-all text-xs font-bold text-neutral-600">Fingerprint: {preview.payload.fingerprint}</p>
                </div>
                {preview.payload.warnings.length ? (
                  <div className="mt-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-5">
                    <p className="font-black text-amber-200">Warnings requiring owner review</p>
                    <ul className="mt-3 space-y-2 text-sm font-semibold text-amber-100/80">
                      {preview.payload.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <aside className="space-y-5">
            <section className={deliveryReady ? "rounded-[1.5rem] border border-emerald-300/25 bg-emerald-300/10 p-5" : "rounded-[1.5rem] border border-rose-400/25 bg-rose-400/10 p-5"}>
              <p className="text-xs font-black uppercase tracking-[.18em] text-neutral-300">Delivery Configuration</p>
              <h2 className="mt-2 text-2xl font-black">{deliveryReady ? "ARMED" : "RESTRICTED"}</h2>
              <p className="mt-3 text-sm font-semibold leading-6 text-neutral-300">
                From: {config.from || "missing"}<br />
                To: {config.recipients.length ? config.recipients.map(maskEmail).join(", ") : "missing"}<br />
                Schedule: 7:00 AM America/Denver
              </p>
            </section>

            <form method="post" action={addAdminHandoff("/api/admin/market-intel/kingmaker/morning-intelligence/test", handoff)} className="rounded-[1.5rem] border border-white/10 bg-white/[.035] p-5">
              <input type="hidden" name="mode" value="dry-run" />
              <p className="text-xs font-black uppercase tracking-[.18em] text-emerald-300">Safe Verification</p>
              <h2 className="mt-2 text-2xl font-black">Build without sending</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-neutral-400">Loads live deals, Purchase Ledger positions, truth health, readiness, and the prior fingerprint.</p>
              <AdminSubmitButton
                title="Build the current KINGMAKER morning-intelligence payload without sending email or changing delivery state."
                className="mt-5 w-full rounded-2xl border border-white/15 bg-white/[.08] px-4 py-3 font-black hover:bg-white/[.12]"
                pendingChildren="Building live payload..."
              >
                Run Controlled Dry Test
              </AdminSubmitButton>
            </form>

            <form method="post" action={addAdminHandoff("/api/admin/market-intel/kingmaker/morning-intelligence/test", handoff)} className="rounded-[1.5rem] border border-amber-300/25 bg-amber-300/[.08] p-5">
              <input type="hidden" name="mode" value="send" />
              <p className="text-xs font-black uppercase tracking-[.18em] text-amber-300">Deliberate Live Test</p>
              <h2 className="mt-2 text-2xl font-black">Force one full email</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-neutral-300">This bypasses duplicate suppression for verification, sends to configured private recipients, and records the resulting fingerprint.</p>
              <AdminSubmitButton
                disabled={Boolean(disabledReason)}
                disabledReason={disabledReason}
                title={disabledReason || "Send one forced KINGMAKER verification email."}
                className="mt-5 w-full rounded-2xl bg-amber-300 px-4 py-3 font-black text-black hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
                pendingChildren="Sending KINGMAKER verification..."
              >
                Send Forced Verification Email
              </AdminSubmitButton>
            </form>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-black/35 px-4 py-4"><p className="text-[10px] font-black uppercase tracking-[.16em] text-neutral-500">{label}</p><p className="mt-2 text-xl font-black">{value}</p></div>;
}

function Notice({ tone, title, detail }: { tone: "success" | "warning" | "error"; title: string; detail: string }) {
  const styles = tone === "success"
    ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
    : tone === "warning"
      ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
      : "border-rose-400/30 bg-rose-400/10 text-rose-100";
  return <section className={`rounded-2xl border p-5 ${styles}`}><h2 className="text-xl font-black">{title}</h2><p className="mt-2 font-semibold leading-6 opacity-80">{detail}</p></section>;
}
