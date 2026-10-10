import type { Metadata } from "next";
import type { ReactNode } from "react";
import AccountSessionBoundary from "../account/AccountSessionBoundary";
import KingmakerShell from "./KingmakerShell";

export const metadata: Metadata = {
  title: "KINGMAKER | Truely Collectables",
  description:
    "Seller operations powered by InstaComp AI intelligence and Checklist Registry identity.",
};

export default function KingmakerLayout({ children }: { children: ReactNode }) {
  return (
    <AccountSessionBoundary>
      <KingmakerShell>{children}</KingmakerShell>
    </AccountSessionBoundary>
  );
}
