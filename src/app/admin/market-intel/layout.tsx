import { Suspense } from "react";
import DiscoveryLiveBulkController from "./DiscoveryLiveBulkController";
import DiscoveryReviewEnhancer from "./DiscoveryReviewEnhancer";
import MarketIntelDrilldownController from "./MarketIntelDrilldownController";
import MarketIntelInteractionAuditEnhancer from "./MarketIntelInteractionAuditEnhancer";
import UniversalInstaCompEnhancer from "./UniversalInstaCompEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <MarketIntelDrilldownController />
        <MarketIntelInteractionAuditEnhancer />
        <UniversalInstaCompEnhancer />
        <DiscoveryReviewEnhancer />
        <DiscoveryLiveBulkController />
      </Suspense>
      {children}
    </>
  );
}
