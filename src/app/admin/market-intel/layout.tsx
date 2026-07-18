import { Suspense } from "react";
import DiscoveryLiveBulkController from "./DiscoveryLiveBulkController";
import DiscoveryReviewEnhancer from "./DiscoveryReviewEnhancer";
import MetricDrilldownEnhancer from "./MetricDrilldownEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <MetricDrilldownEnhancer />
        <DiscoveryReviewEnhancer />
        <DiscoveryLiveBulkController />
      </Suspense>
      {children}
    </>
  );
}
