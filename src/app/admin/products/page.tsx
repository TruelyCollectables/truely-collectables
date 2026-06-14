import { supabase } from "../../../lib/supabase";

export default async function AdminProductsPage() {
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .order("id");

  if (error) {
    return (
      <main className="p-8">
        <h1>Error Loading Products</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-8">
        Admin Products
      </h1>
<a
  href="/admin/products/new"
  className="inline-block border rounded px-4 py-2 mb-6"
>
  Add Product
</a>
      {products?.map((product) => (
        <div
          key={product.id}
          className="border rounded p-4 mb-4"
        >
          <h2 className="font-bold text-xl">
            {product.title}
          </h2>

          <p>Price: ${product.price}</p>

          <p>Quantity: {product.quantity}</p>

          <p>Player: {product.player}</p>

          <p>Sport: {product.sport}</p>
        </div>
      ))}
    </main>
  );
}