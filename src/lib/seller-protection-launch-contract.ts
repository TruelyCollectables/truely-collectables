export type SellerProtectionLaunchContract = ReturnType<
  typeof buildSellerProtectionLaunchContract
>;

export const SELLER_PROTECTION_LAUNCH_LINKS = {
  launchReadinessHref: "/admin/launch-readiness#database-readiness",
  reconciliationHref: "/admin/financial-reconciliation",
  claimOpsHref: "/admin/shipping",
} as const;

export const SELLER_PROTECTION_SMOKE_COVERAGE_LINE =
  "Under-$20 Seller Protection launch handoff with internal-only model, 2% reserve, $20 item cap, shipping exclusion, LetterTrack/USPS IMb evidence rule, and reimbursement ledger path";

export function buildSellerProtectionLaunchContract(
  origin: string | null = null,
) {
  return {
    program: "TCOS Under-$20 Seller Protection",
    coverageModel:
      "Optional TCOS internal Standard Envelope seller protection; it is not third-party insurance.",
    reserveRate: "2% of the protected sale withheld from the seller payout row",
    itemReimbursementCap: "$20.00 protected item amount cap",
    reimbursementScope:
      "Protected item sale amount only; shipping is excluded and is not reimbursed.",
    deliveryEvidenceRule:
      "LetterTrack/USPS IMb evidence must not show delivered before TCOS reimburses an opted-in seller; delivered evidence blocks payout unless an operator saves an explicit override.",
    reimbursementEntryType: "seller_protection_reimbursement",
    financialAdjustmentTable: "financial_adjustment_ledger_entries",
    migration: "20260712174000_add_seller_protection_financial_adjustments.sql",
    ...SELLER_PROTECTION_LAUNCH_LINKS,
    launchReadinessUrl: absoluteLaunchUrl(
      origin,
      SELLER_PROTECTION_LAUNCH_LINKS.launchReadinessHref,
    ),
    reconciliationUrl: absoluteLaunchUrl(
      origin,
      SELLER_PROTECTION_LAUNCH_LINKS.reconciliationHref,
    ),
    claimOpsUrl: absoluteLaunchUrl(
      origin,
      SELLER_PROTECTION_LAUNCH_LINKS.claimOpsHref,
    ),
  };
}

export function sellerProtectionLaunchMarkdownLines(
  sellerProtection: SellerProtectionLaunchContract,
) {
  return [
    "## Under-$20 Seller Protection",
    "",
    `- Program: ${sellerProtection.program}`,
    `- Coverage model: ${sellerProtection.coverageModel}`,
    `- Seller reserve: ${sellerProtection.reserveRate}`,
    `- Item reimbursement cap: ${sellerProtection.itemReimbursementCap}`,
    `- Reimbursement scope: ${sellerProtection.reimbursementScope}`,
    `- Delivery evidence rule: ${sellerProtection.deliveryEvidenceRule}`,
    `- Ledger entry type: ${sellerProtection.reimbursementEntryType}`,
    `- Ledger table: ${sellerProtection.financialAdjustmentTable}`,
    `- Required migration: ${sellerProtection.migration}`,
    `- Launch readiness: ${sellerProtection.launchReadinessUrl || sellerProtection.launchReadinessHref}`,
    `- Reconciliation: ${sellerProtection.reconciliationUrl || sellerProtection.reconciliationHref}`,
    `- Claims ops: ${sellerProtection.claimOpsUrl || sellerProtection.claimOpsHref}`,
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
