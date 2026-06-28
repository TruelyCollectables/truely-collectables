import Link from "next/link";
import {
  inventoryEngine,
  type EbayReconciliationIssue,
  type EbayReconciliationRow,
} from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDate(value: string | null) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function issueLabel(issue: EbayReconciliationIssue) {
  return issue.replaceAll("_", " ").toUpperCase();
}

function issueTone(issue: EbayReconciliationIssue) {
  if (issue === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (issue === "sold_out" || issue === "not_linked") {
    return "border-neutral-200 bg-neutral-100 text-neutral-700";
  }

  if (issue === "stale_sync" || issue === "never_synced") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-rose-200 bg-rose-50 text-rose-800";
}

function needsAttention(row: EbayReconciliationRow) {
  return row.issues.some(
    (issue) =>
      issue === "missing_sku" ||
      issue === "never_synced" ||
      issue === "stale_sync",
  );
}

export default async function AdminEbayPage() {
  const status = await inventoryEngine.getEbayReconciliationStatus();
  const attentionRows = status.rows.filter(needsAttention);
  const otherRows = status.rows.filter((row) => !needsAttention(row));
  const visibleRows = [...attentionRows, ...otherRows].slice(0, 150);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Marketplace Sync
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              eBay Reconciliation
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Local TCOS view of eBay-linked inventory, sync freshness, SKU
              readiness, and listing coverage.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CommandLink href="/admin" label="Command Center" />
            <CommandLink href="/admin/inventory" label="Inventory V2" />
            <CommandLink href="/api/ebay/test" label="Test Route" />
            <CommandLink href="/api/ebay/import-listings?offset=0&limit=50" label="Import Batch" primary />
            <CommandLink href="/api/ebay/full-sync" label="Full Sync" primary />
            <CommandLink href="/api/ebay/auth" label="Reconnect" danger />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total Products" value={String(status.totalProducts)} />
          <Metric label="eBay Linked" value={String(status.ebayLinkedItems)} />
          <Metric label="Healthy Linked" value={String(status.healthyLinkedItems)} />
          <Metric label="Needs Attention" value={String(attentionRows.length)} />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Missing SKU" value={String(status.missingSkuItems)} />
          <Metric label="Never Synced" value={String(status.neverSyncedItems)} />
          <Metric label="Stale Sync" value={String(status.staleItems)} />
          <Metric label="Sold Out" value={String(status.soldOutItems)} />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Sync Window</h2>
              <p className="mt-1 text-sm text-neutral-600">
                A linked eBay item is considered stale after{" "}
                {status.staleAfterHours} hours without being seen by import.
              </p>
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Info label="Latest Seen" value={formatDate(status.latestSeenAt)} />
              <Info label="Local Only" value={String(status.localOnlyItems)} />
            </dl>
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Listing Health Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Rows needing SKU repair, first import, or fresh sync appear
                first. Local-only items are allowed.
              </p>
            </div>
            <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
              Store {status.storeId.slice(-4)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">SKU / Listing</th>
                  <th className="px-4 py-3">Stock</th>
                  <th className="px-4 py-3">Last Seen</th>
                  <th className="px-4 py-3">Health</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-neutral-600" colSpan={6}>
                      No products found.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr key={row.legacyProductId} className="align-top">
                      <td className="px-4 py-4">
                        <p className="font-bold">{row.title}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Legacy #{row.legacyProductId}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p>{row.sku || "No SKU"}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {row.ebayItemId ? `eBay ${row.ebayItemId}` : "Local only"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p>{row.quantity} in TCOS</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {money(row.price)} / {row.status}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p>{formatDate(row.lastSeenAt)}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {row.syncAgeHours === null
                            ? "No import timestamp"
                            : `${row.syncAgeHours.toFixed(2)} hours ago`}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {row.issues.map((issue) => (
                            <span
                              key={issue}
                              className={`rounded border px-2 py-1 text-[11px] font-black ${issueTone(issue)}`}
                            >
                              {issueLabel(issue)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/admin/products/${row.legacyProductId}`}
                          className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                        >
                          Open
                        </Link>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <dt className="text-xs font-bold uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

function CommandLink({
  href,
  label,
  primary,
  danger,
}: {
  href: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : danger
    ? "border border-rose-400 text-rose-200 hover:bg-rose-950"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link href={href} className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}>
      {label}
    </Link>
  );
}
