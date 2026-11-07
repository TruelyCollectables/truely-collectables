import InstaCompAdminFrame from "../InstaCompAdminFrame";
import SellerSweepClient from "./SellerSweepClient";

export const dynamic = "force-dynamic";

export default function SellerSweepPage() {
  return (
    <InstaCompAdminFrame
      eyebrow="Bulk buying intelligence"
      title="InstaComp™ Seller Sweep"
      description="Paste an eBay seller or store URL. Seller Sweep collects the active listings, isolates card lots, stages every listing photo for identification, and ranks the opportunities by value, profit, and ROI."
    >
      <SellerSweepClient />
    </InstaCompAdminFrame>
  );
}
