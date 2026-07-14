import {
  UNDER_20_SELLER_PROTECTION_PROVIDER,
  UNDER_20_SELLER_PROTECTION_RATE,
  UNDER_20_SELLER_PROTECTION_MAX_COVERAGE,
} from "./shipping";

export type Under20SellerProtectionLedgerRow = {
  id?: string | null;
  seller_account_id?: string | null;
  gross_item_amount?: number | string | null;
  shipping_allocated_amount?: number | string | null;
  metadata?: Record<string, unknown> | null;
};

export type Under20SellerProtectionClaimSummary = {
  program: string;
  appliesToMethod: "STANDARD_ENVELOPE";
  sellerOptedIn: boolean;
  eligible: boolean;
  reserveRate: number;
  maxCoverage: number;
  protectedLedgerEntryIds: string[];
  unprotectedLedgerEntryIds: string[];
  protectedItemAmount: number;
  reimbursableItemAmount: number;
  shippingExcludedAmount: number;
  reimbursesShipping: false;
  coverageBasis: "item_sale_amount_excluding_shipping";
  sellerRefundResponsibility: string;
  reimbursementRule: string;
};

export type Under20SellerProtectionReimbursementRow =
  Under20SellerProtectionLedgerRow & {
    id: string;
    order_item_id?: number | null;
    seller_account_id?: string | null;
  };

export type Under20SellerProtectionReimbursementAllocation = {
  rowId: string;
  orderItemId: number | null;
  sellerAccountId: string;
  amount: number;
  shippingExcludedAmount: number;
  coveredAmount: number;
};

export type Under20SellerProtectionReimbursementPlan = {
  requestedReimbursableAmount: number;
  reimbursedAmount: number;
  remainingAmount: number;
  allocations: Under20SellerProtectionReimbursementAllocation[];
  skippedRowIds: string[];
};

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function under20ProtectionFromMetadata(metadata: unknown) {
  return metadataRecord(metadataRecord(metadata).under_20_seller_protection);
}

export function buildUnder20SellerProtectionClaimSummary(
  rows: Under20SellerProtectionLedgerRow[],
): Under20SellerProtectionClaimSummary {
  let protectedItemAmount = 0;
  let shippingExcludedAmount = 0;
  const protectedLedgerEntryIds: string[] = [];
  const unprotectedLedgerEntryIds: string[] = [];

  for (const row of rows) {
    const protection = under20ProtectionFromMetadata(row.metadata);
    const eligible = protection.eligible === true;
    const coveredAmount = moneyNumber(protection.coveredAmount);

    if (eligible && coveredAmount > 0) {
      protectedLedgerEntryIds.push(String(row.id || "unknown"));
      protectedItemAmount += coveredAmount;
      shippingExcludedAmount += moneyNumber(row.shipping_allocated_amount);
    } else {
      unprotectedLedgerEntryIds.push(String(row.id || "unknown"));
    }
  }

  const reimbursableItemAmount = Math.min(
    moneyNumber(protectedItemAmount),
    UNDER_20_SELLER_PROTECTION_MAX_COVERAGE,
  );
  const eligible = reimbursableItemAmount > 0;

  return {
    program: UNDER_20_SELLER_PROTECTION_PROVIDER,
    appliesToMethod: "STANDARD_ENVELOPE",
    sellerOptedIn: protectedLedgerEntryIds.length > 0,
    eligible,
    reserveRate: UNDER_20_SELLER_PROTECTION_RATE,
    maxCoverage: UNDER_20_SELLER_PROTECTION_MAX_COVERAGE,
    protectedLedgerEntryIds,
    unprotectedLedgerEntryIds,
    protectedItemAmount: moneyNumber(protectedItemAmount),
    reimbursableItemAmount,
    shippingExcludedAmount: moneyNumber(shippingExcludedAmount),
    reimbursesShipping: false,
    coverageBasis: "item_sale_amount_excluding_shipping",
    sellerRefundResponsibility: eligible
      ? "Seller must refund the buyer through the order workflow; TCOS reimburses the seller for protected item sale amount only, up to $20. Shipping is excluded."
      : "Seller did not opt into TCOS Under-$20 Seller Protection for this shipment, so seller is responsible for the buyer refund and TCOS reimbursement is $0.",
    reimbursementRule:
      "Under-$20 Standard Envelope seller protection reimburses protected item sale amount only after a buyer refund is required by TCOS delivery-evidence rules. Shipping is not reimbursed.",
  };
}

export function buildUnder20SellerProtectionReimbursementPlan({
  rows,
  reimbursableAmount,
}: {
  rows: Under20SellerProtectionReimbursementRow[];
  reimbursableAmount: number | string | null | undefined;
}): Under20SellerProtectionReimbursementPlan {
  let remaining = Math.min(
    moneyNumber(reimbursableAmount),
    UNDER_20_SELLER_PROTECTION_MAX_COVERAGE,
  );
  let reimbursedAmount = 0;
  const allocations: Under20SellerProtectionReimbursementAllocation[] = [];
  const skippedRowIds: string[] = [];

  for (const row of rows) {
    if (remaining <= 0) {
      skippedRowIds.push(row.id);
      continue;
    }

    const protection = under20ProtectionFromMetadata(row.metadata);
    const coveredAmount = moneyNumber(protection.coveredAmount);
    const amount = Math.min(coveredAmount, remaining);

    if (amount <= 0 || !row.seller_account_id) {
      skippedRowIds.push(row.id);
      continue;
    }

    allocations.push({
      rowId: row.id,
      orderItemId: row.order_item_id ?? null,
      sellerAccountId: row.seller_account_id,
      amount,
      shippingExcludedAmount: moneyNumber(row.shipping_allocated_amount),
      coveredAmount,
    });
    reimbursedAmount += amount;
    remaining = moneyNumber(remaining - amount);
  }

  return {
    requestedReimbursableAmount: moneyNumber(reimbursableAmount),
    reimbursedAmount: moneyNumber(reimbursedAmount),
    remainingAmount: moneyNumber(remaining),
    allocations,
    skippedRowIds,
  };
}
