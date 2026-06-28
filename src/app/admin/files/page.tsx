import Link from "next/link";
import { supabase } from "../../../lib/supabase";
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

function money(value: number | null | undefined) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export default async function AdminFilesPage() {
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
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
    .order("created_at", { ascending: false });

  const reports = (data || []) as EvidenceReport[];

  return (
    <main className="p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">Admin Files</h1>
          <p className="mt-2 text-gray-600">
            Transaction evidence packets for chargebacks, fraud review, and
            legal disputes.
          </p>
        </div>

        <div className="flex gap-3">
          <Link href="/admin/orders" className="border rounded px-4 py-2">
            Orders
          </Link>
          <Link href="/admin" className="border rounded px-4 py-2">
            Dashboard
          </Link>
        </div>
      </div>

      {error ? (
        <section className="rounded border border-red-200 bg-red-50 p-4">
          <h2 className="font-bold text-red-700">Evidence reports unavailable</h2>
          <p className="mt-2 text-sm text-red-700">{error.message}</p>
          <p className="mt-2 text-sm text-red-700">
            Apply the transaction evidence migration before using this page.
          </p>
        </section>
      ) : reports.length === 0 ? (
        <p className="text-gray-600">No evidence packets have been created yet.</p>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <section key={report.id} className="rounded border bg-white p-5">
              <div className="flex flex-wrap justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold">
                    Order #{report.order_id}
                  </h2>
                  <p className="text-sm text-gray-600">
                    {report.customer_email || "No customer email"}
                  </p>
                  <p className="text-xs text-gray-500">
                    Created {new Date(report.created_at).toLocaleString()}
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
                      {new Date(report.email_sent_at).toLocaleString()}
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
    </main>
  );
}
