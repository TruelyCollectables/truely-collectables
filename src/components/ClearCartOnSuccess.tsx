"use client";

import { useEffect } from "react";

export default function ClearCartOnSuccess() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("success") === "true") {
      localStorage.removeItem("cart");
      window.dispatchEvent(new Event("cartUpdated"));
    }
  }, []);

  return null;
}