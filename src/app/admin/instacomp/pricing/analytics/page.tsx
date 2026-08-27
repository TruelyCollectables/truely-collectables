import PricingWorkbench from "../_components/pricing-workbench";

// Shared PricingWorkbench navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingAnalyticsPage() {
  return <PricingWorkbench mode="analytics" eyebrow="Operating Metrics" title="Pricing Analytics" description="Track ready rate, review pressure, confidence, sold-comp depth, and estimated profit across the bounded owner-scoped decision window." />;
}
