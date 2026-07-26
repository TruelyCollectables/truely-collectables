import type { ReactNode } from "react";
import PublicProductCleanup from "./PublicProductCleanup";

export default function ProductDetailLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicProductCleanup />
      {children}
    </>
  );
}
