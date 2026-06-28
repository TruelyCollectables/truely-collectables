"use client";

import { useEffect } from "react";

export default function ClearCartOnSuccess({
  clearOnLoad = false,
}: {
  clearOnLoad?: boolean;
}) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (clearOnLoad || params.get("success") === "true") {
      localStorage.removeItem("cart");
      sessionStorage.removeItem("cart");
      localStorage.setItem("checkoutSuccess", "true");
      window.dispatchEvent(new Event("storage"));
      window.dispatchEvent(new Event("cartUpdated"));
    }
  }, []);

  return null;
}
