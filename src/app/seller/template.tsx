"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import SellerOneSpotListingCenter from "./SellerOneSpotListingCenter";

export default function SellerTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <>
      {children}
      {pathname === "/seller" ? <SellerOneSpotListingCenter /> : null}
    </>
  );
}
