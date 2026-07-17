"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

type BulkDescriptionProduct = {
  legacyProductId: number;
  title: string;
  price: number;
  status: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded bg-black px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving descriptions..." : "Apply To Selected"}
    </button>
  );
}

export default function BulkDescriptionEditor({
  products,
  action,
}: {
  products: BulkDescriptionProduct[];
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allShowingIds = useMemo(
    () => products.map((product) => product.legacyProductId),
    [products],
  );
  const allShowingSelected =
    allShowingIds.length > 0 &&
    allShowingIds.every((id) => selectedSet.has(id));

  function toggleProduct(productId: number) {
    setSelectedIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function toggleAllShowing() {
    setSelectedIds(allShowingSelected ? [] : allShowingIds);
  }

  return (
    <section className="mb-8 rounded border bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Bulk Description Editor</h2>
          <p className="mt-1 text-sm text-gray-600">
            Paste one description/code block, select cards, then replace, prepend,
            or append it across every selected listing.
          </p>
        </div>

        <button
          type="button"
          onClick={toggleAllShowing}
          className="rounded border px-4 py-2 font-bold"
        >
          {allShowingSelected ? "Clear Showing" : "Select All Showing"}
        </button>
      </div>

      <form action={action} className="mt-4 space-y-4">
        {selectedIds.map((id) => (
          <input key={id} type="hidden" name="product_ids" value={id} />
        ))}

        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
          <label className="block">
            <span className="font-bold">Mode</span>
            <select name="mode" className="mt-1 w-full border p-2" defaultValue="append">
              <option value="append">Append after current description</option>
              <option value="prepend">Prepend before current description</option>
              <option value="replace">Replace whole description</option>
            </select>
          </label>

          <label className="block">
            <span className="font-bold">Description / code to apply</span>
            <textarea
              name="description"
              rows={5}
              required
              className="mt-1 w-full border p-2 font-mono text-sm"
              placeholder="Paste your reusable shipping, offer, show special, HTML/code block, or policy text here..."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton />
          <span className="text-sm font-bold text-gray-700">
            {selectedIds.length} selected
          </span>
        </div>

        <div className="max-h-96 overflow-auto rounded border">
          {products.length === 0 ? (
            <p className="p-4 text-sm text-gray-600">No products loaded.</p>
          ) : (
            products.map((product) => (
              <label
                key={product.legacyProductId}
                className="grid cursor-pointer grid-cols-[32px_1fr_auto] items-center gap-3 border-b p-3 last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(product.legacyProductId)}
                  onChange={() => toggleProduct(product.legacyProductId)}
                  className="h-5 w-5"
                />
                <span>
                  <span className="block font-bold">{product.title}</span>
                  <span className="text-sm text-gray-600">
                    #{product.legacyProductId} · {product.status}
                  </span>
                </span>
                <span className="font-bold">${product.price.toFixed(2)}</span>
              </label>
            ))
          )}
        </div>
      </form>
    </section>
  );
}
