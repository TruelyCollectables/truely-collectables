"use client";

import { addToCart } from "../lib/cart";

export default function AddToCartButton({ product }: { product: any }) {
  return (
    <button
      onClick={() => {
        addToCart({
          id: product.id,
          title: product.title,
          price: Number(product.price),
          quantity: 1,
          image_url: product.image_url,
        });

        alert("Added to cart!");
      }}
      className="mt-8 w-full border rounded py-3 text-lg"
    >
      Add To Cart
    </button>
  );
}