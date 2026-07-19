import type { ReactNode } from "react";
import HotPlayersHomepageEnhancer from "./components/HotPlayersHomepageEnhancer";
import StorefrontFixEnhancer from "./components/StorefrontFixEnhancer";

export default function StorefrontTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {/* Keep independent storefront layers stacked so each release remains reversible. */}
      <StorefrontFixEnhancer />
      <HotPlayersHomepageEnhancer />
    </>
  );
}
