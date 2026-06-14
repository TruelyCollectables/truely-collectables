"use client";

import CheckoutButton from "../components/CheckoutButton";
import { useEffect, useState } from "react";

export default function CartPage() {
  const [cart, setCart] = useState<any[]>([]);

  useEffect(() => {
    const storedCart = localStorage.getItem("cart");

    if (storedCart) {
      setCart(JSON.parse(storedCart));
    }
  }, []);

  const total = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-8">
        Shopping Cart
      </h1>

      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          {cart.map((item) => (
            <div
              key={item.id}
              className="border rounded p-4 mb-4"
            >
              <h2 className="font-bold">
                {item.title}
              </h2>

              <p>${item.price}</p>

              <p>Qty: {item.quantity}</p>
            </div>
          ))}

          <div className="mt-8">
            <h2 className="text-2xl font-bold">
              Total: ${total}
            </h2>

          <CheckoutButton />
          </div>
        </>
      )}
    </main>
  );
}