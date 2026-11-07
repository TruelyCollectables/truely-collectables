"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const destinations: Record<string, string> = {
  "ACTIVE TARGETS": "/admin/market-intel/watch-center#tracked-players",
  "WATCHLIST TARGETS": "/admin/market-intel/watchlist#tracked-players",
  "TRACKED PLAYERS": "/admin/market-intel/watch-center#tracked-players",
  "PAUSED TARGETS": "/admin/market-intel/watchlist#tracked-players",
  "DEFAULT RULE": "/admin/market-intel/watchlist#tracked-players",
  "EXACT MARKETS": "/admin/market-intel/comps#card-markets",
  "EXACT IDENTITIES": "/admin/market-intel/comps#card-markets",
  "EXACT CARD MARKETS": "/admin/market-intel/comps#card-markets",
  "EXACT COLLECTIBLE IDENTITIES": "/admin/market-intel/comps#card-markets",
  "WITH MARKET VALUE": "/admin/market-intel/comps#card-markets",
  "SOLD COMPS": "/admin/market-intel/comps#card-markets",
  "VERIFIED SOLD COMPS": "/admin/market-intel/comps#card-markets",
  "VERIFIED COMP ROWS": "/admin/market-intel/comps#card-markets",
  "MARKET VALUES": "/admin/market-intel/comps#card-markets",
  "MARKET VALUE SNAPSHOTS": "/admin/market-intel/comps#card-markets",
  "HOT EXACT CARDS": "/admin/market-intel/watch-center#hot-cards",
  "ACTIVE LISTINGS": "/admin/market-intel/deals#active-listings",
  "MARKETPLACE LISTINGS": "/admin/market-intel/deals#active-listings",
  "EBAY ACTIVE ROWS": "/admin/market-intel/ebay#recent-ebay-candidates",
  "LATEST EBAY ROW": "/admin/market-intel/ebay#recent-ebay-candidates",
  "ACTIVE PRICES": "/admin/market-intel/watch-center#best-prices",
  "ACTIONABLE BUYS": "/admin/market-intel/deals#shark-list",
  "ACTIONABLE": "/admin/market-intel/deals#shark-list",
  "DEAL SCORES": "/admin/market-intel/deals#shark-list",
  "ACTIONABLE EBAY DEALS": "/admin/market-intel/deals#shark-list",
  "WATCH ONLY": "/admin/market-intel/deals#active-listings",
  "WHOLESALE / LOTS": "/admin/market-intel/deals#active-listings",
  "MISLISTED": "/admin/market-intel/deals#active-listings",
  "GROWTH SPECS": "/admin/market-intel/growth-specs#future-money-models",
  "GROWTH SPEC SCENARIOS": "/admin/market-intel/growth-specs#future-money-models",
  "ACTIVE SPECS": "/admin/market-intel/growth-specs#future-money-models",
  "CAPITAL AT RISK": "/admin/market-intel/growth-specs#future-money-models",
  "PROJECTED NET PROFIT": "/admin/market-intel/growth-specs#future-money-models",
  "BIG MONEY MODELS": "/admin/market-intel/growth-specs#future-money-models",
  "AUTO LOT CANDIDATES": "/admin/market-intel/growth-specs#automatic-growth-candidates",
  "CAPITAL INVESTED": "/admin/market-intel/purchases",
  "PURCHASE LOTS": "/admin/market-intel/purchases",
  "TRACKED PURCHASES": "/admin/market-intel/purchases",
  "OWNED UNITS": "/admin/market-intel/purchases",
  "UNITS REMAINING": "/admin/market-intel/portfolio#tracked-positions",
  "REMAINING COST BASIS": "/admin/market-intel/portfolio#tracked-positions",
  "REALIZED NET PROCEEDS": "/admin/market-intel/portfolio#tracked-positions",
  "REALIZED GROSS PROFIT": "/admin/market-intel/portfolio#tracked-positions",
  "ESTIMATED MARKET VALUE": "/admin/market-intel/portfolio#tracked-positions",
  "UNREALIZED GROSS SPREAD": "/admin/market-intel/portfolio#tracked-positions",
  "COMBINED GROSS RETURN": "/admin/market-intel/portfolio#tracked-positions",
  "PERSISTENT ALERTS": "/admin/market-intel/reports#pending-alerts",
  "PENDING ALERTS": "/admin/market-intel/reports#pending-alerts",
  "SENT ALERTS": "/admin/market-intel/reports#report-history",
  "GENERATED REPORTS": "/admin/market-intel/reports#report-history",
  "DELIVERED REPORTS": "/admin/market-intel/reports#report-history",
  "PENDING REVIEW": "/admin/market-intel/discovery#pending-exact-identities",
  "UNDER $5/CARD": "/admin/market-intel/discovery#pending-exact-identities",
  "APPROVED": "/admin/market-intel/discovery#recently-approved",
  "REJECTED": "/admin/market-intel/discovery#pending-exact-identities",
  "ALL CANDIDATES": "/admin/market-intel/discovery#pending-exact-identities",
  "DISCOVERY CANDIDATES": "/admin/market-intel/discovery#pending-exact-identities",
  "ACTIONABLE LISTINGS": "/admin/market-intel/deals#shark-list",
  "CAPITAL FOR ALL": "/admin/market-intel/deals#shark-list",
  "EXPECTED NET PROFIT": "/admin/market-intel/deals#shark-list",
};

const sections: Record<string, Array<{ heading: string; id: string }>> = {
  "/admin/market-intel/watchlist": [{ heading: "TRACKED PLAYERS", id: "tracked-players" }],
  "/admin/market-intel/comps": [{ heading: "CARD MARKETS", id: "card-markets" }],
  "/admin/market-intel/ebay": [{ heading: "RECENT EBAY CANDIDATES", id: "recent-ebay-candidates" }],
  "/admin/market-intel/deals": [
    { heading: "THE SHARK LIST", id: "shark-list" },
    { heading: "ALL ACTIVE LISTINGS", id: "active-listings" },
  ],
  "/admin/market-intel/reports": [
    { heading: "PENDING ALERTS", id: "pending-alerts" },
    { heading: "REPORT HISTORY", id: "report-history" },
  ],
  "/admin/market-intel/delivery": [{ heading: "PENDING DELIVERY QUEUE", id: "pending-delivery" }],
  "/admin/market-intel/ingestion": [{ heading: "FEED STATUS BY SOURCE", id: "feed-status" }],
  "/admin/market-intel/portfolio": [{ heading: "TRACKED POSITIONS", id: "tracked-positions" }],
  "/admin/market-intel/purchases": [{ heading: "TRACKED PURCHASE POSITIONS", id: "tracked-purchase-positions" }],
  "/admin/market-intel/discovery": [
    { heading: "PENDING EXACT IDENTITIES", id: "pending-exact-identities" },
    { heading: "RECENTLY APPROVED", id: "recently-approved" },
  ],
};

function normalize(value: string | null | undefined) {
  return String(value || "")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function routeDestination(pathname: string, label: string) {
  if (destinations[label]) return destinations[label];
  if (pathname === "/admin/market-intel/ingestion") {
    if (["ALL LISTINGS", "ACTIVE", "FRESH <2H", "STALE", "ENDED", "UNMATCHED", "UNSCORED", "PRICE CHANGED"].includes(label)) {
      return label === "UNSCORED"
        ? "/admin/market-intel/deals#active-listings"
        : "/admin/market-intel/ingestion#feed-status";
    }
  }
  if (pathname === "/admin/market-intel/purchases") {
    if (label.includes("INVESTED") || label.includes("COST BASIS")) {
      return "/admin/market-intel/purchases#tracked-purchase-positions";
    }
    if (label.includes("ESTIMATED MARKET") || label.includes("REALIZED") || label === "UNITS REMAINING") {
      return "/admin/market-intel/portfolio#tracked-positions";
    }
  }
  return null;
}

function withHandoff(destination: string, handoff: string | null) {
  const url = new URL(destination, window.location.origin);
  if (handoff && !url.searchParams.has("admin_handoff")) {
    url.searchParams.set("admin_handoff", handoff);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function isMetricCard(card: HTMLElement) {
  if (card.closest("a[href]") || card.querySelector("form,button,input,select,textarea")) return false;
  const paragraphs = card.querySelectorAll(":scope > p");
  return paragraphs.length >= 2 && paragraphs.length <= 4;
}

export default function MarketIntelDrilldownController() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handoff = searchParams.get("admin_handoff");
    const cleanups: Array<() => void> = [];

    for (const rule of sections[pathname] || []) {
      const heading = Array.from(document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p")).find(
        (node) => normalize(node.textContent).includes(rule.heading),
      );
      const section = heading?.closest<HTMLElement>("section");
      if (!section) continue;
      const prior = section.id;
      section.id = rule.id;
      section.classList.add("scroll-mt-6");
      cleanups.push(() => {
        section.id = prior;
        section.classList.remove("scroll-mt-6");
      });
    }

    if (window.location.hash) {
      const frame = window.requestAnimationFrame(() => {
        document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
      });
      cleanups.push(() => window.cancelAnimationFrame(frame));
    }

    for (const labelNode of Array.from(document.querySelectorAll<HTMLElement>("p"))) {
      const label = normalize(labelNode.textContent);
      const destination = routeDestination(pathname, label);
      const card = labelNode.parentElement;
      if (!destination || !card || !isMetricCard(card) || card.dataset.metricDrilldown === "1") continue;

      const href = withHandoff(destination, handoff);
      const drill = document.createElement("p");
      drill.textContent = "DRILL IN →";
      drill.className = "mt-2 text-xs font-black text-cyan-700";
      card.appendChild(drill);
      card.dataset.metricDrilldown = "1";
      card.setAttribute("role", "link");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `Open ${labelNode.textContent || label}`);
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
      const click = () => router.push(href);
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(href);
        }
      };
      card.addEventListener("click", click);
      card.addEventListener("keydown", keydown);
      cleanups.push(() => {
        card.removeEventListener("click", click);
        card.removeEventListener("keydown", keydown);
        card.removeAttribute("role");
        card.removeAttribute("tabindex");
        card.removeAttribute("aria-label");
        delete card.dataset.metricDrilldown;
        drill.remove();
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname, router, searchParams]);

  return null;
}
