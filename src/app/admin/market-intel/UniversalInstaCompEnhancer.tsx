"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MARKETPLACE_HOSTS = [
  "ebay.",
  "comc.com",
  "collx.app",
  "whatnot.com",
  "fanaticscollect.com",
  "mercari.com",
  "poshmark.com",
  "facebook.com",
  "sportlots.com",
  "myslabs.com",
];

function addHandoff(url: URL, handoff: string | null) {
  if (
    handoff &&
    url.origin === window.location.origin &&
    !url.searchParams.has("admin_handoff")
  ) {
    url.searchParams.set("admin_handoff", handoff);
  }
  return url;
}

function identityFromCompHref(href: string) {
  const url = new URL(href, window.location.origin);
  return url.pathname.match(/^\/admin\/market-intel\/comps\/([^/]+)$/)?.[1] || null;
}

function looksLikeMarketplaceSource(anchor: HTMLAnchorElement) {
  const url = new URL(anchor.href, window.location.origin);
  if (url.origin === window.location.origin) return false;
  const hostname = url.hostname.toLowerCase();
  return MARKETPLACE_HOSTS.some((host) => hostname.includes(host));
}

function controlsRoot(anchor: HTMLAnchorElement, exactIdentity: boolean) {
  if (exactIdentity) {
    if (anchor.classList.contains("block") || anchor.closest("tr")) return anchor;
    return anchor.parentElement || anchor;
  }
  return anchor.closest<HTMLElement>("article,tr") || anchor;
}

function createControls(input: {
  compUrl: string;
  trackUrl: string;
  dark: boolean;
  onTracked: () => void;
}) {
  const wrapper = document.createElement("div");
  wrapper.dataset.universalInstacompControls = "1";
  wrapper.className = "mt-3 flex flex-wrap items-center gap-2";

  const comp = document.createElement("a");
  comp.href = input.compUrl;
  comp.textContent = "InstaComp™";
  comp.className = input.dark
    ? "rounded-md border border-cyan-400 bg-cyan-950 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-900"
    : "rounded-md border border-cyan-400 bg-cyan-50 px-3 py-2 text-xs font-black text-cyan-950 hover:bg-cyan-100";

  const track = document.createElement("button");
  track.type = "button";
  track.textContent = "Track Today";
  track.className = input.dark
    ? "rounded-md bg-fuchsia-300 px-3 py-2 text-xs font-black text-black hover:bg-fuchsia-200 disabled:cursor-wait disabled:opacity-50"
    : "rounded-md bg-fuchsia-800 px-3 py-2 text-xs font-black text-white hover:bg-fuchsia-700 disabled:cursor-wait disabled:opacity-50";
  track.title =
    "Run a focused exact-card scan, rescore live matches, recalculate the verified-comp market, and record today’s market observation without buying the card.";

  const status = document.createElement("p");
  status.className = input.dark
    ? "basis-full text-xs font-bold text-neutral-300"
    : "basis-full text-xs font-bold text-neutral-600";
  status.setAttribute("aria-live", "polite");

  const click = async () => {
    if (track.disabled) return;
    track.disabled = true;
    track.textContent = "Tracking Today...";
    status.removeAttribute("role");
    status.textContent = "Scanning this exact card and recording today’s snapshot...";
    try {
      const response = await fetch(input.trackUrl, {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || payload.success !== true) {
        throw new Error(payload?.error || `Tracking failed with HTTP ${response.status}.`);
      }
      status.textContent =
        payload.message || "Today’s exact-card observation was recorded.";
      input.onTracked();
    } catch (error) {
      status.setAttribute("role", "alert");
      status.textContent =
        error instanceof Error ? error.message : "Unable to track this card today.";
    } finally {
      track.disabled = false;
      track.textContent = "Track Today";
    }
  };

  track.addEventListener("click", click);
  wrapper.append(comp, track, status);
  return {
    wrapper,
    cleanup: () => track.removeEventListener("click", click),
  };
}

export default function UniversalInstaCompEnhancer() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname.startsWith("/admin/market-intel")) return;
    const handoff = searchParams.get("admin_handoff");
    const cleanups: Array<() => void> = [];
    const enhanced = new Set<HTMLElement>();

    const currentIdentity = pathname.match(
      /^\/admin\/market-intel\/comps\/([^/]+)$/,
    )?.[1];
    if (currentIdentity) {
      const header = document.querySelector<HTMLElement>(
        "main header > div, main > header > div",
      );
      if (
        header &&
        !header.querySelector('[data-universal-instacomp-controls="1"]')
      ) {
        const compUrl = addHandoff(
          new URL(
            `/admin/market-intel/comps/${currentIdentity}`,
            window.location.origin,
          ),
          handoff,
        );
        const trackUrl = addHandoff(
          new URL(
            `/api/admin/market-intel/identities/${currentIdentity}/track-today`,
            window.location.origin,
          ),
          handoff,
        );
        const controls = createControls({
          compUrl: `${compUrl.pathname}${compUrl.search}`,
          trackUrl: `${trackUrl.pathname}${trackUrl.search}`,
          dark: true,
          onTracked: () => router.refresh(),
        });
        header.appendChild(controls.wrapper);
        cleanups.push(() => {
          controls.cleanup();
          controls.wrapper.remove();
        });
      }
    }

    for (const anchor of Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    )) {
      let compUrl: URL | null = null;
      let trackUrl: URL | null = null;
      const identityId = identityFromCompHref(anchor.href);
      const marketplaceSource = !identityId && looksLikeMarketplaceSource(anchor);
      if (!identityId && !marketplaceSource) continue;

      const root = controlsRoot(anchor, Boolean(identityId));
      if (
        enhanced.has(root) ||
        root.dataset.universalInstacompEnhanced === "1"
      ) {
        continue;
      }

      if (identityId) {
        compUrl = addHandoff(
          new URL(
            `/admin/market-intel/comps/${identityId}`,
            window.location.origin,
          ),
          handoff,
        );
        trackUrl = addHandoff(
          new URL(
            `/api/admin/market-intel/identities/${identityId}/track-today`,
            window.location.origin,
          ),
          handoff,
        );
      } else {
        const sourceUrl = anchor.href;
        compUrl = addHandoff(
          new URL(
            "/api/admin/market-intel/instacomp/resolve",
            window.location.origin,
          ),
          handoff,
        );
        compUrl.searchParams.set("sourceUrl", sourceUrl);
        trackUrl = addHandoff(
          new URL(
            "/api/admin/market-intel/instacomp/resolve",
            window.location.origin,
          ),
          handoff,
        );
        trackUrl.searchParams.set("sourceUrl", sourceUrl);
      }

      root.dataset.universalInstacompEnhanced = "1";
      enhanced.add(root);
      const dark = Boolean(root.closest(".text-white"));
      const controls = createControls({
        compUrl: `${compUrl.pathname}${compUrl.search}${compUrl.hash}`,
        trackUrl: `${trackUrl.pathname}${trackUrl.search}`,
        dark,
        onTracked: () => router.refresh(),
      });

      if (root === anchor || anchor.parentElement === root) {
        anchor.insertAdjacentElement("afterend", controls.wrapper);
      } else {
        root.appendChild(controls.wrapper);
      }

      cleanups.push(() => {
        controls.cleanup();
        controls.wrapper.remove();
        delete root.dataset.universalInstacompEnhanced;
      });
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [pathname, router, searchParams]);

  return null;
}
