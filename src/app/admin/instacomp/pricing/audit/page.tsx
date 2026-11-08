import PricingWorkbench from "../_components/pricing-workbench";

// Shared PricingWorkbench navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingAuditPage() {
  return <PricingWorkbench mode="audit" eyebrow="Audit Trail" title="Pricing Profile Activity" description="Review the newest immutable profile create, update, clone, default, and retirement events without exposing internal ownership or provider details." />;
}
