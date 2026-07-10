"use client";

import { useRef, useState } from "react";
import type { ShippingMethod } from "../../lib/shipping";
import { TERMS_OF_SERVICE_VERSION } from "../../lib/legal";
import { getAccountSession } from "../account/account-session";

const CHECKOUT_ATTEMPT_STORAGE_KEY = "tcos_checkout_attempt_v1";
const CHECKOUT_ATTEMPT_MAX_AGE_MS = 23 * 60 * 60 * 1000;

type StoredCheckoutAttempt = {
  id: string;
  signature: string;
  createdAt: string;
};

function checkoutAttemptFor(cart: unknown, shippingMethod: ShippingMethod) {
  const signature = JSON.stringify({
    cart,
    shippingMethod,
    tosVersion: TERMS_OF_SERVICE_VERSION,
  });

  try {
    const existing = JSON.parse(
      sessionStorage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY) || "null",
    ) as StoredCheckoutAttempt | null;
    const age = existing
      ? Date.now() - new Date(existing.createdAt).getTime()
      : Number.POSITIVE_INFINITY;

    if (
      existing?.id &&
      existing.signature === signature &&
      Number.isFinite(age) &&
      age >= 0 &&
      age < CHECKOUT_ATTEMPT_MAX_AGE_MS
    ) {
      return existing;
    }
  } catch {
    // Replace malformed or unavailable session state with a new attempt.
  }

  const attempt: StoredCheckoutAttempt = {
    id: crypto.randomUUID(),
    signature,
    createdAt: new Date().toISOString(),
  };
  sessionStorage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  return attempt;
}

function clearCheckoutAttempt() {
  sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
}

export default function CheckoutButton({
  shippingMethod = "GROUND_ADVANTAGE",
  termsAccepted,
}: {
  shippingMethod?: ShippingMethod;
  termsAccepted: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const handleCheckout = async () => {
    if (inFlightRef.current) return;

    try {
      if (!termsAccepted) {
        alert("Please accept the Terms of Service before checkout.");
        return;
      }

      inFlightRef.current = true;
      setLoading(true);

      const cart = JSON.parse(localStorage.getItem("cart") || "[]");
      const accountSession = getAccountSession();
      const checkoutAttempt = checkoutAttemptFor(cart, shippingMethod);

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
          checkoutAttemptId: checkoutAttempt.id,
        }),
      });

      const data = await response.json();

      if (data.url) {
        clearCheckoutAttempt();
        window.location.href = data.url;
        return;
      }

      if (data.retryable !== true) {
        clearCheckoutAttempt();
      }

      alert(data.error || "Checkout failed");
    } catch (error) {
      console.error(error);
      alert("Checkout failed");
    } finally {
      inFlightRef.current = false;
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
