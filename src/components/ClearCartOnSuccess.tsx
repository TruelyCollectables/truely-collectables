"use client";

import { useEffect } from "react";

export default function ClearCartOnSuccess({
  clearOnLoad = false,
}: {
  clearOnLoad?: boolean;
}) {
  useEffect(() => {
    if (!clearOnLoad) return;

    localStorage.removeItem("cart");
    sessionStorage.removeItem("cart");
    localStorage.setItem("checkoutSuccess", "true");
    window.dispatchEvent(new Event("storage"));
    window.dispatchEvent(new Event("cartUpdated"));
  }, [clearOnLoad]);

  return null;
}
