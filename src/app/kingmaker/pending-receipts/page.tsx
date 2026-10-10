import Link from "next/link";
import PendingReceiptActions from "./PendingReceiptActions";
import {
  getKingmakerPendingReceipts,
  KINGMAKER_PENDING_RECEIPTS_CUTOFF,
  type KingmakerPendingReceipt,
} from "../../../lib/kingmaker-mac-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null | undefined) { return `$${Number(value || 0).toFixed(2)}`; }
function day(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString() : "Date unavailable"; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function title(row: KingmakerPendingReceipt) {
  return text(row.title) || [row.year, row.brand, row.setName, row.player, row.parallel, row.cardNumber ? `#${row.cardNumber}` : null].filter(Boolean).join(" ") || "Unmatched collectible";
}
function receiptId(row: KingmakerPendingReceipt) {
  return row.orderNumber || row.purchaseId || `Acquisition #${row.acquisitionItemId}`;
}
function statusLabel(row: KingmakerPendingReceipt) {
  if (row.status === "received_unscanned") return "Received — photos can be added later";
  if (row.status === "pending_purchase") return "Photos attached — choose Pending Sale or Stash";
  if (row.status === "possible_match") return "Possible scan match";
  return "Awaiting receipt / photos";
}

export default async function KingmakerPendingReceiptsPage() {
  let receipts: KingmakerPendingReceipt[] = [];
  let summary = { pendingRows: 0, receivedAwaitingPhotos: 0, pendingKnownBasis: 0, unknownBasisCount: 0 };
  let loadError: string | null = null;
  try {
    const data = await getKingmakerPendingReceipts();
    receipts = data.receipts;
    summary = data.summary;
  }
  catch (error) { loadError = error instanceof Error ? error.message : "Could not load Pending Receipts."; }

  return (
    <main className="px-4 py-7 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-emerald-300">KINGMAKER Pending Receipts</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Bought on or after September 16, 2026</h1>
          <p className="mt-4 max-w-4xl text-lg leading-8 text-slate-300">Receive a real purchase as soon as it arrives, even with no photos. Front/back photos can be added later and stay locked to that same purchase before you choose Pending Sale or Stash.</p>
        </section>
        {loadError ? <section className="rounded-xl border border-rose-800 bg-rose-950/40 p-5 text-rose-100"><h2 className="text-2xl font-black">Pending Receipts needs the Mac mini</h2><p className="mt-2 font-semibold">{loadError}</p></section> : null}
        <section className="grid gap-3 sm:grid-cols-4"><Metric label="Tracked receipts" value={String(summary.pendingRows)} /><Metric label="Received, photos later" value={String(summary.receivedAwaitingPhotos)} /><Metric label="Known basis" value={money(summary.pendingKnownBasis)} /><Metric label="Hard cutoff" value={KINGMAKER_PENDING_RECEIPTS_CUTOFF} /></section>
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-black">Import purchases</h2><p className="mt-1 text-sm font-semibold text-slate-400">The dashboard reads the Mac-local KINGMAKER ledger. Keep new eBay and Mercari receipts there before scan matching.</p></div><div className="flex flex-wrap gap-2"><Link href="/admin/market-intel/purchases/ebay-intake" className="rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950">Import eBay purchase</Link><Link href="/admin/market-intel/purchases/new" className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-black text-slate-200 hover:bg-slate-800">Add Mercari receipt manually</Link></div></div></section>
        <ReceiptTable title="Mac-local receipts awaiting arrival" empty="No Mac-local receipts are pending at or after the cutoff." rows={receipts.map((row) => ({ id: String(row.acquisitionItemId), title: title(row), source: row.source || "Source", purchasedAt: row.purchasedAt || row.purchaseDate || row.createdAt || null, identifier: receiptId(row), seller: row.seller || "Seller not captured", cost: row.allocatedCost, costStatus: row.costStatus, detail: `${row.cardNumber ? `Card #${row.cardNumber}` : "Card number pending"} · ${row.parallel || "Parallel pending"} · ${row.inventoryItemId ? `Inventory ${row.inventoryItemId}` : "No scan match yet"}`, href: row.listingUrl || undefined, status: statusLabel(row), rawStatus: row.status, acquisitionItemId: row.acquisitionItemId, hasScan: Boolean(row.scanId) }))} />
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"><p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="mt-2 text-2xl font-black">{value}</p></div>; }
function ReceiptTable({ title, empty, rows }: { title: string; empty: string; rows: Array<{ id: string; title: string; source: string; purchasedAt: string | null; identifier: string; seller: string; cost: number | null; costStatus: string; detail: string; href?: string; status: string; rawStatus: string; acquisitionItemId: number; hasScan: boolean }> }) {
  return <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70"><div className="border-b border-slate-800 p-5"><h2 className="text-2xl font-black">{title}</h2></div>{rows.length === 0 ? <p className="p-5 font-semibold text-slate-400">{empty}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left text-sm"><thead className="bg-slate-950 text-xs font-black uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Receipt</th><th className="px-4 py-3">Source</th><th className="px-4 py-3">Seller / ID</th><th className="px-4 py-3">All-in</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-800">{rows.map((row) => <tr key={row.id} className="align-top"><td className="px-4 py-4"><p className="font-black text-white">{row.title}</p><p className="mt-1 text-xs text-slate-400">{day(row.purchasedAt)}</p>{row.href ? <a className="mt-2 inline-flex text-xs font-black text-emerald-300 underline" href={row.href}>Open source</a> : null}</td><td className="px-4 py-4 font-black">{row.source}</td><td className="px-4 py-4"><p className="font-bold">{row.seller}</p><p className="mt-1 break-all text-xs text-slate-400">{row.identifier}</p></td><td className="px-4 py-4"><p className="font-black">{row.costStatus === "unknown" ? "Unknown" : money(row.cost)}</p><p className="mt-1 text-xs text-slate-400">{row.detail}</p></td><td className="px-4 py-4"><span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">{row.status}</span><PendingReceiptActions acquisitionItemId={row.acquisitionItemId} status={row.rawStatus} hasScan={row.hasScan} /></td></tr>)}</tbody></table></div>}</section>;
}
