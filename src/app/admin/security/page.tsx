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

export default async function AdminSecurityPage() {
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("admin_login_attempts")
    .select(
      "id,ip_address,user_agent,success,failure_reason,lockout_until,identity_risk,created_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(100);

  const attempts = (data ?? []) as AdminLoginAttempt[];
  const failedAttempts = attempts.filter((attempt) => !attempt.success);
  const successfulAttempts = attempts.filter((attempt) => attempt.success);
  const activeLockouts = attempts.filter((attempt) =>
    isActiveLockout(attempt.lockout_until),
  );
  const uniqueIps = new Set(
    attempts.map((attempt) => attempt.ip_address).filter(Boolean),
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
              Admin Login Security
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Review recent admin login attempts, lockouts, identity risk, and
              IP activity for Store #{storeId.slice(-4)}.
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
        {error ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <h2 className="text-xl font-black">Login Audit Unavailable</h2>
            <p className="mt-2 text-sm font-semibold">
              {error.message}
            </p>
            <p className="mt-2 text-sm">
              Apply the `20260628180000_create_admin_login_attempts.sql`
              migration to enable persistent login audit and lockout storage.
            </p>
          </section>
        ) : null}

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
