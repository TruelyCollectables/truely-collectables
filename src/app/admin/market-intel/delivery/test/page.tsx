import Link from "next/link";
import AdminSubmitButton from "../../../AdminSubmitButton";
import {
  addAdminHandoff,
  ADMIN_HANDOFF_PARAM,
} from "../../../../../lib/admin-handoff";
import { getMarketIntelDeliveryConfig } from "../../../../../lib/market-intel-delivery";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    sent?: string;
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

export default async function MarketIntelTestEmailPage({
  searchParams,
}: PageProps) {
  const query = await searchParams;
  const handoff = query?.[ADMIN_HANDOFF_PARAM];
  const config = getMarketIntelDeliveryConfig();
  const ready = config.configured && config.enabled;
  const disabledReason = !config.configured
    ? `Email delivery is missing: ${config.missing.join(", ") || "required configuration"}.`
    : !config.enabled
      ? "Email delivery is disabled in configuration."
      : "";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(132,204,22,0.16),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <Link
          href={addAdminHandoff("/admin/market-intel/delivery", handoff)}
          className="inline-flex rounded-full border border-neutral-300 bg-white/90 px-4 py-2 text-sm font-black shadow-sm transition hover:bg-white"
        >
          ← Email Delivery Center
        </Link>

        <section className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 p-7 text-white shadow-2xl shadow-neutral-950/10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-300">
            TCOS Market Intel™
          </p>
          <h1 className="mt-2 text-4xl font-black">Send a controlled test email</h1>
          <p className="mt-3 font-semibold leading-7 text-neutral-300">
            This confirms the production Vercel variables, Resend API key, verified
            sender domain, and private recipient inbox without creating a fake deal.
          </p>
        </section>

        {query?.sent === "1" ? (
          <section className="rounded-3xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950 shadow-sm ring-1 ring-emerald-950/5">
            <h2 className="text-xl font-black">Test email accepted by Resend</h2>
            <p className="mt-2 font-semibold">
              Check the Outlook inbox and Junk Email folder for “TCOS Market Intel™
              test — alert delivery is armed.”
            </p>
          </section>
        ) : null}

        {query?.error ? (
          <section className="rounded-3xl border border-rose-300 bg-rose-50 p-5 text-rose-950 shadow-sm ring-1 ring-rose-950/5">
            <h2 className="text-xl font-black">Test failed</h2>
            <p className="mt-2 font-semibold">{query.error}</p>
          </section>
        ) : null}

        <section
          className={
            ready
              ? "rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm ring-1 ring-emerald-950/5"
              : "rounded-3xl border border-rose-200 bg-rose-50 p-6 shadow-sm ring-1 ring-rose-950/5"
          }
        >
          <p className="text-xs font-black uppercase tracking-[0.16em]">
            Production configuration
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {ready ? "Ready to test" : "Configuration is incomplete"}
          </h2>
          <dl className="mt-5 grid gap-3 text-sm font-semibold sm:grid-cols-2">
            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-inner">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                Enabled
              </dt>
              <dd className="mt-1 text-lg font-black">{config.enabled ? "YES" : "NO"}</dd>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-inner">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                API key
              </dt>
              <dd className="mt-1 text-lg font-black">{config.apiKey ? "CONFIGURED" : "MISSING"}</dd>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-inner sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                From
              </dt>
              <dd className="mt-1 break-all font-black">{config.from || "Not set"}</dd>
            </div>
            <div className="rounded-2xl border border-black/10 bg-white/60 p-4 shadow-inner sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                To
              </dt>
              <dd className="mt-1 font-black">
                {config.recipients.length
                  ? config.recipients.map(maskEmail).join(", ")
                  : "Not set"}
              </dd>
            </div>
          </dl>

          {!ready ? (
            <p className="mt-4 rounded-2xl border border-rose-200 bg-white p-4 font-bold text-rose-900 shadow-sm ring-1 ring-rose-950/5">
              Missing: {config.missing.join(", ") || "Email delivery is disabled"}
            </p>
          ) : null}

          <form
            method="post"
            action={addAdminHandoff(
              "/api/admin/market-intel/delivery/test",
              handoff,
            )}
            className="mt-6"
          >
            <AdminSubmitButton
              disabled={!ready}
              disabledReason={disabledReason}
              title={disabledReason || "Send a controlled Market Intel test email."}
              className="w-full rounded-2xl bg-black px-5 py-4 text-lg font-black text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
              pendingChildren="Sending test email..."
            >
              Send Test Email Now
            </AdminSubmitButton>
          </form>
        </section>

        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm ring-1 ring-amber-950/5">
          <h2 className="text-xl font-black">After it lands</h2>
          <p className="mt-2 font-semibold leading-6">
            Mark it as safe if Outlook places it in Junk. Then the next operational
            step is loading exact licensed non-base card identities and real sold comps
            so the hourly scanner has markets it can evaluate.
          </p>
        </section>
      </div>
    </main>
  );
}
