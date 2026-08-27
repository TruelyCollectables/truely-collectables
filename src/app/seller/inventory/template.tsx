"use client";

import type { ReactNode } from "react";
import SellerActiveInventoryPricing from "./SellerActiveInventoryPricing";
import SellerInventoryActiveOnlyGuard from "./SellerInventoryActiveOnlyGuard";

export default function SellerInventoryTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="border-b-2 border-neutral-950 bg-violet-100 px-4 py-3 text-neutral-950 sm:px-6">
        <p className="mx-auto max-w-7xl text-sm font-black leading-6">
          Active inventory only: sold cards stay hidden here but remain stored as
          InstaComp™ sold-history evidence. Autograph, patch, relic, jersey-swatch,
          RPA, and game-used trading cards remain Trading Cards.
        </p>
      </div>

      <SellerActiveInventoryPricing />

      <details className="border-b-4 border-neutral-950 bg-neutral-100">
        <summary className="mx-auto max-w-7xl cursor-pointer px-4 py-4 text-sm font-black uppercase tracking-[0.14em] sm:px-6">
          Open advanced active-inventory editor
        </summary>
        <div data-seller-advanced-inventory>
          <SellerInventoryActiveOnlyGuard />
          {children}
        </div>
      </details>
    </>
  );
}
