import { Suspense } from "react";
import DiscoveryLiveBulkController from "./DiscoveryLiveBulkController";
import DiscoveryReviewEnhancer from "./DiscoveryReviewEnhancer";
import EbayPurchaseCompSyncEnhancer from "./EbayPurchaseCompSyncEnhancer";
import MarketIntelDrilldownController from "./MarketIntelDrilldownController";
import MarketIntelRecordController from "./MarketIntelRecordController";
import UniversalInstaCompEnhancer from "./UniversalInstaCompEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <MarketIntelDrilldownController />
        <MarketIntelRecordController />
        <UniversalInstaCompEnhancer />
        <EbayPurchaseCompSyncEnhancer />
        <DiscoveryReviewEnhancer />
        <DiscoveryLiveBulkController />
      </Suspense>
      {children}
    </>
  );
}
