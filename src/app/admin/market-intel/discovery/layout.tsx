import { getIdentityDiscoveryWorkbench } from "../../../../lib/market-intel-identity-candidates";
import ShippingBreakdownPortals from "./ShippingBreakdownPortals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function IdentityDiscoveryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let candidates: Array<{
    id: string;
    askingPrice: number;
    shippingPrice: number;
  }> = [];

  try {
    const workbench = await getIdentityDiscoveryWorkbench();
    candidates = workbench.pending.map((candidate) => ({
      id: candidate.id,
      askingPrice: candidate.asking_price,
      shippingPrice: candidate.shipping_price,
    }));
  } catch {
    // The page itself displays the migration/runtime error when discovery data is unavailable.
  }

  return (
    <>
      <ShippingBreakdownPortals candidates={candidates} />
      {children}
    </>
  );
}
