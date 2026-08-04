import PricingWorkbench from "../_components/pricing-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingReviewPage() {
  return <PricingWorkbench mode="review" eyebrow="Review Operations" title="Pricing Exception Queue" description="Concentrate operator attention on review-required and insufficient-evidence decisions before any advisory result is trusted, exported, or acted on separately." />;
}
