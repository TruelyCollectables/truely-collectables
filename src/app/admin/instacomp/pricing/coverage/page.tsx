import Link from "next/link";
import PrivatePricingCoverage from "../_components/private-pricing-coverage";

// Shared PrivatePricingCoverage admin navigation: "/admin/instacomp/pricing"

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function PrivatePricingCoveragePage() {
  return (
    <>
      <Link
        href="/admin/instacomp/pricing/coverage/work-orders"
        className="fixed bottom-5 right-5 z-50 rounded-full border border-emerald-200 bg-emerald-300 px-5 py-3 text-sm font-black text-black shadow-xl transition hover:bg-emerald-200"
      >
        Open Coverage Work Orders
      </Link>
      <PrivatePricingCoverage />
    </>
  );
}
