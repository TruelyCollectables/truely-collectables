"use client";

import { useEffect } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type TrackingComp = {
  title?: string | null;
  price?: number | null;
  url?: string | null;
};

type TrackingSnapshot = {
  updatedAt?: string | null;
  marketPrice?: number | null;
  soldMedian?: number | null;
  soldCompCount?: number | null;
  sales7d?: number | null;
  sales30d?: number | null;
  trustedForPricing?: boolean;
  reviewReasons?: string[];
  topSoldComps?: TrackingComp[];
};

type EnhancementItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  sku: string | null;
  ebayItemId: string | null;
  status: string;
  category: string;
  isCard: boolean;
  imageUrl: string | null;
  imageUrls: string[];
  tracking: TrackingSnapshot | null;
};

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function categoryLabel(value: string) {
  return String(value || "other_collectable")
    .replaceAll("_", " ")
    .toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not checked";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not checked";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function exactTextElements(root: Element, selector: string, value: string) {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (element) => element.textContent?.trim() === value,
  );
}

function findInventoryArticle(item: EnhancementItem) {
  const articles = Array.from(document.querySelectorAll<HTMLElement>("article"));

  return (
    articles.find((article) => {
      const text = article.textContent || "";
      const hasInventoryActions = Array.from(
        article.querySelectorAll<HTMLButtonElement>("button"),
      ).some((button) =>
        ["Edit Listing", "Close Editor", "Pause Listing", "Archive Draft"].includes(
          button.textContent?.trim() || "",
        ),
      );
      if (!hasInventoryActions) return false;
      if (item.ebayItemId && text.includes(item.ebayItemId)) return true;
      if (item.sku && text.includes(item.sku)) return true;
      return text.includes(item.title);
    }) || null
  );
}

function renderTrackingSummary(container: HTMLElement, tracking: TrackingSnapshot | null) {
  container.replaceChildren();

  if (!tracking) {
    const empty = document.createElement("p");
    empty.className = "text-sm font-semibold text-sky-950";
    empty.textContent =
      "No saved market check yet. Start InstaComp™ to identify the exact card and save current pricing evidence.";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "mt-2 grid grid-cols-2 gap-2 text-xs text-sky-950";
  const values = [
    ["Market price", tracking.marketPrice ? currency(tracking.marketPrice) : "No baseline"],
    ["Sold median", tracking.soldMedian ? currency(tracking.soldMedian) : "No sold median"],
    ["Exact sold comps", String(Number(tracking.soldCompCount || 0))],
    ["Sold 7d / 30d", `${Number(tracking.sales7d || 0)} / ${Number(tracking.sales30d || 0)}`],
    ["Pricing evidence", tracking.trustedForPricing ? "Trusted" : "Needs review"],
    ["Last checked", shortDate(tracking.updatedAt)],
  ];

  for (const [label, value] of values) {
    const cell = document.createElement("div");
    cell.className = "rounded border border-sky-200 bg-white px-2 py-2";
    const heading = document.createElement("p");
    heading.className = "font-black uppercase text-sky-700";
    heading.textContent = label;
    const result = document.createElement("p");
    result.className = "mt-1 font-black text-neutral-950";
    result.textContent = value;
    cell.append(heading, result);
    grid.appendChild(cell);
  }
  container.appendChild(grid);

  const comps = Array.isArray(tracking.topSoldComps)
    ? tracking.topSoldComps.filter((comp) => comp?.url && comp?.title).slice(0, 3)
    : [];
  if (comps.length) {
    const heading = document.createElement("p");
    heading.className = "mt-3 text-xs font-black uppercase tracking-[0.12em] text-sky-800";
    heading.textContent = "Exact sold evidence";
    container.appendChild(heading);

    const list = document.createElement("div");
    list.className = "mt-2 space-y-2";
    for (const comp of comps) {
      const link = document.createElement("a");
      link.href = String(comp.url);
      link.target = "_blank";
      link.rel = "noreferrer";
      link.className =
        "flex items-start justify-between gap-3 rounded border border-sky-200 bg-white px-2 py-2 text-xs hover:border-neutral-950";
      const title = document.createElement("span");
      title.className = "line-clamp-2 font-semibold";
      title.textContent = String(comp.title || "Sold comp");
      const price = document.createElement("span");
      price.className = "whitespace-nowrap font-black";
      price.textContent = currency(comp.price);
      link.append(title, price);
      list.appendChild(link);
    }
    container.appendChild(list);
  }

  if (tracking.reviewReasons?.length) {
    const warning = document.createElement("p");
    warning.className = "mt-3 text-xs font-semibold text-amber-900";
    warning.textContent = `Review: ${tracking.reviewReasons.slice(0, 3).join(" · ")}`;
    container.appendChild(warning);
  }
}

function insertImage(article: HTMLElement, item: EnhancementItem) {
  article.querySelectorAll('[data-tcos-exact-image="true"]').forEach((node) => node.remove());
  if (!item.imageUrl) return;

  const wrapper = document.createElement("div");
  wrapper.dataset.tcosExactImage = "true";
  wrapper.className =
    "mb-4 overflow-hidden rounded-md border border-neutral-300 bg-white p-3";
  const image = document.createElement("img");
  image.src = item.imageUrl;
  image.alt = item.title;
  image.loading = "lazy";
  image.className = "mx-auto max-h-72 w-full object-contain";
  wrapper.appendChild(image);
  article.prepend(wrapper);
}

function fixCategory(article: HTMLElement, item: EnhancementItem) {
  const label = exactTextElements(article, "p,span", "CATEGORY")[0];
  const parent = label?.parentElement;
  if (!parent) return;
  const textNodes = Array.from(parent.querySelectorAll<HTMLElement>("p,span"));
  const value = textNodes.find(
    (element) => element !== label && element.textContent?.trim() !== "CATEGORY",
  );
  if (value) value.textContent = categoryLabel(item.category);
}

function fixStatusMessaging(article: HTMLElement, item: EnhancementItem) {
  for (const message of exactTextElements(
    article,
    "p",
    "This item is ready for activation review.",
  )) {
    if (item.status === "active") {
      message.textContent = "This listing is ACTIVE and currently available for sale in TCOS.";
    } else if (item.status === "archived") {
      message.textContent = "This listing is paused and is not currently available for sale.";
    } else {
      message.textContent = "This draft is ready for activation review.";
    }
  }

  if (item.status === "active") {
    for (const badge of exactTextElements(article, "span", "READY")) {
      badge.textContent = "SELLING";
    }
  }
}

function insertInstaComp(
  article: HTMLElement,
  item: EnhancementItem,
  accessToken: string,
) {
  article
    .querySelectorAll('[data-tcos-exact-instacomp="true"]')
    .forEach((node) => node.remove());

  const block = document.createElement("div");
  block.dataset.tcosExactInstacomp = "true";
  block.className = item.isCard
    ? "mt-4 rounded-md border border-sky-300 bg-sky-50 px-3 py-3"
    : "mt-4 rounded-md border border-violet-300 bg-violet-50 px-3 py-3";

  const heading = document.createElement("p");
  heading.className = item.isCard
    ? "text-xs font-black uppercase tracking-[0.14em] text-sky-900"
    : "text-xs font-black uppercase tracking-[0.14em] text-violet-900";
  heading.textContent = item.isCard
    ? "InstaComp™ Market Tracking"
    : "InstaComp™ for Other Collectibles — Coming Soon";
  block.appendChild(heading);

  if (item.isCard) {
    const summary = document.createElement("div");
    renderTrackingSummary(summary, item.tracking);
    block.appendChild(summary);

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "mt-3 rounded-md bg-violet-700 px-4 py-2 text-sm font-black text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50";
    button.textContent = item.tracking ? "Refresh InstaComp™" : "Start InstaComp™";
    if (!item.imageUrl) {
      button.disabled = true;
      button.textContent = "Image required for InstaComp™";
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Scanning card and current market...";
      try {
        const response = await fetch(
          `/api/account/seller/inventory/${item.inventoryItemId}/instacomp-tracking`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ deepScan: false }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success !== true) {
          throw new Error(data?.error || "InstaComp™ refresh failed.");
        }
        item.tracking = data.tracking as TrackingSnapshot;
        renderTrackingSummary(summary, item.tracking);
        button.textContent = "Refresh InstaComp™";
      } catch (error: any) {
        const warning = document.createElement("p");
        warning.className = "mt-2 text-sm font-bold text-rose-700";
        warning.textContent = error?.message || "InstaComp™ refresh failed.";
        summary.prepend(warning);
        button.textContent = item.tracking ? "Retry InstaComp™" : "Start InstaComp™";
      } finally {
        button.disabled = false;
      }
    });
    block.appendChild(button);
  } else {
    const note = document.createElement("p");
    note.className = "mt-2 text-sm font-semibold text-violet-950";
    note.textContent =
      "This is a physical collectible rather than a trading card. Card InstaComp™ is live now; pricing support for memorabilia and other collectibles is the next expansion.";
    block.appendChild(note);
  }

  const actionButton = Array.from(article.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) =>
      ["Edit Listing", "Close Editor"].includes(button.textContent?.trim() || ""),
  );
  const actionBar = actionButton?.parentElement;
  if (actionBar?.parentElement === article) {
    article.insertBefore(block, actionBar);
  } else {
    article.appendChild(block);
  }
}

function enhanceVisibleCards(items: EnhancementItem[], accessToken: string) {
  for (const item of items) {
    const article = findInventoryArticle(item);
    if (!article) continue;
    if (article.dataset.tcosExactEnhanced === item.inventoryItemId) continue;

    article.dataset.tcosExactEnhanced = item.inventoryItemId;
    insertImage(article, item);
    fixCategory(article, item);
    fixStatusMessaging(article, item);
    insertInstaComp(article, item, accessToken);
  }
}

async function loadEnhancements(accessToken: string) {
  const items: EnhancementItem[] = [];
  let offset = 0;
  let hasMore = true;
  let pages = 0;

  while (hasMore && pages < 20) {
    const response = await fetch(
      `/api/account/seller/inventory/exact-card-enhancements?limit=200&offset=${offset}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.success !== true) {
      throw new Error(data?.error || "Could not load exact seller inventory fixes.");
    }
    const pageItems = Array.isArray(data.items) ? data.items : [];
    items.push(...(pageItems as EnhancementItem[]));
    hasMore = data.hasMore === true;
    offset += pageItems.length;
    pages += 1;
    if (!pageItems.length) break;
  }

  return items;
}

export default function SellerInventoryExactCardEnhancer() {
  useEffect(() => {
    let cancelled = false;
    let observer: MutationObserver | null = null;
    let frame = 0;

    void (async () => {
      const session = await getFreshAccountSession(5 * 60, true);
      if (cancelled || !session?.access_token) return;

      try {
        const items = await loadEnhancements(session.access_token);
        if (cancelled) return;

        const apply = () => {
          window.cancelAnimationFrame(frame);
          frame = window.requestAnimationFrame(() =>
            enhanceVisibleCards(items, session.access_token),
          );
        };

        apply();
        observer = new MutationObserver(apply);
        observer.observe(document.body, { childList: true, subtree: true });
      } catch (error) {
        console.error("Seller inventory exact-card enhancement failed:", error);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
