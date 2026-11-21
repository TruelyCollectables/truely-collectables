"use client";

import { useState } from "react";
import { addToCart } from "../../lib/cart";

export default function QuickAddButton({
  product,
}: {
  product: {
    id: number;
    title: string;
    price: number;
    image_url?: string;
    original_price?: number;
    discount_percent?: number;
  };
}) {
  const [added, setAdded] = useState(false);

  function handleQuickAdd() {
    addToCart({
      id: product.id,
      title: product.title,
      price: Number(product.price),
      quantity: 1,
      image_url: product.image_url,
      original_price: product.original_price,
      discount_percent: product.discount_percent,
    });
    setAdded(true);
    window.setTimeout(() => setAdded(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleQuickAdd}
      className={`flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-xs font-extrabold uppercase tracking-wider transition ${
        added
          ? "bg-[#22c55e] text-[#0f172a]"
          : "bg-[#facc15] text-[#0f172a] hover:bg-[#eab308]"
      }`}
    >
      {added ? "Added ✓" : "+ Cart"}
    </button>
  );
}
