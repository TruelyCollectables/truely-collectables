import AddToCartButton from "../../components/AddToCartButton";
import { supabase } from "../../../lib/supabase";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !product) {
    return (
      <main className="p-8">
        <h1>Product not found</h1>
        <p>Product ID: {id}</p>
        <pre>{error?.message}</pre>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="bg-gray-100 rounded p-8 flex items-center justify-center">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.title}
              className="max-h-[500px] object-contain rounded"
            />
          ) : (
            <span className="text-gray-500">No Image Available</span>
          )}
        </div>

        <div>
          <h1 className="text-4xl font-bold">{product.title}</h1>

          <p className="text-gray-500 mt-3">
            {product.sport} • {product.player}
          </p>

          <p className="text-4xl font-bold mt-6">
            ${product.price}
          </p>

          <p className="mt-4">
            Quantity Available: {product.quantity}
          </p>

          <div className="mt-8">
            <h2 className="text-xl font-bold mb-2">
              Description
            </h2>

            <p className="text-gray-700">
              {product.description || "No description available."}
            </p>
          </div>

        <AddToCartButton product={product} />
        </div>
      </div>
    </main>
  );
}