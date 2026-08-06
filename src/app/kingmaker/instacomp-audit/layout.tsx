import type { ReactNode } from "react";
import AutomaticImagePolicy from "./automatic-image-policy";

export default function InstaCompAuditLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      <AutomaticImagePolicy />
      {children}
    </>
  );
}
