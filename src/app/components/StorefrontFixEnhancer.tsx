"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

function canonicalSport(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");

  if (normalized.includes("hockey") || normalized === "nhl") return "Hockey";
  return value.trim();
}

function priceFromText(value: string | null | undefined) {
  const match = String(value || "").match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replaceAll(",", "")) : null;
}

function shippingLabel(price: number) {
  if (price >= 149) return "FREE Ground shipping";
  return price <= 20 ? "Shipping from $0.78" : "Shipping from $6.99";
}

function findPriceElement(root: Element) {
  return Array.from(root.querySelectorAll("p")).find((node) => {
    const text = node.textContent?.trim() || "";
    return /^\$[\d,]+(?:\.\d{2})?$/.test(text);
  });
}

function addShippingToCard(root: Element) {
  if ((root as HTMLElement).dataset.tcosShippingAdded === "true") return;
  const priceElement = findPriceElement(root);
  const price = priceFromText(priceElement?.textContent);
  if (!priceElement || price === null) return;

  const shipping = document.createElement("p");
  shipping.dataset.tcosShipping = "true";
  shipping.textContent = shippingLabel(price);
  shipping.className = "mt-1 text-[11px] font-black text-neutral-600";

  const quantityElement = Array.from(root.querySelectorAll("p,span")).find((node) =>
    /^qty\s+\d+/i.test(node.textContent?.trim() || ""),
  );

  if (quantityElement?.parentElement) {
    const currentParent = quantityElement.parentElement;
    if (currentParent.dataset.tcosShippingColumn === "true") {
      currentParent.appendChild(shipping);
    } else {
      const column = document.createElement("div");
      column.dataset.tcosShippingColumn = "true";
      column.className = "text-right";
      currentParent.replaceChild(column, quantityElement);
      column.appendChild(quantityElement);
      column.appendChild(shipping);
    }
  } else {
    priceElement.insertAdjacentElement("afterend", shipping);
  }

  (root as HTMLElement).dataset.tcosShippingAdded = "true";
}

function makeShopCardClickable(article: HTMLElement) {
  if (article.dataset.tcosWholeCardClickable === "true") return;
  const productLink = article.querySelector<HTMLAnchorElement>('a[href^="/product/"]');
  if (!productLink) return;

  article.dataset.tcosWholeCardClickable = "true";
  article.setAttribute("role", "link");
  article.setAttribute("tabindex", "0");
  article.style.cursor = "pointer";
  article.classList.add(
    "transition",
    "hover:-translate-y-1",
    "hover:shadow-lg",
    "focus-visible:outline-none",
    "focus-visible:ring-4",
    "focus-visible:ring-blue-500",
  );

  article.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("a,button,input,select,textarea,label")) return;
    window.location.assign(productLink.href);
  });
  article.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    window.location.assign(productLink.href);
  });
}

function mergeHockeySportTiles() {
  const heading = Array.from(document.querySelectorAll("h2")).find(
    (node) => node.textContent?.trim().toLowerCase() === "shop by sport",
  );
  const section = heading?.closest("section");
  if (!section || (section as HTMLElement).dataset.tcosHockeyMerged === "true") return;

  const hockeyLinks = Array.from(
    section.querySelectorAll<HTMLAnchorElement>('a[href*="sport="]'),
  ).filter((link) => {
    const title = link.querySelector("h3")?.textContent || "";
    return canonicalSport(title) === "Hockey";
  });
  if (!hockeyLinks.length) return;

  let total = 0;
  for (const link of hockeyLinks) {
    const countText = link.querySelector("p")?.textContent || "";
    const count = Number((countText.match(/[\d,]+/)?.[0] || "0").replaceAll(",", ""));
    total += Number.isFinite(count) ? count : 0;
  }

  const keeper = hockeyLinks[0];
  const title = keeper.querySelector("h3");
  const count = keeper.querySelector("p");
  if (title) title.textContent = "Hockey";
  if (count) count.textContent = `${total.toLocaleString()} active cards`;
  keeper.href = "/shop?q=hockey";
  hockeyLinks.slice(1).forEach((link) => link.remove());
  (section as HTMLElement).dataset.tcosHockeyMerged = "true";
}

function normalizeShopHockeyFilter() {
  const select = document.querySelector<HTMLSelectElement>('form select[name="sport"]');
  const form = select?.closest("form");
  if (!select || !form || select.dataset.tcosHockeyNormalized === "true") return;

  const options = Array.from(select.options).filter(
    (option) => canonicalSport(option.textContent || "") === "Hockey",
  );
  if (!options.length) return;

  const keeper = options[0];
  keeper.textContent = "Hockey";
  keeper.value = "__TCOS_HOCKEY__";
  options.slice(1).forEach((option) => option.remove());
  select.dataset.tcosHockeyNormalized = "true";

  form.addEventListener("submit", () => {
    if (select.value !== "__TCOS_HOCKEY__") return;
    const search = form.querySelector<HTMLInputElement>('input[name="q"]');
    if (search) {
      search.value = [search.value.trim(), "hockey"].filter(Boolean).join(" ");
    }
    select.removeAttribute("name");
  });
}

function enhanceHomeAndShop(pathname: string) {
  if (pathname === "/") {
    document
      .querySelectorAll('main a[href^="/product/"]')
      .forEach((card) => addShippingToCard(card));
    mergeHockeySportTiles();
  }

  if (pathname === "/shop") {
    document.querySelectorAll<HTMLElement>("main article").forEach((article) => {
      makeShopCardClickable(article);
      addShippingToCard(article);
    });
    normalizeShopHockeyFilter();
  }
}

function buildProductGallery(images: string[], title: string) {
  const gallery = document.createElement("div");
  gallery.dataset.tcosProductGallery = "true";
  gallery.className = `grid gap-4 ${images.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`;

  images.forEach((imageUrl, index) => {
    const figure = document.createElement("figure");
    figure.className =
      "overflow-hidden border-2 border-neutral-950 bg-white p-2 shadow-[4px_4px_0_rgba(17,19,24,0.12)]";
    const frame = document.createElement("div");
    frame.className = "flex min-h-[360px] items-center justify-center bg-neutral-50 lg:min-h-[520px]";
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = `${title} ${index === 0 ? "front" : index === 1 ? "back" : `detail ${index + 1}`}`;
    image.loading = index < 2 ? "eager" : "lazy";
    image.className = "max-h-[520px] w-full object-contain";
    const caption = document.createElement("figcaption");
    caption.textContent = index === 0 ? "Front" : index === 1 ? "Back" : `Detail ${index + 1}`;
    caption.className =
      "border-t-2 border-neutral-950 bg-yellow-300 px-3 py-2 text-center text-xs font-black uppercase tracking-[0.14em]";
    frame.appendChild(image);
    figure.appendChild(frame);
    figure.appendChild(caption);
    gallery.appendChild(figure);
  });

  return gallery;
}

async function enhanceProductPage(pathname: string) {
  const match = pathname.match(/^\/product\/(\d+)$/);
  if (!match || document.querySelector('[data-tcos-product-enhanced="true"]')) return;

  const response = await fetch(`/api/storefront/product-display/${match[1]}`);
  if (!response.ok) return;
  const data = await response.json();
  const images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];

  const main = document.querySelector<HTMLElement>("main.mx-auto.max-w-7xl");
  const productSection = Array.from(main?.children || []).find(
    (node) => node instanceof HTMLElement && node.tagName === "SECTION" && node.className.includes("mt-6"),
  ) as HTMLElement | undefined;
  if (!productSection) return;
  productSection.dataset.tcosProductEnhanced = "true";

  const mediaColumn = productSection.children[0] as HTMLElement | undefined;
  if (mediaColumn && images.length > 1) {
    const original = mediaColumn.firstElementChild as HTMLElement | null;
    if (original) original.style.display = "none";
    mediaColumn.prepend(buildProductGallery(images, String(data.title || "Sports card")));
  }

  const detailColumn = productSection.children[1] as HTMLElement | undefined;
  const priceElement = detailColumn ? findPriceElement(detailColumn) : undefined;
  if (priceElement && !detailColumn?.querySelector('[data-tcos-product-shipping="true"]')) {
    const shipping = document.createElement("p");
    shipping.dataset.tcosProductShipping = "true";
    shipping.textContent = String(data.shipping?.label || "");
    shipping.className = "mt-2 text-lg font-black text-blue-700";
    priceElement.insertAdjacentElement("afterend", shipping);

    const note = document.createElement("p");
    note.textContent = "Final shipping method and total are confirmed in the cart.";
    note.className = "mt-1 text-xs font-semibold text-neutral-500";
    shipping.insertAdjacentElement("afterend", note);
  }
}

export default function StorefrontFixEnhancer() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      enhanceHomeAndShop(pathname);
      void enhanceProductPage(pathname);
    };

    run();
    const timers = [100, 350, 900].map((delay) => window.setTimeout(run, delay));
    const observer = new MutationObserver(run);
    observer.observe(document.body, { childList: true, subtree: true });
    const stopObserver = window.setTimeout(() => observer.disconnect(), 2500);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(stopObserver);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
