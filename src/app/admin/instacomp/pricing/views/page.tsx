import PricingWorkbench from "../_components/pricing-workbench";

// Shared PricingWorkbench navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingViewsPage() {
  return <PricingWorkbench mode="views" eyebrow="Reusable Workflows" title="Saved Pricing Views" description="See active and default operating views, reuse common receipt filters, and move directly into the immutable receipt workspace." />;
}
