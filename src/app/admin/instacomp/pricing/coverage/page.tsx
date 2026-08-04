import PrivatePricingCoverage from "../_components/private-pricing-coverage";

// Shared PrivatePricingCoverage admin navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivatePricingCoveragePage() {
  return <PrivatePricingCoverage />;
}
