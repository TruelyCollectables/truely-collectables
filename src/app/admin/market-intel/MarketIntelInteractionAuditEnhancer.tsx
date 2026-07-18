"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function normalize(value: string | null | undefined) {
  return String(value || "")
    .replace(/[™®]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function slug(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "player";
}

function withHandoff(destination: string, handoff: string | null) {
  const url = new URL(destination, window.location.origin);
  if (handoff && url.origin === window.location.origin && !url.searchParams.has("admin_handoff")) {
    url.searchParams.set("admin_handoff", handoff);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function detailDestination(
  pathname: string,
  label: string,
  handoff: string | null,
) {
  if (pathname === "/admin/market-intel/buy") {
    if (["ACTIONABLE LISTINGS", "WHOLESALE / LOTS", "CAPITAL FOR ALL", "EXPECTED NET PROFIT"].includes(label)) {
      return withHandoff("/admin/market-intel/deals#shark-list", handoff);
    }
  }

  if (pathname === "/admin/market-intel/growth-specs") {
    if (["ACTIVE SPECS", "CAPITAL AT RISK", "PROJECTED NET PROFIT", "BIG MONEY MODELS"].includes(label)) {
      return "#future-money-models";
    }
    if (label === "AUTO LOT CANDIDATES") return "#automatic-growth-candidates";
  }

  if (/^\/admin\/market-intel\/comps\/[^/]+$/.test(pathname)) {
    if (label === "VERIFIED SAMPLE") return "#verified-sale-history";
    if (["CONSERVATIVE VALUE", "MEDIAN", "AVERAGE", "CONFIDENCE", "LIQUIDITY"].includes(label)) {
      return "#market-value";
    }
  }

  if (/^\/admin\/market-intel\/purchases\/[^/]+$/.test(pathname)) {
    if (["TOTAL COST", "UNIT COST", "UNITS REMAINING"].includes(label)) {
      return withHandoff(`${pathname}/edit`, handoff);
    }
    if (["CURRENT MARKET / UNIT", "7-DAY MOVE", "SINCE PURCHASE"].includes(label)) {
      const compLink = document.querySelector<HTMLAnchorElement>(
        'a[href*="/admin/market-intel/comps/"]',
      );
      return compLink?.getAttribute("href") || withHandoff("/admin/market-intel/comps", handoff);
    }
  }

  return null;
}

function openHref(router: ReturnType<typeof useRouter>, href: string, anchor?: HTMLAnchorElement) {
  if (anchor?.target === "_blank" || /^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) {
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }
  const url = new URL(href, window.location.origin);
  if (url.origin === window.location.origin) {
    router.push(`${url.pathname}${url.search}${url.hash}`);
  } else {
    window.location.assign(url.href);
  }
}

export default function MarketIntelInteractionAuditEnhancer() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const handoff = searchParams.get("admin_handoff");

    if (pathname === "/admin/market-intel/watch-center") {
      for (const details of Array.from(document.querySelectorAll<HTMLDetailsElement>("details"))) {
        const name = details.querySelector("summary h3")?.textContent;
        if (!name) continue;
        const priorId = details.id;
        details.id = `player-${slug(name)}`;
        details.classList.add("scroll-mt-6");
        cleanups.push(() => {
          details.id = priorId;
          details.classList.remove("scroll-mt-6");
        });
      }
      if (window.location.hash.startsWith("#player-")) {
        const frame = window.requestAnimationFrame(() => {
          const details = document.getElementById(window.location.hash.slice(1));
          if (details instanceof HTMLDetailsElement) details.open = true;
          details?.scrollIntoView({ block: "start" });
        });
        cleanups.push(() => window.cancelAnimationFrame(frame));
      }
    }

    if (pathname === "/admin/market-intel/watchlist") {
      for (const article of Array.from(document.querySelectorAll<HTMLElement>("article"))) {
        const name = article.querySelector("h3")?.textContent?.trim();
        if (!name || article.dataset.playerDrilldown === "1") continue;
        const href = withHandoff(
          `/admin/market-intel/watch-center#player-${slug(name)}`,
          handoff,
        );
        article.dataset.playerDrilldown = "1";
        article.setAttribute("role", "link");
        article.setAttribute("tabindex", "0");
        article.setAttribute("aria-label", `Open ${name} in TCOS Watch Center`);
        article.classList.add(
          "cursor-pointer",
          "transition",
          "hover:bg-cyan-50",
          "focus:outline-none",
          "focus:ring-2",
          "focus:ring-cyan-500",
        );
        const label = document.createElement("p");
        label.textContent = "OPEN PLAYER WATCH CENTER →";
        label.className = "mt-3 text-xs font-black text-cyan-800";
        article.querySelector("h3")?.parentElement?.appendChild(label);
        const click = (event: Event) => {
          if (event.target instanceof HTMLElement && event.target.closest("button,input,select,textarea,a,form")) return;
          router.push(href);
        };
        const keydown = (event: KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            router.push(href);
          }
        };
        article.addEventListener("click", click);
        article.addEventListener("keydown", keydown);
        cleanups.push(() => {
          article.removeEventListener("click", click);
          article.removeEventListener("keydown", keydown);
          article.removeAttribute("role");
          article.removeAttribute("tabindex");
          article.removeAttribute("aria-label");
          delete article.dataset.playerDrilldown;
          label.remove();
        });
      }
    }

    const headingAnchors: Record<string, string> = {
      "MARKET VALUE": "market-value",
      "VERIFIED SALE HISTORY": "verified-sale-history",
      "AUTOMATIC GROWTH CANDIDATES": "automatic-growth-candidates",
      "FUTURE MONEY MODELS": "future-money-models",
    };
    for (const heading of Array.from(document.querySelectorAll<HTMLElement>("h2,h3"))) {
      const id = headingAnchors[normalize(heading.textContent)];
      const section = heading.closest<HTMLElement>("section");
      if (!id || !section) continue;
      const priorId = section.id;
      section.id = id;
      section.classList.add("scroll-mt-6");
      cleanups.push(() => {
        section.id = priorId;
        section.classList.remove("scroll-mt-6");
      });
    }

    for (const labelNode of Array.from(document.querySelectorAll<HTMLElement>("p"))) {
      const label = normalize(labelNode.textContent);
      const destination = detailDestination(pathname, label, handoff);
      const card = labelNode.parentElement;
      if (!destination || !card || card.dataset.metricDrilldown === "1" || card.closest("a[href]")) continue;
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
      const drill = document.createElement("p");
      drill.textContent = "DRILL IN →";
      drill.className = "mt-2 text-xs font-black text-cyan-700";
      card.appendChild(drill);
      const click = (event: Event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button,input,select,textarea,a,form")) return;
        openHref(router, destination);
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openHref(router, destination);
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

    for (const row of Array.from(document.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      if (row.dataset.rowDrilldown === "1") continue;
      const anchor = row.querySelector<HTMLAnchorElement>("a[href]");
      if (!anchor) continue;
      const href = anchor.href;
      row.dataset.rowDrilldown = "1";
      row.setAttribute("role", "link");
      row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", `Open ${anchor.textContent?.trim() || "record"}`);
      row.classList.add(
        "cursor-pointer",
        "transition",
        "hover:bg-cyan-50",
        "focus:outline-none",
        "focus:ring-2",
        "focus:ring-inset",
        "focus:ring-cyan-500",
      );
      const click = (event: Event) => {
        if (event.target instanceof HTMLElement && event.target.closest("button,input,select,textarea,a,form")) return;
        openHref(router, href, anchor);
      };
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openHref(router, href, anchor);
        }
      };
      row.addEventListener("click", click);
      row.addEventListener("keydown", keydown);
      cleanups.push(() => {
        row.removeEventListener("click", click);
        row.removeEventListener("keydown", keydown);
        row.removeAttribute("role");
        row.removeAttribute("tabindex");
        row.removeAttribute("aria-label");
        delete row.dataset.rowDrilldown;
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname, router, searchParams]);

  return null;
}
