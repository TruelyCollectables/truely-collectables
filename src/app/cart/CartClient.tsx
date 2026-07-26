"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import CheckoutButton from "../components/CheckoutButton";
import {
  calculateShipping,
  getAvailableShippingMethods,
  getFreeShippingMessage,
  getShippingCoverage,
  getStandardEnvelopeEligibility,
  resolveShippingMethod,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../lib/shipping";
import {
  TERMS_OF_SERVICE_PATH,
  TERMS_OF_SERVICE_VERSION,
} from "../../lib/legal";

type CartItem = {
  id: number;
  title: string;
  price: number;
  quantity: number;
  image_url?: string;
};

export default function CartClient(props: { storeDisplayName: string }) {
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];

    if (localStorage.getItem("checkoutSuccess") === "true") {
      localStorage.removeItem("checkoutSuccess");
      localStorage.removeItem("cart");
      sessionStorage.removeItem("cart");
      return [];
    }

    const storedCart = localStorage.getItem("cart");
    if (!storedCart) return [];

    try {
      return JSON.parse(storedCart) as CartItem[];
    } catch {
      return [];
    }
  });
  const [shippingMethod, setShippingMethod] =
    useState<ShippingMethod>("STANDARD_ENVELOPE");
  const [termsAccepted, setTermsAccepted] = useState(false);

  function saveCart(updatedCart: CartItem[]) {
    setCart(updatedCart);
    localStorage.setItem("cart", JSON.stringify(updatedCart));
  }

  function increaseQuantity(id: number) {
    saveCart(
      cart.map((item) =>
        item.id === id ? { ...item, quantity: item.quantity + 1 } : item,
      ),
    );
  }

  function decreaseQuantity(id: number) {
    saveCart(
      cart
        .map((item) =>
          item.id === id ? { ...item, quantity: item.quantity - 1 } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  }

  function removeItem(id: number) {
    saveCart(cart.filter((item) => item.id !== id));
  }

  function clearCart() {
    saveCart([]);
    localStorage.removeItem("cart");
  }

  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price) * item.quantity,
    0,
  );
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const listingPriceBasis = subtotal;
  const standardEnvelopeEligibility = getStandardEnvelopeEligibility({
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const availableShippingMethods = getAvailableShippingMethods({
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const resolvedShipping = resolveShippingMethod({
    requestedMethod: shippingMethod,
    itemCount,
    subtotal,
    listingPriceBasis,
  });
  const selectedShippingMethod = resolvedShipping.method;
  const shippingCoverage = getShippingCoverage({
    method: selectedShippingMethod,
    subtotal,
  });
  const selectedShipping = calculateShipping({
    itemCount,
    subtotal,
    listingPriceBasis,
    method: selectedShippingMethod,
  });
  const total = subtotal + selectedShipping;

  function shippingPrice(method: ShippingMethod) {
    return calculateShipping({
      itemCount,
      subtotal,
      listingPriceBasis,
      method,
    });
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8 border-b border-neutral-200 pb-6">
        <p className="text-sm font-bold uppercase text-neutral-500">
          Secure Checkout
        </p>
        <h1 className="mt-2 text-3xl font-black sm:text-4xl md:text-5xl">
          Shopping Cart
        </h1>
      </div>

      {cart.length === 0 ? (
        <section className="rounded border bg-white p-6 sm:p-8">
          <p className="text-lg font-bold">Your cart is empty.</p>
          <Link
            href="/shop"
            className="mt-5 inline-flex min-h-12 items-center justify-center rounded bg-neutral-950 px-5 py-3 font-bold text-white"
          >
            Shop Inventory
          </Link>
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <section className="space-y-4">
            {cart.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-4 rounded border bg-white p-4 sm:flex-row sm:items-center"
              >
                {item.image_url ? (
                  <Image
                    src={item.image_url}
                    alt={item.title}
                    width={240}
                    height={240}
                    unoptimized
                    className="h-44 w-full rounded bg-neutral-50 object-contain p-2 sm:h-28 sm:w-28 sm:shrink-0"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/product/${item.id}`}
                    className="block break-words font-black underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="mt-1 text-neutral-600">
                    ${Number(item.price).toFixed(2)} each
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => decreaseQuantity(item.id)}
                      aria-label={`Decrease quantity for ${item.title}`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-3 font-bold"
                    >
                      −
                    </button>
                    <span className="min-w-16 text-center text-sm font-bold">
                      Qty: {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => increaseQuantity(item.id)}
                      aria-label={`Increase quantity for ${item.title}`}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border px-3 font-bold"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      className="inline-flex min-h-11 items-center justify-center rounded border border-red-200 px-3 text-sm font-bold text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="self-end text-xl font-black sm:self-auto">
                  ${(Number(item.price) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </section>

          <section className="h-fit rounded border bg-white p-4 sm:p-5">
            <h2 className="text-2xl font-black">Order Summary</h2>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Items</span>
                <strong>{itemCount}</strong>
              </div>
              <div className="flex justify-between">
                <span>Subtotal</span>
                <strong>${subtotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="mt-6">
              <label
                htmlFor="shipping-method"
                className="block text-lg font-black"
              >
                Choose Shipping
              </label>
              <p className="mt-1 text-sm font-semibold text-neutral-600">
                The lowest eligible method is selected automatically. You may
                upgrade to a premium method whenever it is available.
              </p>
              <select
                id="shipping-method"
                value={selectedShippingMethod}
                onChange={(event) =>
                  setShippingMethod(event.target.value as ShippingMethod)
                }
                className="mt-3 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-base font-bold"
              >
                {availableShippingMethods.map((method) => {
                  const price = shippingPrice(method);
                  return (
                    <option key={method} value={method}>
                      {SHIPPING_RULES[method].name} — {price === 0 ? "FREE" : `$${price.toFixed(2)}`}
                    </option>
                  );
                })}
              </select>

              <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                <p className="font-black">
                  {SHIPPING_RULES[selectedShippingMethod].name}
                </p>
                <p className="mt-1 font-semibold">
                  {selectedShippingMethod === "STANDARD_ENVELOPE"
                    ? `Up to 4 qualifying raw cards, original listing-price total $20.00 or less, maximum estimated weight 3 oz. USPS IMb scan visibility is limited and not guaranteed package tracking.`
                    : SHIPPING_RULES[selectedShippingMethod].deliveryEstimate}
                </p>
                {!standardEnvelopeEligibility.eligible &&
                selectedShippingMethod !== "STANDARD_ENVELOPE" ? (
                  <p className="mt-2 text-xs font-bold text-amber-800">
                    Tracked Card Letter is unavailable: {standardEnvelopeEligibility.reason}
                  </p>
                ) : null}
              </div>

              <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-4 text-sm">
                <p>
                  {getFreeShippingMessage({
                    subtotal,
                    method: selectedShippingMethod,
                  })}
                </p>
              </div>

              <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-4 text-sm">
                {selectedShippingMethod === "STANDARD_ENVELOPE" ? (
                  <>
                    <p className="font-black text-emerald-950">
                      Limited letter tracking included
                    </p>
                    <p className="mt-1 font-semibold text-emerald-900">
                      {shippingCoverage.provider} may show USPS processing and
                      delivery-related scans when data is available. It is not
                      guaranteed package tracking, insurance, or proof of delivery.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-black text-emerald-950">
                      Full parcel tracking
                    </p>
                    <p className="mt-1 font-semibold text-emerald-900">
                      Ground Advantage and Priority Mail use carrier parcel tracking.
                    </p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-6 space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <span>Shipping</span>
                <strong>
                  {selectedShipping === 0
                    ? "FREE"
                    : `$${selectedShipping.toFixed(2)}`}
                </strong>
              </div>
              <div className="flex justify-between text-xl">
                <span className="font-black">Total</span>
                <strong>${total.toFixed(2)}</strong>
              </div>
            </div>

            <label className="mt-6 flex min-h-12 items-start gap-3 rounded border p-4 text-sm leading-6">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                I agree to the{" "}
                <a
                  href={TERMS_OF_SERVICE_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline"
                >
                  {props.storeDisplayName} Terms of Service
                </a>{" "}
                version {TERMS_OF_SERVICE_VERSION}.
                <span className="mt-1 block text-neutral-600">
                  I understand {props.storeDisplayName} currently ships only to
                  United States addresses.
                </span>
              </span>
            </label>

            <div className="mt-6 flex flex-col gap-3">
              <CheckoutButton
                shippingMethod={selectedShippingMethod}
                termsAccepted={termsAccepted}
              />

              <button
                type="button"
                onClick={clearCart}
                className="min-h-12 rounded border px-4 py-3 font-bold"
              >
                Clear Cart
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
