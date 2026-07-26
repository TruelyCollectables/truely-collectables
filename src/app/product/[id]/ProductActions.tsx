"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { addToCart } from "../../../lib/cart";

type Product = {
  id: number;
  title: string;
  price: number;
  image_url?: string;
};

type ProductImageResponse = {
  images?: unknown;
};

export default function ProductActions({ product }: { product: Product }) {
  const [images, setImages] = useState<string[]>(
    product.image_url ? [product.image_url] : [],
  );

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/storefront/product-images/${product.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ProductImageResponse;
      })
      .then((payload) => {
        if (!payload || !Array.isArray(payload.images)) return;

        const nextImages = payload.images
          .map((image) => String(image || "").trim())
          .filter(Boolean)
          .slice(0, 2);

        if (nextImages.length) setImages(nextImages);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        console.error("Product images could not be loaded", error);
      });

    return () => controller.abort();
  }, [product.id]);

  function addProductToCart() {
    addToCart({
      id: product.id,
      title: product.title,
      price: Number(product.price),
      quantity: 1,
      image_url: images[0] || product.image_url,
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
    <div className="space-y-4">
      {images.length ? (
        <section className="rounded border bg-neutral-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-wide text-neutral-700">
              Card Photos
            </h3>
            <span className="text-xs font-bold text-neutral-500">
              {images.length >= 2 ? "Front + Back" : "Front only"}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            {images.slice(0, 2).map((image, index) => (
              <figure key={`${image}-${index}`}>
                <div className="relative aspect-[3/4] overflow-hidden rounded border bg-white">
                  <Image
                    src={image}
                    alt={`${product.title} ${index === 0 ? "front" : "back"}`}
                    fill
                    sizes="200px"
                    unoptimized
                    className="object-contain p-1"
                  />
                </div>
                <figcaption className="mt-1 text-center text-xs font-bold uppercase text-neutral-500">
                  {index === 0 ? "Front" : "Back"}
                </figcaption>
              </figure>
            ))}

            {images.length < 2 ? (
              <div className="flex aspect-[3/4] items-center justify-center rounded border border-dashed bg-white p-3 text-center text-xs font-bold text-neutral-500">
                Back photo is being synchronized from the source listing.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <button
        onClick={handleBuyNow}
        className="w-full rounded bg-black py-3 font-bold text-white"
      >
        Make It Mine
      </button>

      <button
        onClick={handleAddToCart}
        className="w-full rounded border py-3 font-bold"
      >
        Add To Cart
      </button>
    </div>
  );
}
