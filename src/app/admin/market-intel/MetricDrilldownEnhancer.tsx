"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const globalDestinations: Record<string, string> = {
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
  "GROWTH SPECS": "/admin/market-intel/growth-specs",
  "GROWTH SPEC SCENARIOS": "/admin/market-intel/growth-specs",
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
  "PENDING": "/admin/market-intel/reports#pending-alerts",
  "SENT": "/admin/market-intel/reports#report-history",
  "DISMISSED": "/admin/market-intel/reports#report-history",
  "EXPIRED": "/admin/market-intel/reports#report-history",
  "REPORT RUNS": "/admin/market-intel/reports#report-history",
  "PENDING REVIEW": "/admin/market-intel/discovery#pending-exact-identities",
  "UNDER $5/CARD": "/admin/market-intel/discovery#pending-exact-identities",
  "APPROVED": "/admin/market-intel/discovery#recently-approved",
  "REJECTED": "/admin/market-intel/discovery#pending-exact-identities",
  "ALL CANDIDATES": "/admin/market-intel/discovery#pending-exact-identities",
  "DISCOVERY CANDIDATES": "/admin/market-intel/discovery#pending-exact-identities",
};

const readinessDestinations: Record<string, string> = {
  "SUPABASE URL": "/admin/settings",
  "SUPABASE SERVICE ROLE": "/admin/settings",
  "EBAY BROWSE CREDENTIALS": "/admin/market-intel/ebay",
  "CRON SECRET": "/admin/settings",
  "EXTERNAL INGESTION SECRET": "/admin/settings",
  "RESEND DELIVERY": "/admin/market-intel/delivery",
  "CORE MARKET INTEL SCHEMA": "/admin/market-intel/readiness#database-checks",
  "ALERT + REPORT PERSISTENCE": "/admin/market-intel/reports",
  "GROWTH SPEC LAB PERSISTENCE": "/admin/market-intel/growth-specs",
  "LICENSED-CARD DISCOVERY QUEUE": "/admin/market-intel/discovery",
  "WATCHLIST TARGETS": "/admin/market-intel/watchlist",
  "DISCOVERY CANDIDATES": "/admin/market-intel/discovery",
  "EXACT COLLECTIBLE IDENTITIES": "/admin/market-intel/comps",
  "VERIFIED SOLD COMPS": "/admin/market-intel/comps",
  "MARKET VALUE SNAPSHOTS": "/admin/market-intel/comps",
  "MARKETPLACE LISTINGS": "/admin/market-intel/deals#active-listings",
  "DEAL SCORES": "/admin/market-intel/deals#shark-list",
  "GROWTH SPEC SCENARIOS": "/admin/market-intel/growth-specs",
  "TRACKED PURCHASES": "/admin/market-intel/purchases",
};

const sectionAnchors: Record<string, Array<{ heading: string; id: string }>> = {
  "/admin/market-intel/watchlist": [
    { heading: "TRACKED PLAYERS", id: "tracked-players" },
  ],
  "/admin/market-intel/comps": [
    { heading: "CARD MARKETS", id: "card-markets" },
  ],
  "/admin/market-intel/ebay": [
    { heading: "RECENT EBAY CANDIDATES", id: "recent-ebay-candidates" },
  ],
  "/admin/market-intel/deals": [
    { heading: "THE SHARK LIST", id: "shark-list" },
    { heading: "ALL ACTIVE LISTINGS", id: "active-listings" },
  ],
  "/admin/market-intel/reports": [
    { heading: "PENDING ALERTS", id: "pending-alerts" },
    { heading: "REPORT HISTORY", id: "report-history" },
  ],
  "/admin/market-intel/portfolio": [
    { heading: "TRACKED POSITIONS", id: "tracked-positions" },
  ],
  "/admin/market-intel/discovery": [
    { heading: "PENDING EXACT IDENTITIES", id: "pending-exact-identities" },
    { heading: "RECENTLY APPROVED", id: "recently-approved" },
  ],
  "/admin/market-intel/readiness": [
    { heading: "BETA ONE CORE STATUS", id: "core-status" },
  ],
};

function normalized(value: string | null | undefined) {
  return String(value || "")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function withHandoff(destination: string, handoff: string | null) {
  const destinationUrl = new URL(destination, window.location.origin);
  if (handoff && !destinationUrl.searchParams.has("admin_handoff")) {
    destinationUrl.searchParams.set("admin_handoff", handoff);
  }
  return `${destinationUrl.pathname}${destinationUrl.search}${destinationUrl.hash}`;
}

function closestCard(node: HTMLElement) {
  return node.closest<HTMLElement>("article,section") || node.parentElement;
}

function makeDrillable(input: {
  card: HTMLElement;
  label: string;
  href: string;
  router: ReturnType<typeof useRouter>;
  cleanups: Array<() => void>;
}) {
  const { card, label, href, router, cleanups } = input;
  if (card.dataset.metricDrilldown === "1") return;
  if (card.closest("a[href]") || card.querySelector(":scope > a[href]")) return;

  const drillLabel = document.createElement("p");
  drillLabel.textContent = "DRILL IN →";
  drillLabel.className = "mt-2 text-xs font-black text-cyan-700";

  card.dataset.metricDrilldown = "1";
  card.setAttribute("role", "link");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", `Open ${label}`);
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

  const open = (event?: Event) => {
    if (event?.target instanceof HTMLElement && event.target.closest("button,input,select,textarea,a,form")) {
      return;
    }
    router.push(href);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      router.push(href);
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

export default function MetricDrilldownEnhancer() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const handoff = searchParams.get("admin_handoff");
    const anchors = sectionAnchors[pathname] || [];

    for (const rule of anchors) {
      const heading = Array.from(
        document.querySelectorAll<HTMLElement>("h1,h2,h3,h4,p"),
      ).find((node) => normalized(node.textContent).includes(rule.heading));
      const section = heading?.closest<HTMLElement>("section");
      if (!section) continue;
      const priorId = section.id;
      section.id = rule.id;
      section.classList.add("scroll-mt-6");
      cleanups.push(() => {
        section.id = priorId;
        section.classList.remove("scroll-mt-6");
      });
    }

    if (window.location.hash) {
      const frame = window.requestAnimationFrame(() => {
        document
          .getElementById(window.location.hash.slice(1))
          ?.scrollIntoView({ block: "start" });
      });
      cleanups.push(() => window.cancelAnimationFrame(frame));
    }

    for (const labelNode of Array.from(document.querySelectorAll<HTMLElement>("p"))) {
      const label = normalized(labelNode.textContent);
      const destination = globalDestinations[label];
      const card = labelNode.parentElement;
      if (!destination || !card) continue;
      makeDrillable({
        card,
        label: labelNode.textContent || label,
        href: withHandoff(destination, handoff),
        router,
        cleanups,
      });
    }

    if (pathname === "/admin/market-intel/readiness") {
      const checksContainer = Array.from(document.querySelectorAll<HTMLElement>("section")).find(
        (section) =>
          section.querySelectorAll(":scope > article").length > 0 &&
          Array.from(section.querySelectorAll("h2")).some((node) =>
            Boolean(readinessDestinations[normalized(node.textContent)]),
          ),
      );
      if (checksContainer) checksContainer.id = "database-checks";

      for (const heading of Array.from(document.querySelectorAll<HTMLElement>("article h2"))) {
        const label = normalized(heading.textContent);
        const destination = readinessDestinations[label];
        const card = closestCard(heading);
        if (!destination || !card) continue;
        makeDrillable({
          card,
          label: heading.textContent || label,
          href: withHandoff(destination, handoff),
          router,
          cleanups,
        });
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname, router, searchParams]);

  return null;
}
