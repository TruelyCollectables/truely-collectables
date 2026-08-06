"use client";

import { useEffect } from "react";

function applyAutomaticImagePolicy() {
  const headings = Array.from(document.querySelectorAll("h3"));
  for (const heading of headings) {
    if (heading.textContent?.trim() !== "Card images") continue;
    const section = heading.closest("section");
    if (!section) continue;

    const description = section.querySelector("p");
    if (description) {
      description.textContent =
        "Front and back are oriented automatically from printed card text during scan and saved before KINGMAKER review.";
    }

    for (const button of Array.from(section.querySelectorAll("button"))) {
      const label = button.textContent?.replace(/\s+/g, " ").trim() || "";
      if (
        label.includes("Rotate left") ||
        label.includes("Rotate right") ||
        label.includes("Swap front / back")
      ) {
        button.remove();
      }
    }
  }
}

export default function AutomaticImagePolicy() {
  useEffect(() => {
    applyAutomaticImagePolicy();
    const observer = new MutationObserver(applyAutomaticImagePolicy);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
