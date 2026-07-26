"use client";

import { useEffect } from "react";
import { CHECKOUT_ATTEMPT_STORAGE_KEY } from "../app/components/CheckoutButton";

export default function ClearCartOnSuccess({
  clearOnLoad = false,
}: {
  clearOnLoad?: boolean;
}) {
  useEffect(() => {
    if (!clearOnLoad) return;

    localStorage.removeItem("cart");
    sessionStorage.removeItem("cart");
    sessionStorage.removeItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
    localStorage.setItem("checkoutSuccess", "true");
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("cartUpdated"));
  }, [clearOnLoad]);

  return null;
}
