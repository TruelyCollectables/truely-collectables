import Link from "next/link";
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

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-8 text-neutral-950">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href={addAdminHandoff("/admin/market-intel/delivery", handoff)}
          className="text-sm font-black hover:underline"
        >
          ← Email Delivery Center
        </Link>

        <section className="rounded-2xl border border-neutral-800 bg-[#101418] p-7 text-white shadow-sm">
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
          <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5 text-emerald-950">
            <h2 className="text-xl font-black">Test email accepted by Resend</h2>
            <p className="mt-2 font-semibold">
              Check the Outlook inbox and Junk Email folder for “TCOS Market Intel™
              test — alert delivery is armed.”
            </p>
          </section>
        ) : null}

        {query?.error ? (
          <section className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-rose-950">
            <h2 className="text-xl font-black">Test failed</h2>
            <p className="mt-2 font-semibold">{query.error}</p>
          </section>
        ) : null}

        <section
          className={
            ready
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-6"
              : "rounded-xl border border-rose-200 bg-rose-50 p-6"
          }
        >
          <p className="text-xs font-black uppercase tracking-[0.16em]">
            Production configuration
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {ready ? "Ready to test" : "Configuration is incomplete"}
          </h2>
          <dl className="mt-5 grid gap-3 text-sm font-semibold sm:grid-cols-2">
            <div className="rounded-lg border border-black/10 bg-white/60 p-4">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                Enabled
              </dt>
              <dd className="mt-1 text-lg font-black">{config.enabled ? "YES" : "NO"}</dd>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/60 p-4">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                API key
              </dt>
              <dd className="mt-1 text-lg font-black">{config.apiKey ? "CONFIGURED" : "MISSING"}</dd>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/60 p-4 sm:col-span-2">
              <dt className="text-xs font-black uppercase tracking-wide text-neutral-500">
                From
              </dt>
              <dd className="mt-1 break-all font-black">{config.from || "Not set"}</dd>
            </div>
            <div className="rounded-lg border border-black/10 bg-white/60 p-4 sm:col-span-2">
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
            <p className="mt-4 rounded-lg border border-rose-200 bg-white p-4 font-bold text-rose-900">
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
            <button
              type="submit"
              disabled={!ready}
              className="w-full rounded-md bg-black px-5 py-4 text-lg font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Send Test Email Now
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
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
