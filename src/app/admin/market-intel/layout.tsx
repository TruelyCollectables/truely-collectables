import { Suspense } from "react";
import MetricDrilldownEnhancer from "./MetricDrilldownEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Suspense fallback={null}>
        <MetricDrilldownEnhancer />
      </Suspense>
      {children}
    </>
  );
}
