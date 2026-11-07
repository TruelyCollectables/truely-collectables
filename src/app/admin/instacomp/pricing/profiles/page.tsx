import PricingWorkbench from "../_components/pricing-workbench";

// Shared PricingWorkbench navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingProfilesPage() {
  return <PricingWorkbench mode="profiles" eyebrow="Economics Control" title="Pricing Profiles" description="Confirm active and default profile readiness, open profile lifecycle controls, compare scenarios, and review the immutable configuration trail." />;
}
