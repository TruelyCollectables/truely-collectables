"use client";

import Link from "next/link";
import { useState } from "react";
import { addToCart } from "../../../lib/cart";

type Product = {
  id: number;
  title: string;
  price: number;
  image_url?: string;
};

export default function ProductActions({ product }: { product: Product }) {
  const [cartMessage, setCartMessage] = useState("");

  function addProductToCart() {
    addToCart({
      id: product.id,
      title: product.title,
      price: Number(product.price),
      quantity: 1,
      image_url: product.image_url,
    });
  }

  function handleAddToCart() {
    addProductToCart();
    setCartMessage("Added to cart.");
  }

  function handleBuyNow() {
    addProductToCart();
    window.location.href = "/cart";
  }

  return (
    <div id="purchase" className="scroll-mt-40 space-y-3">
      <button
        type="button"
        onClick={handleBuyNow}
        aria-label="Make It Mine"
        className="flex min-h-12 w-full items-center justify-center rounded bg-black px-4 py-3 text-base font-bold text-white"
      >
        <span>Make It Mine</span>
        <sup aria-hidden="true" className="ml-0.5 text-[0.55em] leading-none">
          ™
        </sup>
      </button>

      <button
        type="button"
        onClick={handleAddToCart}
        className="min-h-12 w-full rounded border px-4 py-3 text-base font-bold"
      >
        Add To Cart
      </button>

      <div aria-live="polite" className="min-h-6 text-sm font-bold text-emerald-700">
        {cartMessage ? (
          <>
            {cartMessage}{" "}
            <Link href="/cart" className="underline underline-offset-4">
              View cart
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
