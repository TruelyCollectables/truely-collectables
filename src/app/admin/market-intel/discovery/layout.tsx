import { enforceBaseballPremiumPolicy } from "../../../../lib/market-intel-baseball-premium-enforcement";
import { getIdentityDiscoveryWorkbench } from "../../../../lib/market-intel-identity-candidates";
import { repairPendingDiscoveryParsing } from "../../../../lib/market-intel-discovery-repair";
import BulkCandidateControls from "./BulkCandidateControls";
import PurchaseCandidateControls from "./PurchaseCandidateControls";
import ResolvedCandidateCleanup from "./ResolvedCandidateCleanup";
import SelectedPurchaseControls from "./SelectedPurchaseControls";
import ShippingBreakdownPortals from "./ShippingBreakdownPortals";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_COLORADO_TAX_RATE = 0.08;

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

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
    quantity: number;
    ready: boolean;
    missing: string[];
    defaultTax: number;
    purchaseDate: string;
    approval: {
      seasonYear: string;
      manufacturer: string;
      brand: string;
      productLine: string;
      setName: string;
      insertName: string;
      cardNumber: string;
      parallelName: string;
      variationName: string;
      serialNumberedTo: number | null;
      autograph: boolean;
      memorabilia: boolean;
      rookieDesignation: boolean;
      conditionType: "raw" | "graded";
      gradingCompany: string;
      grade: string;
      quantity: number;
    };
  }> = [];

  try {
    await repairPendingDiscoveryParsing();
    await enforceBaseballPremiumPolicy();
    const workbench = await getIdentityDiscoveryWorkbench();
    const today = new Date().toISOString().slice(0, 10);
    candidates = workbench.pending.map((candidate) => {
      const readiness = approvalReadiness(candidate);
      const draft = kempPurchaseDraft(candidate.original_title);
      const estimatedTax = roundMoney(
        (candidate.asking_price + candidate.shipping_price) * DEFAULT_COLORADO_TAX_RATE,
      );
      const defaultTax = draft
        ? roundMoney(
            Math.max(
              0,
              draft.cost - candidate.asking_price - candidate.shipping_price,
            ),
          )
        : estimatedTax;
      const conditionType: "raw" | "graded" =
        candidate.condition_type === "graded" ? "graded" : "raw";

      return {
        id: candidate.id,
        player: candidate.subject.name,
        title: candidate.original_title,
        askingPrice: candidate.asking_price,
        shippingPrice: candidate.shipping_price,
        quantity: candidate.quantity,
        ready: readiness.ready,
        missing: readiness.missing,
        defaultTax,
        purchaseDate: draft?.date ?? today,
        approval: {
          seasonYear: candidate.detected_year || "",
          manufacturer: candidate.detected_manufacturer || "",
          brand:
            candidate.detected_brand || candidate.detected_manufacturer || "",
          productLine: candidate.detected_product_line || "",
          setName:
            candidate.detected_set_name || candidate.detected_product_line || "",
          insertName: candidate.detected_insert_name || "",
          cardNumber: candidate.detected_card_number || "",
          parallelName: candidate.detected_parallel_name || "Base",
          variationName: candidate.detected_variation_name || "",
          serialNumberedTo: candidate.serial_numbered_to,
          autograph: candidate.autograph,
          memorabilia: candidate.memorabilia,
          rookieDesignation: candidate.rookie_designation,
          conditionType,
          gradingCompany: candidate.grading_company || "",
          grade: candidate.grade || "",
          quantity: candidate.quantity,
        },
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
          quantity: candidate.quantity,
          taxRate: DEFAULT_COLORADO_TAX_RATE,
        }))}
      />
      <PurchaseCandidateControls
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          title: candidate.title,
          defaultItemPrice: candidate.askingPrice,
          defaultShipping: candidate.shippingPrice,
          defaultTax: candidate.defaultTax,
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
      <SelectedPurchaseControls
        candidates={candidates.map((candidate) => ({
          id: candidate.id,
          player: candidate.player,
          title: candidate.title,
          ready: candidate.ready,
          missing: candidate.missing,
          itemPrice: candidate.askingPrice,
          shippingPrice: candidate.shippingPrice,
          defaultTax: candidate.defaultTax,
          purchaseDate: candidate.purchaseDate,
          approval: candidate.approval,
        }))}
      />
      {children}
    </>
  );
}
