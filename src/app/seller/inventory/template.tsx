"use client";

import type { ReactNode } from "react";
import SellerInventoryVisualTracker from "./SellerInventoryVisualTracker";

export default function SellerInventoryTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="border-b-2 border-neutral-950 bg-violet-100 px-4 py-3 text-neutral-950 sm:px-6">
        <p className="mx-auto max-w-7xl text-sm font-black leading-6">
          Trading-card rule: autograph cards, patch cards, relic cards, jersey-swatch
          cards, RPAs, and game-used cards stay in Trading Cards and use InstaComp™.
          Actual jerseys, pucks, bats, helmets, photos, albums, and other physical
          collectibles show “InstaComp™ for Other Collectibles — Coming Soon.”
        </p>
      </div>
      <SellerInventoryVisualTracker />
      {children}
    </>
  );
}
