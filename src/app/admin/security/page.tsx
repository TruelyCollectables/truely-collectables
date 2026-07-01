import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import { getActiveStoreId } from "../../../lib/stores";
import { adminLoginSecurityPolicy } from "../../../lib/admin-login-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AdminLoginAttempt = {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  lockout_until: string | null;
  identity_risk: string | null;
  created_at: string;
};

type PublicRateLimitEvent = {
  id: string;
  endpoint_key: string;
  subject_key: string | null;
  ip_address: string | null;
  user_agent: string | null;
  blocked: boolean;
  block_reason: string | null;
  window_seconds: number;
  max_attempts: number;
  identity_risk: string | null;
  identity_evidence: Record<string, string | null> | null;
  created_at: string;
};

function shortDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isActiveLockout(value: string | null) {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function statusTone(attempt: AdminLoginAttempt) {
  if (attempt.success) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (isActiveLockout(attempt.lockout_until)) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-amber-200 bg-amber-50 text-amber-800";
}

function statusLabel(attempt: AdminLoginAttempt) {
  if (attempt.success) return "SUCCESS";
  if (isActiveLockout(attempt.lockout_until)) return "LOCKED";
  return "FAILED";
}

function normalizeReason(value: string | null) {
  return value ? value.replaceAll("_", " ").toUpperCase() : "NONE";
}

function endpointLabel(value: string) {
  const labels: Record<string, string> = {
    checkout: "Checkout",
    public_offer_create: "Public Offer",
    binding_offer_setup: "Binding Offer",
    seller_payout_onboarding: "Seller Payout",
  };

  return labels[value] || normalizeReason(value);
}

function rateLimitTone(event: PublicRateLimitEvent) {
  if (event.blocked) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (event.identity_risk === "unchecked") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function rateLimitLabel(event: PublicRateLimitEvent) {
  if (event.blocked) return "BLOCKED";
  if (event.identity_risk === "unchecked") return "WATCH";
  return "ALLOWED";
}

function evidenceSummary(event: PublicRateLimitEvent) {
  const evidence = event.identity_evidence || {};
  const values = [
    evidence.cf_connecting_ip,
    evidence.true_client_ip,
    evidence.x_real_ip,
    evidence.x_forwarded_for,
    evidence.forwarded,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" | ") : "No header evidence";
}

export default async function AdminSecurityPage() {
  const storeId = getActiveStoreId();
  const [loginResult, rateLimitResult] = await Promise.all([
    supabase
    .from("admin_login_attempts")
    .select(
      "id,ip_address,user_agent,success,failure_reason,lockout_until,identity_risk,created_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("public_endpoint_rate_limit_events")
      .select(
        "id,endpoint_key,subject_key,ip_address,user_agent,blocked,block_reason,window_seconds,max_attempts,identity_risk,identity_evidence,created_at",
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(150),
  ]);

  const attempts = (loginResult.data ?? []) as AdminLoginAttempt[];
  const rateLimitEvents = (rateLimitResult.data ?? []) as PublicRateLimitEvent[];
  const failedAttempts = attempts.filter((attempt) => !attempt.success);
  const successfulAttempts = attempts.filter((attempt) => attempt.success);
  const activeLockouts = attempts.filter((attempt) =>
    isActiveLockout(attempt.lockout_until),
  );
  const uniqueIps = new Set(
    attempts.map((attempt) => attempt.ip_address).filter(Boolean),
  );
  const blockedRateLimitEvents = rateLimitEvents.filter((event) => event.blocked);
  const watchRateLimitEvents = rateLimitEvents.filter(
    (event) => !event.blocked && event.identity_risk === "unchecked",
  );
  const uniqueRateLimitIps = new Set(
    rateLimitEvents.map((event) => event.ip_address).filter(Boolean),
  );
  const endpointCounts = rateLimitEvents.reduce<Record<string, number>>(
    (counts, event) => {
      counts[event.endpoint_key] = (counts[event.endpoint_key] || 0) + 1;
      return counts;
    },
    {},
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Security Center
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Security Command Center
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Review admin login attempts, public money-path throttles,
              identity risk, and IP activity for Store #{storeId.slice(-4)}.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/settings" label="Settings" />
            <CommandLink href="/admin/launch-readiness" label="Readiness" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {loginResult.error ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <h2 className="text-xl font-black">Login Audit Unavailable</h2>
            <p className="mt-2 text-sm font-semibold">
              {loginResult.error.message}
            </p>
            <p className="mt-2 text-sm">
              Apply the `20260628180000_create_admin_login_attempts.sql`
              migration to enable persistent login audit and lockout storage.
            </p>
          </section>
        ) : null}

        {rateLimitResult.error ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <h2 className="text-xl font-black">Public Endpoint Audit Unavailable</h2>
            <p className="mt-2 text-sm font-semibold">
              {rateLimitResult.error.message}
            </p>
            <p className="mt-2 text-sm">
              Apply the
              `20260630113000_create_public_endpoint_rate_limit_events.sql`
              migration to enable public checkout, offer, binding-offer, and
              seller-onboarding rate-limit review.
            </p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Money Events" value={String(rateLimitEvents.length)} />
          <Metric
            label="Blocked Money Events"
            value={String(blockedRateLimitEvents.length)}
            tone="rose"
          />
          <Metric
            label="Watch Events"
            value={String(watchRateLimitEvents.length)}
            tone="amber"
          />
          <Metric label="Money IPs" value={String(uniqueRateLimitIps.size)} />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Public Money-Path Activity</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Checkout, public offers, seller payout onboarding, and binding
                offer setup events from the rate-limit audit table.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
              {Object.entries(endpointCounts).map(([endpoint, count]) => (
                <div
                  key={endpoint}
                  className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2"
                >
                  <p className="text-lg font-black">{count}</p>
                  <p className="text-xs font-bold uppercase text-neutral-500">
                    {endpointLabel(endpoint)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Endpoint</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rateLimitEvents.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-neutral-600" colSpan={9}>
                      No public money-path rate-limit events recorded yet.
                    </td>
                  </tr>
                ) : (
                  rateLimitEvents.map((event) => (
                    <tr key={event.id} className="align-top">
                      <td className="px-4 py-4 font-semibold">
                        {shortDate(event.created_at)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded border px-2 py-1 text-xs font-black ${rateLimitTone(
                            event,
                          )}`}
                        >
                          {rateLimitLabel(event)}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-semibold">
                        {endpointLabel(event.endpoint_key)}
                      </td>
                      <td className="px-4 py-4 font-semibold">
                        {event.ip_address || "Unknown"}
                      </td>
                      <td className="max-w-[180px] px-4 py-4 text-xs text-neutral-600">
                        <span className="line-clamp-3 break-words">
                          {event.subject_key || "None"}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {normalizeReason(event.identity_risk)}
                      </td>
                      <td className="px-4 py-4">
                        {normalizeReason(event.block_reason)}
                      </td>
                      <td className="px-4 py-4">
                        {event.max_attempts} / {Math.round(event.window_seconds / 60)}m
                      </td>
                      <td className="max-w-[360px] px-4 py-4 text-xs text-neutral-600">
                        <span className="line-clamp-3 break-words">
                          {evidenceSummary(event)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Recent Attempts" value={String(attempts.length)} />
          <Metric label="Successful" value={String(successfulAttempts.length)} tone="green" />
          <Metric label="Failed" value={String(failedAttempts.length)} tone="amber" />
          <Metric label="Active Lockouts" value={String(activeLockouts.length)} tone="rose" />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Unique IPs" value={String(uniqueIps.size)} />
          <Metric
            label="Failed Limit"
            value={String(adminLoginSecurityPolicy.maxFailedAttempts)}
          />
          <Metric
            label="Window"
            value={`${adminLoginSecurityPolicy.loginWindowMinutes} min`}
          />
          <Metric
            label="Lockout"
            value={`${adminLoginSecurityPolicy.lockoutMinutes} min`}
          />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <h2 className="text-2xl font-black">Recent Login Attempts</h2>
            <p className="mt-1 text-sm text-neutral-600">
              Showing the latest 100 attempts. Successful attempts are kept for
              audit context; failed attempts drive lockout policy.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Lockout Until</th>
                  <th className="px-4 py-3">User Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {attempts.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-neutral-600" colSpan={7}>
                      No admin login attempts recorded yet.
                    </td>
                  </tr>
                ) : (
                  attempts.map((attempt) => (
                    <tr key={attempt.id} className="align-top">
                      <td className="px-4 py-4 font-semibold">
                        {shortDate(attempt.created_at)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded border px-2 py-1 text-xs font-black ${statusTone(
                            attempt,
                          )}`}
                        >
                          {statusLabel(attempt)}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-semibold">
                        {attempt.ip_address || "Unknown"}
                      </td>
                      <td className="px-4 py-4">
                        {normalizeReason(attempt.identity_risk)}
                      </td>
                      <td className="px-4 py-4">
                        {normalizeReason(attempt.failure_reason)}
                      </td>
                      <td className="px-4 py-4">
                        {shortDate(attempt.lockout_until)}
                      </td>
                      <td className="max-w-[320px] px-4 py-4 text-xs text-neutral-600">
                        <span className="line-clamp-3 break-words">
                          {attempt.user_agent || "Unknown"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "green" | "amber" | "rose";
}) {
  const toneClass =
    tone === "green"
      ? "text-emerald-700"
      : tone === "amber"
      ? "text-amber-700"
      : tone === "rose"
      ? "text-rose-700"
      : "text-neutral-950";

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className={`mt-3 text-3xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function CommandLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold text-white hover:bg-white/10"
    >
      {label}
    </Link>
  );
}
