import PricingWorkbench from "../_components/pricing-workbench";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PricingReceiptsPage() {
  return <PricingWorkbench mode="receipts" eyebrow="Decision History" title="Pricing Receipts" description="Inspect the latest immutable advisory decision window, separate ready decisions from exceptions, and move into comparison or export workflows without changing inventory." />;
}
