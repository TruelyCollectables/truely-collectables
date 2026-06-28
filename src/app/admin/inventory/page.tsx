import Link from "next/link";
import { redirect } from "next/navigation";
import {
  inventoryEngine,
  type InventoryBridgeIssue,
  type InventoryBridgeRow,
} from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backfillInventory() {
  "use server";

  await inventoryEngine.backfillInventoryItemsFromProducts();

  redirect("/admin/inventory?backfill=complete");
}

function money(value: number | null) {
  if (value === null) return "n/a";
  return `$${Number(value || 0).toFixed(2)}`;
}

function issueLabel(issue: InventoryBridgeIssue) {
  return issue.replaceAll("_", " ").toUpperCase();
}

function issueTone(issue: InventoryBridgeIssue) {
  if (issue === "ok") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (issue === "sold_out") {
    return "border-neutral-200 bg-neutral-100 text-neutral-700";
  }

  if (issue === "sku_link_only") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-rose-200 bg-rose-50 text-rose-800";
}

function needsAttention(row: InventoryBridgeRow) {
  return row.issues.some(
    (issue) =>
      issue === "missing_inventory_item" ||
      issue === "quantity_mismatch" ||
      issue === "price_mismatch" ||
      issue === "sku_link_only",
  );
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ backfill?: string }>;
}) {
  const params = await searchParams;
  const status = await inventoryEngine.getBridgeStatus();
  const attentionRows = status.rows.filter(needsAttention);
  const cleanRows = status.rows.filter((row) => !needsAttention(row));
  const visibleRows = [...attentionRows, ...cleanRows].slice(0, 150);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Universal Inventory Engine
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Inventory V2 Bridge
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Store-scoped reconciliation between legacy storefront products and
              TCOS V2 inventory records.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white/10"
            >
              Command Center
            </Link>
            <Link
              href="/admin/products"
              className="rounded-md border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white/10"
            >
              Products
            </Link>
            <form action={backfillInventory}>
              <button
                type="submit"
                className="rounded-md bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 hover:bg-amber-200"
              >
                Backfill V2 Inventory
              </button>
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        {params?.backfill === "complete" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
            Inventory backfill completed. Current bridge status is shown below.
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Legacy Products" value={String(status.totalProducts)} />
          <Metric label="V2 Bridged" value={String(status.bridgedItems)} />
          <Metric label="Needs Backfill" value={String(status.missingInventoryItems)} />
          <Metric label="Needs Review" value={String(attentionRows.length)} />
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Active Items" value={String(status.activeItems)} />
          <Metric label="Sold Out" value={String(status.soldOutItems)} />
          <Metric label="eBay Linked" value={String(status.ebayLinkedItems)} />
          <Metric
            label="Mismatch Count"
            value={String(status.quantityMismatches + status.priceMismatches)}
          />
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Reconciliation Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Attention rows show first. Sold-out rows are not treated as a
                bridge failure unless quantity or price also mismatches.
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
                  <th className="px-4 py-3">SKU / eBay</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">V2 Item</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-neutral-600" colSpan={7}>
                      No inventory rows found.
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
                        <p>Product: {row.productQuantity}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          V2: {row.inventoryQuantity ?? "missing"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p>Product: {money(row.productPrice)}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          V2: {money(row.inventoryPrice)}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="max-w-[180px] break-words text-xs">
                          {row.inventoryItemId || "Not created"}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {row.source}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-[240px] flex-wrap gap-1.5">
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
