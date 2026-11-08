import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listAdminSaleHistory,
  recordCollectibleSale,
  type SaleEvidenceStatus,
} from "../../../lib/collectible-sale-history";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function money(value: number | null) {
  if (value === null) return "Unresolved";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "Unresolved";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unresolved";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function evidenceTone(status: SaleEvidenceStatus) {
  if (status === "verified") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (status === "manual") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }
  return "border-amber-200 bg-amber-50 text-amber-950";
}

function safeSource(value: FormDataEntryValue | null) {
  const source = String(value || "other")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .slice(0, 50);
  return source || "other";
}

async function markSoldElsewhere(formData: FormData) {
  "use server";

  const legacyProductId = Number(formData.get("legacy_product_id") || 0);
  const sourceMarketplace = safeSource(formData.get("source_marketplace"));
  const sourceReference = String(formData.get("source_reference") || "")
    .trim()
    .slice(0, 200);
  const priceText = String(formData.get("sold_price") || "").trim();
  const soldPrice = priceText === "" ? null : Number(priceText);
  const soldDateText = String(formData.get("sold_at") || "").trim();
  const soldAt = soldDateText
    ? new Date(soldDateText).toISOString()
    : new Date().toISOString();

  if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
    redirect("/admin/sales-history?error=invalid_product");
  }
  if (soldPrice !== null && (!Number.isFinite(soldPrice) || soldPrice < 0)) {
    redirect("/admin/sales-history?error=invalid_price");
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const eventKey = [
    "manual",
    sourceMarketplace,
    sourceReference || "no-reference",
    legacyProductId,
    soldAt,
  ].join(":");

  try {
    await recordCollectibleSale({
      supabase,
      storeId,
      legacyProductId,
      eventKey,
      sourceMarketplace,
      sourceReference: sourceReference || null,
      soldQuantity: 1,
      soldPrice,
      soldAt,
      evidenceStatus: soldPrice === null ? "unresolved" : "manual",
      evidence: {
        evidence_source: "admin_mark_sold_elsewhere",
        entered_at: new Date().toISOString(),
      },
      forceZero: true,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not record external sale.";
    redirect(
      `/admin/sales-history?error=${encodeURIComponent(message.slice(0, 180))}`,
    );
  }

  redirect(`/admin/sales-history?saved=${legacyProductId}`);
}

export default async function AdminSalesHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<{ saved?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const history = await listAdminSaleHistory({
    supabase,
    storeId,
    limit: 500,
  });

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="rounded-3xl bg-neutral-950 p-6 text-white sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-300">
            Sale evidence and InstaComp archive
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-4xl font-black">Sold Collectibles</h1>
              <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
                Actual sold prices remain separate from original listing prices.
                Unresolved prices are preserved but excluded from high-confidence
                InstaComp internal comps until evidence is added.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/admin/products"
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-black"
              >
                Admin Products
              </Link>
              <Link
                href="/admin/inventory"
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-black"
              >
                Inventory Bridge
              </Link>
            </div>
          </div>
        </section>

        {params?.saved ? (
          <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">
            Product #{params.saved} was locked as sold and queued for eBay quantity
            protection.
          </div>
        ) : null}
        {params?.error ? (
          <div className="rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-900">
            Sale action failed: {params.error}
          </div>
        ) : null}

        <section className="rounded-3xl border bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-2xl font-black">Mark Sold Elsewhere</h2>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            Use this fallback when a marketplace propagation is delayed or an item
            was sold manually. The website is locked immediately and a durable eBay
            zero-quantity correction is queued when the product is eBay-linked.
          </p>
          <form action={markSoldElsewhere} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <label className="text-sm font-black">
              Product ID
              <input
                name="legacy_product_id"
                type="number"
                min="1"
                required
                className="mt-1 w-full rounded-xl border px-3 py-2 text-base"
              />
            </label>
            <label className="text-sm font-black">
              Marketplace
              <select
                name="source_marketplace"
                defaultValue="collx"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-base"
              >
                <option value="collx">CollX</option>
                <option value="ebay">eBay</option>
                <option value="card_show">Card Show</option>
                <option value="local">Local Sale</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="text-sm font-black">
              Actual sold price
              <input
                name="sold_price"
                type="number"
                min="0"
                step="0.01"
                placeholder="Leave blank if unknown"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-base"
              />
            </label>
            <label className="text-sm font-black">
              Sold date/time
              <span className="mt-1 flex w-full min-w-0 rounded-xl border px-3 py-2">
                <input
                  name="sold_at"
                  type="datetime-local"
                  className="block w-full min-w-0 border-0 bg-transparent p-0 text-base"
                />
              </span>
            </label>
            <label className="text-sm font-black">
              Order/reference
              <input
                name="source_reference"
                type="text"
                maxLength={200}
                placeholder="Optional"
                className="mt-1 w-full rounded-xl border px-3 py-2 text-base"
              />
            </label>
            <button
              type="submit"
              className="min-h-12 rounded-xl bg-red-700 px-5 py-3 font-black text-white md:col-span-2 xl:col-span-5"
            >
              Mark Sold and Protect Inventory
            </button>
          </form>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Sale records" value={history.sales.length} />
          <Metric
            label="Verified/manual prices"
            value={history.sales.filter((sale) => sale.soldPrice !== null && sale.evidenceStatus !== "unresolved").length}
          />
          <Metric label="Price unresolved" value={history.unresolved.length} />
        </section>

        <section className="overflow-hidden rounded-3xl border bg-white shadow-sm">
          <div className="border-b p-5">
            <h2 className="text-2xl font-black">Immutable Sale Records</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Sold Price</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Sold Date</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Reference</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.sales.length ? (
                  history.sales.map((sale) => (
                    <tr key={sale.id}>
                      <td className="px-4 py-4">
                        <p className="font-black">Product #{sale.legacyProductId}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          {sale.sku || "No SKU"} · {sale.ebayItemId || "No eBay ID"}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-lg font-black">
                        {money(sale.soldPrice)}
                      </td>
                      <td className="px-4 py-4 font-bold capitalize">
                        {sale.sourceMarketplace}
                      </td>
                      <td className="px-4 py-4">{dateLabel(sale.soldAt)}</td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full border px-2 py-1 text-xs font-black uppercase ${evidenceTone(sale.evidenceStatus)}`}>
                          {sale.evidenceStatus}
                        </span>
                      </td>
                      <td className="px-4 py-4 break-all text-xs">
                        {sale.sourceReference || "None"}
                      </td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/admin/products/${sale.legacyProductId}`}
                          className="rounded-full border px-3 py-2 text-xs font-black"
                        >
                          Open Product
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-neutral-500">
                      No immutable sale records have been created yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-amber-300 bg-white shadow-sm">
          <div className="border-b border-amber-200 bg-amber-50 p-5">
            <h2 className="text-2xl font-black">Sold Price Unresolved</h2>
            <p className="mt-2 text-sm font-semibold text-amber-950">
              These zero-quantity products remain preserved but are not trusted as
              InstaComp sold comps until an authoritative or manual price is recorded.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Original Listing Price</th>
                  <th className="px-4 py-3">Known Sold Date</th>
                  <th className="px-4 py-3">Known Source</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.unresolved.length ? (
                  history.unresolved.map((row) => (
                    <tr key={row.legacyProductId}>
                      <td className="px-4 py-4">
                        <p className="max-w-xl font-black">{row.title}</p>
                        <p className="mt-1 text-xs text-neutral-500">
                          Product #{row.legacyProductId} · {row.sku || "No SKU"} · {row.ebayItemId || "No eBay ID"}
                        </p>
                      </td>
                      <td className="px-4 py-4 font-black">{money(row.listingPrice)}</td>
                      <td className="px-4 py-4">{dateLabel(row.soldAt)}</td>
                      <td className="px-4 py-4 capitalize">{row.soldSource || "Unresolved"}</td>
                      <td className="px-4 py-4">
                        <Link
                          href={`/admin/products/${row.legacyProductId}`}
                          className="rounded-full border px-3 py-2 text-xs font-black"
                        >
                          Resolve Product
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                      No unresolved sold-price rows.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-3xl font-black">{value.toLocaleString()}</p>
    </div>
  );
}
