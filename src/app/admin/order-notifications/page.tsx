import Link from "next/link";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import NotificationRetryActions from "./NotificationRetryActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DeliveryRow = {
  id: string;
  order_id: number;
  notification_type: string;
  recipient_email: string;
  subject: string;
  status: string;
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  sent_at: string | null;
  created_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll("_", " ").toUpperCase();
}

function statusClass(status: string) {
  if (status === "sent") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "sending") return "border-sky-200 bg-sky-50 text-sky-800";
  if (status === "cancelled") return "border-neutral-200 bg-neutral-100 text-neutral-600";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default async function OrderNotificationsPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const { data, error } = await supabase
    .from("order_notification_deliveries")
    .select(
      "id,order_id,notification_type,recipient_email,subject,status,attempt_count,provider_message_id,last_error,last_attempt_at,sent_at,created_at",
    )
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const rows = (data || []) as DeliveryRow[];
  const pending = rows.filter((row) => ["pending", "sending", "failed"].includes(row.status));

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-neutral-900 bg-neutral-950 p-6 text-white shadow-xl">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-amber-300">
                Buyer Communications
              </p>
              <h1 className="mt-2 text-4xl font-black">Order Notification Delivery</h1>
              <p className="mt-2 max-w-3xl text-sm text-neutral-300">
                Durable payment, shipment and tracking-update delivery history. Sent rows cannot be duplicated; failed rows remain visible and retryable.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/orders" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold">
                Orders
              </Link>
              <Link href="/admin" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-bold">
                Admin
              </Link>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Recent Records" value={rows.length} />
          <Metric label="Sent" value={rows.filter((row) => row.status === "sent").length} />
          <Metric label="Needs Retry" value={pending.length} />
          <Metric label="Failed" value={rows.filter((row) => row.status === "failed").length} />
        </section>

        <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Delivery Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Automatic retries are capped at ten attempts. The provider message ID is retained as delivery evidence.
              </p>
            </div>
            <NotificationRetryActions />
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Order / Type</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Attempts</th>
                  <th className="px-4 py-3">Created / Sent</th>
                  <th className="px-4 py-3">Provider Evidence</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-neutral-500">
                      No order notification records yet.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-4">
                        <Link href={`/admin/orders/${row.order_id}`} className="font-black underline">
                          Order #{row.order_id}
                        </Link>
                        <p className="mt-1 text-xs text-neutral-500">{label(row.notification_type)}</p>
                        <p className="mt-2 max-w-sm font-medium">{row.subject}</p>
                      </td>
                      <td className="px-4 py-4 break-all">{row.recipient_email}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black ${statusClass(row.status)}`}>
                          {label(row.status)}
                        </span>
                        {row.last_error ? (
                          <p className="mt-2 max-w-xs break-words text-xs text-rose-700">{row.last_error}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-4">
                        <p className="font-bold">{row.attempt_count} / 10</p>
                        <p className="mt-1 text-xs text-neutral-500">Last: {formatDate(row.last_attempt_at)}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p>Created: {formatDate(row.created_at)}</p>
                        <p className="mt-1 text-xs text-neutral-500">Sent: {formatDate(row.sent_at)}</p>
                      </td>
                      <td className="px-4 py-4 break-all text-xs">
                        {row.provider_message_id || "—"}
                      </td>
                      <td className="px-4 py-4">
                        {["pending", "sending", "failed"].includes(row.status) ? (
                          <NotificationRetryActions notificationId={row.id} />
                        ) : (
                          <span className="text-xs text-neutral-400">No action</span>
                        )}
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

function Metric({ label: metricLabel, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">{metricLabel}</p>
      <p className="mt-2 text-4xl font-black">{value}</p>
    </div>
  );
}
