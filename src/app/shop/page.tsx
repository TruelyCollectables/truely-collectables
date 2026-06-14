import { supabase } from "../../lib/supabase";

export default async function Shop() {
  const { data: products, error } = await supabase
    .from("products")
    .select("*");

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
      <h1 className="text-4xl font-bold mb-8">
        Shop Sports Cards
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {products?.map((product) => (
          <div
            key={product.id}
            className="border rounded-lg p-4 hover:shadow-lg transition"
          >
            <div className="bg-gray-100 h-64 flex items-center justify-center mb-4 rounded">
              <span className="text-gray-500">Card Image</span>
            </div>

            <h2 className="font-bold text-lg">
              {product.title}
            </h2>

            <p className="text-sm text-gray-500 mt-1">
              {product.sport} • {product.player}
            </p>

            <p className="text-2xl font-bold mt-3">
              ${product.price}
            </p>

            <p className="text-sm mt-1">
              Quantity: {product.quantity}
            </p>

            <button className="mt-4 w-full border rounded py-2">
              View Card
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}