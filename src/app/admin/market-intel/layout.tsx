import MetricDrilldownEnhancer from "./MetricDrilldownEnhancer";

export default function MarketIntelLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <MetricDrilldownEnhancer />
      {children}
    </>
  );
}
