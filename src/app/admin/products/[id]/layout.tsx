import type { ReactNode } from "react";
import Link from "next/link";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

function money(value: unknown) {
  if (value === null || value === undefined || value === "") return "Unresolved";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Unresolved";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(parsed);
}

function dateLabel(value: unknown) {
  if (!value) return "Unresolved";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Unresolved";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default async function AdminProductSaleEvidenceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const legacyProductId = Number(id);
  if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
    return children;
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const [{ data: product }, { data: sales }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id,price,quantity,sold_at,sold_price,sold_source,sold_reference,sold_price_status,archive_after,archived_at",
      )
      .eq("store_id", storeId)
      .eq("id", legacyProductId)
      .maybeSingle(),
    supabase
      .from("collectible_sales")
      .select(
        "id,sold_price,currency,sold_at,source_marketplace,source_reference,evidence_status,sold_quantity",
      )
      .eq("store_id", storeId)
      .eq("legacy_product_id", legacyProductId)
      .order("sold_at", { ascending: false })
      .limit(10),
  ]);

  const latestSale = sales?.[0] || null;
  const actualSoldPrice = latestSale?.sold_price ?? product?.sold_price ?? null;
  const evidenceStatus =
    latestSale?.evidence_status || product?.sold_price_status || "unresolved";
  const saleSource =
    latestSale?.source_marketplace || product?.sold_source || "unresolved";
  const soldAt = latestSale?.sold_at || product?.sold_at || null;
  const reference =
    latestSale?.source_reference || product?.sold_reference || null;
  const hasSaleEvidence = Boolean(
    latestSale || product?.sold_at || Number(product?.quantity || 0) <= 0,
  );

  if (!hasSaleEvidence) return children;

  return (
    <>
      <section className="border-b-4 border-red-800 bg-red-950 px-4 py-5 text-white sm:px-6">
        <div className="mx-auto grid max-w-[1500px] gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-red-200">
              Actual sale evidence
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Evidence label="Original listing price" value={money(product?.price)} />
              <Evidence
                label="Actual sold price"
                value={money(actualSoldPrice)}
                alert={actualSoldPrice === null}
              />
              <Evidence label="Sold date" value={dateLabel(soldAt)} />
              <Evidence label="Sale source" value={String(saleSource)} />
              <Evidence
                label="Evidence status"
                value={String(evidenceStatus)}
                alert={evidenceStatus === "unresolved"}
              />
            </div>
            <p className="mt-3 text-xs font-semibold text-red-100">
              {reference ? `Reference: ${reference}. ` : ""}
              {sales?.length
                ? `${sales.length} immutable sale record${sales.length === 1 ? "" : "s"} retained for this product.`
                : "Sold price remains unresolved and is excluded from high-confidence InstaComp comps."}
            </p>
          </div>
          <Link
            href="/admin/sales-history"
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/30 bg-white/10 px-5 py-2 text-sm font-black hover:bg-white/20"
          >
            Open Sale History
          </Link>
        </div>
      </section>
      {children}
    </>
  );
}

function Evidence({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 p-3">
      <p className="text-[11px] font-black uppercase tracking-wide text-red-200">
        {label}
      </p>
      <p className={`mt-1 break-words font-black capitalize ${alert ? "text-amber-300" : "text-white"}`}>
        {value}
      </p>
    </div>
  );
}
