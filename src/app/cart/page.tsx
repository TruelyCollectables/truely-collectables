"use client";

import Link from "next/link";
import { useState } from "react";
import CheckoutButton from "../components/CheckoutButton";
import {
  calculateShipping,
  getFreeShippingMessage,
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

export default function CartPage() {
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
    useState<ShippingMethod>("GROUND_ADVANTAGE");
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
  const groundShipping = calculateShipping({
    itemCount,
    subtotal,
    method: "GROUND_ADVANTAGE",
  });
  const priorityShipping = calculateShipping({
    itemCount,
    subtotal,
    method: "PRIORITY_MAIL",
  });
  const selectedShipping = calculateShipping({
    itemCount,
    subtotal,
    method: shippingMethod,
  });
  const total = subtotal + selectedShipping;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 border-b border-neutral-200 pb-6">
        <p className="text-sm font-bold uppercase text-neutral-500">
          Secure Checkout
        </p>
        <h1 className="mt-2 text-4xl font-black md:text-5xl">Shopping Cart</h1>
      </div>

      {cart.length === 0 ? (
        <section className="rounded border bg-white p-8">
          <p className="text-lg font-bold">Your cart is empty.</p>
          <Link
            href="/shop"
            className="mt-5 inline-block rounded bg-neutral-950 px-5 py-3 font-bold text-white"
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
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="h-28 w-28 rounded object-cover"
                  />
                ) : null}

                <div className="flex-1">
                  <h2 className="font-black">{item.title}</h2>
                  <p className="mt-1 text-neutral-600">
                    ${Number(item.price).toFixed(2)} each
                  </p>

                  <div className="mt-3 flex items-center gap-3">
                    <button
                      onClick={() => decreaseQuantity(item.id)}
                      className="rounded border px-3 py-1 font-bold"
                    >
                      -
                    </button>
                    <span className="text-sm font-bold">Qty: {item.quantity}</span>
                    <button
                      onClick={() => increaseQuantity(item.id)}
                      className="rounded border px-3 py-1 font-bold"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="ml-2 text-sm font-bold text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="text-xl font-black">
                  ${(Number(item.price) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </section>

          <section className="h-fit rounded border bg-white p-5">
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
              <h3 className="text-lg font-black">Choose Shipping</h3>

              <label className="mt-3 block cursor-pointer rounded border p-4">
                <input
                  type="radio"
                  checked={shippingMethod === "GROUND_ADVANTAGE"}
                  onChange={() => setShippingMethod("GROUND_ADVANTAGE")}
                  className="mr-2"
                />
                {SHIPPING_RULES.GROUND_ADVANTAGE.name} -{" "}
                <strong>
                  {groundShipping === 0
                    ? "FREE"
                    : `$${groundShipping.toFixed(2)}`}
                </strong>
              </label>

              <label className="mt-3 block cursor-pointer rounded border p-4">
                <input
                  type="radio"
                  checked={shippingMethod === "PRIORITY_MAIL"}
                  onChange={() => setShippingMethod("PRIORITY_MAIL")}
                  className="mr-2"
                />
                {SHIPPING_RULES.PRIORITY_MAIL.name} -{" "}
                <strong>
                  {priorityShipping === 0
                    ? "FREE"
                    : `$${priorityShipping.toFixed(2)}`}
                </strong>
              </label>

              <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4 text-sm">
                <p>{getFreeShippingMessage({ subtotal, method: shippingMethod })}</p>
              </div>
            </div>

            <div className="mt-6 space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <span>Shipping</span>
                <strong>${selectedShipping.toFixed(2)}</strong>
              </div>
              <div className="flex justify-between text-xl">
                <span className="font-black">Total</span>
                <strong>${total.toFixed(2)}</strong>
              </div>
            </div>

            <label className="mt-6 flex items-start gap-3 rounded border p-4 text-sm leading-6">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(event) => setTermsAccepted(event.target.checked)}
                className="mt-1"
              />
              <span>
                I agree to the{" "}
                <a
                  href={TERMS_OF_SERVICE_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline"
                >
                  Truely Collectables Terms of Service
                </a>{" "}
                version {TERMS_OF_SERVICE_VERSION}.
              </span>
            </label>

            <div className="mt-6 flex flex-col gap-3">
              <CheckoutButton
                shippingMethod={shippingMethod}
                termsAccepted={termsAccepted}
              />

              <button
                onClick={clearCart}
                className="rounded border px-4 py-3 font-bold"
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
