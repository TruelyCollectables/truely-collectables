"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { addToCart } from "../../../lib/cart";

export type StorefrontProductActionItem = {
  id: number;
  title: string;
  price: number;
  image_url?: string;
  shipping_profile?: "card_letter_eligible" | "parcel_only";
};

type ProductImageResponse = { images?: unknown };

export default function ProductActions({
  product,
}: {
  product: StorefrontProductActionItem;
}) {
  const [images, setImages] = useState<string[]>(
    product.image_url ? [product.image_url] : [],
  );
  const [selectedImage, setSelectedImage] = useState(0);
  const [cartMessage, setCartMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/storefront/product-images/${product.id}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) =>
        response.ok ? ((await response.json()) as ProductImageResponse) : null,
      )
      .then((payload) => {
        if (!payload || !Array.isArray(payload.images)) return;
        const nextImages = payload.images
          .map((image) => String(image || "").trim())
          .filter(Boolean)
          .slice(0, 20);
        if (nextImages.length) {
          setImages(nextImages);
          setSelectedImage(0);
        }
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
      shipping_profile: product.shipping_profile,
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
    <div id="purchase" className="scroll-mt-40 space-y-4">
      {images.length ? (
        <section className="rounded border bg-neutral-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black uppercase tracking-wide text-neutral-700">
              Product Photos
            </h3>
            <span className="text-xs font-bold text-neutral-500">
              {images.length} photo{images.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="relative mt-3 aspect-[4/5] overflow-hidden rounded border bg-white">
            <Image
              src={images[selectedImage] || images[0]}
              alt={`${product.title} photo ${selectedImage + 1}`}
              fill
              sizes="(max-width: 1023px) 100vw, 430px"
              quality={90}
              className="object-contain p-2"
            />
          </div>

          {images.length > 1 ? (
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-5">
              {images.map((image, index) => (
                <button
                  key={`${image}-${index}`}
                  type="button"
                  onClick={() => setSelectedImage(index)}
                  aria-label={`View photo ${index + 1}`}
                  className={`relative aspect-square overflow-hidden rounded border bg-white ${
                    selectedImage === index
                      ? "border-neutral-950 ring-2 ring-neutral-950"
                      : "border-neutral-200"
                  }`}
                >
                  <Image
                    src={image}
                    alt=""
                    fill
                    sizes="96px"
                    quality={85}
                    className="object-contain p-1"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {product.shipping_profile === "parcel_only" ? (
        <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-950">
          This item requires USPS Ground Advantage or Priority Mail. Tracked Card
          Letter is not available.
        </p>
      ) : null}

      <button
        type="button"
        onClick={handleBuyNow}
        className="min-h-12 w-full rounded bg-black px-4 py-3 text-base font-bold text-white"
      >
        Make It Mine
      </button>
      <button
        type="button"
        onClick={handleAddToCart}
        className="min-h-12 w-full rounded border px-4 py-3 text-base font-bold"
      >
        Add To Cart
      </button>
      <div
        aria-live="polite"
        className="min-h-6 text-sm font-bold text-emerald-700"
      >
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
