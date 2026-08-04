import PrivatePricingWorkOrderActivity from "../../_components/private-pricing-work-order-activity";
import PrivatePricingWorkOrderExecution from "../../_components/private-pricing-work-order-execution";
import PrivatePricingWorkOrderReviews from "../../_components/private-pricing-work-order-reviews";
import PrivatePricingWorkOrders from "../../_components/private-pricing-work-orders";

// Shared PrivatePricingWorkOrders admin navigation: "/admin/instacomp/pricing/coverage"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivatePricingWorkOrdersPage() {
  return (
    <>
      <PrivatePricingWorkOrderExecution />
      <PrivatePricingWorkOrderActivity />
      <PrivatePricingWorkOrders />
      <PrivatePricingWorkOrderReviews />
    </>
  );
}
