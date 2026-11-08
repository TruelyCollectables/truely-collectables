import Link from "next/link";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import { getStoreSettings } from "../../../lib/store-settings";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type EvidenceReport = {
  id: string;
  order_id: number;
  stripe_session_id: string;
  customer_email: string | null;
  total: number | null;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
};

type OrderReviewCasePacket = {
  id: string;
  case_id: string;
  order_id: number;
  seller_account_id: string | null;
  status: string | null;
  emailed_to: string | null;
  email_sent_at: string | null;
  email_error: string | null;
  provider_dispute_id: string | null;
  provider_evidence_status: string | null;
  provider_evidence_due_by: string | null;
  provider_evidence_staged_at: string | null;
  provider_evidence_submitted_at: string | null;
  provider_evidence_error: string | null;
  created_at: string;
  updated_at: string | null;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(Number(value || 0));
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
}

function safeErrorMessage(error: { message?: string } | null | undefined) {
  return String(error?.message || "Unknown database error.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function statusTone(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();

  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("rejected")
  ) {
    return "border-red-200 bg-red-50 text-red-950";
  }

  if (
    normalized.includes("sent") ||
    normalized.includes("ready") ||
    normalized.includes("submitted") ||
    normalized.includes("complete")
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-950";
  }

  if (
    normalized.includes("stage") ||
    normalized.includes("pending") ||
    normalized.includes("review")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

type FileCardTone = "amber" | "emerald" | "neutral" | "red" | "sky";

const primaryActionClass =
  "rounded-full bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";
const secondaryActionClass =
  "rounded-full border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black text-neutral-800 shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400";

const fileCardToneClasses: Record<
  FileCardTone,
  { card: string; label: string; detail: string; pill: string }
> = {
  amber: {
    card: "border-amber-200 bg-amber-50 ring-amber-900/10",
    detail: "text-amber-950",
    label: "text-amber-700",
    pill: "border-amber-200 bg-white text-amber-950",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50 ring-emerald-900/10",
    detail: "text-emerald-950",
    label: "text-emerald-700",
    pill: "border-emerald-200 bg-white text-emerald-950",
  },
  neutral: {
    card: "border-neutral-200 bg-white ring-black/[0.02]",
    detail: "text-neutral-500",
    label: "text-neutral-400",
    pill: "border-neutral-200 bg-neutral-100 text-neutral-700",
  },
  red: {
    card: "border-red-200 bg-red-50 ring-red-900/10",
    detail: "text-red-950",
    label: "text-red-700",
    pill: "border-red-200 bg-white text-red-950",
  },
  sky: {
    card: "border-sky-200 bg-sky-50 ring-sky-900/10",
    detail: "text-sky-950",
    label: "text-sky-700",
    pill: "border-sky-200 bg-white text-sky-950",
  },
};

function FileMetricCard({
  detail,
  label: labelText,
  tone = "neutral",
  value,
}: {
  detail: string;
  label: string;
  tone?: FileCardTone;
  value: number | string;
}) {
  const classes = fileCardToneClasses[tone];

  return (
    <div
      className={`rounded-3xl border p-5 shadow-sm ring-1 ${classes.card}`}
    >
      <p
        className={`text-xs font-black uppercase tracking-[0.16em] ${classes.label}`}
      >
        {labelText}
      </p>
      <p className="mt-3 break-words text-3xl font-black">{value}</p>
      <p className={`mt-1 text-sm font-semibold ${classes.detail}`}>
        {detail}
      </p>
    </div>
  );
}

function FilePostureCard({
  cta,
  detail,
  href,
  label: labelText,
  status,
  tone,
}: {
  cta: string;
  detail: string;
  href: string;
  label: string;
  status: string;
  tone: FileCardTone;
}) {
  const classes = fileCardToneClasses[tone];

  return (
    <article
      className={`flex h-full flex-col justify-between rounded-3xl border p-5 shadow-sm ring-1 ${classes.card}`}
    >
      <div>
        <p
          className={`text-xs font-black uppercase tracking-[0.16em] ${classes.label}`}
        >
          {labelText}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-black ${classes.pill}`}
          >
            {status}
          </span>
        </div>
        <p className={`mt-4 text-sm font-semibold leading-6 ${classes.detail}`}>
          {detail}
        </p>
      </div>

      <Link
        href={href}
        className={`mt-5 inline-flex w-fit ${secondaryActionClass}`}
      >
        {cta} →
      </Link>
    </article>
  );
}

export default async function AdminFilesPage() {
  const storeId = getActiveStoreId();
  const supabase = createSupabaseServerClient({ admin: true });
  const storeSettings = await getStoreSettings(supabase, storeId);
  const [evidenceResult, casePacketResult] = await Promise.all([
    supabase
      .from("transaction_evidence_reports")
      .select(
        `
        id,
        order_id,
        stripe_session_id,
        customer_email,
        total,
        status,
        emailed_to,
        email_sent_at,
        email_error,
        created_at
      `,
      )
      .eq("store_id", storeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("order_review_case_packets")
      .select(
        `
        id,
        case_id,
        order_id,
        seller_account_id,
        status,
        emailed_to,
        email_sent_at,
        email_error,
        provider_dispute_id,
        provider_evidence_status,
        provider_evidence_due_by,
        provider_evidence_staged_at,
        provider_evidence_submitted_at,
        provider_evidence_error,
        created_at,
        updated_at
      `,
      )
      .eq("store_id", storeId)
      .order("updated_at", { ascending: false }),
  ]);

  const evidenceUnavailable = Boolean(evidenceResult.error);
  const casePacketsUnavailable = Boolean(casePacketResult.error);
  const fileDataUnavailable = evidenceUnavailable || casePacketsUnavailable;
  const reports = (evidenceResult.data || []) as EvidenceReport[];
  const casePackets =
    (casePacketResult.data || []) as OrderReviewCasePacket[];
  const emailedReports = reports.filter((report) => report.email_sent_at).length;
  const emailedCasePackets = casePackets.filter(
    (packet) => packet.email_sent_at,
  ).length;
  const stripeLinkedPackets = casePackets.filter(
    (packet) => packet.provider_dispute_id,
  ).length;
  const unresolvedStripePackets = casePackets.filter(
    (packet) =>
      packet.provider_dispute_id && !packet.provider_evidence_submitted_at,
  ).length;
  const attentionCount =
    reports.filter((report) => report.email_error).length +
    casePackets.filter(
      (packet) => packet.email_error || packet.provider_evidence_error,
    ).length;
  const evidenceErrorCount = reports.filter((report) => report.email_error)
    .length;
  const casePacketErrorCount = casePackets.filter(
    (packet) => packet.email_error || packet.provider_evidence_error,
  ).length;
  const fileDataPosture = fileDataUnavailable
    ? "SOURCE WARNING"
    : attentionCount > 0
      ? "ACTION REQUIRED"
      : "EVIDENCE READY";
  const primaryFileAction = fileDataUnavailable
    ? {
        cta: "Open Production Smoke",
        detail:
          "One or more evidence sources failed to load. Verify the backing tables before treating an empty queue as clean.",
        href: "/admin/production-smoke",
      }
    : attentionCount > 0
      ? {
          cta: "Open Case Queue",
          detail:
            "Evidence delivery or provider submission errors need review before the dispute file can be considered complete.",
          href: "/admin/order-review-cases?status=all",
        }
      : {
          cta: "Build Next Packet",
          detail:
            "Evidence sources loaded cleanly and no delivery/provider errors are currently flagged.",
          href: "/admin/orders",
        };

  return (
    <main className="min-h-screen space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
              Evidence library
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Admin Files
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              Transaction evidence packets and order review case packets for{" "}
              {storeSettings.displayName}, ready for chargebacks, fraud review,
              returns, disputes, and legal support.
            </p>
            <p className="mt-2 text-xs font-bold text-neutral-400">
              Last refreshed: {new Date().toLocaleString()}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/admin/order-review-cases"
              className={secondaryActionClass}
            >
              Cases
            </Link>
            <Link
              href="/admin/orders"
              className={secondaryActionClass}
            >
              Orders
            </Link>
            <Link
              href="/admin"
              className={primaryActionClass}
            >
              Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FileMetricCard
          detail={
            evidenceUnavailable
              ? "Evidence packet storage did not load"
              : `${emailedReports} emailed to support or operators`
          }
          label="Evidence PDFs"
          value={evidenceUnavailable ? "Unavailable" : reports.length}
        />

        <FileMetricCard
          detail={
            casePacketsUnavailable
              ? "Case packet history did not load"
              : `${emailedCasePackets} emailed from the review queue`
          }
          label="Case packets"
          value={casePacketsUnavailable ? "Unavailable" : casePackets.length}
        />

        <FileMetricCard
          detail={
            casePacketsUnavailable
              ? "Stripe dispute packet data did not load"
              : `${unresolvedStripePackets} still need final evidence submission`
          }
          label="Stripe disputes"
          value={casePacketsUnavailable ? "Unavailable" : stripeLinkedPackets}
        />

        <FileMetricCard
          detail={
            fileDataUnavailable
              ? "One or more evidence sources did not load"
              : "Email or provider evidence errors"
          }
          label="Needs attention"
          tone={
            fileDataUnavailable
              ? "amber"
              : attentionCount > 0
                ? "red"
                : "emerald"
          }
          value={
            evidenceUnavailable || casePacketsUnavailable
              ? "Unavailable"
              : attentionCount
          }
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <FilePostureCard
          cta={primaryFileAction.cta}
          detail={primaryFileAction.detail}
          href={primaryFileAction.href}
          label="Evidence posture"
          status={fileDataPosture}
          tone={
            fileDataUnavailable ? "amber" : attentionCount > 0 ? "red" : "emerald"
          }
        />
        <FilePostureCard
          cta="Open Dispute Queue"
          detail={`${evidenceErrorCount} transaction packet delivery issue(s); ${casePacketErrorCount} case packet or provider issue(s).`}
          href="/admin/order-review-cases?status=all"
          label="Error lane"
          status={`${attentionCount} alert${attentionCount === 1 ? "" : "s"}`}
          tone={attentionCount > 0 ? "red" : "emerald"}
        />
        <FilePostureCard
          cta="Review Latest Orders"
          detail="Downloads, order links, and case queue routes stay visible so evidence work does not dead-end after a packet is found."
          href="/admin/orders"
          label="Operator handoff"
          status={fileDataUnavailable ? "VERIFY SOURCES" : "AUDIT-READY"}
          tone={fileDataUnavailable ? "amber" : "sky"}
        />
      </section>

      {evidenceResult.error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm ring-1 ring-red-900/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Evidence reports unavailable
          </p>
          <h2 className="mt-2 text-2xl font-black text-red-950">
            Transaction evidence storage is not ready
          </h2>
          <p className="mt-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-red-950">
            {safeErrorMessage(evidenceResult.error)}
          </p>
          <p className="mt-3 text-sm font-semibold text-red-900">
            Apply the transaction evidence migration before using this page.
          </p>
        </section>
      ) : null}

      {casePacketResult.error ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm ring-1 ring-amber-900/10">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            Case packets unavailable
          </p>
          <h2 className="mt-2 text-2xl font-black text-amber-950">
            Order review packet history is not ready
          </h2>
          <p className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold text-amber-950">
            {safeErrorMessage(casePacketResult.error)}
          </p>
          <p className="mt-3 text-sm font-semibold text-amber-900">
            Apply the order review case packet migration before saved case
            packet records appear here.
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
              Chargeback support
            </p>
            <h2 className="mt-1 text-2xl font-black">
              Transaction Evidence Packets
            </h2>
          </div>
          <Link
            href="/admin/orders"
            className={secondaryActionClass}
          >
            Create from order
          </Link>
        </div>

        {evidenceUnavailable ? (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-6">
            <h3 className="text-lg font-black text-red-950">
              Evidence packet list unavailable
            </h3>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-red-900">
              Transaction evidence storage did not load, so this page cannot
              prove whether evidence packets exist. Use the readiness warning
              above before treating this queue as clear.
            </p>
          </div>
        ) : reports.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6">
            <h3 className="text-lg font-black">No evidence packets yet</h3>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-600">
              Generate a transaction evidence PDF from an order when a payment,
              chargeback, or customer support case needs a clean audit record.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {reports.map((report) => (
              <section
                key={report.id}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 shadow-sm ring-1 ring-black/[0.02] transition hover:bg-white"
              >
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-black">
                        Order #{report.order_id}
                      </h3>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(
                          report.status || "ready",
                        )}`}
                      >
                        {label(report.status || "ready")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-neutral-600">
                      {report.customer_email || "No customer email"}
                    </p>
                    <p className="text-xs font-bold text-neutral-400">
                      Created {dateLabel(report.created_at)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-right">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
                      Order total
                    </p>
                    <p className="mt-1 text-xl font-black">
                      {money(report.total)}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 text-sm md:grid-cols-[1.2fr_1fr_auto]">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="font-black">Stripe Session</p>
                    <p className="mt-1 break-all font-semibold text-neutral-600">
                      {report.stripe_session_id}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="font-black">Email Delivery</p>
                    {report.email_sent_at ? (
                      <p className="mt-1 font-semibold text-neutral-600">
                        Sent to {report.emailed_to} on{" "}
                        {dateLabel(report.email_sent_at)}
                      </p>
                    ) : (
                      <p
                        className={`mt-1 font-semibold ${
                          report.email_error
                            ? "text-red-700"
                            : "text-neutral-600"
                        }`}
                      >
                        {report.email_error || "Not emailed yet"}
                      </p>
                    )}
                  </div>

                  <div className="flex min-w-44 flex-col gap-2">
                    <a
                      href={`/api/admin/files/${report.id}/download`}
                      className={primaryActionClass}
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${report.order_id}`}
                      className={secondaryActionClass}
                    >
                      View Order
                    </Link>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm ring-1 ring-black/[0.02]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
              Fraud and dispute operations
            </p>
            <h2 className="mt-1 text-2xl font-black">
              Order Review Case Packets
            </h2>
          </div>
          <Link
            href="/admin/order-review-cases?status=all"
            className={secondaryActionClass}
          >
            Open case queue
          </Link>
        </div>

        {casePacketsUnavailable ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h3 className="text-lg font-black text-amber-950">
              Case packet list unavailable
            </h3>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-amber-900">
              Order review packet storage did not load, so this page cannot
              prove whether case packets exist. Use the migration warning above
              before treating this queue as clear.
            </p>
          </div>
        ) : casePackets.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-6">
            <h3 className="text-lg font-black">No saved case packets yet</h3>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-neutral-600">
              Download a case packet from an order or the case queue to create a
              reusable audit record here.
            </p>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            {casePackets.map((packet) => (
              <section
                key={packet.id}
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 shadow-sm ring-1 ring-black/[0.02] transition hover:bg-white"
              >
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-black">
                        Case Packet - Order #{packet.order_id}
                      </h3>
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-black ${statusTone(
                          packet.status,
                        )}`}
                      >
                        {label(packet.status)}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-sm font-semibold text-neutral-600">
                      Case {packet.case_id}
                    </p>
                    <p className="text-xs font-bold text-neutral-400">
                      Updated {dateLabel(packet.updated_at || packet.created_at)}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-right">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-400">
                      Seller scope
                    </p>
                    <p className="mt-1 max-w-64 break-all text-sm font-black text-neutral-700">
                      {packet.seller_account_id || "All seller-owned rows"}
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 text-sm xl:grid-cols-[1fr_1fr_1.2fr_auto]">
                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="font-black">Email Delivery</p>
                    {packet.email_sent_at ? (
                      <p className="mt-1 font-semibold text-neutral-600">
                        Sent to {packet.emailed_to} on{" "}
                        {dateLabel(packet.email_sent_at)}
                      </p>
                    ) : (
                      <p
                        className={`mt-1 font-semibold ${
                          packet.email_error
                            ? "text-red-700"
                            : "text-neutral-600"
                        }`}
                      >
                        {packet.email_error || "Not emailed yet"}
                      </p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <p className="font-black">Packet ID</p>
                    <p className="mt-1 break-all font-semibold text-neutral-600">
                      {packet.id}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-neutral-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black">Stripe Evidence</p>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${statusTone(
                          packet.provider_evidence_status,
                        )}`}
                      >
                        {label(packet.provider_evidence_status)}
                      </span>
                    </div>
                    <p className="mt-1 break-all font-semibold text-neutral-600">
                      {packet.provider_dispute_id || "No linked Stripe dispute"}
                    </p>
                    {packet.provider_evidence_due_by ? (
                      <p className="mt-1 text-xs font-bold text-amber-700">
                        Due {dateLabel(packet.provider_evidence_due_by)}
                      </p>
                    ) : null}
                    {packet.provider_evidence_staged_at ? (
                      <p className="mt-1 text-xs font-bold text-neutral-500">
                        Staged {dateLabel(packet.provider_evidence_staged_at)}
                      </p>
                    ) : null}
                    {packet.provider_evidence_submitted_at ? (
                      <p className="mt-1 text-xs font-bold text-emerald-700">
                        Submitted{" "}
                        {dateLabel(packet.provider_evidence_submitted_at)}
                      </p>
                    ) : null}
                    {packet.provider_evidence_error ? (
                      <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-950">
                        {packet.provider_evidence_error}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex min-w-44 flex-col gap-2">
                    <a
                      href={`/api/admin/order-review-cases/${packet.case_id}/packet`}
                      className={primaryActionClass}
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${packet.order_id}`}
                      className={secondaryActionClass}
                    >
                      View Order
                    </Link>
                    <Link
                      href="/admin/order-review-cases?status=all"
                      className={secondaryActionClass}
                    >
                      Case Queue
                    </Link>
                  </div>
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
