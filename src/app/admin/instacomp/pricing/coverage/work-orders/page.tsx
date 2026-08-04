import PrivatePricingWorkOrders from "../../_components/private-pricing-work-orders";

// Shared PrivatePricingWorkOrders admin navigation: "/admin/instacomp/pricing/coverage"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivatePricingWorkOrdersPage() {
  return <PrivatePricingWorkOrders />;
}
