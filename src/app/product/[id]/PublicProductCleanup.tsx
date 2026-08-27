"use client";

import { useEffect } from "react";

function removeInternalMarketplaceFacts(root: ParentNode) {
  for (const term of Array.from(root.querySelectorAll("dt"))) {
    if (term.textContent?.trim().toLowerCase() !== "ebay") continue;
    const fact = term.parentElement;
    if (fact) fact.remove();
  }
}

export default function PublicProductCleanup() {
  useEffect(() => {
    removeInternalMarketplaceFacts(document);

    const observer = new MutationObserver(() => {
      removeInternalMarketplaceFacts(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
