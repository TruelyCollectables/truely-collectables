"use client";

import { useState } from "react";
import type { ShippingMethod } from "../../lib/shipping";
import { TERMS_OF_SERVICE_VERSION } from "../../lib/legal";
import { getAccountSession } from "../account/account-session";

export default function CheckoutButton({
  shippingMethod = "GROUND_ADVANTAGE",
  termsAccepted,
}: {
  shippingMethod?: ShippingMethod;
  termsAccepted: boolean;
}) {
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    try {
      if (!termsAccepted) {
        alert("Please accept the Terms of Service before checkout.");
        return;
      }

      setLoading(true);

      const cart = JSON.parse(localStorage.getItem("cart") || "[]");
      const accountSession = getAccountSession();

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accountSession?.access_token
            ? { Authorization: `Bearer ${accountSession.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          cart,
          shippingMethod,
          tosAccepted: termsAccepted,
          tosVersion: TERMS_OF_SERVICE_VERSION,
        }),
      });

      const data = await response.json();

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
      className="rounded bg-neutral-950 px-6 py-3 font-black text-white disabled:opacity-50"
    >
      {loading ? "Loading..." : "Proceed to Secure Checkout"}
    </button>
  );
}
