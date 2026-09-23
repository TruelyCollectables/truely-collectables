import { cookies } from "next/headers";
import { GET as getPendingReceipts } from "../../api/account/seller/instacomp-pending-receipts/route";
import PendingReceiptActions from "./PendingReceiptActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Receipt = {
  acquisitionItemId: number;
  purchaseId: string;
  source: string;
  purchasedAt?: string | null;
  purchaseDate?: string | null;
  createdAt?: string | null;
  title?: string | null;
  seller?: string | null;
  orderNumber?: string | null;
  allocatedCost?: number | null;
  costStatus?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  listingUrl?: string | null;
  scanId?: string | null;
  status: string;
};

function money(value: number | null | undefined) {
  return value == null ? "Unknown" : `$${Number(value).toFixed(2)}`;
}

function day(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "Date unavailable";
}

function statusLabel(row: Receipt) {
  if (row.status === "received_unscanned") return "Received — photos can be added later";
  if (row.status === "pending_purchase") return "Photos attached — choose Pending Sale or Stash";
  if (row.status === "received") return "Received";
  return "Awaiting receipt / photos";
}

export default async function PendingReceiptsPage() {
  let receipts: Receipt[] = [];
  let summary = { pendingRows: 0, receivedAwaitingPhotos: 0, pendingKnownBasis: 0 };
  let error = "";

  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
    const response = await getPendingReceipts(
      new Request("http://localhost/api/account/seller/instacomp-pending-receipts?cutoff_date=2026-09-16", {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      }),
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(data.error || "Could not load pending receipts."));
    receipts = Array.isArray(data.receipts) ? data.receipts : [];
    summary = {
      pendingRows: Number(data.summary?.pendingRows || receipts.length),
      receivedAwaitingPhotos: Number(data.summary?.receivedAwaitingPhotos || 0),
      pendingKnownBasis: Number(data.summary?.pendingKnownBasis || 0),
    };
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">
            KINGMAKER Pending Receipts
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">
            Receive first. Add photos later.
          </h1>
          <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-300">
            Receiving never creates a second purchase. When you add the exact front/back scan later,
            KINGMAKER attaches it to the received purchase and then lets you choose Pending Sale or Stash.
          </p>
        </section>

        {error ? (
          <section className="rounded-xl border border-rose-800 bg-rose-950/40 p-5 text-rose-100">
            <h2 className="text-xl font-black">Mac receiving bridge unavailable</h2>
            <p className="mt-2 font-semibold">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Tracked receipts" value={String(summary.pendingRows)} />
          <Metric label="Received, photos later" value={String(summary.receivedAwaitingPhotos)} />
          <Metric label="Known basis" value={money(summary.pendingKnownBasis)} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="border-b border-slate-800 p-5">
            <h2 className="text-2xl font-black">Purchases waiting for receiving work</h2>
          </div>
          {receipts.length === 0 ? (
            <p className="p-5 font-semibold text-slate-400">No purchases are waiting.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-950 text-xs font-black uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Purchase</th>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Paid</th>
                    <th className="px-4 py-3">Status / action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {receipts.map((row) => (
                    <tr key={row.acquisitionItemId} className="align-top">
                      <td className="px-4 py-4">
                        <p className="font-black text-white">{row.title || `Acquisition #${row.acquisitionItemId}`}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {day(row.purchasedAt || row.purchaseDate || row.createdAt)} · {row.orderNumber || row.purchaseId}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {row.cardNumber ? `#${row.cardNumber}` : "Card number pending"} · {row.parallel || "Parallel pending"}
                        </p>
                        {row.listingUrl ? (
                          <a href={row.listingUrl} className="mt-2 inline-flex text-xs font-black text-emerald-300 underline">
                            Open source
                          </a>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 font-black">{row.source || "Source"}</td>
                      <td className="px-4 py-4 font-black">
                        {row.costStatus === "unknown" ? "Unknown" : money(row.allocatedCost)}
                      </td>
                      <td className="px-4 py-4">
                        <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                          {statusLabel(row)}
                        </span>
                        <PendingReceiptActions
                          acquisitionItemId={row.acquisitionItemId}
                          status={row.status}
                          hasScan={Boolean(row.scanId)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
