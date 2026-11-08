"use client";

import { useEffect } from "react";

function hideNonActiveRows() {
  const root = document.querySelector<HTMLElement>("[data-seller-advanced-inventory]");
  if (!root) return;

  for (const article of Array.from(root.querySelectorAll<HTMLElement>("article"))) {
    const badges = Array.from(article.querySelectorAll<HTMLElement>("span")).map((node) =>
      node.textContent?.trim().toUpperCase(),
    );
    const hasActive = badges.includes("ACTIVE");
    article.style.display = hasActive ? "" : "none";
  }
}

export default function SellerInventoryActiveOnlyGuard() {
  useEffect(() => {
    let frame = 0;
    const apply = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(hideNonActiveRows);
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
