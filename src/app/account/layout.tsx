import type { ReactNode } from "react";
import AccountSellerAdminBar from "./AccountSellerAdminBar";
import AccountSessionBoundary from "./AccountSessionBoundary";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <AccountSessionBoundary>
      <AccountSellerAdminBar />
      {children}
    </AccountSessionBoundary>
  );
}
