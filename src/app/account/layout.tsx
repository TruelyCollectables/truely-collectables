import type { ReactNode } from "react";
import AccountSessionBoundary from "./AccountSessionBoundary";

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountSessionBoundary>{children}</AccountSessionBoundary>;
}
