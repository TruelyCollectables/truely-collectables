import Link from "next/link";
import { supabase } from "../../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !product) {
    return (
      <main className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">
          Product Not Found
        </h1>

        <p className="mb-6">
          This card may have been sold or removed.
        </p>

        <Link
          href="/shop"
          className="inline-block border rounded px-4 py-2"
        >
          Back to Shop
        </Link>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <Link
        href="/shop"
        className="inline-block mb-6 underline"
      >
        ← Back to Shop
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          <img
            src={product.image_url || "/placeholder.png"}
            alt={product.title}
            className="w-full rounded-lg border"
          />
        </div>

        <div>
          <h1 className="text-3xl font-bold mb-4">
            {product.title}
          </h1>

          <div className="space-y-2 mb-6">
            {product.player && (
              <p>
                <strong>Player:</strong> {product.player}
              </p>
            )}

            {product.sport && (
              <p>
                <strong>Sport:</strong> {product.sport}
              </p>
            )}

            <p>
              <strong>Quantity:</strong> {product.quantity}
            </p>
          </div>

          <p className="text-4xl font-bold mb-6">
            ${Number(product.price).toFixed(2)}
          </p>

          {product.description && (
            <div className="mb-8">
              <h2 className="font-bold text-xl mb-2">
                Description
              </h2>

              <p className="whitespace-pre-wrap">
                {product.description}
              </p>
            </div>
          )}

          <form action="/api/checkout" method="POST">
            <input
              type="hidden"
              name="productId"
              value={product.id}
            />

            <button
              type="submit"
              className="w-full bg-black text-white rounded py-3 font-bold"
            >
              Buy Now
            </button>
          </form>

          <button
            disabled
            className="w-full border rounded py-3 font-bold mt-3 opacity-50"
          >
            Best Offer Coming Soon
          </button>
        </div>
      </div>
    </main>
  );
}