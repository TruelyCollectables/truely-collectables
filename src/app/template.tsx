import type { ReactNode } from "react";
import HotPlayersHomepageEnhancer from "./components/HotPlayersHomepageEnhancer";
import StorefrontFixEnhancer from "./components/StorefrontFixEnhancer";

export default function StorefrontTemplate({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <StorefrontFixEnhancer />
      <HotPlayersHomepageEnhancer />
    </>
  );
}
