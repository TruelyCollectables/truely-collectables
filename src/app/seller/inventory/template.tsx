"use client";

import type { ReactNode } from "react";
import SellerInventoryVisualTracker from "./SellerInventoryVisualTracker";

export default function SellerInventoryTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      <SellerInventoryVisualTracker />
      {children}
    </>
  );
}
