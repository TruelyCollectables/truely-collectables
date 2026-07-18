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

  return (
    <main className="space-y-6 bg-neutral-50 px-6 py-8 text-neutral-950">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
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
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Cases
            </Link>
            <Link
              href="/admin/orders"
              className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
            >
              Orders
            </Link>
            <Link
              href="/admin"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-black text-white hover:bg-neutral-800"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
            Evidence PDFs
          </p>
          <p className="mt-3 text-3xl font-black">{reports.length}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">
            {emailedReports} emailed to support or operators
          </p>
        </div>

        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
            Case packets
          </p>
          <p className="mt-3 text-3xl font-black">{casePackets.length}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">
            {emailedCasePackets} emailed from the review queue
          </p>
        </div>

        <div className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-400">
            Stripe disputes
          </p>
          <p className="mt-3 text-3xl font-black">{stripeLinkedPackets}</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">
            {unresolvedStripePackets} still need final evidence submission
          </p>
        </div>

        <div
          className={`rounded-3xl border p-5 shadow-sm ${
            attentionCount > 0
              ? "border-red-200 bg-red-50"
              : "border-emerald-200 bg-emerald-50"
          }`}
        >
          <p
            className={`text-xs font-black uppercase tracking-[0.16em] ${
              attentionCount > 0 ? "text-red-700" : "text-emerald-700"
            }`}
          >
            Needs attention
          </p>
          <p className="mt-3 text-3xl font-black">{attentionCount}</p>
          <p
            className={`mt-1 text-sm font-semibold ${
              attentionCount > 0 ? "text-red-950" : "text-emerald-950"
            }`}
          >
            Email or provider evidence errors
          </p>
        </div>
      </section>

      {evidenceResult.error ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-red-700">
            Evidence reports unavailable
          </p>
          <h2 className="mt-2 text-2xl font-black text-red-950">
            Transaction evidence storage is not ready
          </h2>
          <p className="mt-3 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-bold text-red-950">
            {evidenceResult.error.message}
          </p>
          <p className="mt-3 text-sm font-semibold text-red-900">
            Apply the transaction evidence migration before using this page.
          </p>
        </section>
      ) : null}

      {casePacketResult.error ? (
        <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-700">
            Case packets unavailable
          </p>
          <h2 className="mt-2 text-2xl font-black text-amber-950">
            Order review packet history is not ready
          </h2>
          <p className="mt-3 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-bold text-amber-950">
            {casePacketResult.error.message}
          </p>
          <p className="mt-3 text-sm font-semibold text-amber-900">
            Apply the order review case packet migration before saved case
            packet records appear here.
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
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
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Create from order
          </Link>
        </div>

        {reports.length === 0 ? (
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
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"
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
                      className="rounded-md bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white hover:bg-neutral-800"
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${report.order_id}`}
                      className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-50"
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

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
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
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-50"
          >
            Open case queue
          </Link>
        </div>

        {casePackets.length === 0 ? (
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
                className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"
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
                      className="rounded-md bg-neutral-950 px-4 py-2 text-center text-sm font-black text-white hover:bg-neutral-800"
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${packet.order_id}`}
                      className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-50"
                    >
                      View Order
                    </Link>
                    <Link
                      href="/admin/order-review-cases?status=all"
                      className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-center text-sm font-black hover:bg-neutral-50"
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
