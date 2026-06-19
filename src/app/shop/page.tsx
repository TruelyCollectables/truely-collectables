import Link from "next/link";
import { supabase } from "../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Shop() {
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .gt("quantity", 0)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1>Error loading products</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-8">Shop Sports Cards</h1>

      {!products || products.length === 0 ? (
        <p>No products found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((product) => (
            <div
              key={product.id}
              className="border rounded-lg p-4 hover:shadow-lg transition"
            >
              <img
                src={product.image_url}
                alt={product.title}
                className="w-full h-64 object-cover rounded mb-4"
              />

              <h2 className="font-bold text-lg">{product.title}</h2>

              <p className="text-sm text-gray-500 mt-1">
                {product.sport} {product.player ? `• ${product.player}` : ""}
              </p>

              <p className="text-2xl font-bold mt-3">${product.price}</p>

              <p className="text-sm mt-1">Quantity: {product.quantity}</p>

              <Link
                href={`/product/${product.id}`}
                className="block text-center mt-4 w-full border rounded py-2"
              >
                View Card
              </Link>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}