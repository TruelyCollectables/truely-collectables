"use client";

import { useEffect } from "react";

const QUEUE_DIRTY_KEY = "tcos-discovery-queue-dirty";

function resolvingArticle(form: HTMLFormElement) {
  const article = form.closest<HTMLElement>('article[id^="candidate-"]');
  if (!article) return;
  article.style.transition = "opacity 180ms ease, transform 180ms ease";
  article.style.opacity = "0.35";
  article.style.transform = "translateX(18px)";
  article.style.pointerEvents = "none";
  article.setAttribute("aria-busy", "true");
}

function removeResolvedHistory() {
  const approvedHeading = Array.from(document.querySelectorAll("h2")).find(
    (heading) => heading.textContent?.trim() === "Recently Approved",
  );
  const approvedSection = approvedHeading?.closest("section");
  if (approvedSection instanceof HTMLElement) approvedSection.remove();
}

export function markDiscoveryQueueDirty() {
  try {
    window.sessionStorage.setItem(QUEUE_DIRTY_KEY, "1");
  } catch {
    // Session storage can be unavailable in locked-down browser modes.
  }
}

export function markCandidateResolving(form: HTMLFormElement) {
  markDiscoveryQueueDirty();
  resolvingArticle(form);
}

export default function ResolvedCandidateCleanup() {
  useEffect(() => {
    removeResolvedHistory();
    const observer = new MutationObserver(removeResolvedHistory);
    observer.observe(document.body, { childList: true, subtree: true });

    const submitListener = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const action = form.action || "";
      if (
        action.includes("/approve") ||
        action.includes("/reject") ||
        action.includes("/purchase")
      ) {
        markCandidateResolving(form);
      }
    };
    document.addEventListener("submit", submitListener, true);

    const refreshIfStale = (event?: PageTransitionEvent) => {
      let dirty = false;
      try {
        dirty = window.sessionStorage.getItem(QUEUE_DIRTY_KEY) === "1";
      } catch {
        dirty = false;
      }
      if (!dirty && !event?.persisted) return;
      try {
        window.sessionStorage.removeItem(QUEUE_DIRTY_KEY);
      } catch {
        // Ignore storage cleanup failures.
      }
      window.location.reload();
    };

    const pageShowListener = (event: PageTransitionEvent) => refreshIfStale(event);
    window.addEventListener("pageshow", pageShowListener);

    return () => {
      observer.disconnect();
      document.removeEventListener("submit", submitListener, true);
      window.removeEventListener("pageshow", pageShowListener);
    };
  }, []);

  return null;
}
