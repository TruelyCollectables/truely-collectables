"use client";

import CheckoutButton from "../components/CheckoutButton";
import { useEffect, useState } from "react";
import {
  calculateShipping,
  SHIPPING_RULES,
  type ShippingMethod,
  getFreeShippingMessage,
} from "../../lib/shipping";

type CartItem = {
  id: number;
  title: string;
  price: number;
  quantity: number;
  image_url?: string;
};

export default function CartPage() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shippingMethod, setShippingMethod] =
    useState<ShippingMethod>("GROUND_ADVANTAGE");

  useEffect(() => {
    const storedCart = localStorage.getItem("cart");

    if (storedCart) {
      setCart(JSON.parse(storedCart));
    }
  }, []);

  function saveCart(updatedCart: CartItem[]) {
    setCart(updatedCart);
    localStorage.setItem("cart", JSON.stringify(updatedCart));
  }

  function increaseQuantity(id: number) {
    saveCart(
      cart.map((item) =>
        item.id === id ? { ...item, quantity: item.quantity + 1 } : item
      )
    );
  }

  function decreaseQuantity(id: number) {
    saveCart(
      cart
        .map((item) =>
          item.id === id ? { ...item, quantity: item.quantity - 1 } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function removeItem(id: number) {
    saveCart(cart.filter((item) => item.id !== id));
  }

  function clearCart() {
    saveCart([]);
  }

  const subtotal = cart.reduce(
    (sum, item) => sum + Number(item.price) * item.quantity,
    0
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
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">Shopping Cart</h1>

      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <div className="space-y-4">
            {cart.map((item) => (
              <div
                key={item.id}
                className="border rounded p-4 flex gap-4 items-center"
              >
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt={item.title}
                    className="w-24 h-24 object-cover rounded"
                  />
                )}

                <div className="flex-1">
                  <h2 className="font-bold">{item.title}</h2>
                  <p>${Number(item.price).toFixed(2)}</p>

                  <div className="flex items-center gap-3 mt-3">
                    <button
                      onClick={() => decreaseQuantity(item.id)}
                      className="border px-3 py-1 rounded"
                    >
                      -
                    </button>

                    <span>Qty: {item.quantity}</span>

                    <button
                      onClick={() => increaseQuantity(item.id)}
                      className="border px-3 py-1 rounded"
                    >
                      +
                    </button>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="text-red-600 ml-4"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="font-bold">
                  ${(Number(item.price) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 border-t pt-6">
            <p className="text-lg">Cards: {itemCount}</p>

            <h2 className="text-2xl font-bold mt-2">
              Subtotal: ${subtotal.toFixed(2)}
            </h2>

            <div className="mt-6 border rounded p-4">
              <h3 className="text-xl font-bold mb-4">Choose Shipping</h3>

              <label className="block border rounded p-4 mb-3 cursor-pointer">
                <input
                  type="radio"
                  name="shipping"
                  value="GROUND_ADVANTAGE"
                  checked={shippingMethod === "GROUND_ADVANTAGE"}
                  onChange={() => setShippingMethod("GROUND_ADVANTAGE")}
                  className="mr-2"
                />

                {SHIPPING_RULES.GROUND_ADVANTAGE.name} —{" "}
                <strong>
                  {groundShipping === 0
                    ? "FREE"
                    : `$${groundShipping.toFixed(2)}`}
                </strong>

                <p className="text-sm mt-1">
                  ${SHIPPING_RULES.GROUND_ADVANTAGE.basePrice.toFixed(2)} for
                  the first {SHIPPING_RULES.GROUND_ADVANTAGE.cardsIncluded}{" "}
                  cards, +$
                  {SHIPPING_RULES.GROUND_ADVANTAGE.additionalCardPrice.toFixed(
                    2
                  )}{" "}
                  per additional card, FREE over $
                  {SHIPPING_RULES.GROUND_ADVANTAGE.freeShippingThreshold}.
                </p>
              </label>

              <label className="block border rounded p-4 cursor-pointer">
                <input
                  type="radio"
                  name="shipping"
                  value="PRIORITY_MAIL"
                  checked={shippingMethod === "PRIORITY_MAIL"}
                  onChange={() => setShippingMethod("PRIORITY_MAIL")}
                  className="mr-2"
                />

                {SHIPPING_RULES.PRIORITY_MAIL.name} —{" "}
                <strong>
                  {priorityShipping === 0
                    ? "FREE"
                    : `$${priorityShipping.toFixed(2)}`}
                </strong>

                <p className="text-sm mt-1">
                  ${SHIPPING_RULES.PRIORITY_MAIL.basePrice.toFixed(2)} for the
                  first {SHIPPING_RULES.PRIORITY_MAIL.cardsIncluded} cards, +$
                  {SHIPPING_RULES.PRIORITY_MAIL.additionalCardPrice.toFixed(2)}{" "}
                  per additional card, FREE over $
                  {SHIPPING_RULES.PRIORITY_MAIL.freeShippingThreshold}.
                </p>
              </label>

              <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
                <p className="font-medium">
                  {getFreeShippingMessage({
                    subtotal,
                    method: shippingMethod,
                  })}
                </p>
              </div>
            </div>

            <div className="mt-6 text-xl">
              <p>Shipping: ${selectedShipping.toFixed(2)}</p>
              <p className="font-bold mt-2">Total: ${total.toFixed(2)}</p>
            </div>

            <div className="mt-6 flex gap-4">
              <CheckoutButton shippingMethod={shippingMethod} />

              <button onClick={clearCart} className="border px-4 py-2 rounded">
                Clear Cart
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}