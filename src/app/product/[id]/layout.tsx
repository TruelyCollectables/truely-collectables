import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import SoldOverlay from "../../../components/SoldOverlay";
import { getProductSalePresentation } from "../../../lib/collectible-sale-history";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";
import { getActiveStoreId } from "../../../lib/stores";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import PublicProductCleanup from "./PublicProductCleanup";

function money(value: number | null) {
  return value === null ? "Sold price pending verification" : `$${value.toFixed(2)}`;
}

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function ProductDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const legacyProductId = Number(id);
  if (!Number.isInteger(legacyProductId) || legacyProductId <= 0) {
    return (
      <>
        <PublicProductCleanup />
        {children}
      </>
    );
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const storeId = getActiveStoreId();
  const sale = await getProductSalePresentation({
    supabase,
    storeId,
    legacyProductId,
  }).catch(() => null);

  if (!sale) {
    return (
      <>
        <PublicProductCleanup />
        {children}
      </>
    );
  }

  const product = await createServerInventoryEngine()
    .getByLegacyProductId(legacyProductId)
    .catch(() => null);
  if (!product?.imageUrl) {
    return (
      <>
        <PublicProductCleanup />
        {children}
      </>
    );
  }

  const priceIsVerified =
    sale.soldPrice !== null && sale.soldPriceStatus !== "unresolved";

  return (
    <>
      <PublicProductCleanup />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Link href="/shop" className="text-sm font-black underline">
          Back to Shop
        </Link>

        <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="relative min-h-[360px] overflow-hidden rounded border-2 border-red-800 bg-neutral-100 lg:min-h-[680px]">
            <Image
              src={product.imageUrl}
              alt={product.title}
              fill
              unoptimized
              sizes="(min-width: 1024px) calc(100vw - 540px), 100vw"
              className="object-contain p-3"
            />
            <SoldOverlay />
          </div>

          <div className="space-y-5">
            <section>
              <p className="inline-flex rounded bg-red-700 px-3 py-1 text-xs font-black uppercase tracking-[0.15em] text-white">
                Sold · Research only
              </p>
              <h1 className="mt-4 text-4xl font-black leading-tight md:text-5xl">
                {product.title}
              </h1>
              <p className="mt-3 font-semibold text-neutral-600">
                {[product.storefrontSection, product.player]
                  .filter(Boolean)
                  .join(" · ") || "Collectible"}
              </p>
            </section>

            <section className="rounded border-2 border-red-200 bg-red-50 p-5">
              <p className="text-xs font-black uppercase tracking-[0.15em] text-red-700">
                Actual sale evidence
              </p>
              <p className="mt-2 text-4xl font-black text-red-950">
                {priceIsVerified ? `Sold for ${money(sale.soldPrice)}` : money(null)}
              </p>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded bg-white p-3">
                  <dt className="font-black text-neutral-500">Sold date</dt>
                  <dd className="mt-1 font-bold">{dateLabel(sale.soldAt)}</dd>
                </div>
                <div className="rounded bg-white p-3">
                  <dt className="font-black text-neutral-500">Sale source</dt>
                  <dd className="mt-1 font-bold capitalize">
                    {sale.soldSource || "Unresolved"}
                  </dd>
                </div>
                <div className="rounded bg-white p-3">
                  <dt className="font-black text-neutral-500">Price evidence</dt>
                  <dd className="mt-1 font-bold capitalize">
                    {sale.soldPriceStatus}
                  </dd>
                </div>
                <div className="rounded bg-white p-3">
                  <dt className="font-black text-neutral-500">Moves to archive</dt>
                  <dd className="mt-1 font-bold">
                    {dateLabel(sale.archiveAfter)}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="rounded border bg-white p-5">
              <h2 className="text-xl font-black">Sold item protection</h2>
              <p className="mt-2 leading-7 text-neutral-700">
                This collectible is locked from cart, checkout, Buy Now, and Best
                Offer. It remains visible for seven days as sale history, then moves
                to the InstaComp archive without deleting its identity or evidence.
              </p>
            </section>

            <section className="rounded border bg-white p-5">
              <h2 className="text-xl font-black">Catalog details</h2>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                {[
                  ["SKU", product.sku || "Not assigned"],
                  ["eBay listing", product.ebayItemId || "Not linked"],
                  ["Category", product.storefrontSection || "Not cataloged"],
                  ["Player / subject", product.player || "Not cataloged"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded bg-neutral-50 p-3">
                    <dt className="font-black text-neutral-500">{label}</dt>
                    <dd className="mt-1 break-words font-bold">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </section>
      </main>
    </>
  );
}
