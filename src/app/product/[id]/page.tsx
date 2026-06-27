import Link from "next/link";
import { supabase } from "../../../lib/supabase";
import OfferForm from "./OfferForm";
import ProductActions from "./ProductActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", Number(id))
    .maybeSingle();

  if (error || !product) {
    return (
      <main className="p-8 max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Product Not Found</h1>

        <p className="mb-2">
          Product ID checked: <strong>{id}</strong>
        </p>

        <p className="mb-6">
          This card may have been sold, removed, or no longer exists.
        </p>

        <Link href="/shop" className="inline-block border rounded px-4 py-2">
          Back to Shop
        </Link>
      </main>
    );
  }

  const quantity = Number(product.quantity || 0);
  const isSoldOut = quantity <= 0;

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <Link href="/shop" className="inline-block mb-6 underline">
        ← Back to Shop
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <img
          src={product.image_url || "/placeholder.png"}
          alt={product.title}
          className="w-full rounded-lg border"
        />

        <div>
          <h1 className="text-3xl font-bold mb-4">{product.title}</h1>

          <p className="text-gray-600 mb-2">
            {product.sport} {product.player ? `• ${product.player}` : ""}
          </p>

          <p className="text-4xl font-bold mb-4">
            ${Number(product.price).toFixed(2)}
          </p>

          <p className="mb-6">Quantity: {quantity}</p>

          {product.description && (
            <div className="mb-8">
              <h2 className="font-bold text-xl mb-2">Description</h2>
              <p className="whitespace-pre-wrap">{product.description}</p>
            </div>
          )}

          {isSoldOut ? (
            <div className="w-full bg-red-600 text-white rounded py-3 font-bold text-center">
              SOLD OUT
            </div>
          ) : (
            <>
              <ProductActions
                product={{
                  id: product.id,
                  title: product.title,
                  price: Number(product.price),
                  image_url: product.image_url,
                }}
              />

              <OfferForm productId={product.id} price={Number(product.price)} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}