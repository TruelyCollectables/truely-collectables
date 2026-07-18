import { enforceBaseballPremiumPolicy } from "../../../../lib/market-intel-baseball-premium-enforcement";
import { getIdentityDiscoveryWorkbench } from "../../../../lib/market-intel-identity-candidates";
import { repairPendingDiscoveryParsing } from "../../../../lib/market-intel-discovery-repair";
import BulkCandidateControls from "./BulkCandidateControls";
import PurchaseCandidateControls from "./PurchaseCandidateControls";
import ResolvedCandidateCleanup from "./ResolvedCandidateCleanup";
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
  if (!hasNonBaseSignal) missing.push("premium non-base identity");

  if (candidate.condition_type === "graded") {
    if (!candidate.grading_company?.trim()) missing.push("grading company");
    if (!candidate.grade?.trim()) missing.push("grade");
  }

  return { ready: missing.length === 0, missing };
}

function kempPurchaseDraft(title: string) {
  const normalized = title.toLowerCase();
  return normalized.includes("kemp alderman") && normalized.includes("b24-ka")
    ? { cost: 7.31, date: "2026-07-17" }
    : null;
}

export default async function IdentityDiscoveryLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let candidates: Array<{
    id: string;
    player: string;
    title: string;
    askingPrice: number;
    shippingPrice: number;
    deliveredPrice: number;
    ready: boolean;
    missing: string[];
    purchaseCost: number;
    purchaseDate: string;
  }> = [];

  try {
    await repairPendingDiscoveryParsing();
    await enforceBaseballPremiumPolicy();
    const workbench = await getIdentityDiscoveryWorkbench();
    const today = new Date().toISOString().slice(0, 10);
    candidates = workbench.pending.map((candidate) => {
      const readiness = approvalReadiness(candidate);
      const draft = kempPurchaseDraft(candidate.original_title);
      return {
        id: candidate.id,
        player: candidate.subject.name,
        title: candidate.original_title,
        askingPrice: candidate.asking_price,
        shippingPrice: candidate.shipping_price,
        deliveredPrice: candidate.delivered_price,
        ready: readiness.ready,
        missing: readiness.missing,
        purchaseCost: draft?.cost ?? candidate.delivered_price,
        purchaseDate: draft?.date ?? today,
      };
    });
  } catch {
    // The page itself displays the migration/runtime error when discovery data is unavailable.
  }

  return (
    <>
      <ResolvedCandidateCleanup />
      <ShippingBreakdownPortals
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          askingPrice: candidate.askingPrice,
          shippingPrice: candidate.shippingPrice,
        }))}
      />
      <PurchaseCandidateControls
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          defaultCost: candidate.purchaseCost,
          defaultPurchaseDate: candidate.purchaseDate,
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
