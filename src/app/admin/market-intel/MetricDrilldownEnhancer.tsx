"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const destinations: Record<string, string> = {
  "ACTIVE TARGETS": "/admin/market-intel/watch-center#tracked-players",
  "EXACT MARKETS": "/admin/market-intel/comps",
  "ACTIVE LISTINGS": "/admin/market-intel/deals#active-listings",
  "ACTIONABLE BUYS": "/admin/market-intel/deals#shark-list",
  "GROWTH SPECS": "/admin/market-intel/growth-specs",
  "CAPITAL INVESTED": "/admin/market-intel/purchases",
  "COMBINED GROSS RETURN": "/admin/market-intel/portfolio",
};

function normalized(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

export default function MetricDrilldownEnhancer() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname !== "/admin/market-intel") return;
    const handoff = searchParams.get("admin_handoff");
    const cleanups: Array<() => void> = [];

    for (const labelNode of Array.from(document.querySelectorAll("p"))) {
      const destination = destinations[normalized(labelNode.textContent)];
      const card = labelNode.parentElement;
      if (!destination || !card || card.dataset.metricDrilldown === "1") continue;

      const destinationUrl = new URL(destination, window.location.origin);
      if (handoff && !destinationUrl.searchParams.has("admin_handoff")) {
        destinationUrl.searchParams.set("admin_handoff", handoff);
      }
      const href = `${destinationUrl.pathname}${destinationUrl.search}${destinationUrl.hash}`;
      const drillLabel = document.createElement("p");
      drillLabel.textContent = "DRILL IN →";
      drillLabel.className = "mt-2 text-xs font-black text-cyan-700";

      card.dataset.metricDrilldown = "1";
      card.setAttribute("role", "link");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `Open ${labelNode.textContent || "Market Intel detail"}`);
      card.classList.add(
        "cursor-pointer",
        "transition",
        "hover:-translate-y-0.5",
        "hover:border-cyan-400",
        "hover:shadow-md",
        "focus:outline-none",
        "focus:ring-2",
        "focus:ring-cyan-500",
      );
      card.appendChild(drillLabel);

      const open = () => router.push(href);
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      };
      card.addEventListener("click", open);
      card.addEventListener("keydown", keydown);

      cleanups.push(() => {
        card.removeEventListener("click", open);
        card.removeEventListener("keydown", keydown);
        card.removeAttribute("role");
        card.removeAttribute("tabindex");
        card.removeAttribute("aria-label");
        delete card.dataset.metricDrilldown;
        drillLabel.remove();
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname, router, searchParams]);

  return null;
}
