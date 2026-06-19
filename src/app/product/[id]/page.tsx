import Link from "next/link";
import { supabase } from "../../../lib/supabase";

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
      <main className="p-8">
        <h1 className="text-3xl font-bold">Product not found</h1>
        <Link href="/shop" className="underline mt-4 block">
          Back to Shop
        </Link>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <Link href="/shop" className="underline mb-6 block">
        ← Back to Shop
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <img
          src={product.image_url}
          alt={product.title}
          className="w-full rounded-lg border object-cover"
        />

        <div>
          <h1 className="text-4xl font-bold mb-4">{product.title}</h1>

          <p className="text-gray-600 mb-2">
            {product.sport} {product.player ? `• ${product.player}` : ""}
          </p>

          <p className="text-4xl font-bold mb-4">${product.price}</p>

          <p className="mb-4">Quantity: {product.quantity}</p>

          {product.description && (
            <div className="mb-6">
              <h2 className="text-xl font-bold mb-2">Description</h2>
              <p className="whitespace-pre-wrap text-gray-700">
                {product.description}
              </p>
            </div>
          )}

          <form action="/api/checkout" method="POST">
            <input type="hidden" name="productId" value={product.id} />

            <button
              type="submit"
              className="w-full bg-black text-white rounded py-3 font-bold"
            >
              Buy Now
            </button>
          </form>

          {product.ebay_url ? (
            <a
              href={product.ebay_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center border rounded py-3 font-bold mt-3"
            >
              Make Best Offer on eBay
            </a>
          ) : (
            <button
              disabled
              className="w-full border rounded py-3 font-bold opacity-50 mt-3"
            >
              Best Offer Coming Soon
            </button>
          )}
        </div>
      </div>
    </main>
  );
}