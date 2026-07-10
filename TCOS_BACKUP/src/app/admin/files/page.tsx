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
  return `$${Number(value || 0).toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "Not saved";
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

  return (
    <main className="p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Admin Files</h1>
          <p className="mt-2 text-gray-600">
            Transaction evidence packets and order review case packets for{" "}
            {storeSettings.displayName}, ready for chargebacks, fraud review,
            returns, disputes, and legal support.
          </p>
        </div>

        <div className="flex gap-3">
          <Link href="/admin/order-review-cases" className="border rounded px-4 py-2">
            Cases
          </Link>
          <Link href="/admin/orders" className="border rounded px-4 py-2">
            Orders
          </Link>
          <Link href="/admin" className="border rounded px-4 py-2">
            Dashboard
          </Link>
        </div>
      </div>

      {evidenceResult.error ? (
        <section className="rounded border border-red-200 bg-red-50 p-4">
          <h2 className="font-bold text-red-700">
            Evidence reports unavailable
          </h2>
          <p className="mt-2 text-sm text-red-700">
            {evidenceResult.error.message}
          </p>
          <p className="mt-2 text-sm text-red-700">
            Apply the transaction evidence migration before using this page.
          </p>
        </section>
      ) : null}

      {casePacketResult.error ? (
        <section className="mt-4 rounded border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-bold text-amber-800">
            Order review case packets unavailable
          </h2>
          <p className="mt-2 text-sm text-amber-800">
            {casePacketResult.error.message}
          </p>
          <p className="mt-2 text-sm text-amber-800">
            Apply the order review case packet migration before saved case
            packet records appear here.
          </p>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">
          Transaction Evidence Packets
        </h2>

        {reports.length === 0 ? (
          <p className="text-gray-600">
            No transaction evidence packets have been created yet.
          </p>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <section key={report.id} className="rounded border bg-white p-5">
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold">
                      Order #{report.order_id}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {report.customer_email || "No customer email"}
                    </p>
                    <p className="text-xs text-gray-500">
                      Created {dateLabel(report.created_at)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold">{money(report.total)}</p>
                    <p className="text-sm">
                      Status: <strong>{report.status || "ready"}</strong>
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
                  <div>
                    <p className="font-bold">Stripe Session</p>
                    <p className="break-all text-gray-600">
                      {report.stripe_session_id}
                    </p>
                  </div>

                  <div>
                    <p className="font-bold">Email Delivery</p>
                    {report.email_sent_at ? (
                      <p className="text-gray-600">
                        Sent to {report.emailed_to} on{" "}
                        {dateLabel(report.email_sent_at)}
                      </p>
                    ) : (
                      <p className="text-gray-600">
                        {report.email_error || "Not emailed yet"}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 md:items-end">
                    <a
                      href={`/api/admin/files/${report.id}/download`}
                      className="rounded border px-4 py-2 text-center"
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${report.order_id}`}
                      className="rounded border px-4 py-2 text-center"
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

      <section className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Order Review Case Packets</h2>

        {casePackets.length === 0 ? (
          <p className="text-gray-600">
            No order review case packet records have been saved yet. Download a
            case packet from an order or the case queue to create the record.
          </p>
        ) : (
          <div className="space-y-4">
            {casePackets.map((packet) => (
              <section key={packet.id} className="rounded border bg-white p-5">
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold">
                      Case Packet - Order #{packet.order_id}
                    </h3>
                    <p className="break-all text-sm text-gray-600">
                      Case {packet.case_id}
                    </p>
                    <p className="text-xs text-gray-500">
                      Updated {dateLabel(packet.updated_at || packet.created_at)}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm">
                      Status: <strong>{label(packet.status)}</strong>
                    </p>
                    <p className="mt-1 break-all text-xs text-gray-500">
                      Seller: {packet.seller_account_id || "All seller-owned rows"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
                  <div>
                    <p className="font-bold">Email Delivery</p>
                    {packet.email_sent_at ? (
                      <p className="text-gray-600">
                        Sent to {packet.emailed_to} on{" "}
                        {dateLabel(packet.email_sent_at)}
                      </p>
                    ) : (
                      <p className="text-gray-600">
                        {packet.email_error || "Not emailed yet"}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="font-bold">Packet ID</p>
                    <p className="break-all text-gray-600">{packet.id}</p>
                  </div>

                  <div>
                    <p className="font-bold">Stripe Evidence</p>
                    <p className="text-gray-600">
                      {label(packet.provider_evidence_status)}
                    </p>
                    <p className="break-all text-xs text-gray-500">
                      {packet.provider_dispute_id || "No linked Stripe dispute"}
                    </p>
                    {packet.provider_evidence_due_by ? (
                      <p className="text-xs text-gray-500">
                        Due {dateLabel(packet.provider_evidence_due_by)}
                      </p>
                    ) : null}
                    {packet.provider_evidence_error ? (
                      <p className="text-xs font-bold text-red-700">
                        {packet.provider_evidence_error}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2 md:items-end">
                    <a
                      href={`/api/admin/order-review-cases/${packet.case_id}/packet`}
                      className="rounded border px-4 py-2 text-center"
                    >
                      Download PDF
                    </a>
                    <Link
                      href={`/admin/orders/${packet.order_id}`}
                      className="rounded border px-4 py-2 text-center"
                    >
                      View Order
                    </Link>
                    <Link
                      href="/admin/order-review-cases?status=all"
                      className="rounded border px-4 py-2 text-center"
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
