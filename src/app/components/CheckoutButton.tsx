"use client";

import { useState } from "react";
import type { ShippingMethod } from "../../lib/shipping";

export default function CheckoutButton({
  shippingMethod = "GROUND_ADVANTAGE",
}: {
  shippingMethod?: ShippingMethod;
}) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      setLoading(true);

      const cart = JSON.parse(localStorage.getItem("cart") || "[]");

      console.log("CHECKOUT SHIPPING METHOD:", shippingMethod);

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cart,
          shippingMethod,
        }),
      });

      const data = await response.json();

      console.log("CHECKOUT RESPONSE:", data);

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      alert(data.error || "Checkout failed");
    } catch (error) {
      console.error(error);
      alert("Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className="mt-4 border rounded px-6 py-3 disabled:opacity-50"
    >
      {loading ? "Loading..." : "🔒 Proceed to Secure Checkout"}
    </button>
  );
}