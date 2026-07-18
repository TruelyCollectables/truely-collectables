import { getIdentityDiscoveryWorkbench } from "../../../../lib/market-intel-identity-candidates";
import BulkCandidateControls from "./BulkCandidateControls";
import ShippingBreakdownPortals from "./ShippingBreakdownPortals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function approvalReadiness(candidate: {
  detected_year: string | null;
  detected_manufacturer: string | null;
  detected_product_line: string | null;
  detected_card_number: string | null;
  detected_parallel_name: string | null;
  detected_insert_name: string | null;
  detected_variation_name: string | null;
  serial_numbered_to: number | null;
  autograph: boolean;
  memorabilia: boolean;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
}) {
  const missing: string[] = [];
  if (!candidate.detected_year?.trim()) missing.push("year");
  if (!candidate.detected_manufacturer?.trim()) missing.push("manufacturer");
  if (!candidate.detected_product_line?.trim()) missing.push("product line");
  if (!candidate.detected_card_number?.trim()) missing.push("exact card number");

  const parallel = String(candidate.detected_parallel_name || "")
    .trim()
    .toLowerCase();
  const hasNonBaseSignal = Boolean(
    (parallel && !["base", "base card", "regular", "standard"].includes(parallel)) ||
      candidate.detected_insert_name?.trim() ||
      candidate.detected_variation_name?.trim() ||
      candidate.serial_numbered_to ||
      candidate.autograph ||
      candidate.memorabilia,
  );
  if (!hasNonBaseSignal) missing.push("non-base identity");

  if (candidate.condition_type === "graded") {
    if (!candidate.grading_company?.trim()) missing.push("grading company");
    if (!candidate.grade?.trim()) missing.push("grade");
  }

  return { ready: missing.length === 0, missing };
}

export default async function IdentityDiscoveryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let candidates: Array<{
    id: string;
    player: string;
    askingPrice: number;
    shippingPrice: number;
    ready: boolean;
    missing: string[];
  }> = [];

  try {
    const workbench = await getIdentityDiscoveryWorkbench();
    candidates = workbench.pending.map((candidate) => {
      const readiness = approvalReadiness(candidate);
      return {
        id: candidate.id,
        player: candidate.subject.name,
        askingPrice: candidate.asking_price,
        shippingPrice: candidate.shipping_price,
        ready: readiness.ready,
        missing: readiness.missing,
      };
    });
  } catch {
    // The page itself displays the migration/runtime error when discovery data is unavailable.
  }

  return (
    <>
      <ShippingBreakdownPortals
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          askingPrice: candidate.askingPrice,
          shippingPrice: candidate.shippingPrice,
        }))}
      />
      <BulkCandidateControls
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          player: candidate.player,
          ready: candidate.ready,
          missing: candidate.missing,
        }))}
      />
      {children}
    </>
  );
}
