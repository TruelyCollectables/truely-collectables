import { Suspense } from "react";
import DiscoveryLiveBulkController from "./DiscoveryLiveBulkController";
import DiscoveryReviewEnhancer from "./DiscoveryReviewEnhancer";
import MarketIntelInteractionAuditEnhancer from "./MarketIntelInteractionAuditEnhancer";
import MetricDrilldownEnhancer from "./MetricDrilldownEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <MetricDrilldownEnhancer />
        <MarketIntelInteractionAuditEnhancer />
        <DiscoveryReviewEnhancer />
        <DiscoveryLiveBulkController />
      </Suspense>
      {children}
    </>
  );
}
