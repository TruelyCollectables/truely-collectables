"use client";

import { useEffect, useState } from "react";
import type { SuccessTheme } from "./theme";

const SAYINGS = [
  "Welcome to the family.",
  "This one just found its next chapter.",
  "Your collection just got stronger.",
  "Claimed, protected, and headed your way.",
  "That piece is coming home.",
  "Another story belongs in your collection now.",
  "Built for the shelf, the slab box, or the brag session.",
  "You did not just buy a thing. You added a memory.",
  "This is the good kind of mail day waiting to happen.",
  "Your collector instincts were working today.",
];

export default function SuccessCelebration({
  productTitle,
  theme,
}: {
  productTitle?: string | null;
  theme: SuccessTheme;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const nextIndex = Math.floor(Math.random() * SAYINGS.length);
    setIndex(nextIndex);

    const interval = window.setInterval(() => {
      setIndex((currentIndex) => (currentIndex + 1) % SAYINGS.length);
    }, 4500);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      className="rounded border px-5 py-4 text-center"
      style={{
        background: `linear-gradient(135deg, ${theme.accent}, ${theme.secondary})`,
        borderColor: theme.accent,
        color: theme.textOnAccent,
      }}
    >
      <p className="text-sm font-bold uppercase">
        Collector moment
      </p>
      <p className="mt-2 min-h-16 text-3xl font-black leading-tight md:text-5xl">
        {SAYINGS[index]}
      </p>
      {productTitle ? (
        <p className="mx-auto mt-3 max-w-2xl text-sm font-bold">
          {productTitle}
        </p>
      ) : null}
    </div>
  );
}
