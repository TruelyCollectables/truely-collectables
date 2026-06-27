"use client";

import { addToCart } from "../../../lib/cart";

type Product = {
  id: number;
  title: string;
  price: number;
  image_url?: string;
};

export default function ProductActions({ product }: { product: Product }) {
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
    alert("Added to cart!");
  }

  function handleBuyNow() {
    addProductToCart();
    window.location.href = "/cart";
  }

  return (
    <div className="space-y-3">
      <button
        onClick={handleBuyNow}
        className="w-full bg-black text-white rounded py-3 font-bold"
      >
        Buy Now
      </button>

      <button
        onClick={handleAddToCart}
        className="w-full border rounded py-3 font-bold"
      >
        Add To Cart
      </button>
    </div>
  );
}