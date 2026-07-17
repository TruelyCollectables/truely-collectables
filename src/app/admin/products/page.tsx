import Link from "next/link";
import { redirect } from "next/navigation";
import BulkDescriptionEditor from "./BulkDescriptionEditor";
import { createServerInventoryEngine } from "../../../lib/server-inventory-engine";
import type { UniversalInventoryItem } from "../../../modules/inventory";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseBulkDescriptionMode(value: FormDataEntryValue | null) {
  const mode = String(value || "append");

  return mode === "replace" || mode === "prepend" || mode === "append"
    ? mode
    : "append";
}

async function bulkUpdateDescriptions(formData: FormData) {
  "use server";

  const ids = Array.from(new Set(
    formData
      .getAll("product_ids")
      .map((value) => Number(value || 0))
      .filter((value) => Number.isInteger(value) && value > 0),
  )).slice(0, 500);
  const descriptionPatch = String(formData.get("description") || "").trim();
  const mode = parseBulkDescriptionMode(formData.get("mode"));

  if (ids.length === 0 || descriptionPatch.length === 0) {
    redirect("/admin/products?bulkError=missing_selection_or_description");
  }

  const engine = createServerInventoryEngine();
  let updated = 0;

  for (const id of ids) {
    const product = await engine.getByLegacyProductId(id);

    if (!product) continue;

    const currentDescription = product.description?.trim() || "";
    const nextDescription =
      mode === "replace"
        ? descriptionPatch
        : mode === "prepend"
          ? [descriptionPatch, currentDescription].filter(Boolean).join("\n\n")
          : [currentDescription, descriptionPatch].filter(Boolean).join("\n\n");

    await engine.updateProduct(id, {
      title: product.title,
      player: product.player,
      sport: product.sport,
      price: product.price,
      quantity: product.quantity,
      status: product.status,
      imageUrl: product.imageUrl,
      description: nextDescription,
      authenticity: product.authenticity,
    });
    updated += 1;
  }

  redirect(`/admin/products?bulkUpdated=${updated}`);
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams?: Promise<{ bulkUpdated?: string; bulkError?: string }>;
}) {
  const query = await searchParams;
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

      {query?.bulkUpdated && (
        <div className="mb-6 rounded border border-green-300 bg-green-50 p-4 font-bold text-green-800">
          Updated descriptions on {query.bulkUpdated} product
          {query.bulkUpdated === "1" ? "" : "s"}.
        </div>
      )}

      {query?.bulkError && (
        <div className="mb-6 rounded border border-red-300 bg-red-50 p-4 font-bold text-red-800">
          Select at least one product and paste a description/code block first.
        </div>
      )}

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

      <BulkDescriptionEditor
        products={products.map((product) => ({
          legacyProductId: product.legacyProductId,
          title: product.title,
          price: product.price,
          status: product.status,
        }))}
        action={bulkUpdateDescriptions}
      />

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
