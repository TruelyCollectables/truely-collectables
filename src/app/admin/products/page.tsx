import Link from "next/link";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";
import type { UniversalInventoryItem } from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminProductsPage() {
  let products: UniversalInventoryItem[] = [];
  let error: Error | null = null;

  try {
    products = await createServerInventoryEngine().listAll();
  } catch (err: any) {
    error = err;
  }

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

      <Link
        href="/admin/products/new"
        className="inline-block border rounded px-4 py-2 mb-6"
      >
        Add Product
      </Link>

      <Link
        href="/admin/logout"
        className="inline-block border rounded px-4 py-2 mb-6 ml-4"
      >
        Logout
      </Link>

      {products?.map((product) => (
        <div
          key={product.legacyProductId}
          className="border rounded p-4 mb-4"
        >
          <h2 className="font-bold text-xl">
            {product.title}
          </h2>

          <p>Price: ${product.price}</p>

          <p>Quantity: {product.quantity}</p>

          <p>Status: {product.status}</p>

          <p>Inventory Source: {product.source}</p>

          <p>Player: {product.player}</p>

          <p>Sport: {product.sport}</p>

          <Link
            href={`/admin/products/${product.legacyProductId}`}
            className="inline-block border rounded px-4 py-2 mt-4"
          >
            Edit
          </Link>
        </div>
      ))}
    </main>
  );
}
