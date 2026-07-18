"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  adminBulkDescriptionBlockedReason,
  adminBulkDescriptionSelectionSummary,
  adminBulkDescriptionSubmitLabel,
} from "../../../lib/admin-product-bulk";

type BulkDescriptionProduct = {
  legacyProductId: number;
  title: string;
  price: number;
  status: string;
};

function SubmitButton({
  blockedReason,
  selectedCount,
}: {
  blockedReason: string | null;
  selectedCount: number;
}) {
  const { pending } = useFormStatus();
  const disabled = pending || Boolean(blockedReason);
  const label = adminBulkDescriptionSubmitLabel({ pending, selectedCount });

  return (
    <button
      type="submit"
      aria-busy={pending}
      disabled={disabled}
      title={blockedReason || `Apply this description to ${selectedCount} selected product${selectedCount === 1 ? "" : "s"}.`}
      className="rounded bg-black px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
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
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectionMessage, setSelectionMessage] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) return products;

    return products.filter((product) =>
      [
        product.title,
        product.status,
        String(product.legacyProductId),
        product.price.toFixed(2),
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [products, search]);
  const allShowingIds = useMemo(
    () => filteredProducts.map((product) => product.legacyProductId),
    [filteredProducts],
  );
  const allShowingSelected =
    allShowingIds.length > 0 &&
    allShowingIds.every((id) => selectedSet.has(id));
  const blockedReason = adminBulkDescriptionBlockedReason({
    description,
    productCount: products.length,
    selectedCount: selectedIds.length,
  });
  const selectionSummary = adminBulkDescriptionSelectionSummary({
    filteredCount: filteredProducts.length,
    productCount: products.length,
    selectedCount: selectedIds.length,
  });

  function toggleProduct(productId: number) {
    setSelectionMessage("");
    setSelectedIds((current) =>
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId],
    );
  }

  function toggleAllShowing() {
    if (filteredProducts.length === 0) {
      setSelectionMessage("No visible products match the current bulk editor search.");
      return;
    }

    setSelectedIds((current) => {
      if (allShowingSelected) {
        setSelectionMessage("Cleared the products currently visible in this bulk editor list.");
        return current.filter((id) => !allShowingIds.includes(id));
      }

      setSelectionMessage("Selected every product currently visible in this bulk editor list.");
      return Array.from(new Set([...current, ...allShowingIds]));
    });
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
          aria-disabled={filteredProducts.length === 0}
          title={
            filteredProducts.length === 0
              ? "No products match the current bulk editor search."
              : allShowingSelected
                ? "Clear the products currently visible in this bulk editor list."
                : "Select every product currently visible in this bulk editor list."
          }
          className="rounded border px-4 py-2 font-bold aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {allShowingSelected ? "Clear Showing" : "Select All Showing"}
        </button>
      </div>

      {selectionMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-950"
        >
          {selectionMessage}
        </p>
      ) : null}

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
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full border p-2 font-mono text-sm"
              placeholder="Paste your reusable shipping, offer, show special, HTML/code block, or policy text here..."
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            blockedReason={blockedReason}
            selectedCount={selectedIds.length}
          />
          <span role="status" aria-live="polite" className="text-sm font-bold text-gray-700">
            {selectionSummary}
          </span>
        </div>

        {blockedReason ? (
          <p
            role="status"
            aria-live="polite"
            className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950"
          >
            Bulk update blocked: {blockedReason}
          </p>
        ) : (
          <p
            role="status"
            aria-live="polite"
            className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-950"
          >
            Ready to update {selectedIds.length} selected product
            {selectedIds.length === 1 ? "" : "s"}.
          </p>
        )}

        <label className="block">
          <span className="font-bold">Search products to select</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm font-semibold"
            placeholder="Search title, status, ID, or price..."
          />
        </label>

        <div className="max-h-96 overflow-auto rounded border">
          {products.length === 0 ? (
            <p className="p-4 text-sm text-gray-600">No products loaded.</p>
          ) : filteredProducts.length === 0 ? (
            <p className="p-4 text-sm font-semibold text-gray-600">
              No products match “{search}”. Clear the search to show all products.
            </p>
          ) : (
            filteredProducts.map((product) => (
              <label
                key={product.legacyProductId}
                className="grid cursor-pointer grid-cols-[32px_1fr_auto] items-center gap-3 border-b p-3 last:border-b-0"
              >
                <input
                  type="checkbox"
                  aria-label={`Select ${product.title} for bulk description update`}
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
