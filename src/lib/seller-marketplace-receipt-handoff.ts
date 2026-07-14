export type SellerMarketplaceReceiptHandoffContract = ReturnType<
  typeof buildSellerMarketplaceReceiptHandoffContract
>;

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_TITLE =
  "Seller Marketplace Receipt Handoff";

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_ROUTE = "/seller/marketplaces";

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_PROOF_TEXT =
  "Seller marketplace receipt handoff proof text";

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_CONTROLS = [
  "Copy Safe Receipt",
  "Download Safe Receipt",
  "Copy Trail",
  "Download Trail",
  "Clear Trail",
] as const;

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_OPERATIONS = [
  "auth",
  "import",
  "staging",
  "reconcile",
  "order-import",
  "promotion",
] as const;

export const SELLER_MARKETPLACE_RECEIPT_HANDOFF_SAFE_USE_BOUNDARY =
  "Treat the receipt trail as a safe operator handoff aid, not an audit ledger, payment record, fulfillment proof, or provider reconciliation source of truth.";

export function buildSellerMarketplaceReceiptHandoffContract(
  origin: string | null = null,
) {
  return {
    title: SELLER_MARKETPLACE_RECEIPT_HANDOFF_TITLE,
    status: "ready",
    route: SELLER_MARKETPLACE_RECEIPT_HANDOFF_ROUTE,
    url: absoluteLaunchUrl(origin, SELLER_MARKETPLACE_RECEIPT_HANDOFF_ROUTE),
    proofText: SELLER_MARKETPLACE_RECEIPT_HANDOFF_PROOF_TEXT,
    controls: [...SELLER_MARKETPLACE_RECEIPT_HANDOFF_CONTROLS],
    operations: [...SELLER_MARKETPLACE_RECEIPT_HANDOFF_OPERATIONS],
    safeUseBoundary: SELLER_MARKETPLACE_RECEIPT_HANDOFF_SAFE_USE_BOUNDARY,
    operatorAction:
      "Confirm the seller marketplace page shows the proof text and all receipt controls before operators rely on copied or downloaded marketplace API receipt handoffs.",
  };
}

export function sellerMarketplaceReceiptHandoffMarkdownLines(
  handoff: SellerMarketplaceReceiptHandoffContract,
) {
  return [
    `## ${handoff.title}`,
    "",
    `- Status: ${handoff.status}`,
    `- Route: ${handoff.url || handoff.route}`,
    `- Proof text: ${handoff.proofText}`,
    `- Controls: ${handoff.controls.join(", ")}`,
    `- Operations: ${handoff.operations.join(", ")}`,
    `- Safe-use boundary: ${handoff.safeUseBoundary}`,
    `- Operator action: ${handoff.operatorAction}`,
  ];
}

function absoluteLaunchUrl(origin: string | null, href: string) {
  if (!origin) return undefined;

  try {
    return new URL(href, origin).toString();
  } catch {
    return undefined;
  }
}
