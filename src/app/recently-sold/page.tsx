import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import SoldOverlay from "../../components/SoldOverlay";
import { listRecentSoldStorefrontItems } from "../../lib/collectible-sale-history";
import { preferHighResolutionListingImage } from "../../lib/listing-image-utils";
import { getActiveStoreId } from "../../lib/stores";
import { createSupabaseServerClient } from "../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Recently Sold Sports Cards",
  description:
    "See the sports cards and collectibles that recently sold from Truely Collectables.",
  alternates: { canonical: "/recently-sold" },
};

function soldPriceLabel(product: {
  soldPrice?: number | null;
  soldPriceStatus?: string | null;
}) {
  if (
    product.soldPrice !== null &&
    product.soldPrice !== undefined &&
    product.soldPriceStatus !== "unresolved"
  ) {
    return `Sold for $${Number(product.soldPrice).toFixed(2)}`;
  }
  return "Sold price pending verification";
}

function soldDateLabel(value: string | null | undefined) {
  if (!value) return "Recently sold";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently sold";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default async function RecentlySoldPage() {
  const supabase = createSupabaseServerClient({ admin: true });
  const products = await listRecentSoldStorefrontItems({
    supabase,
    storeId: getActiveStoreId(),
    sort: "newest",
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <section className="border-b-4 border-red-700 pb-7">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">
          The seven-day sale wall
        </p>
        <h1 className="mt-2 text-4xl font-black sm:text-5xl">
          Recently Sold — See What You Missed
        </h1>
        <p className="mt-4 max-w-3xl text-lg font-semibold leading-8 text-neutral-600">
          These cards and collectibles sold during the last seven days. Open any
          item to view its sale details and the available front and back photos.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <p className="rounded bg-red-100 px-4 py-2 text-sm font-black text-red-800">
            {products.length.toLocaleString()} recently sold
          </p>
          <Link
            href="/shop"
            className="inline-flex min-h-11 items-center justify-center rounded border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-sm font-black shadow-[3px_3px_0_#111318]"
          >
            Shop Available Inventory
          </Link>
        </div>
      </section>

      {products.length === 0 ? (
        <section className="mt-8 rounded border bg-white p-6">
          <h2 className="text-2xl font-black">Nothing sold in the last seven days.</h2>
          <p className="mt-2 font-semibold text-neutral-600">
            New sales will appear here automatically.
          </p>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => {
            const imageUrl =
              preferHighResolutionListingImage(product.imageUrl) ||
              "/placeholder.png";
            return (
              <article
                key={product.legacyProductId}
                className="overflow-hidden rounded border-2 border-red-700 bg-white"
              >
                <Link
                  href={`/product/${product.legacyProductId}`}
                  className="block"
                  aria-label={`View sold item ${product.title}`}
                >
                  <div className="relative aspect-[4/5] bg-neutral-100">
                    <Image
                      src={imageUrl}
                      alt={`${product.title} front`}
                      fill
                      unoptimized
                      sizes="(min-width: 1280px) 300px, (min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                      className="object-contain p-2"
                    />
                    <SoldOverlay compact />
                  </div>
                </Link>

                <div className="p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-red-700">
                    {product.storefrontSection} · {soldDateLabel(product.soldAt)}
                  </p>
                  <h2 className="mt-2 line-clamp-2 min-h-14 text-lg font-black leading-7">
                    {product.title}
                  </h2>
                  {product.player ? (
                    <p className="mt-2 text-sm font-semibold text-neutral-500">
                      {product.player}
                    </p>
                  ) : null}
                  <p className="mt-4 border-t border-neutral-200 pt-3 text-lg font-black text-red-800">
                    {soldPriceLabel(product)}
                  </p>
                  <Link
                    href={`/product/${product.legacyProductId}`}
                    className="mt-4 flex min-h-11 w-full items-center justify-center rounded border border-red-800 px-4 py-2 text-center font-black text-red-800 hover:bg-red-800 hover:text-white"
                  >
                    View Sold Item
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
