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

export type Under20SellerProtectionBuyerRefundGate = {
  allowed: boolean;
  reason: string;
};

export type Under20SellerProtectionSellerVisibilitySummary = {
  program: string;
  reserveRate: number;
  maxCoverage: number;
  protectedRowCount: number;
  unprotectedRowCount: number;
  protectedItemAmount: number;
  reimbursableItemAmount: number;
  shippingExcludedAmount: number;
  reserveAmount: number;
  reimbursesShipping: false;
  status: "protected" | "unprotected" | "mixed" | "not_applicable";
  label: string;
  detail: string;
  sellerResponsibility: string;
};

function moneyNumber(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function hasBuyerRefundProofNote(value: unknown) {
  const note = normalized(value);

  return (
    note.length >= 20 &&
    (note.includes("refund") || note.includes("refunded")) &&
    (note.includes("buyer") ||
      note.includes("customer") ||
      note.includes("order") ||
      note.includes("stripe") ||
      note.includes("payment"))
  );
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function under20ProtectionFromMetadata(metadata: unknown) {
  return metadataRecord(metadataRecord(metadata).under_20_seller_protection);
}

function isEligibleUnder20SellerProtection(protection: Record<string, unknown>) {
  return (
    protection.eligible === true &&
    protection.provider === UNDER_20_SELLER_PROTECTION_PROVIDER &&
    protection.coverageBasis === "item_sale_amount_excluding_shipping" &&
    protection.reimbursesShipping === false
  );
}

export function buildUnder20SellerProtectionSellerVisibilitySummary(
  rows: Under20SellerProtectionLedgerRow[],
): Under20SellerProtectionSellerVisibilitySummary {
  const claim = buildUnder20SellerProtectionClaimSummary(rows);
  const reserveAmount = rows.reduce((sum, row) => {
    const metadata = metadataRecord(row.metadata);
    const directFee = moneyNumber(metadata.seller_protection_fee_amount);
    const protectionFee = moneyNumber(
      metadataRecord(metadata.under_20_seller_protection).feeAmount,
    );

    return sum + (directFee || protectionFee);
  }, 0);
  const protectedRowCount = claim.protectedLedgerEntryIds.length;
  const unprotectedRowCount = claim.unprotectedLedgerEntryIds.length;
  const status =
    protectedRowCount > 0 && unprotectedRowCount > 0
      ? "mixed"
      : protectedRowCount > 0
        ? "protected"
        : unprotectedRowCount > 0
          ? "unprotected"
          : "not_applicable";
  const label =
    status === "protected"
      ? "Protected"
      : status === "mixed"
        ? "Mixed protection"
        : status === "unprotected"
          ? "Seller liable"
          : "Not applicable";
  const detail =
    status === "protected"
      ? "This order has opted-in TCOS Under-$20 Seller Protection. TCOS withheld the 2% reserve and can reimburse protected item sale amount up to $20 after buyer refund proof and delivery-evidence rules are satisfied. Shipping is excluded."
      : status === "mixed"
        ? "This order has both protected and unprotected seller rows. TCOS reimbursement only applies to opted-in protected item sale amount up to $20; shipping and unprotected rows stay seller responsibility."
        : status === "unprotected"
          ? "Seller did not opt into TCOS Under-$20 Seller Protection for these Standard Envelope seller rows. If delivery cannot show delivered and the buyer must be refunded, seller is responsible for the refund."
          : "No under-$20 Standard Envelope seller-protection ledger rows are attached to this seller scope.";

  return {
    program: claim.program,
    reserveRate: claim.reserveRate,
    maxCoverage: claim.maxCoverage,
    protectedRowCount,
    unprotectedRowCount,
    protectedItemAmount: claim.protectedItemAmount,
    reimbursableItemAmount: claim.reimbursableItemAmount,
    shippingExcludedAmount: claim.shippingExcludedAmount,
    reserveAmount: moneyNumber(reserveAmount),
    reimbursesShipping: false,
    status,
    label,
    detail,
    sellerResponsibility: claim.sellerRefundResponsibility,
  };
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
    const eligible = isEligibleUnder20SellerProtection(protection);
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

export function evaluateUnder20SellerProtectionBuyerRefundGate(params: {
  note?: string | null;
}): Under20SellerProtectionBuyerRefundGate {
  if (hasBuyerRefundProofNote(params.note)) {
    return {
      allowed: true,
      reason:
        "Buyer refund evidence was confirmed in the internal note before TCOS seller-protection reimbursement.",
    };
  }

  return {
    allowed: false,
    reason:
      "Before Mark Paid, add an internal note confirming the buyer/customer refund evidence or refund reference. TCOS seller-protection reimbursement can only be recorded after buyer refund proof is documented.",
  };
}

export function evaluateUnder20SellerProtectionBuyerRefundMetadataGate(params: {
  metadata?: Record<string, unknown> | null;
  note?: string | null;
}): Under20SellerProtectionBuyerRefundGate {
  const metadata = metadataRecord(params.metadata);
  const latestBuyerRefundEvidence = metadataRecord(
    metadata.latest_seller_protection_buyer_refund_evidence,
  );
  const latestAdminStatusChange = metadataRecord(
    metadata.latest_admin_status_change,
  );
  const combinedNote = [
    params.note,
    latestBuyerRefundEvidence.note,
    latestAdminStatusChange.note,
  ]
    .map((entry) => String(entry || "").trim())
    .filter((entry) => entry.length > 0)
    .join(" / ");

  return evaluateUnder20SellerProtectionBuyerRefundGate({
    note: combinedNote,
  });
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
    const eligible = isEligibleUnder20SellerProtection(protection);
    const coveredAmount = moneyNumber(protection.coveredAmount);
    const amount = Math.min(coveredAmount, remaining);

    if (!eligible || amount <= 0 || !row.seller_account_id) {
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
