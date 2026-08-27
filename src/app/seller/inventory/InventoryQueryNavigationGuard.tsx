"use client";

import { useEffect } from "react";

function shouldForceInventoryReload(anchor: HTMLAnchorElement) {
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return false;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return false;
  if (url.pathname !== "/seller/inventory") return false;

  return url.searchParams.get("source") === "instacomp";
}

export default function InventoryQueryNavigationGuard() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || !shouldForceInventoryReload(anchor)) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(anchor.href);
    }

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
