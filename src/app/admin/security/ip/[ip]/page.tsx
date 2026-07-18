import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "../../../../../lib/supabase";
import { getActiveStoreId } from "../../../../../lib/stores";
import AdminSubmitButton from "../../../AdminSubmitButton";

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
  user_agent: string | null;
  blocked: boolean;
  block_reason: string | null;
  window_seconds: number;
  max_attempts: number;
  identity_risk: string | null;
  identity_evidence: Record<string, string | null> | null;
  created_at: string;
};

type TosEvent = {
  id: string;
  context_type: string;
  context_id: string | null;
  tos_kind: string;
  tos_version: string;
  user_agent: string | null;
  ip_risk: string | null;
  ip_block_reason: string | null;
  ip_evidence: Record<string, string | null> | null;
  created_at: string;
};

type Order = {
  id: number;
  account_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total: number | null;
  status: string | null;
  fulfillment_status: string | null;
  stripe_session_id: string | null;
  tos_accepted_at: string | null;
  tos_ip_risk: string | null;
  created_at: string;
};

type Offer = {
  id: number;
  account_id: string | null;
  product_id: number | null;
  customer_email: string | null;
  customer_name: string | null;
  offer_amount: number | null;
  counter_amount: number | null;
  status: string | null;
  stripe_session_id: string | null;
  tos_accepted_at: string | null;
  tos_ip_risk: string | null;
  created_at: string;
};

type EvidenceReport = {
  id: string;
  order_id: number;
  customer_email: string | null;
  total: number | null;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  created_at: string;
};

type SecurityIpInvestigation = {
  id: string;
  ip_address: string;
  status: "watch" | "review" | "resolved";
  severity: "low" | "medium" | "high" | "critical";
  notes: string | null;
  created_at: string;
  updated_at: string;
  last_reviewed_at: string | null;
  resolved_at: string | null;
};

const INVESTIGATION_STATUSES = ["watch", "review", "resolved"] as const;
const INVESTIGATION_SEVERITIES = ["low", "medium", "high", "critical"] as const;

async function saveIpInvestigation(formData: FormData) {
  "use server";

  const ipAddress = String(formData.get("ip_address") || "").trim();
  const status = String(formData.get("status") || "watch").trim();
  const severity = String(formData.get("severity") || "medium").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!ipAddress) {
    redirect("/admin/security?case=missing-ip");
  }

  if (
    !INVESTIGATION_STATUSES.includes(status as SecurityIpInvestigation["status"]) ||
    !INVESTIGATION_SEVERITIES.includes(
      severity as SecurityIpInvestigation["severity"],
    )
  ) {
    redirect(`/admin/security/ip/${encodeURIComponent(ipAddress)}?case=invalid`);
  }

  const now = new Date().toISOString();

  await supabase.from("security_ip_investigations").upsert(
    {
      store_id: getActiveStoreId(),
      ip_address: ipAddress,
      status,
      severity,
      notes: notes || null,
      updated_at: now,
      last_reviewed_at: now,
      resolved_at: status === "resolved" ? now : null,
    },
    {
      onConflict: "store_id,ip_address",
    },
  );

  redirect(`/admin/security/ip/${encodeURIComponent(ipAddress)}?case=saved`);
}

function shortDate(value: string | null) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ").toUpperCase() : "NONE";
}

function endpointLabel(value: string) {
  const labels: Record<string, string> = {
    checkout: "Checkout",
    public_offer_create: "Public Offer",
    binding_offer_setup: "Binding Offer",
    seller_payout_onboarding: "Seller Payout",
  };

  return labels[value] || label(value);
}

function riskTone(value: string | null | undefined) {
  if (value === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  if (value === "unchecked") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function statusTone(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();

  if (
    normalized.includes("blocked") ||
    normalized.includes("failed") ||
    normalized.includes("review") ||
    normalized.includes("declined")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (
    normalized.includes("pending") ||
    normalized.includes("counter") ||
    normalized.includes("unchecked")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function investigationTone(value: string | null | undefined) {
  if (value === "critical" || value === "review") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  if (value === "high" || value === "watch" || value === "medium") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function investigationCaseNotice(caseValue: string | string[] | undefined) {
  const value = Array.isArray(caseValue) ? caseValue[0] : caseValue;

  if (value === "saved") {
    return {
      title: "Investigation saved",
      body: "Status, severity, notes, and last-reviewed time were updated for this IP.",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }

  if (value === "invalid") {
    return {
      title: "Investigation was not saved",
      body: "Use a supported status and severity, then save the investigation again.",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    };
  }

  return null;
}

function evidenceSummary(
  evidence: Record<string, string | null> | null | undefined,
) {
  const values = [
    evidence?.cf_connecting_ip,
    evidence?.true_client_ip,
    evidence?.x_real_ip,
    evidence?.x_forwarded_for,
    evidence?.forwarded,
  ].filter(Boolean);

  return values.length > 0 ? values.join(" | ") : "No header evidence";
}

function userAgentSummary(value: string | null) {
  return value || "Unknown";
}

function uniqueCount(values: Array<string | null | undefined>) {
  return new Set(values.filter(Boolean)).size;
}

export default async function AdminSecurityIpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ ip: string }>;
  searchParams?: Promise<{ case?: string | string[] }>;
}) {
  const { ip } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const ipAddress = decodeURIComponent(ip);
  const storeId = getActiveStoreId();

  const [
    loginResult,
    rateLimitResult,
    tosResult,
    ordersResult,
    offersResult,
    investigationResult,
  ] = await Promise.all([
    supabase
      .from("admin_login_attempts")
      .select(
        "id,ip_address,user_agent,success,failure_reason,lockout_until,identity_risk,created_at",
      )
      .eq("store_id", storeId)
      .eq("ip_address", ipAddress)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("public_endpoint_rate_limit_events")
      .select(
        "id,endpoint_key,subject_key,user_agent,blocked,block_reason,window_seconds,max_attempts,identity_risk,identity_evidence,created_at",
      )
      .eq("store_id", storeId)
      .eq("ip_address", ipAddress)
      .order("created_at", { ascending: false })
      .limit(150),
    supabase
      .from("tos_acceptance_events")
      .select(
        "id,context_type,context_id,tos_kind,tos_version,user_agent,ip_risk,ip_block_reason,ip_evidence,created_at",
      )
      .eq("store_id", storeId)
      .eq("ip_address", ipAddress)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("orders")
      .select(
        "id,account_id,customer_email,customer_name,total,status,fulfillment_status,stripe_session_id,tos_accepted_at,tos_ip_risk,created_at",
      )
      .eq("store_id", storeId)
      .eq("tos_ip_address", ipAddress)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("offers")
      .select(
        "id,account_id,product_id,customer_email,customer_name,offer_amount,counter_amount,status,stripe_session_id,tos_accepted_at,tos_ip_risk,created_at",
      )
      .eq("store_id", storeId)
      .eq("tos_ip_address", ipAddress)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("security_ip_investigations")
      .select(
        "id,ip_address,status,severity,notes,created_at,updated_at,last_reviewed_at,resolved_at",
      )
      .eq("store_id", storeId)
      .eq("ip_address", ipAddress)
      .maybeSingle(),
  ]);

  const loginAttempts = (loginResult.data ?? []) as AdminLoginAttempt[];
  const rateLimitEvents = (rateLimitResult.data ?? []) as PublicRateLimitEvent[];
  const tosEvents = (tosResult.data ?? []) as TosEvent[];
  const orders = (ordersResult.data ?? []) as Order[];
  const offers = (offersResult.data ?? []) as Offer[];
  const investigation =
    (investigationResult.data as SecurityIpInvestigation | null) ?? null;
  const orderIds = orders.map((order) => order.id);
  const evidenceResult =
    orderIds.length > 0
      ? await supabase
          .from("transaction_evidence_reports")
          .select(
            "id,order_id,customer_email,total,status,emailed_to,email_sent_at,created_at",
          )
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
      : { data: [], error: null };
  const evidenceReports = (evidenceResult.data ?? []) as EvidenceReport[];
  const blockedRateLimitEvents = rateLimitEvents.filter((event) => event.blocked);
  const failedLoginAttempts = loginAttempts.filter((attempt) => !attempt.success);
  const relatedEmails = uniqueCount([
    ...orders.map((order) => order.customer_email),
    ...offers.map((offer) => offer.customer_email),
    ...evidenceReports.map((report) => report.customer_email),
  ]);
  const relatedAccounts = uniqueCount([
    ...orders.map((order) => order.account_id),
    ...offers.map((offer) => offer.account_id),
  ]);
  const queryErrors = [
    loginResult.error,
    rateLimitResult.error,
    tosResult.error,
    ordersResult.error,
    offersResult.error,
    investigationResult.error,
    evidenceResult.error,
  ].filter(Boolean);
  const caseNotice = investigationCaseNotice(resolvedSearchParams.case);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Security Center
            </p>
            <h1 className="mt-2 break-all text-4xl font-black tracking-tight">
              IP Dossier: {ipAddress}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Combined admin login, public endpoint, TOS, order, offer, and
              evidence activity tied to this server-observed IP.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin/security" label="Security Center" />
            <CommandLink href="/admin/orders" label="Orders" />
            <CommandLink href="/admin/offers" label="Offers" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {caseNotice ? (
          <section className={`rounded-md border px-5 py-4 ${caseNotice.className}`}>
            <h2 className="text-lg font-black">{caseNotice.title}</h2>
            <p className="mt-1 text-sm font-semibold">{caseNotice.body}</p>
          </section>
        ) : null}

        {queryErrors.length > 0 ? (
          <section className="rounded-md border border-rose-200 bg-rose-50 p-5 text-rose-800">
            <h2 className="text-xl font-black">Some Evidence Could Not Load</h2>
            <div className="mt-2 space-y-1 text-sm font-semibold">
              {queryErrors.map((error, index) => (
                <p key={index}>{error?.message}</p>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Admin Logins" value={String(loginAttempts.length)} />
          <Metric
            label="Failed Logins"
            value={String(failedLoginAttempts.length)}
            tone="rose"
          />
          <Metric
            label="Blocked Money Events"
            value={String(blockedRateLimitEvents.length)}
            tone="rose"
          />
          <Metric label="TOS Events" value={String(tosEvents.length)} />
          <Metric label="Orders" value={String(orders.length)} />
          <Metric label="Offers" value={String(offers.length)} />
          <Metric label="Evidence Reports" value={String(evidenceReports.length)} />
          <Metric label="Related Emails" value={String(relatedEmails)} />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Related Accounts" value={String(relatedAccounts)} />
          <Metric
            label="Order Total"
            value={money(
              orders.reduce((total, order) => total + Number(order.total || 0), 0),
            )}
            tone="green"
          />
          <Metric
            label="Offer Total"
            value={money(
              offers.reduce(
                (total, offer) => total + Number(offer.offer_amount || 0),
                0,
              ),
            )}
            tone="amber"
          />
          <Metric
            label="Last Seen"
            value={shortDate(
              [
                ...loginAttempts.map((row) => row.created_at),
                ...rateLimitEvents.map((row) => row.created_at),
                ...tosEvents.map((row) => row.created_at),
                ...orders.map((row) => row.created_at),
                ...offers.map((row) => row.created_at),
              ].sort().at(-1) ?? null,
            )}
          />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_1.2fr]">
            <div className="border-b border-neutral-200 p-5 lg:border-b-0 lg:border-r">
              <h2 className="text-2xl font-black">Investigation Status</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <Pill
                  label={label(investigation?.status || "untracked")}
                  className={investigationTone(investigation?.status)}
                />
                <Pill
                  label={label(investigation?.severity || "medium")}
                  className={investigationTone(investigation?.severity)}
                />
              </div>
              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="font-bold uppercase text-neutral-500">Updated</dt>
                  <dd>{shortDate(investigation?.updated_at || null)}</dd>
                </div>
                <div>
                  <dt className="font-bold uppercase text-neutral-500">Last Reviewed</dt>
                  <dd>{shortDate(investigation?.last_reviewed_at || null)}</dd>
                </div>
                <div>
                  <dt className="font-bold uppercase text-neutral-500">Resolved</dt>
                  <dd>{shortDate(investigation?.resolved_at || null)}</dd>
                </div>
              </dl>
              <div className="mt-5 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
                {investigation?.notes || "No internal notes yet."}
              </div>
            </div>

            <form action={saveIpInvestigation} className="space-y-5 p-5">
              <input type="hidden" name="ip_address" value={ipAddress} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-bold uppercase text-neutral-500">
                    Status
                  </span>
                  <select
                    name="status"
                    defaultValue={investigation?.status || "watch"}
                    className="w-full rounded border border-neutral-300 px-3 py-2"
                  >
                    <option value="watch">Watch</option>
                    <option value="review">Review</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-bold uppercase text-neutral-500">
                    Severity
                  </span>
                  <select
                    name="severity"
                    defaultValue={investigation?.severity || "medium"}
                    className="w-full rounded border border-neutral-300 px-3 py-2"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-bold uppercase text-neutral-500">
                  Internal Notes
                </span>
                <textarea
                  name="notes"
                  defaultValue={investigation?.notes || ""}
                  rows={7}
                  maxLength={5000}
                  className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                  placeholder="Summarize why this IP is being watched, what evidence matters, and what action was taken."
                />
              </label>

              <AdminSubmitButton
                className="rounded-md bg-neutral-950 px-5 py-2 text-sm font-black text-white hover:bg-neutral-800"
                pendingChildren="Saving investigation..."
              >
                Save Investigation
              </AdminSubmitButton>
            </form>
          </div>
        </section>

        <EvidenceBlock
          title="Public Money-Path Events"
          emptyText="No public money-path events tied to this IP."
        >
          <table className="w-full min-w-[1040px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Endpoint</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Policy</th>
                <th className="px-4 py-3">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {rateLimitEvents.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="px-4 py-4 font-semibold">
                    {shortDate(event.created_at)}
                  </td>
                  <td className="px-4 py-4">
                    <Pill
                      label={event.blocked ? "BLOCKED" : "ALLOWED"}
                      tone={event.blocked ? "rose" : "green"}
                    />
                  </td>
                  <td className="px-4 py-4 font-semibold">
                    {endpointLabel(event.endpoint_key)}
                  </td>
                  <td className="max-w-[190px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-3 break-words">
                      {event.subject_key || "None"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <Pill label={label(event.identity_risk)} className={riskTone(event.identity_risk)} />
                  </td>
                  <td className="px-4 py-4">{label(event.block_reason)}</td>
                  <td className="px-4 py-4">
                    {event.max_attempts} / {Math.round(event.window_seconds / 60)}m
                  </td>
                  <td className="max-w-[320px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-3 break-words">
                      {evidenceSummary(event.identity_evidence)}
                    </span>
                  </td>
                </tr>
              ))}
              {rateLimitEvents.length === 0 ? (
                <EmptyRow colSpan={8} text="No public money-path events tied to this IP." />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>

        <EvidenceBlock
          title="TOS Acceptance Evidence"
          emptyText="No TOS acceptance events tied to this IP."
        >
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Context</th>
                <th className="px-4 py-3">Kind</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Evidence</th>
                <th className="px-4 py-3">User Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {tosEvents.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="px-4 py-4 font-semibold">
                    {shortDate(event.created_at)}
                  </td>
                  <td className="px-4 py-4">
                    {label(event.context_type)}
                    {event.context_id ? ` #${event.context_id}` : ""}
                  </td>
                  <td className="px-4 py-4">{label(event.tos_kind)}</td>
                  <td className="px-4 py-4">{event.tos_version}</td>
                  <td className="px-4 py-4">
                    <Pill label={label(event.ip_risk)} className={riskTone(event.ip_risk)} />
                  </td>
                  <td className="px-4 py-4">{label(event.ip_block_reason)}</td>
                  <td className="max-w-[300px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-3 break-words">
                      {evidenceSummary(event.ip_evidence)}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-3 break-words">
                      {userAgentSummary(event.user_agent)}
                    </span>
                  </td>
                </tr>
              ))}
              {tosEvents.length === 0 ? (
                <EmptyRow colSpan={8} text="No TOS acceptance events tied to this IP." />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>

        <EvidenceBlock
          title="Related Orders"
          emptyText="No orders tied to this IP."
        >
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Fulfillment</th>
                <th className="px-4 py-3">TOS At</th>
                <th className="px-4 py-3">Stripe Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {orders.map((order) => (
                <tr key={order.id} className="align-top">
                  <td className="px-4 py-4 font-black">
                    <Link className="text-amber-700 underline" href={`/admin/orders/${order.id}`}>
                      #{order.id}
                    </Link>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-semibold">{order.customer_name || "No name"}</p>
                    <p className="text-xs text-neutral-600">{order.customer_email || "No email"}</p>
                  </td>
                  <td className="max-w-[180px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-2 break-words">
                      {order.account_id || "Guest"}
                    </span>
                  </td>
                  <td className="px-4 py-4 font-semibold">{money(order.total)}</td>
                  <td className="px-4 py-4">
                    <Pill label={label(order.status)} className={statusTone(order.status)} />
                  </td>
                  <td className="px-4 py-4">
                    <Pill
                      label={label(order.fulfillment_status)}
                      className={statusTone(order.fulfillment_status)}
                    />
                  </td>
                  <td className="px-4 py-4">{shortDate(order.tos_accepted_at)}</td>
                  <td className="max-w-[220px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-2 break-words">
                      {order.stripe_session_id || "None"}
                    </span>
                  </td>
                </tr>
              ))}
              {orders.length === 0 ? (
                <EmptyRow colSpan={8} text="No orders tied to this IP." />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>

        <EvidenceBlock
          title="Related Offers"
          emptyText="No offers tied to this IP."
        >
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Offer</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Counter</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">TOS At</th>
                <th className="px-4 py-3">Stripe Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {offers.map((offer) => (
                <tr key={offer.id} className="align-top">
                  <td className="px-4 py-4 font-black">#{offer.id}</td>
                  <td className="px-4 py-4">
                    <p className="font-semibold">{offer.customer_name || "No name"}</p>
                    <p className="text-xs text-neutral-600">{offer.customer_email || "No email"}</p>
                  </td>
                  <td className="px-4 py-4">
                    {offer.product_id ? (
                      <Link
                        className="font-semibold text-amber-700 underline"
                        href={`/admin/products/${offer.product_id}`}
                      >
                        #{offer.product_id}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td className="px-4 py-4 font-semibold">{money(offer.offer_amount)}</td>
                  <td className="px-4 py-4">{money(offer.counter_amount)}</td>
                  <td className="px-4 py-4">
                    <Pill label={label(offer.status)} className={statusTone(offer.status)} />
                  </td>
                  <td className="px-4 py-4">{shortDate(offer.tos_accepted_at)}</td>
                  <td className="max-w-[220px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-2 break-words">
                      {offer.stripe_session_id || "None"}
                    </span>
                  </td>
                </tr>
              ))}
              {offers.length === 0 ? (
                <EmptyRow colSpan={8} text="No offers tied to this IP." />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>

        <EvidenceBlock
          title="Transaction Evidence Reports"
          emptyText="No evidence reports tied to orders from this IP."
        >
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Report</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Emailed</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {evidenceReports.map((report) => (
                <tr key={report.id} className="align-top">
                  <td className="max-w-[180px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-2 break-words">{report.id}</span>
                  </td>
                  <td className="px-4 py-4 font-black">
                    <Link
                      className="text-amber-700 underline"
                      href={`/admin/orders/${report.order_id}`}
                    >
                      #{report.order_id}
                    </Link>
                  </td>
                  <td className="px-4 py-4">{report.customer_email || "No email"}</td>
                  <td className="px-4 py-4 font-semibold">{money(report.total)}</td>
                  <td className="px-4 py-4">
                    <Pill label={label(report.status)} className={statusTone(report.status)} />
                  </td>
                  <td className="px-4 py-4">
                    {report.emailed_to
                      ? `${report.emailed_to} at ${shortDate(report.email_sent_at)}`
                      : "Not emailed"}
                  </td>
                  <td className="px-4 py-4">{shortDate(report.created_at)}</td>
                </tr>
              ))}
              {evidenceReports.length === 0 ? (
                <EmptyRow
                  colSpan={7}
                  text="No evidence reports tied to orders from this IP."
                />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>

        <EvidenceBlock
          title="Admin Login Attempts"
          emptyText="No admin login attempts tied to this IP."
        >
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Lockout Until</th>
                <th className="px-4 py-3">User Agent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loginAttempts.map((attempt) => (
                <tr key={attempt.id} className="align-top">
                  <td className="px-4 py-4 font-semibold">
                    {shortDate(attempt.created_at)}
                  </td>
                  <td className="px-4 py-4">
                    <Pill
                      label={attempt.success ? "SUCCESS" : "FAILED"}
                      tone={attempt.success ? "green" : "rose"}
                    />
                  </td>
                  <td className="px-4 py-4">
                    <Pill
                      label={label(attempt.identity_risk)}
                      className={riskTone(attempt.identity_risk)}
                    />
                  </td>
                  <td className="px-4 py-4">{label(attempt.failure_reason)}</td>
                  <td className="px-4 py-4">{shortDate(attempt.lockout_until)}</td>
                  <td className="max-w-[340px] px-4 py-4 text-xs text-neutral-600">
                    <span className="line-clamp-3 break-words">
                      {userAgentSummary(attempt.user_agent)}
                    </span>
                  </td>
                </tr>
              ))}
              {loginAttempts.length === 0 ? (
                <EmptyRow colSpan={6} text="No admin login attempts tied to this IP." />
              ) : null}
            </tbody>
          </table>
        </EvidenceBlock>
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
      <p className={`mt-3 break-words text-3xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function EvidenceBlock({
  title,
  children,
}: {
  title: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 p-5">
        <h2 className="text-2xl font-black">{title}</h2>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Pill({
  label,
  tone,
  className,
}: {
  label: string;
  tone?: "green" | "amber" | "rose";
  className?: string;
}) {
  const toneClass =
    className ||
    (tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-rose-200 bg-rose-50 text-rose-800");

  return (
    <span className={`rounded border px-2 py-1 text-xs font-black ${toneClass}`}>
      {label}
    </span>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td className="px-4 py-6 text-neutral-600" colSpan={colSpan}>
        {text}
      </td>
    </tr>
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
