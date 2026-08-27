import Link from "next/link";
import { redirect } from "next/navigation";
import AdminSubmitButton from "../AdminSubmitButton";
import {
  inventoryEngine,
  type InventoryBridgeIssue,
  type InventoryBridgeRow,
} from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function backfillInventory() {
  "use server";

  let failure: string | null = null;

  try {
    await inventoryEngine.backfillInventoryItemsFromProducts();
  } catch (error) {
    failure =
      error instanceof Error && error.message.trim()
        ? error.message.trim().slice(0, 240)
        : "Inventory backfill failed. Please try again.";
  }

  if (failure) {
    redirect(`/admin/inventory?backfillError=${encodeURIComponent(failure)}`);
  }

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
  searchParams?: Promise<{ backfill?: string; backfillError?: string }>;
}) {
  const params = await searchParams;
  const status = await inventoryEngine.getBridgeStatus();
  const attentionRows = status.rows.filter(needsAttention);
  const cleanRows = status.rows.filter((row) => !needsAttention(row));
  const visibleRows = [...attentionRows, ...cleanRows].slice(0, 150);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.15),_transparent_34%),linear-gradient(180deg,_#faf7ef_0%,_#f4f1ea_42%,_#eee7da_100%)] px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-2xl shadow-neutral-950/10">
        <div className="flex flex-col gap-5 border-b border-white/10 bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_32%),linear-gradient(135deg,_rgba(255,255,255,0.08),_transparent)] p-6 lg:flex-row lg:items-end lg:justify-between lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              Universal Inventory Engine
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Inventory Bridge
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-300">
              Store-scoped reconciliation between legacy storefront products and
              TCOS inventory records.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/15"
            >
              Command Center
            </Link>
            <Link
              href="/admin/products"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/15"
            >
              Products
            </Link>
            <Link
              href="/admin/inventory/category-review"
              className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold transition hover:bg-white/15"
            >
              Category Review
            </Link>
            <form action={backfillInventory}>
              <AdminSubmitButton
                className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-amber-200"
                pendingChildren="Backfilling..."
                title="Backfill missing inventory bridge records from existing product data without publishing or changing live listings."
              >
                Backfill Inventory Bridge
              </AdminSubmitButton>
              <p className="mt-2 text-xs font-bold text-amber-100">
                Repairs local inventory bridge records only; buyer-facing products and eBay listings are not published.
              </p>
            </form>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] space-y-6 py-6">
        {params?.backfill === "complete" ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 shadow-sm ring-1 ring-emerald-950/5">
            Inventory backfill completed. Current bridge status is shown below.
          </div>
        ) : null}
        {params?.backfillError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-800 shadow-sm ring-1 ring-rose-950/5">
            Inventory backfill failed: {params.backfillError}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Legacy Products" value={String(status.totalProducts)} />
          <Metric label="Inventory Bridged" value={String(status.bridgedItems)} />
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

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white/95 shadow-sm ring-1 ring-black/[0.02]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Reconciliation Queue</h2>
              <p className="mt-1 text-sm text-neutral-600">
                Attention rows show first. Sold-out rows are not treated as a
                bridge failure unless quantity or price also mismatches.
              </p>
            </div>
            <span className="rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
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
                  <th className="px-4 py-3">Inventory Item</th>
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
                          Inventory: {row.inventoryQuantity ?? "missing"}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        <p>Product: {money(row.productPrice)}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Inventory: {money(row.inventoryPrice)}
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
                              className={`rounded-full border px-2 py-1 text-[11px] font-black ${issueTone(issue)}`}
                            >
                              {issueLabel(issue)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/admin/products/${row.legacyProductId}`}
                          className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-bold shadow-sm transition hover:bg-neutral-50"
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
    <div className="rounded-3xl border border-neutral-200 bg-white/95 p-5 shadow-sm ring-1 ring-black/[0.02]">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black">{value}</p>
    </div>
  );
}
