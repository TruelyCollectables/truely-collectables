"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTHENTICITY_STATUSES,
  AUTOGRAPH_SOURCES,
  authenticityStatusLabel,
  autographSourceLabel,
  buildAuthenticityBadges,
  hasAuthenticityDetails,
  sanitizeAuthenticityProfile,
  type AuthenticityProfile,
} from "../../../lib/authenticity";
import {
  STANDARD_AUCTION_DURATION_LABEL,
  STANDARD_AUCTION_POLICY_SUMMARY,
} from "../../../lib/auction-policy";
import {
  getFreshAccountSession,
  type StoredAccountSession,
} from "../../account/account-session";
import type {
  PublicSellerMarketplaceConnection,
  SellerMarketplaceProvider,
} from "../../../lib/seller-marketplace-connections";
import type {
  SellerEbayInventoryPreview,
  SellerEbayPreviewItem,
} from "../../../lib/seller-ebay";

type SellerStagedItem = {
  id: string;
  import_job_id?: string | null;
  provider: string;
  source_item_id: string;
  sku: string | null;
  title: string;
  quantity: number;
  price: number | null;
  currency: string;
  offer_status: string | null;
  listing_status: string | null;
  item_condition: string | null;
  image_url: string | null;
  stage_status: string;
  metadata?: Record<string, unknown> | null;
  draft_activation_readiness?: {
    ready: boolean;
    blockers: string[];
  } | null;
  promotion_guard?: {
    blocked: boolean;
    alreadyPromoted: boolean;
    promotedLegacyProductId: number | null;
    reasons: string[];
    matches: Array<{
      id: number;
      title: string;
      sellerScope: "store_owned" | "same_seller" | "other_seller";
      matchType: "sku" | "ebay_item_id";
    }>;
  } | null;
  updated_at: string;
};

const SELLER_STAGED_PROMOTION_BATCH_SIZE = 100;

type SellerImportJob = {
  id: string;
  status: string;
  row_count: number;
  staged_count: number;
  skipped_count: number;
  error_count: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  source_cursor?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  current_summary?: {
    total: number;
    ready: number;
    draft_cleanup: number;
    staged: number;
    needs_review: number;
    mapped: number;
    skipped: number;
    blocked: number;
    promoted: number;
  } | null;
};

type SellerStageAllProgress = {
  batchesCompleted: number;
  processedCount: number;
  stagedCount: number;
  skippedCount: number;
  nextOffset: number;
  totalAvailable: number | null;
};

type SellerReconciliationRun = {
  id: string;
  status: string;
  cursorOffset: number;
  scannedCount: number;
  matchedCount: number;
  quantityReducedCount: number;
  soldCount: number;
  reviewCount: number;
  failedCount: number;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
};

type SellerReconciliationStatus = {
  linkedCount: number;
  latestRun: SellerReconciliationRun | null;
  recentRuns: SellerReconciliationRun[];
};

type SellerReconciliationResult = {
  runId: string;
  status: string;
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  totalLinked: number;
  scannedCount: number;
  matchedCount: number;
  quantityReducedCount: number;
  soldCount: number;
  reviewCount: number;
  failedCount: number;
};

type SellerReconciliationProgress = {
  batchesCompleted: number;
  scannedCount: number;
  matchedCount: number;
  quantityReducedCount: number;
  soldCount: number;
  reviewCount: number;
  failedCount: number;
  nextOffset: number;
  totalLinked: number;
};

type SellerOutsideOrderStatus = {
  orderCount: number;
  paidCount: number;
  refundedCount: number;
  unmatchedItemCount: number;
  latestImportedAt: string | null;
};

type SellerOutsideOrderImportResult = {
  offset: number;
  nextOffset: number;
  hasMore: boolean;
  totalAvailable: number;
  importedOrderCount: number;
  importedItemCount: number;
  inventoryReducedCount: number;
  soldCount: number;
  unmatchedItemCount: number;
  reviewCount: number;
  failedItemCount: number;
};

type SellerMarketplaceOperationReceipt = {
  title: string;
  summary: string;
  tone: "neutral" | "emerald" | "amber" | "rose" | "sky";
  details: Array<{ label: string; value: string }>;
};

type SellerMarketplaceOperationReceiptHistoryEntry =
  SellerMarketplaceOperationReceipt & {
    historyKey: string;
  };

const SELLER_MARKETPLACE_RECEIPT_HISTORY_LIMIT = 5;
const SELLER_MARKETPLACE_RECEIPT_HISTORY_STORAGE_KEY =
  "tcos.sellerMarketplaceOperationReceiptHistory.v1";
const SELLER_MARKETPLACE_RECEIPT_DOWNLOAD_MIME_TYPE = "text/plain;charset=utf-8";

class SellerMarketplaceOperationError extends Error {
  operationReceipt: SellerMarketplaceOperationReceipt | null;

  constructor(
    message: string,
    operationReceipt: SellerMarketplaceOperationReceipt | null,
  ) {
    super(message);
    this.name = "SellerMarketplaceOperationError";
    this.operationReceipt = operationReceipt;
  }
}

type SellerInventorySummary = {
  totalItems: number;
  draftCount: number;
  draftReadyCount: number;
  draftNeedsWorkCount: number;
  activeCount: number;
  archivedCount: number;
  totalQuantity: number;
  totalDraftValue: number;
};

type SellerInventoryItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  sku: string | null;
  category: string;
  condition: string;
  status: string;
  quantity: number;
  price: number;
  updatedAt: string | null;
  createdAt: string | null;
  ebayItemId: string | null;
  imageUrl: string | null;
  activationReadiness: {
    ready: boolean;
    blockers: string[];
  };
};

type BulkPromotionMode = "ready" | "draft_cleanup";

type StageFilter =
  | "all"
  | "draft_cleanup"
  | "needs_review"
  | "staged"
  | "mapped"
  | "skipped"
  | "blocked"
  | "ready";

function parseStageFilter(value: string | null): StageFilter {
  return value === "draft_cleanup" ||
    value === "needs_review" ||
    value === "staged" ||
    value === "mapped" ||
    value === "skipped" ||
    value === "blocked" ||
    value === "ready"
    ? value
    : "all";
}

const STAGED_CATEGORY_OPTIONS = [
  "sports_cards",
  "trading_cards",
  "autographs",
  "memorabilia",
  "sealed_wax",
  "shoes",
  "comics",
  "coins",
  "toys",
  "other_collectable",
] as const;

function initialStageWorkspaceState() {
  if (typeof window === "undefined") {
    return {
      filter: "all" as StageFilter,
      search: "",
      importJobId: null as string | null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const importJobId = params.get("importJobId");

  return {
    filter: parseStageFilter(params.get("stage")),
    search: params.get("search") || "",
    importJobId: importJobId && importJobId.trim() ? importJobId : null,
  };
}

const requestableProviders: Array<{
  provider: SellerMarketplaceProvider;
  label: string;
  note: string;
}> = [
  {
    provider: "ebay",
    label: "Connect eBay OAuth",
    note: "Start seller-safe eBay account linking for this store account.",
  },
  {
    provider: "shopify",
    label: "Request Shopify",
    note: "Save interest for future TCOS to Shopify seller sync.",
  },
];

const marketplacePacketIntakeGuardrails = [
  "Cross-list prep only; no external publishing is approved from packet intake.",
  `${STANDARD_AUCTION_POLICY_SUMMARY} Use ${STANDARD_AUCTION_DURATION_LABEL} as the standard auction duration unless an operator explicitly approves a different duration.`,
  "No postage purchase, no Coverage policy creation, no seller payout release, and no order fulfillment.",
  "Use ready or needs-work Seller Inventory rows as the source of truth before importing packet files.",
  "Not insurance: packet intake does not activate TCOS Under-$20 Seller Protection or reimburse shipping.",
];

const EBAY_THIRD_PARTY_ACCESS_URL =
  "https://accounts.ebay.com/acctsec/security-center/third-party-app-access";
const EBAY_IDENTITY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";
const EBAY_FULFILLMENT_SCOPE =
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment";

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Never";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(value: string | null | undefined) {
  if (value === "connected" || value === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (
    value === "connect_requested" ||
    value === "needs_reauth" ||
    value === "sync_paused" ||
    value === "paused" ||
    value === "syncing" ||
    value === "queued" ||
    value === "completed_with_errors"
  ) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (value === "error" || value === "failed" || value === "revoked") {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function operationReceiptToneClass(
  tone: SellerMarketplaceOperationReceipt["tone"],
) {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-950";
  }

  if (tone === "rose") {
    return "border-rose-200 bg-rose-50 text-rose-900";
  }

  if (tone === "sky") {
    return "border-sky-200 bg-sky-50 text-sky-950";
  }

  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

function operationReceiptFromError(error: unknown) {
  if (error instanceof SellerMarketplaceOperationError) {
    return error.operationReceipt;
  }

  return null;
}

function headerText(headers: Headers, name: string, fallback = "—") {
  const value = headers.get(name);
  return value && value.trim().length > 0 ? value : fallback;
}

function headerNumber(headers: Headers, name: string) {
  const value = Number(headers.get(name));
  return Number.isFinite(value) ? value : 0;
}

function headerBoolean(headers: Headers, name: string) {
  return headers.get(name) === "true";
}

function sellerMarketplaceEbayAuthReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Ebay-Auth-Mutation");
  if (!mutation) return null;

  const status = headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Auth-Status");
  const storeSync = headerText(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Store-Sync",
  );
  const connectionStatus = headerText(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Auth-Connection-Status",
  );

  return {
    title: "eBay OAuth start receipt",
    summary: `${label(status)} auth request with store sync ${label(storeSync)}.`,
    tone:
      status === "ready" || status === "connected" || status === "redirect"
        ? "sky"
        : status === "blocked"
          ? "rose"
          : "amber",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Provider", value: headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Auth-Provider") },
      { label: "Connection", value: label(connectionStatus) },
      { label: "Sync", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Auth-Sync-Status")) },
    ],
  };
}

function sellerMarketplaceEbayStatusReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Ebay-Status-Mutation");
  if (!mutation) return null;

  const status = headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Status");
  const identityVerified = headerBoolean(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Verified",
  );
  const warning = headerText(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Identity-Warning",
    "none",
  );

  return {
    title: "eBay status receipt",
    summary: `${label(status)} refresh; identity ${identityVerified ? "verified" : "needs review"}.`,
    tone: warning !== "none" ? "amber" : status === "ok" ? "emerald" : "neutral",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Status", value: label(status) },
      { label: "Identity", value: identityVerified ? "Verified" : "Needs Review" },
      { label: "Warning", value: label(warning) },
    ],
  };
}

function sellerMarketplaceSyncControlReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get(
    "X-TCOS-Seller-Marketplace-Sync-Control-Mutation",
  );
  if (!mutation) return null;

  const action = headerText(headers, "X-TCOS-Seller-Marketplace-Sync-Control-Action");
  const result = headerText(headers, "X-TCOS-Seller-Marketplace-Sync-Control-Result");

  return {
    title: "eBay sync-control receipt",
    summary: `${label(action)} request ${label(result)}.`,
    tone: result === "updated" || result === "unchanged" ? "emerald" : "amber",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Unchanged", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Sync-Control-Unchanged") ? "Yes" : "No" },
      { label: "Connection", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Sync-Control-Connection-Status")) },
      { label: "Sync", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Sync-Control-Sync-Status")) },
    ],
  };
}

function sellerMarketplaceEbayDisconnectReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get(
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Mutation",
  );
  if (!mutation) return null;

  const result = headerText(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Result",
  );
  const credentialsDeleted = headerBoolean(
    headers,
    "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Credentials-Deleted",
  );

  return {
    title: "eBay disconnect receipt",
    summary: `${label(result)}; credentials ${credentialsDeleted ? "deleted" : "already absent"}.`,
    tone: result === "disconnected" || result === "already_disconnected" ? "emerald" : "amber",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Already", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Already") ? "Yes" : "No" },
      { label: "Connection", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Connection-Status")) },
      { label: "Sync", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Ebay-Disconnect-Sync-Status")) },
    ],
  };
}

function sellerMarketplaceImportPreviewReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const status = headers.get("X-TCOS-Seller-Marketplace-Import-Preview-Status");
  if (!status) return null;

  const sampled = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Import-Preview-Sampled",
  );
  const totalAvailable = headerText(
    headers,
    "X-TCOS-Seller-Marketplace-Import-Preview-Total-Available",
    "unknown",
  );
  const writeBlocked = headerBoolean(
    headers,
    "X-TCOS-Seller-Marketplace-Import-Preview-Write-Blocked",
  );
  const needsReview = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Import-Preview-Needs-Review",
  );

  return {
    title: "Import preview receipt",
    summary: `${sampled} sampled from ${totalAvailable} available; ${needsReview} need review.`,
    tone: writeBlocked || needsReview > 0 ? "amber" : "emerald",
    details: [
      { label: "Status", value: label(status) },
      { label: "Requested Limit", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Requested-Limit") },
      { label: "Ready", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Ready") },
      { label: "Has More", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Has-More") ? "Yes" : "No" },
      { label: "Write Blocked", value: writeBlocked ? "Yes" : "No" },
      { label: "Missing SKU", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Missing-SKU") },
      { label: "Missing Listing ID", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Listing-ID") },
      { label: "Missing Image", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Preview-Missing-Image") },
    ],
  };
}

function sellerMarketplaceReconciliationReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Reconcile-Mutation");
  if (!mutation) return null;

  const status = headerText(headers, "X-TCOS-Seller-Marketplace-Reconcile-Status");
  const scanned = headerNumber(headers, "X-TCOS-Seller-Marketplace-Reconcile-Scanned");
  const reduced = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Reconcile-Quantity-Reduced",
  );
  const sold = headerNumber(headers, "X-TCOS-Seller-Marketplace-Reconcile-Sold");
  const review = headerNumber(headers, "X-TCOS-Seller-Marketplace-Reconcile-Review");
  const failed = headerNumber(headers, "X-TCOS-Seller-Marketplace-Reconcile-Failed");

  return {
    title: "Inventory reconciliation receipt",
    summary: `${scanned} scanned; ${reduced} reduced, ${sold} sold, ${review} review, ${failed} failed.`,
    tone: failed > 0 ? "rose" : review > 0 ? "amber" : "emerald",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Status", value: label(status) },
      { label: "Linked", value: headerText(headers, "X-TCOS-Seller-Marketplace-Reconcile-Linked") },
      { label: "Matched", value: headerText(headers, "X-TCOS-Seller-Marketplace-Reconcile-Matched") },
      { label: "Has More", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Reconcile-Has-More") ? "Yes" : "No" },
      { label: "Reset Cursor", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Reconcile-Reset-Cursor") ? "Yes" : "No" },
    ],
  };
}

function sellerMarketplaceOrderImportReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Order-Import-Mutation");
  if (!mutation) return null;

  const status = headerText(headers, "X-TCOS-Seller-Marketplace-Order-Import-Status");
  const importedOrders = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Orders",
  );
  const importedItems = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Order-Import-Imported-Items",
  );
  const reduced = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Order-Import-Inventory-Reduced",
  );
  const failed = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Order-Import-Failed-Items",
  );

  return {
    title: "Outside eBay order receipt",
    summary: `${importedOrders} orders / ${importedItems} items imported; ${reduced} quantities reduced.`,
    tone: failed > 0 ? "rose" : "emerald",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Status", value: label(status) },
      { label: "Paid", value: headerText(headers, "X-TCOS-Seller-Marketplace-Order-Import-Paid") },
      { label: "Refunded", value: headerText(headers, "X-TCOS-Seller-Marketplace-Order-Import-Refunded") },
      { label: "Unmatched", value: headerText(headers, "X-TCOS-Seller-Marketplace-Order-Import-Unmatched") },
      { label: "Review", value: headerText(headers, "X-TCOS-Seller-Marketplace-Order-Import-Review") },
      { label: "Has More", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Order-Import-Has-More") ? "Yes" : "No" },
      { label: "Reset Cursor", value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Order-Import-Reset-Cursor") ? "Yes" : "No" },
    ],
  };
}

function sellerMarketplaceStagedReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Staged-Mutation");
  const rows = headers.get("X-TCOS-Seller-Marketplace-Staged-Rows");

  if (!mutation && !rows) return null;

  const ready = headerNumber(headers, "X-TCOS-Seller-Marketplace-Staged-Ready");
  const needsReview = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Staged-Needs-Review",
  );
  const blocked = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Staged-Blocked",
  );

  if (mutation) {
    const stagedCount = headerNumber(
      headers,
      "X-TCOS-Seller-Marketplace-Staged-Count",
    );
    const skippedCount = headerNumber(
      headers,
      "X-TCOS-Seller-Marketplace-Staged-Skipped",
    );
    const updatedCount = headerNumber(
      headers,
      "X-TCOS-Seller-Marketplace-Staged-Updated",
    );
    const targetStatus = headerText(
      headers,
      "X-TCOS-Seller-Marketplace-Staged-Target-Status",
      "metadata",
    );

    return {
      title: "Staged-row mutation receipt",
      summary: `${label(mutation)} touched ${updatedCount || stagedCount} row(s); ${skippedCount} skipped.`,
      tone: skippedCount > 0 || targetStatus === "needs_review" ? "amber" : "emerald",
      details: [
        { label: "Mutation", value: label(mutation) },
        { label: "Staged", value: String(stagedCount) },
        { label: "Updated", value: String(updatedCount) },
        { label: "Target", value: label(targetStatus) },
        {
          label: "Has More",
          value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Staged-Has-More")
            ? "Yes"
            : "No",
        },
      ],
    };
  }

  return {
    title: "Staged-row workspace receipt",
    summary: `${headerNumber(headers, "X-TCOS-Seller-Marketplace-Staged-Rows")} staged rows; ${ready} ready, ${needsReview} review, ${blocked} blocked.`,
    tone: blocked > 0 || needsReview > 0 ? "amber" : ready > 0 ? "emerald" : "neutral",
    details: [
      { label: "Ready", value: String(ready) },
      { label: "Draft Cleanup", value: headerText(headers, "X-TCOS-Seller-Marketplace-Staged-Draft-Cleanup") },
      { label: "Needs Review", value: String(needsReview) },
      { label: "Mapped", value: headerText(headers, "X-TCOS-Seller-Marketplace-Staged-Mapped") },
      { label: "Skipped", value: headerText(headers, "X-TCOS-Seller-Marketplace-Staged-Skipped") },
      { label: "Blocked", value: String(blocked) },
      { label: "Promoted", value: headerText(headers, "X-TCOS-Seller-Marketplace-Staged-Promoted") },
      { label: "Import Jobs", value: headerText(headers, "X-TCOS-Seller-Marketplace-Import-Jobs") },
    ],
  };
}

function sellerMarketplacePromotionReceipt(
  headers: Headers,
): SellerMarketplaceOperationReceipt | null {
  const mutation = headers.get("X-TCOS-Seller-Marketplace-Promote-Mutation");
  if (!mutation) return null;

  const status = headerText(headers, "X-TCOS-Seller-Marketplace-Promote-Status");
  const requested = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Promote-Requested",
  );
  const succeeded = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Promote-Succeeded",
  );
  const failed = headerNumber(
    headers,
    "X-TCOS-Seller-Marketplace-Promote-Failed",
  );

  return {
    title: "Staged promotion receipt",
    summary: `${succeeded} of ${requested} staged row(s) promoted; ${failed} failed.`,
    tone: failed > 0 ? (succeeded > 0 ? "amber" : "rose") : "emerald",
    details: [
      { label: "Mutation", value: label(mutation) },
      { label: "Mode", value: label(headerText(headers, "X-TCOS-Seller-Marketplace-Promote-Mode")) },
      { label: "Status", value: label(status) },
      {
        label: "Partial",
        value: headerBoolean(headers, "X-TCOS-Seller-Marketplace-Promote-Partial")
          ? "Yes"
          : "No",
      },
    ],
  };
}

function formatSellerMarketplaceOperationReceipt(
  receipt: SellerMarketplaceOperationReceipt,
) {
  return [
    "TCOS Seller Marketplace API Receipt",
    `Title: ${receipt.title}`,
    `Summary: ${receipt.summary}`,
    `Tone: ${label(receipt.tone)}`,
    ...receipt.details.map((detail) => `${detail.label}: ${detail.value}`),
  ].join("\n");
}

function formatSellerMarketplaceOperationReceiptHistory(
  receipts: SellerMarketplaceOperationReceipt[],
) {
  return [
    "TCOS Seller Marketplace API Receipt Trail",
    `Receipt count: ${receipts.length}`,
    ...receipts.flatMap((receipt, index) => [
      "",
      `Receipt ${index + 1}`,
      formatSellerMarketplaceOperationReceipt(receipt),
    ]),
  ].join("\n");
}

function isSellerMarketplaceOperationReceipt(
  value: unknown,
): value is SellerMarketplaceOperationReceipt {
  if (!value || typeof value !== "object") return false;

  const receipt = value as Partial<SellerMarketplaceOperationReceipt>;
  const validTone =
    receipt.tone === "neutral" ||
    receipt.tone === "emerald" ||
    receipt.tone === "amber" ||
    receipt.tone === "rose" ||
    receipt.tone === "sky";

  return (
    typeof receipt.title === "string" &&
    typeof receipt.summary === "string" &&
    validTone &&
    Array.isArray(receipt.details) &&
    receipt.details.every(
      (detail) =>
        detail &&
        typeof detail === "object" &&
        typeof (detail as { label?: unknown }).label === "string" &&
        typeof (detail as { value?: unknown }).value === "string",
    )
  );
}

function sellerMarketplaceOperationReceiptHistoryFromSession() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.sessionStorage.getItem(
      SELLER_MARKETPLACE_RECEIPT_HISTORY_STORAGE_KEY,
    );
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (receipt): receipt is SellerMarketplaceOperationReceiptHistoryEntry =>
          isSellerMarketplaceOperationReceipt(receipt) &&
          typeof (receipt as { historyKey?: unknown }).historyKey ===
            "string",
      )
      .slice(0, SELLER_MARKETPLACE_RECEIPT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function saveSellerMarketplaceOperationReceiptHistoryToSession(
  receipts: SellerMarketplaceOperationReceiptHistoryEntry[],
) {
  if (typeof window === "undefined") return;

  try {
    if (receipts.length === 0) {
      window.sessionStorage.removeItem(
        SELLER_MARKETPLACE_RECEIPT_HISTORY_STORAGE_KEY,
      );
      return;
    }

    window.sessionStorage.setItem(
      SELLER_MARKETPLACE_RECEIPT_HISTORY_STORAGE_KEY,
      JSON.stringify(receipts.slice(0, SELLER_MARKETPLACE_RECEIPT_HISTORY_LIMIT)),
    );
  } catch {
    // Browser storage can be blocked or full; receipt copy still works in memory.
  }
}

function sellerMarketplaceReceiptFileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sellerMarketplaceReceiptFileName(kind: "latest" | "trail") {
  return `tcos-seller-marketplace-${kind}-receipt-${sellerMarketplaceReceiptFileTimestamp()}.txt`;
}

function downloadSellerMarketplaceReceiptFile(fileName: string, content: string) {
  const blob = new Blob([content], {
    type: SELLER_MARKETPLACE_RECEIPT_DOWNLOAD_MIME_TYPE,
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function SellerMarketplaceOperationReceiptCard({
  receipt,
  onCopyReceipt,
  onDownloadReceipt,
}: {
  receipt: SellerMarketplaceOperationReceipt;
  onCopyReceipt: (receipt: SellerMarketplaceOperationReceipt) => void;
  onDownloadReceipt: (receipt: SellerMarketplaceOperationReceipt) => void;
}) {
  return (
    <div
      className={`border-b p-4 ${operationReceiptToneClass(receipt.tone)}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em]">
            Latest Marketplace API Receipt
          </p>
          <p className="mt-1 text-sm font-black">{receipt.title}</p>
          <p className="mt-1 text-sm leading-6">{receipt.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCopyReceipt(receipt)}
            className="rounded-md border border-current bg-white/70 px-3 py-2 text-xs font-black uppercase tracking-[0.08em] hover:bg-white"
          >
            Copy Safe Receipt
          </button>
          <button
            type="button"
            onClick={() => onDownloadReceipt(receipt)}
            className="rounded-md border border-current bg-white/70 px-3 py-2 text-xs font-black uppercase tracking-[0.08em] hover:bg-white"
          >
            Download Safe Receipt
          </button>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {receipt.details.map((detail) => (
          <div
            key={`${receipt.title}-${detail.label}`}
            className="rounded-md bg-white/70 px-3 py-2"
          >
            <dt className="text-[11px] font-black uppercase tracking-[0.08em] opacity-70">
              {detail.label}
            </dt>
            <dd className="mt-1 text-sm font-black">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SellerMarketplaceOperationReceiptHistory({
  receipts,
  onCopyReceipt,
  onCopyReceiptTrail,
  onDownloadReceiptTrail,
  onClearReceiptTrail,
}: {
  receipts: SellerMarketplaceOperationReceiptHistoryEntry[];
  onCopyReceipt: (receipt: SellerMarketplaceOperationReceipt) => void;
  onCopyReceiptTrail: () => void;
  onDownloadReceiptTrail: () => void;
  onClearReceiptTrail: () => void;
}) {
  if (receipts.length === 0) return null;

  return (
    <div className="border-b border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.12em] text-neutral-500">
            Recent Marketplace API Receipts
          </p>
          <p className="mt-1 text-xs font-semibold leading-5 text-neutral-500">
            Session-saved in this browser tab for operator handoff.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyReceiptTrail}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-neutral-700 hover:bg-neutral-50"
          >
            Copy Trail
          </button>
          <button
            type="button"
            onClick={onDownloadReceiptTrail}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-neutral-700 hover:bg-neutral-50"
          >
            Download Trail
          </button>
          <button
            type="button"
            onClick={onClearReceiptTrail}
            className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-neutral-700 hover:bg-neutral-50"
          >
            Clear Trail
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {receipts.map((receipt) => (
          <div
            key={receipt.historyKey}
            className={`rounded-md border px-3 py-2 ${operationReceiptToneClass(receipt.tone)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black">{receipt.title}</p>
                <p className="mt-1 text-xs font-semibold leading-5">
                  {receipt.summary}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onCopyReceipt(receipt)}
                className="shrink-0 rounded border border-current bg-white/70 px-2 py-1 text-[11px] font-black uppercase tracking-[0.08em] hover:bg-white"
              >
                Copy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function metadataTextValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function metadataNumberValue(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? value : null;
}

function metadataRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function isResolvedStageItem(item: SellerStagedItem) {
  return item.stage_status === "mapped" || item.stage_status === "skipped";
}

function isActivePromotionBlocked(item: SellerStagedItem) {
  return item.promotion_guard?.blocked === true && !isResolvedStageItem(item);
}

function isDuplicateTrashItem(item: SellerStagedItem) {
  const metadata = metadataRecord(item.metadata);
  const stageTrash = metadataRecord(metadata?.stage_trash);

  return (
    item.stage_status === "skipped" &&
    (metadataTextValue(metadata, "trash_kind") === "duplicate" ||
      metadata?.duplicate_trash === true ||
      metadataTextValue(stageTrash, "kind") === "duplicate")
  );
}

function isExactDuplicateTrashCandidate(item: SellerStagedItem) {
  if (isResolvedStageItem(item)) return false;

  const guard = item.promotion_guard;
  if (!guard?.blocked) return false;

  return (
    guard.alreadyPromoted ||
    guard.reasons.includes("existing_ebay_item") ||
    guard.matches.some((match) => match.matchType === "ebay_item_id")
  );
}

function stagedStatusLabel(item: SellerStagedItem) {
  if (isDuplicateTrashItem(item)) return "DUPLICATE TRASH";
  return label(item.stage_status);
}

function authenticityBadgeTone(tone: "neutral" | "emerald" | "amber" | "sky") {
  if (tone === "emerald") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (tone === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (tone === "sky") {
    return "border-sky-200 bg-sky-50 text-sky-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function stagedAuthenticityProfile(item: SellerStagedItem): AuthenticityProfile {
  return sanitizeAuthenticityProfile(metadataRecord(item.metadata)?.authenticity);
}

function previewAuthenticityProfile(item: SellerEbayPreviewItem): AuthenticityProfile {
  return sanitizeAuthenticityProfile(item.authenticity);
}

function metadataCountEntries(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
) {
  const summary = metadataRecord(metadata?.[key]);

  return Object.entries(summary || {})
    .map(([entryKey, value]) => [entryKey, Number(value)] as const)
    .filter((entry) => Number.isFinite(entry[1]) && entry[1] > 0)
    .sort((left, right) => right[1] - left[1]);
}

function importDiagnosticLabel(value: string) {
  if (value === "missing_sku") return "Missing SKU";
  if (value === "missing_listing_id") return "Missing listing ID";
  if (value === "missing_price") return "Missing price";
  if (value === "missing_image") return "Missing image";
  if (value === "needs_review") return "Needs review";
  if (value === "ready_to_stage") return "Ready to stage";
  if (value === "missing_sku_and_listing_id") return "No SKU or listing ID";
  if (value === "missing_stage_identity") return "Missing stage identity";
  return label(value);
}

function sellerInventoryHref(
  status: "all" | "draft" | "active" | "archived" = "all",
  readiness: "all" | "ready" | "needs_work" = "all",
  search?: string,
) {
  const params = new URLSearchParams();

  if (status !== "all") {
    params.set("status", status);
  }

  if (readiness !== "all") {
    params.set("readiness", readiness);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/inventory?${query}` : "/seller/inventory";
}

function sellerOrdersQueueHref(
  queue: "all" | "action_required" | "shipping" | "cash_out" | "completed",
  search?: string,
) {
  const params = new URLSearchParams();

  if (queue !== "all") {
    params.set("queue", queue);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/orders?${query}` : "/seller/orders";
}

function sellerPayoutQueueHref(
  request: "all" | "blocked" | "open" | "paid" | "attention",
  search?: string,
) {
  const params = new URLSearchParams();

  if (request !== "all") {
    params.set("request", request);
  }

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return query ? `/seller/payouts?${query}` : "/seller/payouts";
}

function sellerDraftOutputHref(
  summary: SellerInventorySummary | null,
  mode?: BulkPromotionMode | null,
) {
  if (mode === "draft_cleanup") {
    return {
      href: sellerInventoryHref("draft", "needs_work"),
      label: "Open Needs Work Drafts",
    };
  }

  if (mode === "ready") {
    return {
      href: sellerInventoryHref("draft", "ready"),
      label: "Open Ready Drafts",
    };
  }

  if ((summary?.draftNeedsWorkCount || 0) > 0) {
    return {
      href: sellerInventoryHref("draft", "needs_work"),
      label: "Open Needs Work Drafts",
    };
  }

  if ((summary?.draftReadyCount || 0) > 0) {
    return {
      href: sellerInventoryHref("draft", "ready"),
      label: "Open Ready Drafts",
    };
  }

  return {
    href: sellerInventoryHref("draft"),
    label: "Open Seller Drafts",
  };
}

function sellerInventoryItemHref(item: SellerInventoryItem) {
  const search = item.sku?.trim() || item.title;

  if (item.status === "draft") {
    return item.activationReadiness.ready
      ? sellerInventoryHref("draft", "ready", search)
      : sellerInventoryHref("draft", "needs_work", search);
  }

  if (item.status === "active" || item.status === "archived") {
    return sellerInventoryHref(item.status, "all", search);
  }

  return sellerInventoryHref("all", "all", search);
}

function sellerInventoryMarketplaceHref(item: SellerInventoryItem) {
  const search = item.ebayItemId?.trim() || item.sku?.trim() || item.title.trim();
  const params = new URLSearchParams();

  if (item.status === "draft") {
    params.set(
      "stage",
      item.activationReadiness.ready ? "ready" : "draft_cleanup",
    );
  }

  if (search) {
    params.set("search", search);
  }

  const query = params.toString();
  return {
    href: query ? `/seller/marketplaces?${query}` : "/seller/marketplaces",
    label:
      item.status === "draft"
        ? item.activationReadiness.ready
          ? "Search Ready Rows"
          : "Search Cleanup Rows"
        : "Search Marketplace Rows",
  };
}

function sellerInventoryOrdersHref(item: SellerInventoryItem) {
  const search = item.title.trim();

  if (item.status === "active") {
    return sellerOrdersQueueHref("shipping", search);
  }

  if (!item.activationReadiness.ready) {
    return sellerOrdersQueueHref("action_required", search);
  }

  return sellerOrdersQueueHref("all", search);
}

function sellerInventoryOrdersLabel(item: SellerInventoryItem) {
  if (item.status === "active") {
    return "Open Shipping Orders";
  }

  if (!item.activationReadiness.ready) {
    return "Open Action Orders";
  }

  return "Open Seller Orders";
}

function sellerInventoryPayoutHref(item: SellerInventoryItem) {
  const search = item.title.trim();

  if (item.status === "active") {
    return sellerPayoutQueueHref("open", search);
  }

  return sellerPayoutQueueHref("all", search);
}

function sellerInventoryPayoutLabel(item: SellerInventoryItem) {
  if (item.status === "active") {
    return "Open Cash-Out Payouts";
  }

  return "Open Seller Payouts";
}

function sellerPromotedInventoryHref(item?: {
  sku?: string | null;
  title?: string;
  draft_activation_readiness?: {
    ready: boolean;
  } | null;
}) {
  const search = item?.sku?.trim() || item?.title?.trim() || "";
  const readiness = item?.draft_activation_readiness?.ready
    ? "ready"
    : item?.draft_activation_readiness
      ? "needs_work"
      : "all";
  return sellerInventoryHref("draft", readiness, search);
}

function sellerStagedInventorySearchLabel(item: SellerStagedItem) {
  if (item.draft_activation_readiness?.ready) {
    return "Search Ready Drafts";
  }

  if (item.draft_activation_readiness) {
    return "Search Needs Work Drafts";
  }

  return "Search Seller Drafts";
}

function sellerStagedInstaCompHref(items: SellerStagedItem[]) {
  const selectedItems = items.slice(0, 25);
  const params = new URLSearchParams();
  const searchText = selectedItems
    .map((item) => item.sku?.trim() || item.title.trim())
    .filter(Boolean)
    .slice(0, 5)
    .join(" | ");

  params.set("source", "seller-ebay-staging");
  params.set("rows", String(items.length));

  if (searchText) {
    params.set("q", searchText);
  }

  for (const item of selectedItems) {
    params.append("stagedItemId", item.id);
  }

  return `/admin/instacomp?${params.toString()}`;
}

function sellerMatchedInventoryHref(match: {
  title: string;
  sellerScope: "store_owned" | "same_seller" | "other_seller";
}) {
  if (match.sellerScope === "other_seller") {
    return null;
  }

  return sellerInventoryHref("all", "all", match.title);
}

function importDiagnosticTone(kind: "quality" | "skip", value: string) {
  if (kind === "skip") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "ready_to_stage") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (value === "needs_review") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function outcomeTone(
  kind: "ready" | "draft_cleanup" | "review" | "mapped" | "blocked" | "skipped" | "promoted",
) {
  if (kind === "ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (kind === "draft_cleanup" || kind === "review" || kind === "blocked") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (kind === "mapped" || kind === "promoted") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function importRunCompletion(
  summary: NonNullable<SellerImportJob["current_summary"]>,
) {
  const resolved = summary.mapped + summary.skipped;
  const unresolved =
    summary.ready + summary.draft_cleanup + summary.needs_review + summary.blocked;
  const total = Math.max(summary.total, 0);
  const percent = total > 0 ? Math.round((resolved / total) * 100) : 0;

  if (total > 0 && unresolved === 0 && resolved >= total) {
    return {
      label: "Cleanup Complete",
      detail: `${resolved} of ${total} rows resolved`,
      percent: 100,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      barTone: "bg-emerald-500",
    };
  }

  if (resolved > 0) {
    return {
      label: "Cleanup In Progress",
      detail: `${resolved} of ${total} rows resolved`,
      percent,
      tone: "border-sky-200 bg-sky-50 text-sky-800",
      barTone: "bg-sky-500",
    };
  }

  return {
    label: "Needs Cleanup",
    detail: `${unresolved} of ${total} rows still active`,
    percent: 0,
    tone: "border-amber-200 bg-amber-50 text-amber-900",
    barTone: "bg-amber-500",
  };
}

function importRunWorkCounts(
  summary: NonNullable<SellerImportJob["current_summary"]>,
) {
  return {
    unresolved:
      summary.ready + summary.draft_cleanup + summary.needs_review + summary.blocked,
    resolved: summary.mapped + summary.skipped,
  };
}

function selectedQueueGuidance(summary: {
  total: number;
  ready: number;
  draft_cleanup: number;
  needs_review: number;
  blocked: number;
  mapped: number;
  skipped: number;
}) {
  if (summary.total === 0) {
    return null;
  }

  if (summary.blocked > 0) {
    return {
      title: "Blocked rows need attention first",
      detail:
        summary.ready > 0 || summary.draft_cleanup > 0 || summary.needs_review > 0
          ? "This selection mixes promotable work with conflict blockers. Review blocked rows before treating the selection as clean."
          : "This selection is carrying conflict blockers that should be reviewed before more bulk moves.",
      tone: "border-rose-200 bg-rose-50 text-rose-900",
    };
  }

  if (
    (summary.mapped > 0 || summary.skipped > 0) &&
    (summary.ready > 0 || summary.draft_cleanup > 0 || summary.needs_review > 0)
  ) {
    return {
      title: "Selection mixes active and completed rows",
      detail:
        "Some selected rows already finished their current workflow. Trim down to active work if you want a cleaner bulk selection.",
      tone: "border-sky-200 bg-sky-50 text-sky-900",
    };
  }

  if (summary.needs_review > 0 && summary.ready > 0) {
    return {
      title: "Mixed ready and review selection",
      detail:
        "Promote Ready Selected will only move the ready rows. Review rows still need cleanup or status changes before promotion.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (summary.draft_cleanup > 0 && summary.ready > 0) {
    return {
      title: "Mixed clean and cleanup-needed drafts",
      detail:
        "Some selected rows can promote cleanly while others can only promote into drafts that still need activation cleanup.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (summary.draft_cleanup > 0 && summary.needs_review > 0) {
    return {
      title: "Mixed cleanup-needed and review rows",
      detail:
        "Some selected rows can still become drafts, while others should stay in review until their imported details are corrected.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (summary.draft_cleanup > 0 && summary.draft_cleanup === summary.total) {
    return {
      title: "Selection will promote with draft cleanup",
      detail:
        "These rows can become seller drafts, but they will still carry activation blockers after promotion.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (summary.ready > 0 && summary.ready === summary.total) {
    return {
      title: "Selection is promotion-ready",
      detail:
        "Every selected row is clear to become seller draft inventory.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    };
  }

  if (summary.needs_review > 0 && summary.needs_review === summary.total) {
    return {
      title: "Selection is in review",
      detail:
        "These rows are parked for cleanup. Use bulk stage moves after you finish reviewing titles, identifiers, and conflicts.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (summary.mapped > 0 && summary.mapped === summary.total) {
    return {
      title: "Selection is already mapped",
      detail:
        "These rows already created seller draft inventory. Open the seller draft inventory view or filter to ready rows for more promotion work.",
      tone: "border-sky-200 bg-sky-50 text-sky-900",
    };
  }

  if (summary.skipped > 0 && summary.skipped === summary.total) {
    return {
      title: "Selection is already skipped",
      detail:
        "These rows are out of active staging unless you intentionally move them back into staged or review.",
      tone: "border-neutral-200 bg-neutral-100 text-neutral-700",
    };
  }

  return {
    title: "Selection contains mixed statuses",
    detail:
      "Use the status chips above to confirm what is in the selection before bulk-moving or promoting rows.",
    tone: "border-neutral-200 bg-neutral-100 text-neutral-700",
  };
}

function stageSignals(item: SellerStagedItem) {
  const metadata =
    item.metadata && typeof item.metadata === "object"
      ? (item.metadata as Record<string, unknown>)
      : null;
  const authenticity = stagedAuthenticityProfile(item);
  const signals: Array<{
    label: string;
    tone: "warning" | "neutral" | "positive";
  }> = [];

  if (!item.sku) {
    signals.push({ label: "Missing SKU", tone: "warning" });
  }

  if (!metadataTextValue(metadata, "source_listing_id")) {
    signals.push({ label: "Missing listing ID", tone: "warning" });
  }

  if (typeof item.price !== "number" || item.price <= 0) {
    signals.push({ label: "No active price", tone: "neutral" });
  }

  if (!item.image_url) {
    signals.push({ label: "No image", tone: "neutral" });
  }

  if (item.promotion_guard?.alreadyPromoted) {
    signals.push({ label: "Draft created", tone: "positive" });
  }

  if (isDuplicateTrashItem(item)) {
    signals.push({ label: "Dup trash - verify", tone: "warning" });
  }

  if (
    isActivePromotionBlocked(item) &&
    item.promotion_guard?.matches.some((match) => match.sellerScope === "same_seller")
  ) {
    signals.push({ label: "Existing seller match", tone: "warning" });
  } else if (isActivePromotionBlocked(item)) {
    signals.push({ label: "Store conflict", tone: "warning" });
  }

  if (authenticity.status === "verified_cert") {
    signals.push({ label: "Imported cert", tone: "positive" });
  }

  if (authenticity.status === "seller_pass_guarantee") {
    signals.push({ label: "Pass guarantee", tone: "positive" });
  }

  if (authenticity.status === "provenance_only") {
    signals.push({ label: "Provenance-only", tone: "neutral" });
  }

  if (authenticity.status === "unverified_as_is") {
    signals.push({ label: "Unverified autograph", tone: "warning" });
  }

  if (item.draft_activation_readiness?.ready) {
    signals.push({ label: "Draft-ready", tone: "positive" });
  } else if ((item.draft_activation_readiness?.blockers.length || 0) > 0) {
    signals.push({ label: "Draft needs work", tone: "warning" });
  }

  return signals;
}

function stageLaneFilter(item: SellerStagedItem): StageFilter {
  if (item.stage_status === "mapped") return "mapped";
  if (item.stage_status === "skipped") return "skipped";
  if (isActivePromotionBlocked(item)) return "blocked";
  if (item.stage_status === "needs_review") return "needs_review";
  if (hasDraftActivationCleanup(item)) return "draft_cleanup";
  if (isDraftActivationReadyStageItem(item)) return "ready";
  return "staged";
}

function stageLaneBadge(item: SellerStagedItem) {
  const filter = stageLaneFilter(item);

  if (filter === "blocked") {
    return {
      label: "Blocked lane",
      tone: "border-rose-200 bg-rose-50 text-rose-800",
      filter,
    };
  }

  if (filter === "needs_review") {
    return {
      label: "Review lane",
      tone: "border-amber-200 bg-amber-50 text-amber-800",
      filter,
    };
  }

  if (filter === "draft_cleanup") {
    return {
      label: "Draft cleanup lane",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      filter,
    };
  }

  if (filter === "ready") {
    return {
      label: "Ready lane",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
      filter,
    };
  }

  if (filter === "mapped") {
    return {
      label: "Mapped lane",
      tone: "border-sky-200 bg-sky-50 text-sky-800",
      filter,
    };
  }

  if (filter === "skipped") {
    if (isDuplicateTrashItem(item)) {
      return {
        label: "Duplicate trash lane",
        tone: "border-rose-200 bg-rose-50 text-rose-800",
        filter,
      };
    }

    return {
      label: "Skipped lane",
      tone: "border-neutral-200 bg-neutral-100 text-neutral-700",
      filter,
    };
  }

  return {
    label: "Staged lane",
    tone: "border-neutral-200 bg-neutral-100 text-neutral-700",
    filter,
  };
}

function stageWorkPriority(item: SellerStagedItem) {
  if (isActivePromotionBlocked(item)) return 0;
  if (item.stage_status === "needs_review") return 1;
  if (hasDraftActivationCleanup(item)) return 2;
  if (isDraftActivationReadyStageItem(item)) return 3;
  if (item.stage_status === "staged") return 4;
  if (item.stage_status === "mapped") return 5;
  if (item.stage_status === "skipped") return 6;
  return 7;
}

function isDraftActivationReadyStageItem(item: SellerStagedItem) {
  return item.draft_activation_readiness?.ready === true;
}

function hasDraftActivationCleanup(item: SellerStagedItem) {
  return (
    canPromoteStageItem(item) &&
    item.draft_activation_readiness?.ready === false &&
    (item.draft_activation_readiness?.blockers.length || 0) > 0
  );
}

function signalTone(tone: "warning" | "neutral" | "positive") {
  if (tone === "positive") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (tone === "warning") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function canPromoteStageItem(item: SellerStagedItem) {
  return item.stage_status === "staged" && item.promotion_guard?.blocked !== true;
}

function stageItemIdsForFilter(
  items: SellerStagedItem[],
  filter: StageFilter | "unresolved",
) {
  if (filter === "all") {
    return items.map((item) => item.id);
  }

  if (filter === "unresolved") {
    return items
      .filter(
        (item) =>
          canPromoteStageItem(item) ||
          item.stage_status === "needs_review" ||
          isActivePromotionBlocked(item),
      )
      .map((item) => item.id);
  }

  if (filter === "ready") {
    return items
      .filter((item) => isDraftActivationReadyStageItem(item))
      .map((item) => item.id);
  }

  if (filter === "draft_cleanup") {
    return items.filter((item) => hasDraftActivationCleanup(item)).map((item) => item.id);
  }

  if (filter === "blocked") {
    return items
      .filter((item) => isActivePromotionBlocked(item))
      .map((item) => item.id);
  }

  return items
    .filter((item) => item.stage_status === filter)
    .map((item) => item.id);
}

function selectedStageItemsForIds(
  items: SellerStagedItem[],
  selectedIds: string[],
) {
  const selectedIdSet = new Set(selectedIds);
  return items.filter((item) => selectedIdSet.has(item.id));
}

function stageItemIdsNeedingStatus(
  items: SellerStagedItem[],
  targetStatus: "staged" | "needs_review" | "skipped",
) {
  return items
    .filter((item) => item.stage_status !== targetStatus)
    .map((item) => item.id);
}

function promotionReasonLabel(reason: string) {
  if (reason === "already_promoted") return "Already promoted";
  if (reason === "existing_ebay_item") return "eBay item conflict";
  if (reason === "existing_sku") return "SKU conflict";
  return label(reason);
}

function sellerScopeLabel(scope: "store_owned" | "same_seller" | "other_seller") {
  if (scope === "store_owned") return "Store-owned";
  if (scope === "same_seller") return "Same seller";
  return "Other seller";
}

function readinessBlockerLabel(value: string) {
  if (value === "missing_sku") return "Missing SKU";
  if (value === "missing_price") return "Missing price";
  if (value === "missing_quantity") return "Missing quantity";
  if (value === "missing_image") return "Missing image";
  if (value === "missing_authenticity_disclosure") {
    return "Missing authenticity disclosure";
  }
  if (value === "missing_cert_provider") return "Missing cert provider";
  if (value === "missing_pass_guarantee_authenticator") {
    return "Missing guarantee authenticator";
  }
  if (value === "missing_provenance_evidence") {
    return "Missing provenance evidence";
  }
  return label(value);
}

function stageLaneTitle(filter: StageFilter) {
  if (filter === "ready") return "Ready lane";
  if (filter === "draft_cleanup") return "Draft cleanup lane";
  if (filter === "blocked") return "Blocked lane";
  if (filter === "needs_review") return "Review lane";
  if (filter === "staged") return "Staged lane";
  if (filter === "mapped") return "Mapped lane";
  if (filter === "skipped") return "Trash / archived lane";
  return "Working staged rows";
}

function stageLaneDetail(filter: StageFilter) {
  if (filter === "ready") {
    return "These rows can promote into seller drafts with no current activation blockers.";
  }

  if (filter === "draft_cleanup") {
    return "These rows can promote into drafts now, but they still need activation cleanup before going live.";
  }

  if (filter === "blocked") {
    return "These rows are blocked by promotion conflicts and need review before more draft work.";
  }

  if (filter === "needs_review") {
    return "These rows are parked for manual seller cleanup before they should move forward.";
  }

  if (filter === "staged") {
    return "These rows are actively staged, including both clean-ready and cleanup-needed draft candidates.";
  }

  if (filter === "mapped") {
    return "These rows already created seller-owned draft inventory.";
  }

  if (filter === "skipped") {
    return "These rows are sold, ended, out-of-stock, or intentionally archived out of the active selling workflow. Duplicate-trash rows stay here until you verify before permanent delete.";
  }

  return "This workspace shows active seller work only; sold, ended, mapped, and archived rows stay out of the way unless you open their lanes.";
}

function stageLaneSelectionLabel(filter: StageFilter) {
  if (filter === "ready") return "Select ready lane";
  if (filter === "draft_cleanup") return "Select cleanup lane";
  if (filter === "blocked") return "Select blocked lane";
  if (filter === "needs_review") return "Select review lane";
  if (filter === "mapped") return "Select mapped lane";
  if (filter === "skipped") return "Select sold / archived lane";
  if (filter === "staged") return "Select staged lane";
  return "Select visible working rows";
}

function stageLaneEmptyState(
  filter: StageFilter,
  options: { hasSearch: boolean; hasImportRun: boolean },
) {
  if (options.hasSearch) {
    return {
      title: "No rows match the current lane and search",
      detail:
        "Try clearing the staged-row search or widening the workspace lane to bring matching listings back into view.",
      tone: "border-neutral-200 bg-neutral-50 text-neutral-700",
    };
  }

  if (filter === "ready") {
    return {
      title: "No ready rows in view",
      detail:
        "There are no staged rows in this view that can become seller drafts without activation cleanup.",
      tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    };
  }

  if (filter === "draft_cleanup") {
    return {
      title: "No draft cleanup rows in view",
      detail:
        "There are no staged rows in this view that can promote into drafts while still carrying activation blockers.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (filter === "blocked") {
    return {
      title: "No blocked rows in view",
      detail:
        "This view is not carrying any promotion conflicts right now.",
      tone: "border-rose-200 bg-rose-50 text-rose-900",
    };
  }

  if (filter === "needs_review") {
    return {
      title: "No review rows in view",
      detail:
        "There are no staged rows currently parked for seller cleanup in this workspace.",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  if (filter === "mapped") {
    return {
      title: "No mapped rows in view",
      detail:
        "This view does not currently include staged rows that already created seller draft inventory.",
      tone: "border-sky-200 bg-sky-50 text-sky-900",
    };
  }

  if (filter === "skipped") {
    return {
      title: "No skipped rows in view",
      detail:
        "There are no skipped staged rows in the current workspace slice.",
      tone: "border-neutral-200 bg-neutral-100 text-neutral-700",
    };
  }

  if (options.hasImportRun) {
    return {
      title: "No staged rows in this run view",
      detail:
        "The selected import run is not returning any staged listings for the current lane.",
      tone: "border-neutral-200 bg-neutral-50 text-neutral-700",
    };
  }

  return {
    title: "No staged rows in view",
    detail:
      "There are no seller-staged listings visible in the current workspace slice.",
    tone: "border-neutral-200 bg-neutral-50 text-neutral-700",
  };
}

function bulkPromotionModeLabel(mode: BulkPromotionMode | null) {
  if (mode === "draft_cleanup") return "Draft Cleanup Promotion";
  if (mode === "ready") return "Ready Promotion";
  return "Promotion";
}

async function fetchSellerConnections(accessToken: string) {
  const response = await fetch("/api/account/seller/marketplace-connections", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error || "Could not load seller marketplace connections.",
    );
  }

  return (data.connections || []) as PublicSellerMarketplaceConnection[];
}

async function fetchSellerEbayPreview(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/import-preview?limit=5",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceImportPreviewReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not load seller eBay import preview.",
      operationReceipt,
    );
  }

  return {
    preview: data.preview as SellerEbayInventoryPreview,
    operationReceipt,
  };
}

async function fetchSellerStagedItems(
  accessToken: string,
  options?: { importJobId?: string | null; stageStatus?: StageFilter },
) {
  const searchParams = new URLSearchParams({
    limit: options?.importJobId ? "250" : "100",
    importJobLimit: "8",
  });

  if (options?.importJobId) {
    searchParams.set("importJobId", options.importJobId);
  }

  if (options?.stageStatus && options.stageStatus !== "all") {
    searchParams.set("stageStatus", options.stageStatus);
  }

  const response = await fetch(
    `/api/account/seller/marketplace-connections/ebay/staged-items?${searchParams.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceStagedReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not load seller staged listings.",
      operationReceipt,
    );
  }

  return {
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    latestImportJob: (data.latestImportJob || null) as SellerImportJob | null,
    recentImportJobs: (data.recentImportJobs || []) as SellerImportJob[],
    operationReceipt,
  };
}

async function stageSellerItems(
  accessToken: string,
  options: { resetCursor?: boolean } = {},
) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        limit: 25,
        resetCursor: options.resetCursor === true,
      }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceStagedReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not stage seller eBay listings.",
      operationReceipt,
    );
  }

  return {
    ...(data.result as {
    importJobId: string | null;
    offset: number;
    nextOffset: number;
    hasMore: boolean;
    stagedCount: number;
    skippedCount: number;
    totalAvailable: number | null;
    fetchedAt: string;
    sampleItems: SellerEbayPreviewItem[];
    }),
    operationReceipt,
  };
}

async function fetchSellerInventory(accessToken: string) {
  const response = await fetch("/api/account/seller/inventory", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load seller inventory.");
  }

  return {
    summary: (data.summary || null) as SellerInventorySummary | null,
    recentItems: (data.recentItems || []) as SellerInventoryItem[],
  };
}

async function fetchSellerReconciliationStatus(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/reconcile",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceReconciliationReceipt(
    response.headers,
  );

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not load seller eBay reconciliation status.",
      operationReceipt,
    );
  }

  return {
    linkedCount: Number(data.linkedCount || 0),
    latestRun: (data.latestRun || null) as SellerReconciliationRun | null,
    recentRuns: (data.recentRuns || []) as SellerReconciliationRun[],
    operationReceipt,
  } satisfies SellerReconciliationStatus & {
    operationReceipt: SellerMarketplaceOperationReceipt | null;
  };
}

async function runSellerReconciliationBatch(
  accessToken: string,
  options: { resetCursor?: boolean } = {},
) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/reconcile",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ resetCursor: options.resetCursor === true }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceReconciliationReceipt(
    response.headers,
  );

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not reconcile seller eBay inventory.",
      operationReceipt,
    );
  }

  return {
    ...(data.result as SellerReconciliationResult),
    operationReceipt,
  };
}

async function fetchSellerOutsideOrderStatus(accessToken: string) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/orders",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceOrderImportReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not load outside eBay orders.",
      operationReceipt,
    );
  }

  return {
    orderCount: Number(data.orderCount || 0),
    paidCount: Number(data.paidCount || 0),
    refundedCount: Number(data.refundedCount || 0),
    unmatchedItemCount: Number(data.unmatchedItemCount || 0),
    latestImportedAt: data.latestImportedAt || null,
    operationReceipt,
  } satisfies SellerOutsideOrderStatus & {
    operationReceipt: SellerMarketplaceOperationReceipt | null;
  };
}

async function runSellerOutsideOrderImportBatch(
  accessToken: string,
  options: { resetCursor?: boolean } = {},
) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ resetCursor: options.resetCursor === true }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceOrderImportReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not import outside eBay orders.",
      operationReceipt,
    );
  }

  return {
    ...(data.result as SellerOutsideOrderImportResult),
    operationReceipt,
  };
}

async function updateSellerStagedItemStatus(params: {
  accessToken: string;
  stagedItemId?: string;
  stagedItemIds?: string[];
  stageStatus: "staged" | "needs_review" | "mapped" | "skipped";
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemId: params.stagedItemId,
        stagedItemIds: params.stagedItemIds,
        stageStatus: params.stageStatus,
      }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceStagedReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not update seller staged item.",
      operationReceipt,
    );
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    updatedCount: Number(data.updatedCount || 0),
    operationReceipt,
  };
}

async function trashDuplicateSellerStagedItems(params: {
  accessToken: string;
  stagedItemIds: string[];
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemIds: params.stagedItemIds,
        duplicateTrash: true,
      }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceStagedReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not move duplicate staged items to trash.",
      operationReceipt,
    );
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    updatedCount: Number(data.updatedCount || 0),
    skippedCount: Number(data.skippedCount || 0),
    duplicateTrashCount: Number(data.duplicateTrashCount || 0),
    operationReceipt,
  };
}

async function updateSellerStagedItemReview(params: {
  accessToken: string;
  stagedItemId: string;
  categoryHint: string;
  authenticity: AuthenticityProfile;
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemId: params.stagedItemId,
        categoryHint: params.categoryHint,
        authenticity: params.authenticity,
      }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplaceStagedReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not save seller staged item review.",
      operationReceipt,
    );
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    updatedCount: Number(data.updatedCount || 0),
    operationReceipt,
  };
}

async function promoteSellerStagedItem(params: {
  accessToken: string;
  stagedItemId?: string;
  stagedItemIds?: string[];
}) {
  const response = await fetch(
    "/api/account/seller/marketplace-connections/ebay/staged-items/promote",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        stagedItemId: params.stagedItemId,
        stagedItemIds: params.stagedItemIds,
      }),
    },
  );
  const data = await response.json();
  const operationReceipt = sellerMarketplacePromotionReceipt(response.headers);

  if (!response.ok) {
    throw new SellerMarketplaceOperationError(
      data.error || "Could not promote seller staged item.",
      operationReceipt,
    );
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    promotedItem: (data.promotedItem || null) as {
      legacyProductId: number;
      inventoryItemId: string | null;
    } | null,
    promotedItems: (data.promotedItems || []) as Array<{
      stagedItemId: string;
      legacyProductId: number;
      inventoryItemId: string | null;
    }>,
    promotedCount: Number(data.promotedCount || 0),
    errorCount: Number(data.errorCount || 0),
    errors: (data.errors || []) as Array<{
      stagedItemId: string;
      error: string;
    }>,
    operationReceipt,
  };
}

export default function SellerConnectionsPanel({
  ebaySyncEnabled,
}: {
  ebaySyncEnabled: boolean;
}) {
  const [initialStageWorkspace] = useState(initialStageWorkspaceState);
  const [session, setSession] = useState<StoredAccountSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [connections, setConnections] = useState<
    PublicSellerMarketplaceConnection[]
  >([]);
  const [stagedItems, setStagedItems] = useState<SellerStagedItem[]>([]);
  const [inventorySummary, setInventorySummary] =
    useState<SellerInventorySummary | null>(null);
  const [recentInventoryItems, setRecentInventoryItems] = useState<
    SellerInventoryItem[]
  >([]);
  const sellerDraftOutputLink = sellerDraftOutputHref(inventorySummary);
  const [lastBulkPromotionMode, setLastBulkPromotionMode] =
    useState<BulkPromotionMode | null>(null);
  const [latestImportJob, setLatestImportJob] = useState<SellerImportJob | null>(
    null,
  );
  const [recentImportJobs, setRecentImportJobs] = useState<SellerImportJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProvider, setIsSavingProvider] = useState("");
  const [preview, setPreview] = useState<SellerEbayInventoryPreview | null>(
    null,
  );
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isLoadingStaged, setIsLoadingStaged] = useState(false);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [isStagingItems, setIsStagingItems] = useState(false);
  const [isStagingAll, setIsStagingAll] = useState(false);
  const [stageAllStopRequested, setStageAllStopRequested] = useState(false);
  const [stageAllProgress, setStageAllProgress] =
    useState<SellerStageAllProgress | null>(null);
  const [reconciliationStatus, setReconciliationStatus] =
    useState<SellerReconciliationStatus | null>(null);
  const [reconciliationProgress, setReconciliationProgress] =
    useState<SellerReconciliationProgress | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isReconcilingAll, setIsReconcilingAll] = useState(false);
  const [outsideOrderStatus, setOutsideOrderStatus] =
    useState<SellerOutsideOrderStatus | null>(null);
  const [isImportingOutsideOrders, setIsImportingOutsideOrders] =
    useState(false);
  const [isImportingAllOutsideOrders, setIsImportingAllOutsideOrders] =
    useState(false);
  const [
    latestMarketplaceOperationReceipt,
    setLatestMarketplaceOperationReceipt,
  ] = useState<SellerMarketplaceOperationReceipt | null>(null);
  const marketplaceOperationReceiptSequenceRef = useRef(0);
  const [
    marketplaceOperationReceiptHistory,
    setMarketplaceOperationReceiptHistory,
  ] = useState<SellerMarketplaceOperationReceiptHistoryEntry[]>(
    sellerMarketplaceOperationReceiptHistoryFromSession,
  );
  const stageAllStopRequestedRef = useRef(false);
  const [updatingStageItemId, setUpdatingStageItemId] = useState("");
  const [editingReviewItemId, setEditingReviewItemId] = useState("");
  const [reviewCategoryHint, setReviewCategoryHint] = useState("other_collectable");
  const [reviewAuthenticityStatus, setReviewAuthenticityStatus] =
    useState<AuthenticityProfile["status"]>("not_applicable");
  const [reviewAutographSource, setReviewAutographSource] =
    useState<AuthenticityProfile["autographSource"]>("none");
  const [reviewCertProvider, setReviewCertProvider] = useState("");
  const [reviewCertNumber, setReviewCertNumber] = useState("");
  const [reviewGuaranteedAuthenticators, setReviewGuaranteedAuthenticators] =
    useState("");
  const [reviewProvenanceEvidence, setReviewProvenanceEvidence] = useState("");
  const [reviewAuthenticityNotes, setReviewAuthenticityNotes] = useState("");
  const [selectedStageItemIds, setSelectedStageItemIds] = useState<string[]>([]);
  const [lastBulkPromotionSuccesses, setLastBulkPromotionSuccesses] = useState<
    Array<{
      stagedItemId: string;
      legacyProductId: number;
      inventoryItemId: string | null;
    }>
  >([]);
  const [lastBulkPromotionErrors, setLastBulkPromotionErrors] = useState<
    Array<{ stagedItemId: string; error: string }>
  >([]);
  const [promotingStageItemId, setPromotingStageItemId] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>(
    initialStageWorkspace.filter,
  );
  const [activeImportJobId, setActiveImportJobId] = useState<string | null>(
    initialStageWorkspace.importJobId,
  );
  const [stagedSearch, setStagedSearch] = useState(initialStageWorkspace.search);
  const [message, setMessage] = useState(() => {
    if (typeof window === "undefined") return "";

    const params = new URLSearchParams(window.location.search);
    const ebayStatus = params.get("ebay");
    const ebayMessage = params.get("message");

    if (ebayMessage) return ebayMessage;
    if (ebayStatus === "connected") return "eBay seller connection saved.";
    if (ebayStatus === "error") return "eBay seller connection failed.";
    return "";
  });

  const rememberOperationErrorReceipt = useCallback((error: unknown) => {
    const operationReceipt = operationReceiptFromError(error);

    if (operationReceipt) {
      setLatestMarketplaceOperationReceipt(operationReceipt);
    }
  }, []);

  useEffect(() => {
    if (!latestMarketplaceOperationReceipt) return;

    marketplaceOperationReceiptSequenceRef.current += 1;
    const historyEntry = {
      ...latestMarketplaceOperationReceipt,
      historyKey: `seller-marketplace-receipt-${marketplaceOperationReceiptSequenceRef.current}`,
    } satisfies SellerMarketplaceOperationReceiptHistoryEntry;

    setMarketplaceOperationReceiptHistory((current) =>
      [historyEntry, ...current].slice(
        0,
        SELLER_MARKETPLACE_RECEIPT_HISTORY_LIMIT,
      ),
    );
  }, [latestMarketplaceOperationReceipt]);

  useEffect(() => {
    saveSellerMarketplaceOperationReceiptHistoryToSession(
      marketplaceOperationReceiptHistory,
    );
  }, [marketplaceOperationReceiptHistory]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const freshSession =
        typeof window === "undefined"
          ? null
          : await getFreshAccountSession(5 * 60, true);

      if (cancelled) return;

      setSession(freshSession);
      setAuthChecked(true);

      if (!freshSession?.access_token) {
        setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshSellerStageState = useCallback(async (
    accessToken: string,
    options?: { silent?: boolean; importJobId?: string | null },
  ) => {
    setIsLoadingStaged(true);
    const requestedImportJobId =
      options && "importJobId" in options ? options.importJobId ?? null : activeImportJobId;

    try {
      const data = await fetchSellerStagedItems(accessToken, {
        importJobId: requestedImportJobId,
        stageStatus: stageFilter,
      });
      setStagedItems(data.stagedItems);
      setLatestImportJob(data.latestImportJob);
      setRecentImportJobs(data.recentImportJobs);
      if (!options?.silent) {
        setLatestMarketplaceOperationReceipt(data.operationReceipt);
      }
      setActiveImportJobId(
        requestedImportJobId &&
          data.stagedItems.some((item) => item.import_job_id === requestedImportJobId)
          ? requestedImportJobId
          : null,
      );
      setLastBulkPromotionSuccesses((current) =>
        current.filter((entry) => data.stagedItems.some((item) => item.id === entry.stagedItemId)),
      );
      setLastBulkPromotionErrors((current) =>
        current.filter((entry) => data.stagedItems.some((item) => item.id === entry.stagedItemId)),
      );
      setSelectedStageItemIds((current) =>
        current.filter((id) => data.stagedItems.some((item) => item.id === id)),
      );
      return data;
    } catch (error: any) {
      if (!options?.silent) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not load seller staged listings.");
      }
      return null;
    } finally {
      setIsLoadingStaged(false);
    }
  }, [activeImportJobId, rememberOperationErrorReceipt, stageFilter]);

  const refreshSellerInventoryState = useCallback(async (
    accessToken: string,
    options?: { silent?: boolean },
  ) => {
    setIsLoadingInventory(true);

    try {
      const data = await fetchSellerInventory(accessToken);
      setInventorySummary(data.summary);
      setRecentInventoryItems(data.recentItems);
    } catch (error: any) {
      if (!options?.silent) {
        setMessage(error.message || "Could not load seller inventory.");
      }
    } finally {
      setIsLoadingInventory(false);
    }
  }, []);

  const refreshSellerReconciliationState = useCallback(async (
    accessToken: string,
    options?: { silent?: boolean },
  ) => {
    try {
      const status = await fetchSellerReconciliationStatus(accessToken);
      setReconciliationStatus(status);
      if (!options?.silent) {
        setLatestMarketplaceOperationReceipt(status.operationReceipt);
      }
      return status;
    } catch (error: any) {
      if (!options?.silent) {
        rememberOperationErrorReceipt(error);
        setMessage(
          error.message || "Could not load seller eBay reconciliation status.",
        );
      }
      return null;
    }
  }, [rememberOperationErrorReceipt]);

  const refreshSellerOutsideOrderState = useCallback(async (
    accessToken: string,
    options?: { silent?: boolean },
  ) => {
    try {
      const status = await fetchSellerOutsideOrderStatus(accessToken);
      setOutsideOrderStatus(status);
      if (!options?.silent) {
        setLatestMarketplaceOperationReceipt(status.operationReceipt);
      }
      return status;
    } catch (error: any) {
      if (!options?.silent) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not load outside eBay orders.");
      }
      return null;
    }
  }, [rememberOperationErrorReceipt]);

  useEffect(() => {
    if (!session?.access_token) return;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const nextConnections = await fetchSellerConnections(
            session.access_token,
          );
          setConnections(nextConnections);
          setMessage("");
          await refreshSellerStageState(session.access_token, { silent: true });
          await refreshSellerInventoryState(session.access_token, { silent: true });
          await refreshSellerReconciliationState(session.access_token, {
            silent: true,
          });
          await refreshSellerOutsideOrderState(session.access_token, {
            silent: true,
          });
        } catch (error: any) {
          setMessage(
            error.message || "Could not load seller marketplace connections.",
          );
          setConnections([]);
        } finally {
          setIsLoading(false);
        }
      })();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [
    refreshSellerInventoryState,
    refreshSellerOutsideOrderState,
    refreshSellerReconciliationState,
    refreshSellerStageState,
    session?.access_token,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const normalizedSearch = stagedSearch.trim();

    if (stageFilter === "all") {
      params.delete("stage");
    } else {
      params.set("stage", stageFilter);
    }

    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    } else {
      params.delete("search");
    }

    if (activeImportJobId) {
      params.set("importJobId", activeImportJobId);
    } else {
      params.delete("importJobId");
    }

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [activeImportJobId, stageFilter, stagedSearch]);

  async function requestConnection(provider: SellerMarketplaceProvider) {
    if (!session?.access_token) return;
    if (provider === "ebay" && !ebaySyncEnabled) {
      setMessage(
        "eBay sync is disabled for this store. Ask a store admin to enable it before connecting seller eBay accounts.",
      );
      return;
    }

    setIsSavingProvider(provider);
    setMessage("");

    try {
      const endpoint =
        provider === "ebay"
          ? "/api/account/seller/marketplace-connections/ebay/auth"
          : "/api/account/seller/marketplace-connections";
      const payload = provider === "ebay" ? {} : { provider };
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      const operationReceipt =
        provider === "ebay"
          ? sellerMarketplaceEbayAuthReceipt(response.headers)
          : null;

      if (!response.ok) {
        throw new SellerMarketplaceOperationError(
          data.error || "Could not save seller marketplace connection.",
          operationReceipt,
        );
      }

      if (provider === "ebay") {
        setLatestMarketplaceOperationReceipt(operationReceipt);
      }

      if (provider === "ebay" && data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }

      setMessage(`${label(provider)} connection request saved.`);
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(
          error.message || "Could not save seller marketplace connection.",
        );
    } finally {
      setIsSavingProvider("");
    }
  }

  async function refreshEbayStatus() {
    if (!session?.access_token) return;

    setIsSavingProvider("ebay-status");
    setMessage("");

    try {
      const response = await fetch(
        "/api/account/seller/marketplace-connections/ebay/status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const data = await response.json();
      const operationReceipt = sellerMarketplaceEbayStatusReceipt(
        response.headers,
      );

      if (!response.ok) {
        throw new SellerMarketplaceOperationError(
          data.error || "Could not refresh seller eBay status.",
          operationReceipt,
        );
      }

      setLatestMarketplaceOperationReceipt(operationReceipt);
      setMessage("Seller eBay status refreshed.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not refresh seller eBay status.");
      } finally {
      setIsSavingProvider("");
    }
  }

  async function changeSellerEbaySync(paused: boolean) {
    if (!session?.access_token || isSavingProvider.length > 0) return;

    if (
      paused &&
      !window.confirm(
        "Pause seller eBay sync? TCOS will stop reading new eBay data. Stored credentials, staged listings, import history, and seller inventory will remain intact.",
      )
    ) {
      return;
    }

    setIsSavingProvider(paused ? "ebay-pause" : "ebay-resume");
    setMessage("");

    try {
      const response = await fetch(
        "/api/account/seller/marketplace-connections/ebay/sync-control",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ action: paused ? "pause" : "resume" }),
        },
      );
      const data = await response.json();
      const operationReceipt = sellerMarketplaceSyncControlReceipt(
        response.headers,
      );

      if (!response.ok) {
        throw new SellerMarketplaceOperationError(
          data.error || "Could not update seller eBay sync.",
          operationReceipt,
        );
      }

      if (paused) {
        setPreview(null);
        setStageAllProgress(null);
      }

      setLatestMarketplaceOperationReceipt(operationReceipt);
      setMessage(
        paused
          ? "Seller eBay sync paused. Credentials and imported work remain safe."
          : "Seller eBay sync resumed and is ready for preview or staging.",
      );
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not update seller eBay sync.");
      } finally {
      setIsSavingProvider("");
    }
  }

  async function disconnectEbay() {
    if (!session?.access_token || isSavingProvider.length > 0) return;

    const confirmed = window.confirm(
      "Disconnect seller eBay from TCOS? TCOS will permanently delete its stored eBay access and refresh tokens. Existing staged items and import history will remain for your records.",
    );

    if (!confirmed) return;

    setIsSavingProvider("ebay-disconnect");
    setMessage("");

    try {
      const response = await fetch(
        "/api/account/seller/marketplace-connections/ebay/disconnect",
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const data = await response.json();
      const operationReceipt = sellerMarketplaceEbayDisconnectReceipt(
        response.headers,
      );

      if (!response.ok) {
        throw new SellerMarketplaceOperationError(
          data.error || "Could not disconnect seller eBay.",
          operationReceipt,
        );
      }

      setPreview(null);
      setStageAllProgress(null);
      setLatestMarketplaceOperationReceipt(operationReceipt);
      setMessage(
        "Seller eBay disconnected and TCOS credentials deleted. To invalidate eBay's authorization immediately, also remove TCOS under eBay Third-party app access.",
      );
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not disconnect seller eBay.");
      } finally {
      setIsSavingProvider("");
    }
  }

  async function loadPreview() {
    if (!session?.access_token || !ebaySyncEnabled) return;

    setIsLoadingPreview(true);
    setMessage("");

    try {
      const nextPreview = await fetchSellerEbayPreview(session.access_token);
      setPreview(nextPreview.preview);
      setLatestMarketplaceOperationReceipt(nextPreview.operationReceipt);
      setMessage("Seller eBay preview loaded.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not load seller eBay import preview.");
      } finally {
      setIsLoadingPreview(false);
    }
  }

  async function stagePreviewBatch(resetCursor = false) {
    if (!session?.access_token || !ebaySyncEnabled) return;

    setIsStagingItems(true);
    setMessage("");

    try {
      const result = await stageSellerItems(session.access_token, {
        resetCursor,
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      const batchRange =
        result.nextOffset > result.offset
          ? `Remote listings ${result.offset + 1}-${result.nextOffset}`
          : `No remote listings found at offset ${result.offset}`;
      setMessage(
        `${resetCursor ? "Seller eBay import restarted. " : ""}${batchRange}. ${result.stagedCount} items captured, ${result.skippedCount} skipped.${result.hasMore ? " The next batch is ready." : " All available listings have been reached."}`,
      );
      await refreshSellerStageState(session.access_token, {
        importJobId: result.importJobId || null,
      });

      if (preview) {
        setPreview({
          ...preview,
          sampleItems: result.sampleItems,
          sampled: result.sampleItems.length,
          totalAvailable: result.totalAvailable,
          hasMore: result.hasMore,
          fetchedAt: result.fetchedAt,
        });
      }

      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not stage seller eBay listings.");
      } finally {
      setIsStagingItems(false);
    }
  }

  async function stageAllRemaining() {
    if (!session?.access_token || !ebaySyncEnabled || isStagingItems) return;

    const accessToken = session.access_token;
    let batchesCompleted = 0;
    let processedCount = 0;
    let stagedCount = 0;
    let skippedCount = 0;
    let nextOffset = latestStageNextOffset || 0;
    let totalAvailable: number | null = null;
    let stopped = false;
    let latestReceipt: SellerMarketplaceOperationReceipt | null = null;

    stageAllStopRequestedRef.current = false;
    setStageAllStopRequested(false);
    setStageAllProgress({
      batchesCompleted,
      processedCount,
      stagedCount,
      skippedCount,
      nextOffset,
      totalAvailable,
    });
    setIsStagingItems(true);
    setIsStagingAll(true);
    setMessage("Staging all remaining seller eBay listings...");

    try {
      let hasMore = true;

      while (hasMore) {
        if (batchesCompleted >= 400) {
          throw new Error(
            "The safe 10,000-listing limit was reached. Resume in a new run after reviewing the staged inventory.",
          );
        }

        const result = await stageSellerItems(accessToken);

        if (result.hasMore && result.nextOffset <= result.offset) {
          throw new Error(
            "eBay did not advance the import cursor. The run was paused to prevent a duplicate loop.",
          );
        }

        batchesCompleted += 1;
        processedCount += result.sampleItems.length;
        stagedCount += result.stagedCount;
        skippedCount += result.skippedCount;
        nextOffset = result.nextOffset;
        totalAvailable = result.totalAvailable;
        hasMore = result.hasMore;
        latestReceipt = result.operationReceipt;

        const progress = {
          batchesCompleted,
          processedCount,
          stagedCount,
          skippedCount,
          nextOffset,
          totalAvailable,
        };
        setStageAllProgress(progress);
        setPreview((current) =>
          current
            ? {
                ...current,
                sampleItems: result.sampleItems,
                sampled: result.sampleItems.length,
                totalAvailable: result.totalAvailable,
                hasMore: result.hasMore,
                fetchedAt: result.fetchedAt,
              }
            : current,
        );
        setMessage(
          `Staging seller eBay listings: ${nextOffset}${typeof totalAvailable === "number" ? ` of ${totalAvailable}` : " processed"}. ${batchesCompleted} batch${batchesCompleted === 1 ? "" : "es"} completed.`,
        );

        if (stageAllStopRequestedRef.current && hasMore) {
          stopped = true;
          break;
        }
      }

      if (stopped) {
        setLatestMarketplaceOperationReceipt(latestReceipt);
        setMessage(
          `Seller eBay staging stopped safely after ${processedCount} listing${processedCount === 1 ? "" : "s"} in ${batchesCompleted} completed batch${batchesCompleted === 1 ? "" : "es"}. Run Stage All Remaining to resume at listing ${nextOffset + 1}.`,
        );
      } else {
        setLatestMarketplaceOperationReceipt(latestReceipt);
        setMessage(
          `Seller eBay staging complete. ${processedCount} listing${processedCount === 1 ? "" : "s"} processed across ${batchesCompleted} batch${batchesCompleted === 1 ? "" : "es"}; ${stagedCount} captured and ${skippedCount} skipped.`,
        );
      }
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(
          `Seller eBay staging paused safely after ${processedCount} completed listing${processedCount === 1 ? "" : "s"}. ${error.message || "The next batch could not be staged."} Run Stage All Remaining again to resume.`,
        );
    } finally {
      await refreshSellerStageState(accessToken, {
        silent: true,
        importJobId: null,
      });

      try {
        const nextConnections = await fetchSellerConnections(accessToken);
        setConnections(nextConnections);
      } catch {
        // The completed staging cursor remains durable even if this UI refresh fails.
      }

      stageAllStopRequestedRef.current = false;
      setStageAllStopRequested(false);
      setIsStagingAll(false);
      setIsStagingItems(false);
    }
  }

  function stopStageAllAfterCurrentBatch() {
    stageAllStopRequestedRef.current = true;
    setStageAllStopRequested(true);
    setMessage("Stop requested. TCOS will finish the current batch and preserve the next cursor.");
  }

  async function importSellerOutsideOrders(options: {
    all: boolean;
    resetCursor?: boolean;
  }) {
    if (
      !session?.access_token ||
      !canUseSellerEbayTools ||
      !ebayOrderImportReady ||
      isImportingOutsideOrders
    ) {
      return;
    }

    const accessToken = session.access_token;
    let batchesCompleted = 0;
    let importedOrders = 0;
    let importedItems = 0;
    let reduced = 0;
    let sold = 0;
    let review = 0;
    let failed = 0;
    let hasMore = true;
    let resetCursor = options.resetCursor === true;
    let latestReceipt: SellerMarketplaceOperationReceipt | null = null;

    setIsImportingOutsideOrders(true);
    setIsImportingAllOutsideOrders(options.all);
    setMessage(
      options.all
        ? "Importing all recent outside eBay orders..."
        : "Importing the next outside eBay order batch...",
    );

    try {
      while (hasMore) {
        if (batchesCompleted >= 200) {
          throw new Error(
            "The safe 5,000-order limit was reached. Run the import again to resume from the saved cursor.",
          );
        }

        const result = await runSellerOutsideOrderImportBatch(accessToken, {
          resetCursor,
        });
        resetCursor = false;
        batchesCompleted += 1;
        importedOrders += result.importedOrderCount;
        importedItems += result.importedItemCount;
        reduced += result.inventoryReducedCount;
        sold += result.soldCount;
        review += result.reviewCount + result.unmatchedItemCount;
        failed += result.failedItemCount;
        hasMore = result.hasMore;
        latestReceipt = result.operationReceipt;

        if (!options.all) break;
      }

      setLatestMarketplaceOperationReceipt(latestReceipt);
      setMessage(
        `Outside eBay order import ${hasMore ? "batch complete" : "complete"}. ${importedOrders} order${importedOrders === 1 ? "" : "s"} and ${importedItems} line item${importedItems === 1 ? "" : "s"} recorded; ${reduced} quantities reduced, ${sold} marked sold, ${review} need review, and ${failed} failed. TCOS fees and payouts were not touched.`,
      );
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(
          `Outside eBay order import stopped safely after ${importedOrders} order${importedOrders === 1 ? "" : "s"}. ${error.message || "The next batch could not be imported."}`,
        );
    } finally {
      await Promise.all([
        refreshSellerOutsideOrderState(accessToken, { silent: true }),
        refreshSellerInventoryState(accessToken, { silent: true }),
        refreshSellerReconciliationState(accessToken, { silent: true }),
      ]);
      setIsImportingAllOutsideOrders(false);
      setIsImportingOutsideOrders(false);
    }
  }

  async function reconcileSellerInventory(options: {
    all: boolean;
    resetCursor?: boolean;
  }) {
    if (
      !session?.access_token ||
      !canUseSellerEbayTools ||
      isReconciling ||
      isStagingItems
    ) {
      return;
    }

    const accessToken = session.access_token;
    let batchesCompleted = 0;
    let scannedCount = 0;
    let matchedCount = 0;
    let quantityReducedCount = 0;
    let soldCount = 0;
    let reviewCount = 0;
    let failedCount = 0;
    let nextOffset = 0;
    let totalLinked = reconciliationStatus?.linkedCount || 0;
    let resetCursor = options.resetCursor === true;
    let latestReceipt: SellerMarketplaceOperationReceipt | null = null;

    setIsReconciling(true);
    setIsReconcilingAll(options.all);
    setMessage(
      options.all
        ? "Reconciling all linked seller eBay inventory..."
        : "Reconciling the next linked seller eBay batch...",
    );

    try {
      let hasMore = true;

      while (hasMore) {
        if (batchesCompleted >= 400) {
          throw new Error(
            "The safe 10,000-item reconciliation limit was reached. Resume from the saved cursor after reviewing the latest results.",
          );
        }

        const result = await runSellerReconciliationBatch(accessToken, {
          resetCursor,
        });
        resetCursor = false;

        if (result.hasMore && result.nextOffset <= result.offset) {
          throw new Error(
            "The reconciliation cursor did not advance, so TCOS stopped before repeating a batch.",
          );
        }

        batchesCompleted += 1;
        scannedCount += result.scannedCount;
        matchedCount += result.matchedCount;
        quantityReducedCount += result.quantityReducedCount;
        soldCount += result.soldCount;
        reviewCount += result.reviewCount;
        failedCount += result.failedCount;
        nextOffset = result.nextOffset;
        totalLinked = result.totalLinked;
        hasMore = result.hasMore;
        latestReceipt = result.operationReceipt;

        setReconciliationProgress({
          batchesCompleted,
          scannedCount,
          matchedCount,
          quantityReducedCount,
          soldCount,
          reviewCount,
          failedCount,
          nextOffset,
          totalLinked,
        });

        if (!options.all) break;
      }

      setLatestMarketplaceOperationReceipt(latestReceipt);
      setMessage(
        `Seller eBay reconciliation ${hasMore ? "batch complete" : "complete"}. ${scannedCount} linked item${scannedCount === 1 ? "" : "s"} checked; ${quantityReducedCount} reduced, ${soldCount} marked sold, ${reviewCount} flagged for review, and ${failedCount} failed. No TCOS fee was created for outside sales.`,
      );
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(
          `Seller eBay reconciliation stopped safely after ${scannedCount} checked item${scannedCount === 1 ? "" : "s"}. ${error.message || "The next batch could not be reconciled."}`,
        );
    } finally {
      await Promise.all([
        refreshSellerReconciliationState(accessToken, { silent: true }),
        refreshSellerInventoryState(accessToken, { silent: true }),
        refreshSellerStageState(accessToken, { silent: true }),
      ]);

      try {
        setConnections(await fetchSellerConnections(accessToken));
      } catch {
        // Reconciliation results remain durable if this UI refresh fails.
      }

      setIsReconcilingAll(false);
      setIsReconciling(false);
    }
  }

  async function setStageStatus(
    stagedItemId: string,
    stageStatus: "staged" | "needs_review" | "mapped" | "skipped",
  ) {
    if (!session?.access_token) return;

    setUpdatingStageItemId(stagedItemId);
    setMessage("");

    try {
      const result = await updateSellerStagedItemStatus({
        accessToken: session.access_token,
        stagedItemId,
        stageStatus,
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      setLastBulkPromotionSuccesses([]);
      setLastBulkPromotionErrors([]);
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      setMessage(`Staged item moved to ${label(stageStatus)}.`);
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not update seller staged item.");
      } finally {
      setUpdatingStageItemId("");
    }
  }

  function openStageReviewEditor(item: SellerStagedItem) {
    const metadata = metadataRecord(item.metadata);
    const authenticity = stagedAuthenticityProfile(item);

    setEditingReviewItemId(item.id);
    setReviewCategoryHint(
      metadataTextValue(metadata, "category_hint") || "other_collectable",
    );
    setReviewAuthenticityStatus(authenticity.status);
    setReviewAutographSource(authenticity.autographSource);
    setReviewCertProvider(authenticity.certProvider || "");
    setReviewCertNumber(authenticity.certNumber || "");
    setReviewGuaranteedAuthenticators(
      authenticity.guaranteedAuthenticators.join(", "),
    );
    setReviewProvenanceEvidence(authenticity.provenanceEvidence || "");
    setReviewAuthenticityNotes(authenticity.authenticityNotes || "");
    setMessage("");
  }

  function closeStageReviewEditor() {
    setEditingReviewItemId("");
    setReviewCategoryHint("other_collectable");
    setReviewAuthenticityStatus("not_applicable");
    setReviewAutographSource("none");
    setReviewCertProvider("");
    setReviewCertNumber("");
    setReviewGuaranteedAuthenticators("");
    setReviewProvenanceEvidence("");
    setReviewAuthenticityNotes("");
  }

  async function saveStageReview(itemId: string) {
    if (!session?.access_token) return;

    setUpdatingStageItemId(itemId);
    setMessage("");

    try {
      const result = await updateSellerStagedItemReview({
        accessToken: session.access_token,
        stagedItemId: itemId,
        categoryHint: reviewCategoryHint,
        authenticity: sanitizeAuthenticityProfile({
          status: reviewAuthenticityStatus,
          autographSource: reviewAutographSource,
          certProvider: reviewCertProvider,
          certNumber: reviewCertNumber,
          guaranteedAuthenticators: reviewGuaranteedAuthenticators,
          provenanceEvidence: reviewProvenanceEvidence,
          authenticityNotes: reviewAuthenticityNotes,
        }),
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      await refreshSellerStageState(session.access_token, { silent: true });
      closeStageReviewEditor();
      setMessage("Staged listing review details saved.");
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not save seller staged item review.");
      } finally {
      setUpdatingStageItemId("");
    }
  }

  async function setBulkStageStatus(
    stageStatus: "staged" | "needs_review" | "skipped",
  ) {
    const targetIds =
      stageStatus === "staged"
        ? selectedMarkStagedIds
        : stageStatus === "needs_review"
          ? selectedMarkReviewIds
          : selectedMarkSkippedIds;

    await setBulkStageStatusForIds(targetIds, stageStatus);
  }

  async function trashExactDuplicateStageItems(stageItemIds: string[]) {
    if (!session?.access_token || stageItemIds.length === 0) {
      if (session?.access_token) {
        setMessage("No exact eBay duplicate staged listings are selected.");
      }
      return;
    }

    const confirmed = window.confirm(
      `Move ${stageItemIds.length} exact eBay duplicate staged row(s) to Duplicate Trash? They will be hidden from active work but not permanently deleted until you verify them.`,
    );

    if (!confirmed) return;

    setUpdatingStageItemId("bulk-duplicate-trash");
    setMessage("");
    setLastBulkPromotionSuccesses([]);
    setLastBulkPromotionErrors([]);

    try {
      const result = await trashDuplicateSellerStagedItems({
        accessToken: session.access_token,
        stagedItemIds: stageItemIds,
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      setSelectedStageItemIds((current) =>
        current.filter((id) => !stageItemIds.includes(id)),
      );
      setMessage(
        `${result.duplicateTrashCount || result.updatedCount} exact duplicate staged listing(s) moved to Duplicate Trash for verification before permanent delete.${result.skippedCount > 0 ? ` ${result.skippedCount} SKU-only or resolved row(s) were left alone.` : ""}`,
      );
    } catch (error: any) {
      rememberOperationErrorReceipt(error);
      setMessage(error.message || "Could not move duplicate staged items to trash.");
    } finally {
      setUpdatingStageItemId("");
    }
  }

  async function promoteStageItem(stagedItemId: string) {
    if (!session?.access_token) return;
    const stagedItem = stagedItems.find((item) => item.id === stagedItemId);
    const promotionMode = stagedItem && hasDraftActivationCleanup(stagedItem)
      ? "draft_cleanup"
      : "ready";

    setPromotingStageItemId(stagedItemId);
    setMessage("");
    setLastBulkPromotionSuccesses([]);
    setLastBulkPromotionErrors([]);
    setLastBulkPromotionMode(promotionMode);

    try {
      const result = await promoteSellerStagedItem({
        accessToken: session.access_token,
        stagedItemId,
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      if (result.promotedItem?.legacyProductId) {
        setLastBulkPromotionSuccesses([
          {
            stagedItemId,
            legacyProductId: result.promotedItem.legacyProductId,
            inventoryItemId: result.promotedItem.inventoryItemId,
          },
        ]);
      }
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      await refreshSellerReconciliationState(session.access_token, {
        silent: true,
      });
      setMessage(
        promotionMode === "draft_cleanup"
          ? `Created seller draft product #${result.promotedItem?.legacyProductId} with activation cleanup still required.`
          : `Created seller draft product #${result.promotedItem?.legacyProductId}.`,
      );
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not promote seller staged item.");
      } finally {
      setPromotingStageItemId("");
    }
  }

  async function promoteSelectedStageItems() {
    if (!session?.access_token || selectedStageItemIds.length === 0) return;

    const promotableItems = stagedItems.filter(
      (item) =>
        selectedStageItemIds.includes(item.id) &&
        isDraftActivationReadyStageItem(item),
    );

    if (promotableItems.length === 0) {
      setMessage("No selected staged listings are ready to promote.");
      return;
    }

    await runBulkPromotion({
      stageItemIds: promotableItems.map((item) => item.id),
      progressKey: "bulk-promote",
      emptyMessage: "No selected staged listings are ready to promote.",
      mode: "ready",
    });
  }

  async function promoteSelectedDraftCleanupItems() {
    if (!session?.access_token || selectedStageItemIds.length === 0) return;

    const promotableItems = stagedItems.filter(
      (item) =>
        selectedStageItemIds.includes(item.id) && hasDraftActivationCleanup(item),
    );

    if (promotableItems.length === 0) {
      setMessage(
        "No selected staged listings can promote into drafts that still need cleanup.",
      );
      return;
    }

    await runBulkPromotion({
      stageItemIds: promotableItems.map((item) => item.id),
      progressKey: "bulk-promote-draft-cleanup",
      emptyMessage:
        "No selected staged listings can promote into drafts that still need cleanup.",
      mode: "draft_cleanup",
    });
  }

  async function promoteAllReadyStageItems() {
    await runBulkPromotion({
      stageItemIds: readyStageItemIds,
      progressKey: "bulk-promote-all-ready",
      emptyMessage: "No ready staged listings are available to promote.",
      mode: "ready",
    });
  }

  async function promoteAllDraftCleanupStageItems() {
    await runBulkPromotion({
      stageItemIds: draftCleanupStageItemIds,
      progressKey: "bulk-promote-all-draft-cleanup",
      emptyMessage:
        "No draft-cleanup staged listings are available to promote.",
      mode: "draft_cleanup",
    });
  }

  async function runBulkPromotion(params: {
    stageItemIds: string[];
    progressKey: string;
    emptyMessage: string;
    mode: BulkPromotionMode;
  }) {
    if (!session?.access_token || params.stageItemIds.length === 0) {
      if (session?.access_token) {
        setMessage(params.emptyMessage);
      }
      return;
    }

    setPromotingStageItemId(params.progressKey);
    setMessage("");
    setLastBulkPromotionSuccesses([]);
    setLastBulkPromotionErrors([]);
    setLastBulkPromotionMode(params.mode);

    let promotedCount = 0;
    let firstError = "";
    let promotedStageItemIds: string[] = [];
    let promotedItems: Array<{
      stagedItemId: string;
      legacyProductId: number;
      inventoryItemId: string | null;
    }> = [];
    let promotionErrors: Array<{ stagedItemId: string; error: string }> = [];
    let operationReceipt: SellerMarketplaceOperationReceipt | null = null;

    try {
      for (let index = 0; index < params.stageItemIds.length; index += SELLER_STAGED_PROMOTION_BATCH_SIZE) {
        const chunk = params.stageItemIds.slice(
          index,
          index + SELLER_STAGED_PROMOTION_BATCH_SIZE,
        );
        const result = await promoteSellerStagedItem({
          accessToken: session.access_token,
          stagedItemIds: chunk,
        });
        promotedItems = [...promotedItems, ...result.promotedItems];
        promotionErrors = [...promotionErrors, ...result.errors];
        operationReceipt = result.operationReceipt;
      }

      promotedCount = promotedItems.length;
      promotedStageItemIds = promotedItems.map((item) => item.stagedItemId);
      firstError = promotionErrors[0]?.error || "";
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        firstError = error.message || "Could not bulk promote seller staged items.";
      }

    await refreshSellerStageState(session.access_token, { silent: true });
    await refreshSellerInventoryState(session.access_token, { silent: true });
    await refreshSellerReconciliationState(session.access_token, {
      silent: true,
    });
    if (promotedStageItemIds.length > 0) {
      setSelectedStageItemIds((current) =>
        current.filter((id) => !promotedStageItemIds.includes(id)),
      );
    }
    setLastBulkPromotionSuccesses(promotedItems);
    setLastBulkPromotionErrors(promotionErrors);
    setLatestMarketplaceOperationReceipt(operationReceipt);

    if (firstError && promotedCount > 0) {
      setMessage(
        params.mode === "draft_cleanup"
          ? `Promoted ${promotedCount} of ${params.stageItemIds.length} staged listing(s) into drafts that still need activation cleanup. ${firstError}`
          : `Promoted ${promotedCount} of ${params.stageItemIds.length} staged listing(s). ${firstError}`,
      );
    } else if (firstError) {
      setMessage(firstError);
    } else {
      setMessage(
        params.mode === "draft_cleanup"
          ? `Promoted ${promotedCount} staged listing(s) into drafts that still need activation cleanup.`
          : `Promoted ${promotedCount} staged listing(s) into seller draft inventory.`,
      );
    }

    setPromotingStageItemId("");
  }

  async function setBulkStageStatusForIds(
    stageItemIds: string[],
    stageStatus: "staged" | "needs_review" | "skipped",
  ) {
    if (!session?.access_token || stageItemIds.length === 0) {
      if (session?.access_token) {
        setMessage(`No selected staged listings need to move to ${label(stageStatus)}.`);
      }
      return;
    }

    setUpdatingStageItemId(`bulk-${stageStatus}`);
    setMessage("");
    setLastBulkPromotionSuccesses([]);
    setLastBulkPromotionErrors([]);

    try {
      const result = await updateSellerStagedItemStatus({
        accessToken: session.access_token,
        stagedItemIds: stageItemIds,
        stageStatus,
      });
      setLatestMarketplaceOperationReceipt(result.operationReceipt);
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      setSelectedStageItemIds((current) =>
        current.filter((id) => !stageItemIds.includes(id)),
      );
      setMessage(
        `${result.updatedCount || stageItemIds.length} staged listing(s) moved to ${label(stageStatus)}.`,
      );
      } catch (error: any) {
        rememberOperationErrorReceipt(error);
        setMessage(error.message || "Could not update seller staged items.");
      } finally {
      setUpdatingStageItemId("");
    }
  }

  const ebayConnection = connections.find(
    (connection) => connection.provider === "ebay",
  );
  const sellerEbaySyncPaused =
    ebayConnection?.connectionStatus === "sync_paused" ||
    ebayConnection?.syncStatus === "paused";
  const sellerEbayAuthorized =
    ebayConnection?.connectionStatus === "connected" ||
    ebayConnection?.connectionStatus === "sync_paused";
  const canUseSellerEbayTools =
    Boolean(session?.access_token) &&
    ebaySyncEnabled &&
    sellerEbayAuthorized &&
    !sellerEbaySyncPaused;
  const ebayRevocationProtectionReady =
    sellerEbayAuthorized &&
    ebayConnection.oauthScope.includes(EBAY_IDENTITY_SCOPE) &&
    Boolean(ebayConnection.providerAccountId);
  const ebayRevocationProtectionNeedsReconnect =
    sellerEbayAuthorized &&
    !ebayRevocationProtectionReady;
  const ebayOrderImportReady =
    sellerEbayAuthorized &&
    Boolean(ebayConnection?.oauthScope.includes(EBAY_FULFILLMENT_SCOPE));
  const stagedSummary = stagedItems.reduce(
    (summary, item) => {
      summary.total += 1;

      if (item.stage_status === "needs_review") summary.needs_review += 1;
      if (item.stage_status === "staged") summary.staged += 1;
      if (item.stage_status === "mapped") summary.mapped += 1;
      if (item.stage_status === "skipped") summary.skipped += 1;

      if (stageSignals(item).some((signal) => signal.tone === "warning")) {
        summary.attention += 1;
      }

      if (isActivePromotionBlocked(item)) {
        summary.blocked += 1;
      }

      if (isDuplicateTrashItem(item)) {
        summary.duplicate_trash += 1;
      }

      if (isDraftActivationReadyStageItem(item)) {
        summary.ready += 1;
      }

      if (hasDraftActivationCleanup(item)) {
        summary.draft_cleanup += 1;
      }

      if (item.promotion_guard?.alreadyPromoted) {
        summary.promoted += 1;
      }

      return summary;
    },
    {
      total: 0,
      needs_review: 0,
      staged: 0,
      mapped: 0,
      skipped: 0,
      attention: 0,
      blocked: 0,
      duplicate_trash: 0,
      ready: 0,
      draft_cleanup: 0,
      promoted: 0,
    },
  );
  const filteredStagedItems = [...stagedItems]
    .filter((item) =>
      activeImportJobId ? item.import_job_id === activeImportJobId : true,
    )
    .filter((item) => {
      if (stageFilter === "all") return true;
      if (stageFilter === "draft_cleanup") return hasDraftActivationCleanup(item);
      if (stageFilter === "blocked") return isActivePromotionBlocked(item);
      if (stageFilter === "ready") {
        return isDraftActivationReadyStageItem(item);
      }

      return item.stage_status === stageFilter;
    })
    .filter((item) => {
      const query = stagedSearch.trim().toLowerCase();

      if (!query) return true;

      const metadata =
        item.metadata && typeof item.metadata === "object"
          ? (item.metadata as Record<string, unknown>)
          : null;
      const haystack = [
        item.title,
        item.sku,
        item.source_item_id,
        item.item_condition,
        metadataTextValue(metadata, "source_listing_id"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    })
    .sort((left, right) => {
      const stageDiff = stageWorkPriority(left) - stageWorkPriority(right);

      if (stageDiff !== 0) return stageDiff;

      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });
  const visibleStageItemIds = filteredStagedItems.map((item) => item.id);
  const readyVisibleStageItemIds = filteredStagedItems
    .filter((item) => isDraftActivationReadyStageItem(item))
    .map((item) => item.id);
  const draftCleanupVisibleStageItemIds = filteredStagedItems
    .filter((item) => hasDraftActivationCleanup(item))
    .map((item) => item.id);
  const reviewVisibleStageItemIds = filteredStagedItems
    .filter((item) => item.stage_status === "needs_review")
    .map((item) => item.id);
  const blockedVisibleStageItemIds = filteredStagedItems
    .filter((item) => isActivePromotionBlocked(item))
    .map((item) => item.id);
  const duplicateTrashVisibleStageItemIds = filteredStagedItems
    .filter((item) => isExactDuplicateTrashCandidate(item))
    .map((item) => item.id);
  const readyStageItemIds = stagedItems
    .filter((item) => isDraftActivationReadyStageItem(item))
    .map((item) => item.id);
  const draftCleanupStageItemIds = stagedItems
    .filter((item) => hasDraftActivationCleanup(item))
    .map((item) => item.id);
  const needsReviewStageItemIds = stagedItems
    .filter((item) => item.stage_status === "needs_review")
    .map((item) => item.id);
  const blockedStageItems = stagedItems
    .filter((item) => isActivePromotionBlocked(item))
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    );
  const blockedStageItemIds = blockedStageItems.map((item) => item.id);
  const exactDuplicateTrashStageItems = stagedItems.filter((item) =>
    isExactDuplicateTrashCandidate(item),
  );
  const exactDuplicateTrashStageItemIds = exactDuplicateTrashStageItems.map(
    (item) => item.id,
  );
  const promotedStageItemCount = stagedItems.filter(
    (item) => item.promotion_guard?.alreadyPromoted,
  ).length;
  const blockedReasonSummary = blockedStageItems.reduce(
    (summary, item) => {
      for (const reason of item.promotion_guard?.reasons || []) {
        summary[reason] = (summary[reason] || 0) + 1;
      }

      return summary;
    },
    {} as Record<string, number>,
  );
  const selectedVisibleCount = visibleStageItemIds.filter((id) =>
    selectedStageItemIds.includes(id),
  ).length;
  const selectedStageItems = selectedStageItemsForIds(
    stagedItems,
    selectedStageItemIds,
  );
  const selectedSummary = selectedStageItems.reduce(
    (summary, item) => {
      summary.total += 1;

      if (canPromoteStageItem(item)) {
        if (isDraftActivationReadyStageItem(item)) {
          summary.ready += 1;
        } else if (hasDraftActivationCleanup(item)) {
          summary.draft_cleanup += 1;
        }
      }

      if (item.stage_status === "needs_review") {
        summary.needs_review += 1;
      }

      if (isActivePromotionBlocked(item)) {
        summary.blocked += 1;
      }

      if (isDuplicateTrashItem(item)) {
        summary.duplicate_trash += 1;
      }

      if (item.stage_status === "mapped") {
        summary.mapped += 1;
      }

      if (item.stage_status === "skipped") {
        summary.skipped += 1;
      }

      return summary;
    },
    {
      total: 0,
      ready: 0,
      draft_cleanup: 0,
      needs_review: 0,
      blocked: 0,
      mapped: 0,
      skipped: 0,
      duplicate_trash: 0,
    },
  );
  const selectedReadyStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "ready",
  );
  const selectedUnresolvedStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "unresolved",
  );
  const selectedReviewStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "needs_review",
  );
  const selectedBlockedStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "blocked",
  );
  const selectedExactDuplicateTrashStageItemIds = selectedStageItems
    .filter((item) => isExactDuplicateTrashCandidate(item))
    .map((item) => item.id);
  const selectedDraftCleanupStageItemIds = selectedStageItems
    .filter((item) => hasDraftActivationCleanup(item))
    .map((item) => item.id);
  const selectedMarkStagedIds = stageItemIdsNeedingStatus(
    selectedStageItems,
    "staged",
  );
  const selectedMarkReviewIds = stageItemIdsNeedingStatus(
    selectedStageItems,
    "needs_review",
  );
  const selectedMarkSkippedIds = stageItemIdsNeedingStatus(
    selectedStageItems,
    "skipped",
  );
  const selectedMappedStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "mapped",
  );
  const selectedSkippedStageItemIds = stageItemIdsForFilter(
    selectedStageItems,
    "skipped",
  );
  const selectedCompletedStageItemIds = Array.from(
    new Set([...selectedMappedStageItemIds, ...selectedSkippedStageItemIds]),
  );
  const successfulPromotionStageItemIds = Array.from(
    new Set(lastBulkPromotionSuccesses.map((entry) => entry.stagedItemId)),
  );
  const successfulPromotionStageItems = selectedStageItemsForIds(
    stagedItems,
    successfulPromotionStageItemIds,
  );
  const successfulPromotionMappedIds = stagedItems
    .filter(
      (item) =>
        successfulPromotionStageItemIds.includes(item.id) &&
        item.stage_status === "mapped",
    )
    .map((item) => item.id);
  const failedPromotionStageItemIds = Array.from(
    new Set(lastBulkPromotionErrors.map((entry) => entry.stagedItemId)),
  );
  const failedPromotionStageItems = selectedStageItemsForIds(
    stagedItems,
    failedPromotionStageItemIds,
  );
  const failedPromotionConflictIds = failedPromotionStageItems
    .filter((item) => isActivePromotionBlocked(item))
    .map((item) => item.id);
  const failedPromotionReadyIds = failedPromotionStageItems
    .filter((item) => isDraftActivationReadyStageItem(item))
    .map((item) => item.id);
  const failedPromotionDraftCleanupIds = failedPromotionStageItems
    .filter((item) => hasDraftActivationCleanup(item))
    .map((item) => item.id);
  const failedPromotionNeedsReviewIds = failedPromotionStageItems
    .filter((item) => item.stage_status === "needs_review")
    .map((item) => item.id);
  const failedPromotionSummary = failedPromotionStageItems.reduce(
    (summary, item) => {
      summary.total += 1;

      if (isActivePromotionBlocked(item)) {
        summary.conflict += 1;
      }

      if (item.stage_status === "needs_review") {
        summary.review += 1;
      }

      if (canPromoteStageItem(item)) {
        if (isDraftActivationReadyStageItem(item)) {
          summary.ready += 1;
        } else if (hasDraftActivationCleanup(item)) {
          summary.draft_cleanup += 1;
        }
      }

      return summary;
    },
    {
      total: 0,
      conflict: 0,
      review: 0,
      ready: 0,
      draft_cleanup: 0,
    },
  );
  const failedPromotionReviewIds = stagedItems
    .filter(
      (item) =>
        failedPromotionStageItemIds.includes(item.id) &&
        item.stage_status !== "needs_review",
    )
    .map((item) => item.id);
  const selectedReadyCount = selectedSummary.ready;
  const selectedDraftCleanupCount = selectedSummary.draft_cleanup;
  const selectedInstaCompHref = selectedStageItems.length
    ? sellerStagedInstaCompHref(selectedStageItems)
    : "/admin/instacomp?source=seller-ebay-staging";
  const selectionGuidance = selectedQueueGuidance(selectedSummary);
  const lastPromotionDraftLink = sellerDraftOutputHref(
    inventorySummary,
    lastBulkPromotionMode,
  );
  const activeImportJob =
    recentImportJobs.find((job) => job.id === activeImportJobId) ??
    (latestImportJob?.id === activeImportJobId ? latestImportJob : null);
  const displayedImportJob = activeImportJob ?? latestImportJob;
  const latestStageCursor = metadataRecord(latestImportJob?.source_cursor);
  const latestStageNextOffset = metadataNumberValue(
    latestStageCursor,
    "next_offset",
  );
  const hasResumableStageCursor =
    latestStageNextOffset !== null && latestStageNextOffset > 0;
  const hasReachedEndOfEbayInventory = latestStageCursor?.has_more === false;
  const currentLaneTotalStageItemIds = stageItemIdsForFilter(stagedItems, stageFilter);
  const currentLaneVisibleStageItemIds = visibleStageItemIds;
  const emptyLaneState = stageLaneEmptyState(stageFilter, {
    hasSearch: stagedSearch.trim().length > 0,
    hasImportRun: Boolean(activeImportJobId),
  });
  const allVisibleSelected =
    visibleStageItemIds.length > 0 &&
    selectedVisibleCount === visibleStageItemIds.length;

  function focusStageLane(filter: StageFilter) {
    setStageFilter(filter);
    setStagedSearch("");
  }

  async function copyTextToClipboard(text: string) {
    if (typeof window === "undefined") return;

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  async function copyWorkspaceLink() {
    if (typeof window === "undefined") return;

    try {
      await copyTextToClipboard(window.location.href);
      setMessage("Workspace link copied.");
    } catch {
      setMessage("Could not copy workspace link.");
    }
  }

  async function copyMarketplaceOperationReceipt(
    receipt: SellerMarketplaceOperationReceipt,
  ) {
    try {
      await copyTextToClipboard(formatSellerMarketplaceOperationReceipt(receipt));
      setMessage("Safe marketplace API receipt copied.");
    } catch {
      setMessage("Could not copy marketplace API receipt.");
    }
  }

  async function copyMarketplaceOperationReceiptTrail() {
    try {
      await copyTextToClipboard(
        formatSellerMarketplaceOperationReceiptHistory(
          marketplaceOperationReceiptHistory,
        ),
      );
      setMessage("Safe marketplace API receipt trail copied.");
    } catch {
      setMessage("Could not copy marketplace API receipt trail.");
    }
  }

  function downloadMarketplaceOperationReceipt(
    receipt: SellerMarketplaceOperationReceipt,
  ) {
    try {
      downloadSellerMarketplaceReceiptFile(
        sellerMarketplaceReceiptFileName("latest"),
        formatSellerMarketplaceOperationReceipt(receipt),
      );
      setMessage("Safe marketplace API receipt downloaded.");
    } catch {
      setMessage("Could not download marketplace API receipt.");
    }
  }

  function downloadMarketplaceOperationReceiptTrail() {
    try {
      downloadSellerMarketplaceReceiptFile(
        sellerMarketplaceReceiptFileName("trail"),
        formatSellerMarketplaceOperationReceiptHistory(
          marketplaceOperationReceiptHistory,
        ),
      );
      setMessage("Safe marketplace API receipt trail downloaded.");
    } catch {
      setMessage("Could not download marketplace API receipt trail.");
    }
  }

  function clearMarketplaceOperationReceiptTrail() {
    setLatestMarketplaceOperationReceipt(null);
    setMarketplaceOperationReceiptHistory([]);
    setMessage("Marketplace API receipt trail cleared.");
  }

  async function focusImportRunWithSelection(
    importJobId: string | null,
    filter: StageFilter | "unresolved",
  ) {
    setStageFilter(filter === "unresolved" ? "all" : filter);
    setStagedSearch("");

    if (!session?.access_token) {
      setActiveImportJobId(importJobId);
      setSelectedStageItemIds([]);
      return;
    }

    const data = await refreshSellerStageState(session.access_token, {
      silent: true,
      importJobId,
    });

    if (data) {
      setSelectedStageItemIds(stageItemIdsForFilter(data.stagedItems, filter));
    }
  }

  async function focusImportRun(importJobId: string | null) {
    setStagedSearch("");

    if (!session?.access_token) {
      setActiveImportJobId(importJobId);
      return;
    }

    await refreshSellerStageState(session.access_token, {
      silent: true,
      importJobId,
    });
  }

  function keepSelectedStageLane(
    filter:
      | "ready"
      | "draft_cleanup"
      | "needs_review"
      | "blocked"
      | "unresolved"
      | "completed",
  ) {
    if (filter === "ready") {
      setSelectedStageItemIds(selectedReadyStageItemIds);
      return;
    }

    if (filter === "draft_cleanup") {
      setSelectedStageItemIds(selectedDraftCleanupStageItemIds);
      return;
    }

    if (filter === "unresolved") {
      setSelectedStageItemIds(selectedUnresolvedStageItemIds);
      return;
    }

    if (filter === "completed") {
      setSelectedStageItemIds(selectedCompletedStageItemIds);
      return;
    }

    if (filter === "needs_review") {
      setSelectedStageItemIds(selectedReviewStageItemIds);
      return;
    }

    setSelectedStageItemIds(selectedBlockedStageItemIds);
  }

  function keepFailedPromotionSelection() {
    const failedIds = lastBulkPromotionErrors.map((entry) => entry.stagedItemId);
    if (failedIds.length === 0) return;

    setSelectedStageItemIds((current) =>
      current.filter((id) => failedIds.includes(id)),
    );
  }

  function keepSuccessfulPromotionSelection() {
    if (successfulPromotionStageItemIds.length === 0) return;

    setSelectedStageItemIds(successfulPromotionStageItemIds);
  }

  function keepFailedConflictSelection() {
    if (failedPromotionConflictIds.length === 0) return;

    setSelectedStageItemIds((current) =>
      current.filter((id) => failedPromotionConflictIds.includes(id)),
    );
  }

  async function openFailedPromotionQueue(
    filter: StageFilter,
    stageItemIds: string[],
  ) {
    if (stageItemIds.length === 0) return;

    setStageFilter(filter);
    setStagedSearch("");

    if (!session?.access_token) {
      setSelectedStageItemIds(stageItemIds);
      return;
    }

    await refreshSellerStageState(session.access_token, {
      silent: true,
      importJobId: activeImportJobId,
    });
    setSelectedStageItemIds(stageItemIds);
  }

  async function openFailedConflictQueue() {
    await openFailedPromotionQueue("blocked", failedPromotionConflictIds);
  }

  async function openFailedQueue() {
    await openFailedPromotionQueue("all", failedPromotionStageItemIds);
  }

  async function openSuccessfulPromotionQueue() {
    await openFailedPromotionQueue("mapped", successfulPromotionMappedIds);
  }

  async function openFailedReviewQueue() {
    await openFailedPromotionQueue("needs_review", failedPromotionNeedsReviewIds);
  }

  async function openFailedReadyQueue() {
    await openFailedPromotionQueue("ready", failedPromotionReadyIds);
  }

  async function openFailedDraftCleanupQueue() {
    await openFailedPromotionQueue("draft_cleanup", failedPromotionDraftCleanupIds);
  }

  async function markFailedPromotionRowsForReview() {
    await setBulkStageStatusForIds(failedPromotionReviewIds, "needs_review");
  }

  async function retryFailedReadyPromotions() {
    await runBulkPromotion({
      stageItemIds: failedPromotionReadyIds,
      progressKey: "retry-failed-ready",
      emptyMessage: "No failed promotion rows are currently ready to retry.",
      mode: "ready",
    });
  }

  async function retryFailedDraftCleanupPromotions() {
    await runBulkPromotion({
      stageItemIds: failedPromotionDraftCleanupIds,
      progressKey: "retry-failed-draft-cleanup",
      emptyMessage:
        "No failed promotion rows are currently eligible for draft-cleanup retry.",
      mode: "draft_cleanup",
    });
  }

  if (!authChecked) {
    return (
      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-2xl font-black">Your Connections</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Refreshing your TCOS account session...
        </p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="rounded-md border border-neutral-200 bg-white p-5">
        <h2 className="text-2xl font-black">Your Connections</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-600">
          Log in from the account page to view seller-specific marketplace
          connections. Store #1 foundation stats remain visible above.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-200 p-5">
        <div>
          <h2 className="text-2xl font-black">Your Connections</h2>
          <p className="mt-1 text-sm text-neutral-600">
            Seller-scoped marketplace connection records for the active TCOS
            store.
          </p>
        </div>
        {isLoading ? (
          <span className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
            Loading
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 border-b border-neutral-200 bg-neutral-50 p-5 md:grid-cols-2">
        {requestableProviders.map((provider) => (
          <button
            key={provider.provider}
            type="button"
            onClick={() => requestConnection(provider.provider)}
            disabled={
              isSavingProvider.length > 0 ||
              (provider.provider === "ebay" && !ebaySyncEnabled)
            }
            className="rounded-md border border-neutral-300 bg-white px-4 py-3 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <p className="font-black">{provider.label}</p>
            <p className="mt-1 text-sm text-neutral-600">
              {provider.provider === "ebay" && !ebaySyncEnabled
                ? "This store currently has eBay sync turned off, so seller eBay connect is paused."
                : provider.note}
            </p>
          </button>
        ))}
      </div>

      <div className="border-b border-sky-200 bg-sky-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-800">
              Marketplace Packet Intake
            </p>
            <h3 className="mt-1 text-lg font-black text-sky-950">
              Seller Inventory packet handoff
            </h3>
            <p className="mt-2 text-sm leading-6 text-sky-900">
              Seller Inventory marketplace packets are cross-list prep only.
              They are receiving-side notes for sellers and operators, not a
              live marketplace connector, postage workflow, Coverage workflow,
              payout workflow, or fulfillment trigger. Auction prep defaults to
              the TCOS standard {STANDARD_AUCTION_DURATION_LABEL}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/seller/inventory?status=draft&readiness=ready"
              className="rounded-md bg-sky-950 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white hover:bg-sky-800"
            >
              Open Ready Rows
            </Link>
            <Link
              href="/seller/inventory?status=draft&readiness=needs_work"
              className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-sky-950 hover:bg-sky-100"
            >
              Open Needs-Work Rows
            </Link>
          </div>
        </div>
        <ul className="mt-4 grid gap-2 text-sm font-semibold leading-6 text-sky-950 md:grid-cols-2">
          {marketplacePacketIntakeGuardrails.map((guardrail) => (
            <li key={guardrail} className="rounded-md bg-white/80 p-3">
              {guardrail}
            </li>
          ))}
        </ul>
        <p className="mt-3 rounded-md border border-sky-200 bg-white p-3 text-xs font-bold uppercase tracking-[0.1em] text-sky-900">
          Packet intake does not publish externally, buy postage, create
          Coverage policies, activate seller protection, reimburse shipping,
          release payouts, or fulfill orders.
        </p>
      </div>

      {message ? (
        <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {message}
        </div>
      ) : null}

      {latestMarketplaceOperationReceipt ? (
        <SellerMarketplaceOperationReceiptCard
          receipt={latestMarketplaceOperationReceipt}
          onCopyReceipt={(receipt) =>
            void copyMarketplaceOperationReceipt(receipt)
          }
          onDownloadReceipt={downloadMarketplaceOperationReceipt}
        />
      ) : null}

      <SellerMarketplaceOperationReceiptHistory
        receipts={
          latestMarketplaceOperationReceipt
            ? marketplaceOperationReceiptHistory.slice(1)
            : marketplaceOperationReceiptHistory
        }
        onCopyReceipt={(receipt) =>
          void copyMarketplaceOperationReceipt(receipt)
        }
        onCopyReceiptTrail={() => void copyMarketplaceOperationReceiptTrail()}
        onDownloadReceiptTrail={downloadMarketplaceOperationReceiptTrail}
        onClearReceiptTrail={clearMarketplaceOperationReceiptTrail}
      />

      {ebayRevocationProtectionReady ? (
        <div className="border-b border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-black text-emerald-900">
            eBay revocation protection active
          </p>
          <p className="mt-1 text-sm leading-6 text-emerald-800">
            This connection is mapped to eBay&apos;s immutable seller identity.
            Signed authorization-revocation events can automatically disable the
            connection and delete TCOS-stored credentials.
          </p>
        </div>
      ) : ebayRevocationProtectionNeedsReconnect ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 p-4">
          <div>
            <p className="text-sm font-black text-amber-950">
              One security reconnect required
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">
              This older eBay connection predates immutable identity mapping.
              Reauthorize once so TCOS can match signed eBay revocation events.
              Existing staged listings, import history, and seller inventory stay
              unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestConnection("ebay")}
            disabled={
              !ebaySyncEnabled ||
              isSavingProvider.length > 0 ||
              isStagingItems
            }
            className="rounded-md bg-amber-950 px-4 py-2 text-sm font-black text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingProvider === "ebay"
              ? "Opening eBay..."
              : "Reconnect for Security"}
          </button>
        </div>
      ) : null}

      {sellerEbayAuthorized && !ebayOrderImportReady ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 p-4">
          <div>
            <p className="text-sm font-black text-sky-950">
              Reconnect once for outside-order protection
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-sky-900">
              Grant eBay order-read permission so TCOS can detect sales made
              outside TCOS and safely lower shared inventory. Existing staged
              listings and seller inventory remain unchanged.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestConnection("ebay")}
            disabled={!ebaySyncEnabled || isSavingProvider.length > 0}
            className="rounded-md bg-sky-950 px-4 py-2 text-sm font-black text-white hover:bg-sky-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingProvider === "ebay"
              ? "Opening eBay..."
              : "Reconnect for Orders"}
          </button>
        </div>
      ) : null}

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Outside eBay Orders</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Record eBay sales made outside TCOS in a separate audit ledger and
              lower linked inventory from eBay&apos;s authoritative quantity. These
              orders never enter TCOS checkout, payouts, or the 8% fee ledger.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void importSellerOutsideOrders({ all: false })}
              disabled={
                !canUseSellerEbayTools ||
                !ebayOrderImportReady ||
                isImportingOutsideOrders
              }
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isImportingOutsideOrders && !isImportingAllOutsideOrders
                ? "Importing Batch..."
                : "Import Next 25"}
            </button>
            <button
              type="button"
              onClick={() =>
                void importSellerOutsideOrders({ all: true, resetCursor: true })
              }
              disabled={
                !canUseSellerEbayTools ||
                !ebayOrderImportReady ||
                isImportingOutsideOrders
              }
              className="rounded-md border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-black text-sky-950 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isImportingAllOutsideOrders
                ? "Importing All Recent..."
                : "Import All Recent"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <PreviewMetric
            label="Outside Orders"
            value={String(outsideOrderStatus?.orderCount || 0)}
          />
          <PreviewMetric
            label="Paid"
            value={String(outsideOrderStatus?.paidCount || 0)}
          />
          <PreviewMetric
            label="Refunded"
            value={String(outsideOrderStatus?.refundedCount || 0)}
          />
          <PreviewMetric
            label="Unmatched Items"
            value={String(outsideOrderStatus?.unmatchedItemCount || 0)}
          />
          <PreviewMetric
            label="Last Import"
            value={shortDate(outsideOrderStatus?.latestImportedAt)}
          />
        </div>

        {!ebayOrderImportReady && sellerEbayAuthorized ? (
          <p className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-900">
            Reconnect eBay once to enable outside-order imports.
          </p>
        ) : null}

        <p className="mt-4 text-xs font-semibold uppercase leading-5 text-neutral-500">
          Refunds and cancellations are flagged for review and never restore
          stock automatically. Scheduled polling runs on the staggered seller
          heartbeat, about every 90 minutes while seller sync is active.
        </p>
      </div>

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Seller eBay Import Preview</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Pull a live sample from the connected seller eBay account before
              TCOS writes anything into shared store inventory.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => loadPreview()}
              disabled={
                !canUseSellerEbayTools ||
                isLoadingPreview ||
                isSavingProvider.length > 0 ||
                isStagingItems
              }
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingPreview ? "Loading Preview..." : "Preview eBay Import"}
            </button>
            <button
              type="button"
              onClick={() => stagePreviewBatch()}
              disabled={
                !canUseSellerEbayTools ||
                isLoadingPreview ||
                isSavingProvider.length > 0 ||
                isStagingItems ||
                hasReachedEndOfEbayInventory
              }
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isStagingItems
                ? "Staging Batch..."
                : hasReachedEndOfEbayInventory
                  ? "All Listings Staged"
                  : hasResumableStageCursor
                    ? "Stage Next 25"
                    : "Stage First 25"}
            </button>
            {!hasReachedEndOfEbayInventory ? (
              <button
                type="button"
                onClick={() => stageAllRemaining()}
                disabled={
                  !canUseSellerEbayTools ||
                  isLoadingPreview ||
                  isSavingProvider.length > 0 ||
                  isStagingItems
                }
                className="rounded-md border border-emerald-500 bg-emerald-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStagingAll
                  ? "Bringing Listings Over..."
                  : "1-Click Bring eBay Listings to TCOS"}
              </button>
            ) : null}
            {isStagingAll ? (
              <button
                type="button"
                onClick={stopStageAllAfterCurrentBatch}
                disabled={stageAllStopRequested}
                className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {stageAllStopRequested ? "Stopping After Batch..." : "Stop After Current Batch"}
              </button>
            ) : hasResumableStageCursor ? (
              <button
                type="button"
                onClick={() => stagePreviewBatch(true)}
                disabled={
                  !canUseSellerEbayTools ||
                  isLoadingPreview ||
                  isSavingProvider.length > 0 ||
                  isStagingItems
                }
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Restart From First 25
              </button>
            ) : null}
          </div>
        </div>

        {!ebaySyncEnabled ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            Store sync is disabled, so seller eBay preview and staging are
            paused.
          </p>
        ) : sellerEbaySyncPaused ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Seller sync is paused. Resume this connection when you want TCOS to
            read new eBay listings again. Stored credentials, staged listings,
            import history, and seller inventory remain intact.
          </p>
        ) : ebayConnection?.connectionStatus !== "connected" ? (
          <p className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-semibold text-neutral-700">
            Connect a seller eBay account first, then preview and stage remote
            listings before inventory mapping is enabled.
          </p>
        ) : null}

        {stageAllProgress ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-black text-amber-950">
                {isStagingAll ? "Full eBay staging in progress" : "Latest full staging run"}
              </p>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-800">
                Cursor {stageAllProgress.nextOffset}
                {typeof stageAllProgress.totalAvailable === "number"
                  ? ` / ${stageAllProgress.totalAvailable}`
                  : ""}
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <PreviewInfo
                label="Batches"
                value={String(stageAllProgress.batchesCompleted)}
              />
              <PreviewInfo
                label="Processed This Run"
                value={String(stageAllProgress.processedCount)}
              />
              <PreviewInfo
                label="Captured"
                value={String(stageAllProgress.stagedCount)}
              />
              <PreviewInfo
                label="Skipped"
                value={String(stageAllProgress.skippedCount)}
              />
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <PreviewMetric
                label="Remote Listings"
                value={
                  typeof preview.totalAvailable === "number"
                    ? preview.totalAvailable.toLocaleString()
                    : "Review"
                }
              />
              <PreviewMetric label="Sampled" value={String(preview.sampled)} />
              <PreviewMetric
                label="Environment"
                value={label(preview.ebayEnvironment)}
              />
              <PreviewMetric
                label="Write Mode"
                value={preview.writeBlocked ? "Preview Only" : "Enabled"}
              />
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
              {preview.writeBlockReason}
            </div>

            <PreviewItemsTable items={preview.sampleItems} />

            <p className="text-xs font-semibold uppercase text-neutral-500">
              Preview fetched {shortDate(preview.fetchedAt)}
              {preview.hasMore ? " | more remote listings available" : ""}
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">eBay Inventory Reconciliation</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Compare seller-owned TCOS inventory with its source eBay listing.
              TCOS can lower availability or mark an item sold, but it never
              raises stock automatically and never charges the 8% platform fee
              for an outside eBay sale.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void reconcileSellerInventory({ all: false })
              }
              disabled={
                !canUseSellerEbayTools ||
                isReconciling ||
                isStagingItems ||
                (reconciliationStatus?.linkedCount || 0) === 0
              }
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReconciling && !isReconcilingAll
                ? "Reconciling Batch..."
                : "Reconcile Next 25"}
            </button>
            <button
              type="button"
              onClick={() =>
                void reconcileSellerInventory({ all: true, resetCursor: true })
              }
              disabled={
                !canUseSellerEbayTools ||
                isReconciling ||
                isStagingItems ||
                (reconciliationStatus?.linkedCount || 0) === 0
              }
              className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-900 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isReconcilingAll ? "Reconciling All..." : "Reconcile All Linked"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <PreviewMetric
            label="Linked Items"
            value={String(reconciliationStatus?.linkedCount || 0)}
          />
          <PreviewMetric
            label="Last Scanned"
            value={String(reconciliationStatus?.latestRun?.scannedCount || 0)}
          />
          <PreviewMetric
            label="Matched"
            value={String(reconciliationStatus?.latestRun?.matchedCount || 0)}
          />
          <PreviewMetric
            label="Quantity Reduced"
            value={String(
              reconciliationStatus?.latestRun?.quantityReducedCount || 0,
            )}
          />
          <PreviewMetric
            label="Marked Sold"
            value={String(reconciliationStatus?.latestRun?.soldCount || 0)}
          />
          <PreviewMetric
            label="Needs Review"
            value={String(reconciliationStatus?.latestRun?.reviewCount || 0)}
          />
          <PreviewMetric
            label="Failed"
            value={String(reconciliationStatus?.latestRun?.failedCount || 0)}
          />
        </div>

        {reconciliationProgress ? (
          <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
            <p className="font-black">
              {isReconciling ? "Reconciliation in progress" : "Latest reconciliation progress"}
            </p>
            <p className="mt-1 leading-6">
              {reconciliationProgress.scannedCount} checked across {reconciliationProgress.batchesCompleted} batch
              {reconciliationProgress.batchesCompleted === 1 ? "" : "es"}; {reconciliationProgress.quantityReducedCount} reduced, {reconciliationProgress.soldCount} sold, {reconciliationProgress.reviewCount} review, {reconciliationProgress.failedCount} failed.
              {reconciliationProgress.totalLinked > 0
                ? ` Cursor ${reconciliationProgress.nextOffset} of ${reconciliationProgress.totalLinked}.`
                : ""}
            </p>
          </div>
        ) : reconciliationStatus?.latestRun ? (
          <p className="mt-4 text-xs font-semibold uppercase text-neutral-500">
            Last reconciliation {shortDate(reconciliationStatus.latestRun.completedAt)} / {label(reconciliationStatus.latestRun.status)}
          </p>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No seller eBay reconciliation has run yet.
          </p>
        )}

        {!ebaySyncEnabled ? (
          <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            Store-wide eBay sync is disabled, so reconciliation is paused.
          </p>
        ) : sellerEbaySyncPaused ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            Resume seller sync before reconciling linked inventory.
          </p>
        ) : null}
      </div>

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Seller Draft Output</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Recent seller-owned inventory created through staged promotion.
              This is the handoff between import cleanup and real seller catalog
              work.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={sellerDraftOutputLink.href}
              className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
            >
              {sellerDraftOutputLink.label}
            </Link>
            <button
              type="button"
              onClick={() =>
                session?.access_token &&
                refreshSellerInventoryState(session.access_token)
              }
              disabled={isLoadingInventory || !session?.access_token}
              className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoadingInventory ? "Refreshing..." : "Refresh Draft Output"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <PreviewMetric
            label="Seller Items"
            value={String(inventorySummary?.totalItems || 0)}
          />
          <PreviewMetric
            label="Drafts"
            value={String(inventorySummary?.draftCount || 0)}
          />
          <PreviewMetric
            label="Draft Ready"
            value={String(inventorySummary?.draftReadyCount || 0)}
          />
          <PreviewMetric
            label="Needs Work"
            value={String(inventorySummary?.draftNeedsWorkCount || 0)}
          />
          <PreviewMetric
            label="Active"
            value={String(inventorySummary?.activeCount || 0)}
          />
          <PreviewMetric
            label="Units"
            value={String(inventorySummary?.totalQuantity || 0)}
          />
          <PreviewMetric
            label="Draft Value"
            value={formatCurrency(inventorySummary?.totalDraftValue || 0)}
          />
        </div>

        {recentInventoryItems.length === 0 ? (
          <p className="mt-4 text-sm text-neutral-500">
            No seller-owned inventory items have been created yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            {recentInventoryItems.slice(0, 8).map((item) => (
              <div
                key={item.inventoryItemId}
                className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
              >
                {(() => {
                  const inventoryItemHref = sellerInventoryItemHref(item);
                  const inventoryMarketplaceLink =
                    sellerInventoryMarketplaceHref(item);

                  return (
                    <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black text-neutral-950">{item.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      SKU {item.sku || "Not set"} / {label(item.status)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                        item.status,
                      )}`}
                    >
                      {label(item.status)}
                    </span>
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${
                        item.activationReadiness.ready
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }`}
                    >
                      {item.activationReadiness.ready
                        ? "READY"
                        : "NEEDS WORK"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <PreviewInfo label="Category" value={label(item.category)} />
                  <PreviewInfo label="Condition" value={label(item.condition)} />
                  <PreviewInfo label="Quantity" value={String(item.quantity)} />
                  <PreviewInfo label="Price" value={formatCurrency(item.price)} />
                </div>

                <p className="mt-3 text-xs text-neutral-500">
                  Updated {shortDate(item.updatedAt)} / Created {shortDate(item.createdAt)}
                </p>

                {item.activationReadiness.blockers.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.activationReadiness.blockers.map((blocker) => (
                      <span
                        key={`${item.inventoryItemId}-${blocker}`}
                        className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                      >
                        {readinessBlockerLabel(blocker)}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={inventoryItemHref}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                  >
                    Open Seller Inventory
                  </Link>
                  <Link
                    href={inventoryMarketplaceLink.href}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                  >
                    {inventoryMarketplaceLink.label}
                  </Link>
                  <Link
                    href={sellerInventoryOrdersHref(item)}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                  >
                    {sellerInventoryOrdersLabel(item)}
                  </Link>
                  <Link
                    href={sellerInventoryPayoutHref(item)}
                    className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                  >
                    {sellerInventoryPayoutLabel(item)}
                  </Link>
                  {typeof item.legacyProductId === "number" ? (
                    <Link
                      href={`/admin/products/${item.legacyProductId}`}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                    >
                      Open Admin Product
                    </Link>
                  ) : null}
                  {item.ebayItemId ? (
                    <span className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600">
                      eBay {item.ebayItemId}
                    </span>
                  ) : null}
                </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black">Staged Seller Listings</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
              Seller-private staging captures eBay listings for review before
              TCOS maps ownership and writes them into store inventory.
            </p>
            {activeImportJobId ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-900">
                  {activeImportJob
                    ? `Focused to job ${activeImportJobId.slice(0, 8)} / ${activeImportJob.row_count || 0} rows`
                    : `Focused to job ${activeImportJobId.slice(0, 8)}`}
                </span>
                <button
                  type="button"
                  onClick={() => focusImportRun(null)}
                  className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                >
                  Show All Runs ({recentImportJobs.length})
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() =>
              session?.access_token &&
              refreshSellerStageState(session.access_token)
            }
            disabled={isLoadingStaged || !session?.access_token}
            className={`rounded-md border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeImportJobId
                ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                : "border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {isLoadingStaged
              ? activeImportJobId
                ? "Refreshing Focused Run..."
                : "Refreshing..."
              : activeImportJob
                ? `Refresh Focused Run (${activeImportJob.row_count || 0} rows)`
                : "Refresh Staged"}
          </button>
        </div>

        {displayedImportJob ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-5">
              <PreviewMetric
                label={activeImportJob ? "Focused Job" : "Last Job"}
                value={label(displayedImportJob.status)}
              />
              <PreviewMetric
                label="Rows"
                value={String(displayedImportJob.row_count || 0)}
              />
              <PreviewMetric
                label="Staged"
                value={String(displayedImportJob.staged_count || 0)}
              />
              <PreviewMetric
                label="Skipped"
                value={String(displayedImportJob.skipped_count || 0)}
              />
              <PreviewMetric
                label="Completed"
                value={shortDate(displayedImportJob.completed_at)}
              />
            </div>

            <LatestImportDiagnostics
              job={displayedImportJob}
              runCount={recentImportJobs.length}
              isActive={activeImportJobId === displayedImportJob.id}
              onFocus={() => void focusImportRun(displayedImportJob.id)}
              onSelectFilter={(filter) =>
                void focusImportRunWithSelection(displayedImportJob.id, filter)
              }
              onSelectWorkQueue={() =>
                void focusImportRunWithSelection(displayedImportJob.id, "unresolved")
              }
              onClear={() => void focusImportRun(null)}
            />
          </>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No seller staging jobs have run yet.
          </p>
        )}

        {recentImportJobs.length > 0 ? (
          <div
            className={`mt-4 rounded-md border p-4 ${
              activeImportJobId
                ? "border-amber-300 bg-amber-50/30"
                : "border-neutral-200 bg-neutral-50"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
                  {activeImportJobId ? "Focused Run History" : "Import Run History"}
                </h4>
                <p className="mt-1 text-sm text-neutral-600">
                  {activeImportJob
                    ? `Recent seller staging runs, including skipped rows and error pressure. Job ${activeImportJob.id.slice(0, 8)} is currently in focus.`
                    : "Recent seller staging runs, including skipped rows and error pressure."}
                </p>
              </div>
              <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs font-black text-neutral-700">
                {recentImportJobs.length} runs
              </span>
            </div>
            <p className="mt-3 max-w-4xl text-xs font-semibold leading-5 text-neutral-500">
              One-click import stages your eBay listings into TCOS review first.
              Nothing goes live automatically. After staging, select card rows
              and send them to InstaComp™ cleanup before promoting them into
              TCOS seller drafts.
            </p>

            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {recentImportJobs.map((job) => (
                <ImportRunCard
                  key={job.id}
                  job={job}
                  runCount={recentImportJobs.length}
                  isActive={activeImportJobId === job.id}
                  onFocus={() => void focusImportRun(job.id)}
                  onSelectFilter={(filter) =>
                    void focusImportRunWithSelection(job.id, filter)
                  }
                  onSelectWorkQueue={() =>
                    void focusImportRunWithSelection(job.id, "unresolved")
                  }
                  onClear={() => void focusImportRun(null)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {stagedItems.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-800">
                Ready To Promote
              </p>
              <p className="mt-2 text-2xl font-black text-emerald-950">
                {stagedSummary.ready}
              </p>
              <p className="mt-2 text-sm text-emerald-900">
                Staged rows already clear to become seller draft inventory.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => focusStageLane("ready")}
                  className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                >
                  Show Ready ({readyStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStageItemIds(readyStageItemIds)}
                  disabled={readyStageItemIds.length === 0}
                  className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Ready ({readyStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => void promoteAllReadyStageItems()}
                  disabled={
                    readyStageItemIds.length === 0 ||
                    Boolean(promotingStageItemId) ||
                    updatingStageItemId.startsWith("bulk-")
                  }
                  className="rounded-md border border-emerald-900 bg-emerald-900 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {promotingStageItemId === "bulk-promote-all-ready"
                    ? "Promoting All..."
                    : `Promote All Ready (${readyStageItemIds.length})`}
                </button>
              </div>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">
                Draft Cleanup
              </p>
              <p className="mt-2 text-2xl font-black text-amber-950">
                {stagedSummary.draft_cleanup}
              </p>
              <p className="mt-2 text-sm text-amber-900">
                Rows that can become drafts now, but still need activation cleanup after promotion.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedStageItemIds(draftCleanupStageItemIds)}
                  disabled={stagedSummary.draft_cleanup === 0}
                  className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Cleanup ({draftCleanupStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => focusStageLane("draft_cleanup")}
                  className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  Show Cleanup ({draftCleanupStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => void promoteAllDraftCleanupStageItems()}
                  disabled={
                    draftCleanupStageItemIds.length === 0 ||
                    Boolean(promotingStageItemId) ||
                    updatingStageItemId.startsWith("bulk-")
                  }
                  className="rounded-md border border-amber-900 bg-amber-900 px-3 py-2 text-xs font-black text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {promotingStageItemId === "bulk-promote-all-draft-cleanup"
                    ? "Promoting Cleanup..."
                    : `Promote Cleanup (${draftCleanupStageItemIds.length})`}
                </button>
              </div>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">
                Needs Review
              </p>
              <p className="mt-2 text-2xl font-black text-amber-950">
                {stagedSummary.needs_review}
              </p>
              <p className="mt-2 text-sm text-amber-900">
                Rows intentionally parked for seller cleanup before promotion.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => focusStageLane("needs_review")}
                  className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100"
                >
                  Show Review ({needsReviewStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStageItemIds(needsReviewStageItemIds)}
                  disabled={needsReviewStageItemIds.length === 0}
                  className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Review ({needsReviewStageItemIds.length})
                </button>
              </div>
            </div>

            <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-rose-800">
                Conflict Blockers
              </p>
              <p className="mt-2 text-2xl font-black text-rose-950">
                {stagedSummary.blocked}
              </p>
              <p className="mt-2 text-sm text-rose-900">
                Duplicate or already-promoted rows that need conflict review.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => focusStageLane("blocked")}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100"
                >
                  Show Blocked ({blockedStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedStageItemIds(blockedStageItemIds)}
                  disabled={blockedStageItemIds.length === 0}
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Blocked ({blockedStageItemIds.length})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void trashExactDuplicateStageItems(exactDuplicateTrashStageItemIds)
                  }
                  disabled={
                    exactDuplicateTrashStageItemIds.length === 0 ||
                    updatingStageItemId.startsWith("bulk-") ||
                    Boolean(promotingStageItemId)
                  }
                  className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Trash Exact Dups ({exactDuplicateTrashStageItemIds.length})
                </button>
              </div>
            </div>

            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-600">
                Draft Output
              </p>
              <p className="mt-2 text-2xl font-black text-neutral-950">
                {promotedStageItemCount}
              </p>
              <p className="mt-2 text-sm text-neutral-700">
                Staged rows already promoted into seller-owned draft inventory.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => focusStageLane("mapped")}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                >
                  Show Mapped ({promotedStageItemCount})
                </button>
                <Link
                  href={sellerDraftOutputLink.href}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                >
                  {sellerDraftOutputLink.label}
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        {stagedItems.length > 0 ? (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
              <PreviewMetric
                label="Loaded Staged Rows"
                value={String(stagedSummary.total)}
              />
              <PreviewMetric
                label="Needs Attention"
                value={String(stagedSummary.attention)}
              />
              <PreviewMetric
                label="Promotion Blocked"
                value={String(stagedSummary.blocked)}
              />
              <PreviewMetric
                label="Ready To Promote"
                value={String(stagedSummary.ready)}
              />
              <PreviewMetric
                label="Draft Cleanup"
                value={String(stagedSummary.draft_cleanup)}
              />
              <PreviewMetric
                label="Drafts Created"
                value={String(stagedSummary.promoted)}
              />
            </div>

            <div className="mt-4 rounded-md border border-neutral-200 bg-white p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h3 className="text-lg font-black">Conflict Review Dashboard</h3>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-600">
                    Blocked rows are grouped here so sellers can spot duplicate
                    IDs, repeated SKUs, and already-promoted listings before they
                    burn time in the main table.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => focusStageLane("blocked")}
                    className="rounded-md border border-rose-300 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50"
                  >
                    Show blocked only ({blockedStageItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void trashExactDuplicateStageItems(exactDuplicateTrashStageItemIds)
                    }
                    disabled={
                      exactDuplicateTrashStageItemIds.length === 0 ||
                      updatingStageItemId.startsWith("bulk-") ||
                      Boolean(promotingStageItemId)
                    }
                    className="rounded-md border border-rose-300 px-3 py-2 text-xs font-black text-rose-900 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Trash exact dups ({exactDuplicateTrashStageItemIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => focusStageLane("ready")}
                    className="rounded-md border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50"
                  >
                    Show ready only ({readyStageItemIds.length})
                  </button>
                </div>
              </div>

              {blockedStageItems.length === 0 ? (
                <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900">
                  No blocked promotion rows right now.
                </p>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {Object.entries(blockedReasonSummary)
                      .sort((left, right) => right[1] - left[1])
                      .slice(0, 4)
                      .map(([reason, count]) => (
                        <PreviewMetric
                          key={reason}
                          label={promotionReasonLabel(reason)}
                          value={String(count)}
                        />
                      ))}
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-2">
                    {blockedStageItems.slice(0, 6).map((item) => (
                      <div
                        key={`blocked-${item.id}`}
                        className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-black text-neutral-950">{item.title}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {item.source_item_id}
                            </p>
                          </div>
                          <span className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-800">
                            BLOCKED
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {(item.promotion_guard?.reasons || []).map((reason) => (
                            <span
                              key={`${item.id}-${reason}`}
                              className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                            >
                              {promotionReasonLabel(reason)}
                            </span>
                          ))}
                        </div>

                        {item.promotion_guard?.matches.length ? (
                          <div className="mt-3 space-y-2">
                            {item.promotion_guard.matches.slice(0, 2).map((match) => {
                              const matchInventoryHref = sellerMatchedInventoryHref(match);

                              return (
                                <div
                                  key={`${item.id}-match-${match.id}-${match.matchType}`}
                                  className="rounded border border-neutral-200 bg-white px-3 py-2"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <p className="truncate font-semibold text-neutral-900">
                                        {match.title}
                                      </p>
                                      <p className="text-xs text-neutral-500">
                                        {promotionReasonLabel(match.matchType)} /{" "}
                                        {sellerScopeLabel(match.sellerScope)}
                                      </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                      {matchInventoryHref ? (
                                        <Link
                                          href={matchInventoryHref}
                                          className="text-xs font-bold text-neutral-700 underline"
                                        >
                                          Open Seller Inventory
                                        </Link>
                                      ) : null}
                                      <Link
                                        href={`/admin/products/${match.id}`}
                                        className="text-xs font-bold text-neutral-700 underline"
                                      >
                                        Open Admin Product
                                      </Link>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => focusStageLane("blocked")}
                            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                          >
                            Filter blocked
                          </button>
                          <button
                            type="button"
                            onClick={() => setStageStatus(item.id, "needs_review")}
                            disabled={
                              updatingStageItemId === item.id ||
                              updatingStageItemId.startsWith("bulk-") ||
                              Boolean(promotingStageItemId)
                            }
                            className="rounded-md border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Mark Review
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div
              className={`mt-4 rounded-md border p-4 ${
                activeImportJobId
                  ? "border-amber-300 bg-amber-50/30"
                  : "border-neutral-200 bg-neutral-50"
              }`}
            >
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="flex flex-wrap gap-2">
                  {([
                    ["all", `Working (${stagedSummary.total})`],
                    ["ready", `Ready (${stagedSummary.ready})`],
                    ["draft_cleanup", `Draft Cleanup (${stagedSummary.draft_cleanup})`],
                    ["blocked", `Blocked (${stagedSummary.blocked})`],
                    ["needs_review", `Needs Review (${stagedSummary.needs_review})`],
                    ["staged", `Staged (${stagedSummary.staged})`],
                    ["mapped", `Mapped (${stagedSummary.mapped})`],
                    ["skipped", `Sold / Archived (${stagedSummary.skipped})`],
                  ] as Array<[StageFilter, string]>).map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setStageFilter(value)}
                      className={`rounded-md border px-3 py-2 text-xs font-black uppercase ${
                        stageFilter === value
                          ? activeImportJobId
                            ? "border-amber-900 bg-amber-900 text-white"
                            : "border-neutral-950 bg-neutral-950 text-white"
                          : activeImportJobId
                            ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                            : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>

                <label className="block w-full xl:max-w-sm">
                  <span className="text-xs font-black uppercase text-neutral-500">
                    {activeImportJobId ? "Search Focused Run Rows" : "Search Staged Rows"}
                  </span>
                  <input
                    type="text"
                    value={stagedSearch}
                    onChange={(event) => setStagedSearch(event.target.value)}
                    placeholder={
                      activeImportJobId
                        ? "Search the focused run by title, SKU, listing ID, condition..."
                        : "Title, SKU, listing ID, condition..."
                    }
                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-950"
                  />
                </label>
              </div>
            </div>

            <div
              className={`mt-4 rounded-md border p-4 ${
                activeImportJobId
                  ? "border-amber-300 bg-amber-50/30"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    {activeImportJobId ? "Focused Run Workspace" : "Workspace View"}
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-900">
                    {stageLaneTitle(stageFilter)} / {filteredStagedItems.length} visible row(s)
                  </p>
                  <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                    {stageLaneDetail(stageFilter)}
                    {activeImportJob
                      ? ` Focused to job ${activeImportJob.id.slice(0, 8)} with ${activeImportJob.row_count || 0} imported row(s).`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedStageItemIds(currentLaneVisibleStageItemIds)}
                    disabled={currentLaneVisibleStageItemIds.length === 0}
                    className={`rounded-md border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                      activeImportJobId
                        ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                        : "border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    {`${stageLaneSelectionLabel(stageFilter)} (${currentLaneVisibleStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyWorkspaceLink()}
                    className={`rounded-md border px-3 py-2 text-xs font-bold ${
                      activeImportJobId
                        ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                        : "border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    Copy Workspace Link
                  </button>
                  {stageFilter !== "all" ? (
                    <button
                      type="button"
                      onClick={() => focusStageLane("all")}
                      className={`rounded-md border px-3 py-2 text-xs font-bold ${
                        activeImportJobId
                          ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                          : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      Show All Lanes ({stagedSummary.total})
                    </button>
                  ) : null}
                  {stagedSearch.trim() ? (
                    <button
                      type="button"
                      onClick={() => setStagedSearch("")}
                      className={`rounded-md border px-3 py-2 text-xs font-bold ${
                        activeImportJobId
                          ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                          : "border-neutral-300 hover:bg-neutral-50"
                      }`}
                    >
                      Clear Search ({currentLaneTotalStageItemIds.length})
                    </button>
                  ) : null}
                  {activeImportJobId ? (
                    <button
                      type="button"
                      onClick={() => void focusImportRun(null)}
                      className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      Show All Runs ({recentImportJobs.length})
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div
              className={`mt-4 rounded-md border p-4 ${
                activeImportJobId
                  ? "border-amber-300 bg-amber-50/20"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm font-semibold text-neutral-700">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setSelectedStageItemIds((current) =>
                            Array.from(new Set([...current, ...visibleStageItemIds])),
                          );
                        } else {
                          setSelectedStageItemIds((current) =>
                            current.filter((id) => !visibleStageItemIds.includes(id)),
                          );
                        }
                      }}
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                    {`Select visible rows (${visibleStageItemIds.length})`}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStageItemIds((current) =>
                        Array.from(new Set([...current, ...readyVisibleStageItemIds])),
                      )
                    }
                    disabled={readyVisibleStageItemIds.length === 0}
                    className="rounded-md border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Select ready visible (${readyVisibleStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStageItemIds((current) =>
                        Array.from(new Set([...current, ...draftCleanupVisibleStageItemIds])),
                      )
                    }
                    disabled={draftCleanupVisibleStageItemIds.length === 0}
                    className="rounded-md border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Select cleanup visible (${draftCleanupVisibleStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStageItemIds((current) =>
                        Array.from(new Set([...current, ...reviewVisibleStageItemIds])),
                      )
                    }
                    disabled={reviewVisibleStageItemIds.length === 0}
                    className="rounded-md border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Select review visible (${reviewVisibleStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStageItemIds((current) =>
                        Array.from(new Set([...current, ...blockedVisibleStageItemIds])),
                      )
                    }
                    disabled={blockedVisibleStageItemIds.length === 0}
                    className="rounded-md border border-rose-300 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Select blocked visible (${blockedVisibleStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStageItemIds((current) =>
                        Array.from(
                          new Set([...current, ...duplicateTrashVisibleStageItemIds]),
                        ),
                      )
                    }
                    disabled={duplicateTrashVisibleStageItemIds.length === 0}
                    className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Select exact dups visible (${duplicateTrashVisibleStageItemIds.length})`}
                  </button>
                  <span className="text-xs font-black uppercase text-neutral-500">
                    {selectedStageItemIds.length} selected
                  </span>
                  <span className="text-xs font-black uppercase text-emerald-700">
                    {selectedReadyCount} ready
                  </span>
                  {selectedDraftCleanupCount > 0 ? (
                    <span className="text-xs font-black uppercase text-amber-700">
                      {selectedDraftCleanupCount} draft cleanup
                    </span>
                  ) : null}
                  {selectedSummary.needs_review > 0 ? (
                    <span className="text-xs font-black uppercase text-amber-700">
                      {selectedSummary.needs_review} review
                    </span>
                  ) : null}
                  {selectedSummary.blocked > 0 ? (
                    <span className="text-xs font-black uppercase text-rose-700">
                      {selectedSummary.blocked} blocked
                    </span>
                  ) : null}
                  {selectedSummary.mapped > 0 ? (
                    <span className="text-xs font-black uppercase text-sky-700">
                      {selectedSummary.mapped} mapped
                    </span>
                  ) : null}
                  {selectedSummary.skipped > 0 ? (
                    <span className="text-xs font-black uppercase text-neutral-600">
                      {selectedSummary.skipped} skipped
                    </span>
                  ) : null}
                  {selectedExactDuplicateTrashStageItemIds.length > 0 ? (
                    <span className="text-xs font-black uppercase text-rose-800">
                      {selectedExactDuplicateTrashStageItemIds.length} exact dups
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link
                    href={selectedInstaCompHref}
                    className={`rounded-md border px-3 py-2 text-xs font-black ${
                      selectedStageItems.length
                        ? "border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                        : "pointer-events-none border-neutral-200 bg-neutral-50 text-neutral-400"
                    }`}
                  >
                    Send Selected to InstaComp™ ({selectedStageItems.length})
                  </Link>
                  <button
                    type="button"
                    onClick={() => promoteSelectedStageItems()}
                    disabled={
                      selectedReadyCount === 0 ||
                      Boolean(promotingStageItemId) ||
                      updatingStageItemId.startsWith("bulk-")
                    }
                    className="rounded-md border border-emerald-300 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promotingStageItemId === "bulk-promote"
                      ? "Promoting Ready..."
                      : `Promote Ready (${selectedReadyCount})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => promoteSelectedDraftCleanupItems()}
                    disabled={
                      selectedDraftCleanupCount === 0 ||
                      Boolean(promotingStageItemId) ||
                      updatingStageItemId.startsWith("bulk-")
                    }
                    className="rounded-md border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {promotingStageItemId === "bulk-promote-draft-cleanup"
                      ? "Promoting Cleanup Drafts..."
                      : `Promote Draft Cleanup (${selectedDraftCleanupCount})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkStageStatus("staged")}
                    disabled={
                      selectedMarkStagedIds.length === 0 ||
                      updatingStageItemId.startsWith("bulk-") ||
                      Boolean(promotingStageItemId)
                    }
                    className={`rounded-md border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                      activeImportJobId
                        ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                        : "border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    {`Mark Staged (${selectedMarkStagedIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkStageStatus("needs_review")}
                    disabled={
                      selectedMarkReviewIds.length === 0 ||
                      updatingStageItemId.startsWith("bulk-") ||
                      Boolean(promotingStageItemId)
                    }
                    className="rounded-md border border-amber-300 px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Mark Review (${selectedMarkReviewIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkStageStatus("skipped")}
                    disabled={
                      selectedMarkSkippedIds.length === 0 ||
                      updatingStageItemId.startsWith("bulk-") ||
                      Boolean(promotingStageItemId)
                    }
                    className="rounded-md border border-rose-300 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Mark Skipped (${selectedMarkSkippedIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void trashExactDuplicateStageItems(
                        selectedExactDuplicateTrashStageItemIds,
                      )
                    }
                    disabled={
                      selectedExactDuplicateTrashStageItemIds.length === 0 ||
                      updatingStageItemId.startsWith("bulk-") ||
                      Boolean(promotingStageItemId)
                    }
                    className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-black text-rose-900 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {`Trash Exact Dups (${selectedExactDuplicateTrashStageItemIds.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStageItemIds([])}
                    disabled={selectedStageItemIds.length === 0}
                    className={`rounded-md border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                      activeImportJobId
                        ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                        : "border-neutral-300 hover:bg-neutral-50"
                    }`}
                  >
                    Clear Selection ({selectedStageItemIds.length})
                  </button>
                </div>
              </div>

              {selectionGuidance ? (
                <div className={`mt-3 rounded-md border p-3 ${selectionGuidance.tone}`}>
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    {selectionGuidance.title}
                  </p>
                  <p className="mt-1 text-sm font-semibold">
                    {selectionGuidance.detail}
                  </p>
                  {selectedSummary.total > 0 &&
                  (selectedSummary.blocked > 0 ||
                    ((selectedSummary.mapped > 0 || selectedSummary.skipped > 0) &&
                      (selectedSummary.ready > 0 ||
                        selectedSummary.draft_cleanup > 0 ||
                        selectedSummary.needs_review > 0)) ||
                    (selectedSummary.draft_cleanup > 0 &&
                      selectedSummary.needs_review > 0) ||
                    (selectedSummary.ready > 0 &&
                      selectedSummary.needs_review > 0)) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("unresolved")}
                        disabled={selectedUnresolvedStageItemIds.length === 0}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Active Work ({selectedUnresolvedStageItemIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("completed")}
                        disabled={selectedCompletedStageItemIds.length === 0}
                        className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Completed Only ({selectedCompletedStageItemIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("ready")}
                        disabled={selectedReadyStageItemIds.length === 0}
                        className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Ready Only ({selectedReadyStageItemIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("draft_cleanup")}
                        disabled={selectedDraftCleanupStageItemIds.length === 0}
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Draft Cleanup Only ({selectedDraftCleanupStageItemIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("needs_review")}
                        disabled={selectedReviewStageItemIds.length === 0}
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Review Only ({selectedReviewStageItemIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => keepSelectedStageLane("blocked")}
                        disabled={selectedBlockedStageItemIds.length === 0}
                        className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Blocked Only ({selectedBlockedStageItemIds.length})
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {lastBulkPromotionSuccesses.length > 0 ? (
                <div
                  className={`mt-3 rounded-md border p-3 ${
                    lastBulkPromotionMode === "draft_cleanup"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-emerald-200 bg-emerald-50 text-emerald-900"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em]">
                        {bulkPromotionModeLabel(lastBulkPromotionMode)} Results
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        {lastBulkPromotionMode === "draft_cleanup"
                          ? `${lastBulkPromotionSuccesses.length} staged row(s) became seller drafts that still need activation cleanup.`
                          : `${lastBulkPromotionSuccesses.length} staged row(s) became seller draft inventory.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => keepSuccessfulPromotionSelection()}
                        className={`rounded-md border bg-white px-3 py-2 text-xs font-bold hover:bg-white ${
                          lastBulkPromotionMode === "draft_cleanup"
                            ? "border-amber-300 text-amber-800 hover:bg-amber-100"
                            : "border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                        }`}
                      >
                        Keep Promoted Only ({lastBulkPromotionSuccesses.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => void openSuccessfulPromotionQueue()}
                        disabled={successfulPromotionMappedIds.length === 0}
                        className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Show Promoted Rows ({successfulPromotionMappedIds.length})
                      </button>
                      <Link
                        href={lastPromotionDraftLink.href}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                      >
                        {lastPromotionDraftLink.label}
                      </Link>
                    </div>
                  </div>
                  {lastBulkPromotionMode === "draft_cleanup" ? (
                    <p className="mt-3 text-xs font-semibold text-amber-900">
                      Next move: review these drafts in the needs-work inventory lane and clear their activation blockers before they go live.
                    </p>
                  ) : null}
                  <div className="mt-3 space-y-2">
                    {lastBulkPromotionSuccesses.slice(0, 3).map((entry) => {
                      const item = successfulPromotionStageItems.find(
                        (candidate) => candidate.id === entry.stagedItemId,
                      );

                        return (
                          <div
                            key={`${entry.stagedItemId}-${entry.legacyProductId}`}
                            className={`rounded-md border bg-white px-3 py-2 ${
                              lastBulkPromotionMode === "draft_cleanup"
                                ? "border-amber-200"
                                : "border-emerald-200"
                            }`}
                          >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-neutral-900">
                                {item?.title || `Draft product #${entry.legacyProductId}`}
                              </p>
                              <p className="text-xs font-semibold text-emerald-800">
                                Draft product #{entry.legacyProductId}
                              </p>
                            </div>
                            <Link
                              href={sellerPromotedInventoryHref(item)}
                              className="text-xs font-bold text-neutral-700 underline"
                            >
                              Open Seller Inventory
                            </Link>
                            <Link
                              href={`/admin/products/${entry.legacyProductId}`}
                              className="text-xs font-bold text-neutral-700 underline"
                            >
                              Open Admin Product
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                    {lastBulkPromotionSuccesses.length > 3 ? (
                      <p
                        className={`text-xs font-semibold ${
                          lastBulkPromotionMode === "draft_cleanup"
                            ? "text-amber-800"
                            : "text-emerald-800"
                        }`}
                      >
                        {lastBulkPromotionSuccesses.length - 3} more promoted row(s) are available in inventory.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {lastBulkPromotionErrors.length > 0 ? (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-rose-900">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.14em]">
                        {bulkPromotionModeLabel(lastBulkPromotionMode)} Follow-Up
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        {lastBulkPromotionMode === "draft_cleanup"
                          ? `${lastBulkPromotionErrors.length} selected row(s) still need cleanup-lane promotion follow-up.`
                          : `${lastBulkPromotionErrors.length} selected row(s) still need ready-lane promotion follow-up.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => keepFailedPromotionSelection()}
                        className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100"
                      >
                        Keep Failed Only ({lastBulkPromotionErrors.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFailedQueue()}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                      >
                        Open Failed Promotions ({lastBulkPromotionErrors.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryFailedReadyPromotions()}
                        disabled={
                          failedPromotionReadyIds.length === 0 ||
                          updatingStageItemId.startsWith("bulk-") ||
                          Boolean(promotingStageItemId)
                        }
                        className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {promotingStageItemId === "retry-failed-ready"
                          ? "Retrying Ready..."
                          : `Retry Ready Failures (${failedPromotionReadyIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryFailedDraftCleanupPromotions()}
                        disabled={
                          failedPromotionDraftCleanupIds.length === 0 ||
                          updatingStageItemId.startsWith("bulk-") ||
                          Boolean(promotingStageItemId)
                        }
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {promotingStageItemId === "retry-failed-draft-cleanup"
                          ? "Retrying Cleanup..."
                          : `Retry Cleanup Failures (${failedPromotionDraftCleanupIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => keepFailedConflictSelection()}
                        disabled={failedPromotionConflictIds.length === 0}
                        className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Keep Conflict Failures (${failedPromotionConflictIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFailedReadyQueue()}
                        disabled={failedPromotionReadyIds.length === 0}
                        className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Open Ready Retry Rows (${failedPromotionReadyIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFailedDraftCleanupQueue()}
                        disabled={failedPromotionDraftCleanupIds.length === 0}
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Open Cleanup Rows (${failedPromotionDraftCleanupIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFailedReviewQueue()}
                        disabled={failedPromotionNeedsReviewIds.length === 0}
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Open Review Rows (${failedPromotionNeedsReviewIds.length})`}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFailedConflictQueue()}
                        disabled={failedPromotionConflictIds.length === 0}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Open Conflict Rows ({failedPromotionConflictIds.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => void markFailedPromotionRowsForReview()}
                        disabled={
                          failedPromotionReviewIds.length === 0 ||
                          updatingStageItemId.startsWith("bulk-") ||
                          Boolean(promotingStageItemId)
                        }
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {`Send Failed To Review (${failedPromotionReviewIds.length})`}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] font-black text-rose-800">
                      {failedPromotionSummary.total} failed
                    </span>
                    {failedPromotionSummary.conflict > 0 ? (
                      <span className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] font-black text-rose-800">
                        {failedPromotionSummary.conflict} conflict
                      </span>
                    ) : null}
                    {failedPromotionSummary.review > 0 ? (
                      <span className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-800">
                        {failedPromotionSummary.review} review
                      </span>
                    ) : null}
                    {failedPromotionSummary.draft_cleanup > 0 ? (
                      <span className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-800">
                        {failedPromotionSummary.draft_cleanup} draft cleanup
                      </span>
                    ) : null}
                    {failedPromotionSummary.ready > 0 ? (
                      <span className="rounded border border-emerald-200 bg-white px-2 py-1 text-[11px] font-black text-emerald-800">
                        {failedPromotionSummary.ready} still ready
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {lastBulkPromotionErrors.slice(0, 3).map((entry) => {
                      const item = stagedItems.find((candidate) => candidate.id === entry.stagedItemId);

                      return (
                        <div
                          key={`${entry.stagedItemId}-${entry.error}`}
                          className="rounded-md border border-rose-200 bg-white px-3 py-2"
                        >
                          <p className="text-sm font-bold text-neutral-900">
                            {item?.title || `Staged row ${entry.stagedItemId.slice(0, 8)}`}
                          </p>
                          <p className="mt-1 text-xs font-semibold text-rose-800">
                            {entry.error}
                          </p>
                          {(item?.promotion_guard?.reasons || []).length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(item?.promotion_guard?.reasons || []).slice(0, 3).map((reason) => (
                                <span
                                  key={`${entry.stagedItemId}-${reason}`}
                                  className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                                >
                                  {promotionReasonLabel(reason)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {item?.promotion_guard?.matches.length ? (
                            <div className="mt-2 space-y-2">
                              {item.promotion_guard.matches.slice(0, 2).map((match) => {
                                const matchInventoryHref = sellerMatchedInventoryHref(match);

                                return (
                                  <div
                                    key={`${entry.stagedItemId}-failed-match-${match.id}-${match.matchType}`}
                                    className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-xs font-bold text-neutral-900">
                                          {match.title}
                                        </p>
                                        <p className="text-[11px] font-semibold text-neutral-600">
                                          {promotionReasonLabel(match.matchType)} /{" "}
                                          {sellerScopeLabel(match.sellerScope)}
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        {matchInventoryHref ? (
                                          <Link
                                            href={matchInventoryHref}
                                            className="text-xs font-bold text-neutral-700 underline"
                                          >
                                            Open Seller Inventory
                                          </Link>
                                        ) : null}
                                        <Link
                                          href={`/admin/products/${match.id}`}
                                          className="text-xs font-bold text-neutral-700 underline"
                                        >
                                          Open Conflict
                                        </Link>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {lastBulkPromotionErrors.length > 3 ? (
                      <p className="text-xs font-semibold text-rose-800">
                        {lastBulkPromotionErrors.length - 3} more failed row(s) remain in the current selection.
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto rounded-md border border-neutral-200">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">Select</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Qty</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 bg-white">
                  {filteredStagedItems.map((item) => {
                    const metadata =
                      item.metadata && typeof item.metadata === "object"
                        ? (item.metadata as Record<string, unknown>)
                        : null;
                    const signals = stageSignals(item);
                    const laneBadge = stageLaneBadge(item);
                    const authenticity = stagedAuthenticityProfile(item);
                    const authenticityBadges = buildAuthenticityBadges(authenticity);
                    const categoryHint = metadataTextValue(metadata, "category_hint");
                    const categoryConfidence = metadataTextValue(
                      metadata,
                      "category_confidence",
                    );
                    const promotedProductId =
                      item.promotion_guard?.promotedLegacyProductId ||
                      metadataNumberValue(metadata, "promoted_legacy_product_id");
                    const canPromote = canPromoteStageItem(item);

                    return (
                      <tr key={item.id}>
                        <td className="px-4 py-4 align-top">
                          <input
                            type="checkbox"
                            checked={selectedStageItemIds.includes(item.id)}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedStageItemIds((current) =>
                                  current.includes(item.id)
                                    ? current
                                    : [...current, item.id],
                                );
                              } else {
                                setSelectedStageItemIds((current) =>
                                  current.filter((id) => id !== item.id),
                                );
                              }
                            }}
                            className="mt-1 h-4 w-4 rounded border-neutral-300"
                          />
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-bold">{item.title}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {item.source_item_id}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Link
                              href={sellerPromotedInventoryHref(item)}
                              className="text-xs font-bold text-neutral-700 underline"
                            >
                              {sellerStagedInventorySearchLabel(item)}
                            </Link>
                            <Link
                              href={sellerStagedInstaCompHref([item])}
                              className="text-xs font-bold text-blue-700 underline"
                            >
                              Send to InstaComp™
                            </Link>
                          </div>
                          {categoryHint ? (
                            <p className="mt-1 text-xs text-neutral-500">
                              Category hint {label(categoryHint)}
                              {categoryConfidence
                                ? ` / ${label(categoryConfidence)} confidence`
                                : ""}
                            </p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {signals.length > 0 ? (
                              signals.map((signal) => (
                                <span
                                  key={`${item.id}-${signal.label}`}
                                  className={`rounded border px-2 py-1 text-[11px] font-black ${signalTone(
                                    signal.tone,
                                  )}`}
                                >
                                  {signal.label}
                                </span>
                              ))
                            ) : (
                              <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-800">
                                Ready signal clean
                              </span>
                            )}
                          </div>
                          {authenticityBadges.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {authenticityBadges.map((badge) => (
                                <span
                                  key={`${item.id}-${badge.label}`}
                                  className={`rounded border px-2 py-1 text-[11px] font-black ${authenticityBadgeTone(
                                    badge.tone,
                                  )}`}
                                >
                                  {badge.label}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {hasAuthenticityDetails(authenticity) ? (
                            <div className="mt-2 space-y-1 text-xs text-neutral-600">
                              {authenticity.certProvider ? (
                                <p>
                                  Cert source: {authenticity.certProvider}
                                  {authenticity.certNumber
                                    ? ` / ${authenticity.certNumber}`
                                    : ""}
                                </p>
                              ) : null}
                              {authenticity.provenanceEvidence ? (
                                <p className="line-clamp-2">
                                  Provenance: {authenticity.provenanceEvidence}
                                </p>
                              ) : null}
                              {authenticity.authenticityNotes ? (
                                <p className="line-clamp-2">
                                  Note: {authenticity.authenticityNotes}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {item.draft_activation_readiness ? (
                            <div className="mt-2">
                              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                Draft Activation Outlook
                              </p>
                              {item.draft_activation_readiness.ready ? (
                                <p className="mt-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
                                  If promoted right now, this row will create a draft with no current activation blockers.
                                </p>
                              ) : (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {item.draft_activation_readiness.blockers.map((blocker) => (
                                    <span
                                      key={`${item.id}-draft-${blocker}`}
                                      className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                                    >
                                      {readinessBlockerLabel(blocker)}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}
                          {editingReviewItemId === item.id ? (
                            <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-600">
                                    Review Imported Details
                                  </p>
                                  <p className="mt-1 text-xs text-neutral-600">
                                    Fix the category and disclosure before this row becomes draft inventory.
                                  </p>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 md:grid-cols-2">
                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Category Hint
                                  </span>
                                  <select
                                    value={reviewCategoryHint}
                                    onChange={(event) =>
                                      setReviewCategoryHint(event.target.value)
                                    }
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  >
                                    {STAGED_CATEGORY_OPTIONS.map((option) => (
                                      <option key={option} value={option}>
                                        {label(option)}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Authenticity Status
                                  </span>
                                  <select
                                    value={reviewAuthenticityStatus}
                                    onChange={(event) =>
                                      setReviewAuthenticityStatus(
                                        event.target.value as AuthenticityProfile["status"],
                                      )
                                    }
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  >
                                    {AUTHENTICITY_STATUSES.map((status) => (
                                      <option key={status} value={status}>
                                        {authenticityStatusLabel(status)}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Autograph Source
                                  </span>
                                  <select
                                    value={reviewAutographSource}
                                    onChange={(event) =>
                                      setReviewAutographSource(
                                        event.target.value as AuthenticityProfile["autographSource"],
                                      )
                                    }
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  >
                                    {AUTOGRAPH_SOURCES.map((source) => (
                                      <option key={source} value={source}>
                                        {autographSourceLabel(source)}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Cert Provider
                                  </span>
                                  <input
                                    type="text"
                                    value={reviewCertProvider}
                                    onChange={(event) =>
                                      setReviewCertProvider(event.target.value)
                                    }
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  />
                                </label>

                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Cert Number
                                  </span>
                                  <input
                                    type="text"
                                    value={reviewCertNumber}
                                    onChange={(event) =>
                                      setReviewCertNumber(event.target.value)
                                    }
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  />
                                </label>

                                <label className="block">
                                  <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                    Pass Guarantee Names
                                  </span>
                                  <input
                                    type="text"
                                    value={reviewGuaranteedAuthenticators}
                                    onChange={(event) =>
                                      setReviewGuaranteedAuthenticators(event.target.value)
                                    }
                                    placeholder="JSA, PSA DNA, Beckett"
                                    className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                  />
                                </label>
                              </div>

                              <label className="mt-3 block">
                                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                  Provenance Evidence
                                </span>
                                <textarea
                                  value={reviewProvenanceEvidence}
                                  onChange={(event) =>
                                    setReviewProvenanceEvidence(event.target.value)
                                  }
                                  rows={2}
                                  className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                />
                              </label>

                              <label className="mt-3 block">
                                <span className="text-[11px] font-black uppercase tracking-[0.14em] text-neutral-500">
                                  Disclosure Notes
                                </span>
                                <textarea
                                  value={reviewAuthenticityNotes}
                                  onChange={(event) =>
                                    setReviewAuthenticityNotes(event.target.value)
                                  }
                                  rows={2}
                                  className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs"
                                />
                              </label>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => saveStageReview(item.id)}
                                  disabled={updatingStageItemId === item.id}
                                  className="rounded-md bg-neutral-950 px-3 py-2 text-xs font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                                >
                                  {updatingStageItemId === item.id
                                    ? "Saving..."
                                    : "Save Review"}
                                </button>
                                <button
                                  type="button"
                                  onClick={closeStageReviewEditor}
                                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4 font-semibold">
                          {item.sku || "Missing SKU"}
                        </td>
                        <td className="px-4 py-4">{item.quantity}</td>
                        <td className="px-4 py-4">
                          {typeof item.price === "number"
                            ? formatCurrency(item.price)
                            : "No active price"}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                              item.stage_status,
                            )}`}
                          >
                            {stagedStatusLabel(item)}
                          </span>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => focusStageLane(laneBadge.filter)}
                              className={`rounded border px-2 py-1 text-[11px] font-black ${laneBadge.tone}`}
                            >
                              {laneBadge.label}
                            </button>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                editingReviewItemId === item.id
                                  ? closeStageReviewEditor()
                                  : openStageReviewEditor(item)
                              }
                              disabled={
                                updatingStageItemId === item.id ||
                                updatingStageItemId.startsWith("bulk-") ||
                                promotingStageItemId === item.id
                              }
                              className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-bold hover:bg-neutral-50 disabled:opacity-60"
                            >
                              {editingReviewItemId === item.id
                                ? "Close Review"
                                : "Review Details"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setStageStatus(item.id, "staged")}
                              disabled={
                                updatingStageItemId === item.id ||
                                updatingStageItemId.startsWith("bulk-") ||
                                promotingStageItemId === item.id
                              }
                              className="rounded border border-neutral-300 px-2 py-1 text-[11px] font-bold hover:bg-neutral-50 disabled:opacity-60"
                            >
                              Stage
                            </button>
                            <button
                              type="button"
                              onClick={() => setStageStatus(item.id, "needs_review")}
                              disabled={
                                updatingStageItemId === item.id ||
                                updatingStageItemId.startsWith("bulk-") ||
                                promotingStageItemId === item.id
                              }
                              className="rounded border border-amber-300 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                            >
                              Review
                            </button>
                            <button
                              type="button"
                              onClick={() => setStageStatus(item.id, "skipped")}
                              disabled={
                                updatingStageItemId === item.id ||
                                updatingStageItemId.startsWith("bulk-") ||
                                promotingStageItemId === item.id
                              }
                              className="rounded border border-rose-300 px-2 py-1 text-[11px] font-bold text-rose-800 hover:bg-rose-50 disabled:opacity-60"
                            >
                              Skip
                            </button>
                            {isExactDuplicateTrashCandidate(item) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void trashExactDuplicateStageItems([item.id])
                                }
                                disabled={
                                  updatingStageItemId === item.id ||
                                  updatingStageItemId.startsWith("bulk-") ||
                                  promotingStageItemId === item.id
                                }
                                className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] font-black text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                              >
                                Trash Dup
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => promoteStageItem(item.id)}
                              disabled={
                                updatingStageItemId === item.id ||
                                updatingStageItemId.startsWith("bulk-") ||
                                promotingStageItemId === item.id ||
                                !canPromote
                              }
                              className="rounded border border-emerald-300 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                            >
                              {promotingStageItemId === item.id
                                ? "Promoting..."
                                : hasDraftActivationCleanup(item)
                                  ? "Promote Draft Anyway"
                                  : "Promote Draft"}
                            </button>
                          </div>
                          {!canPromote && !item.promotion_guard?.blocked ? (
                            <p className="mt-2 text-xs font-semibold text-neutral-600">
                              Move this row to STAGED before promoting it.
                            </p>
                          ) : null}
                          {canPromote && hasDraftActivationCleanup(item) ? (
                            <p className="mt-2 text-xs font-semibold text-amber-800">
                              This row can promote into draft inventory now, but the draft
                              will still need cleanup before activation:{" "}
                              {(item.draft_activation_readiness?.blockers || [])
                                .map((blocker) => readinessBlockerLabel(blocker))
                                .join(", ")}
                              .
                            </p>
                          ) : null}
                          {typeof promotedProductId === "number" ? (
                            <div className="mt-2 space-y-1">
                              <p className="text-xs font-semibold text-emerald-700">
                                Draft product #{promotedProductId}
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  href={sellerPromotedInventoryHref(item)}
                                  className="text-xs font-bold text-neutral-700 underline"
                                >
                                  Open Seller Inventory
                                </Link>
                                <Link
                                  href={`/admin/products/${promotedProductId}`}
                                  className="text-xs font-bold text-neutral-700 underline"
                                >
                                  Open Admin Product
                                </Link>
                              </div>
                            </div>
                          ) : null}
                          {item.promotion_guard?.matches.length ? (
                            <div className="mt-2 space-y-1">
                              {item.promotion_guard.matches.slice(0, 2).map((match) => {
                                const matchInventoryHref = sellerMatchedInventoryHref(match);

                                return (
                                  <div
                                    key={`${item.id}-${match.id}-${match.matchType}`}
                                    className="flex flex-wrap gap-2 text-xs font-semibold"
                                  >
                                    {matchInventoryHref ? (
                                      <Link
                                        href={matchInventoryHref}
                                        className="text-rose-700 underline"
                                      >
                                        Open Seller Inventory
                                      </Link>
                                    ) : null}
                                    <Link
                                      href={`/admin/products/${match.id}`}
                                      className="text-rose-700 underline"
                                    >
                                      Conflict: {match.title} via{" "}
                                      {match.matchType === "ebay_item_id"
                                        ? "eBay item"
                                        : "SKU"}
                                    </Link>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-4">{shortDate(item.updated_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredStagedItems.length === 0 ? (
              <div className={`mt-4 rounded-md border p-4 ${emptyLaneState.tone}`}>
                <p className="text-xs font-black uppercase tracking-[0.14em]">
                  {emptyLaneState.title}
                </p>
                <p className="mt-2 text-sm font-semibold">
                  {emptyLaneState.detail}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {stagedSearch.trim() ? (
                    <button
                      type="button"
                      onClick={() => setStagedSearch("")}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                    >
                      Clear Search ({currentLaneTotalStageItemIds.length})
                    </button>
                  ) : null}
                  {stageFilter !== "all" ? (
                    <button
                      type="button"
                      onClick={() => focusStageLane("all")}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                    >
                      Show All Lanes ({stagedSummary.total})
                    </button>
                  ) : null}
                  {activeImportJobId ? (
                    <button
                      type="button"
                      onClick={() => void focusImportRun(null)}
                      className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      Show All Runs ({recentImportJobs.length})
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-4 text-sm text-neutral-500">
            No staged seller listings yet.
          </p>
        )}
      </div>

      {connections.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-neutral-600">
          {ebaySyncEnabled
            ? "No seller marketplace connections are saved yet. Use the request actions above to create seller-scoped connection records and start seller-safe eBay OAuth without touching the Store #1 eBay sync token."
            : "No seller marketplace connections are saved yet. eBay connect actions stay paused until a store admin re-enables eBay sync for this store."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Marketplace</th>
                <th className="px-4 py-3">Connection</th>
                <th className="px-4 py-3">Sync</th>
                <th className="px-4 py-3">Last Sync</th>
                <th className="px-4 py-3">Token Rotation</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {connections.map((connection) => (
                <tr key={connection.id} className="align-top">
                  <td className="px-4 py-4">
                    <p className="font-bold">{label(connection.provider)}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {connection.providerAccountLabel ||
                        connection.providerAccountId ||
                        "No provider account label"}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                        connection.connectionStatus,
                      )}`}
                    >
                      {label(connection.connectionStatus)}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
                        connection.syncStatus,
                      )}`}
                    >
                      {label(connection.syncStatus)}
                    </span>
                    {connection.lastSyncError ? (
                      <p className="mt-2 max-w-xs text-xs font-semibold text-rose-700">
                        {connection.lastSyncError}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    {shortDate(connection.lastSyncCompletedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <p>{shortDate(connection.tokenLastRotatedAt)}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      Access expires {shortDate(connection.accessTokenExpiresAt)}
                    </p>
                    {connection.provider === "ebay" &&
                    (connection.connectionStatus === "connected" ||
                      connection.connectionStatus === "sync_paused") ? (
                      <span
                        className={`mt-2 inline-flex rounded border px-2 py-1 text-[11px] font-black ${
                          connection.oauthScope.includes(EBAY_IDENTITY_SCOPE) &&
                          connection.providerAccountId
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-amber-200 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {connection.oauthScope.includes(EBAY_IDENTITY_SCOPE) &&
                        connection.providerAccountId
                          ? "REVOCATION PROTECTED"
                          : "SECURITY RECONNECT"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    {connection.provider === "ebay" &&
                    (connection.connectionStatus === "connected" ||
                      connection.connectionStatus === "sync_paused") ? (
                      <div className="flex max-w-xs flex-wrap gap-2">
                        {ebaySyncEnabled ? (
                          <>
                            {connection.connectionStatus !== "sync_paused" &&
                            connection.syncStatus !== "paused" ? (
                              <button
                                type="button"
                                onClick={() => refreshEbayStatus()}
                                disabled={isSavingProvider.length > 0}
                                className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Refresh Status
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                changeSellerEbaySync(
                                  connection.connectionStatus !== "sync_paused" &&
                                    connection.syncStatus !== "paused",
                                )
                              }
                              disabled={
                                isSavingProvider.length > 0 ||
                                isStagingItems ||
                                isLoadingPreview
                              }
                              className={`rounded-md border px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
                                connection.connectionStatus === "sync_paused" ||
                                connection.syncStatus === "paused"
                                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                                  : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"
                              }`}
                            >
                              {isSavingProvider === "ebay-pause"
                                ? "Pausing..."
                                : isSavingProvider === "ebay-resume"
                                  ? "Resuming..."
                                  : connection.connectionStatus === "sync_paused" ||
                                      connection.syncStatus === "paused"
                                    ? "Resume Seller Sync"
                                    : "Pause Seller Sync"}
                            </button>
                          </>
                        ) : (
                          <span className="self-center text-xs font-semibold text-rose-700">
                            Store sync disabled
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => disconnectEbay()}
                          disabled={isSavingProvider.length > 0}
                          className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSavingProvider === "ebay-disconnect"
                            ? "Disconnecting..."
                            : "Disconnect eBay"}
                        </button>
                        <a
                          href={EBAY_THIRD_PARTY_ACCESS_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50"
                        >
                          eBay App Permissions
                        </a>
                      </div>
                    ) : connection.provider === "ebay" && !ebaySyncEnabled ? (
                      <span className="text-xs font-semibold text-rose-700">
                        Store sync disabled
                      </span>
                    ) : connection.provider === "ebay" ? (
                      <button
                        type="button"
                        onClick={() => requestConnection("ebay")}
                        disabled={isSavingProvider.length > 0}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reconnect eBay
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-neutral-500">
                        Pending provider build
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PreviewItemsTable({ items }: { items: SellerEbayPreviewItem[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Item</th>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Qty</th>
            <th className="px-4 py-3">Price</th>
            <th className="px-4 py-3">Offer</th>
            <th className="px-4 py-3">Condition</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 bg-white">
          {items.map((item) => {
            const authenticity = previewAuthenticityProfile(item);
            const authenticityBadges = buildAuthenticityBadges(authenticity);

            return (
              <tr key={item.sku || item.listingId || item.title}>
                <td className="px-4 py-4">
                  <p className="font-bold">{item.title}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {item.listingId
                      ? `Listing ${item.listingId}`
                      : "No listing ID returned"}
                  </p>
                  {item.categoryHint ? (
                    <p className="mt-1 text-xs text-neutral-500">
                      Category hint {label(item.categoryHint)}
                      {item.categoryConfidence
                        ? ` / ${label(item.categoryConfidence)} confidence`
                        : ""}
                    </p>
                  ) : null}
                  {authenticityBadges.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {authenticityBadges.map((badge) => (
                        <span
                          key={`${item.title}-${badge.label}`}
                          className={`rounded border px-2 py-1 text-[11px] font-black ${authenticityBadgeTone(
                            badge.tone,
                          )}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {hasAuthenticityDetails(authenticity) ? (
                    <div className="mt-2 space-y-1 text-xs text-neutral-600">
                      {authenticity.certProvider ? (
                        <p>
                          Cert source: {authenticity.certProvider}
                          {authenticity.certNumber
                            ? ` / ${authenticity.certNumber}`
                            : ""}
                        </p>
                      ) : null}
                      {authenticity.authenticityNotes ? (
                        <p className="line-clamp-2">
                          Note: {authenticity.authenticityNotes}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-4 font-semibold">
                  {item.sku || "Missing SKU"}
                </td>
                <td className="px-4 py-4">{item.quantity}</td>
                <td className="px-4 py-4">
                  {typeof item.price === "number"
                    ? formatCurrency(item.price)
                    : "No active price"}
                </td>
                <td className="px-4 py-4">
                  <p>{item.offerStatus ? label(item.offerStatus) : "No offer"}</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {item.listingStatus
                      ? label(item.listingStatus)
                      : "No listing status"}
                  </p>
                </td>
                <td className="px-4 py-4">{item.condition || "Not set"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-black">{value}</p>
    </div>
  );
}

function PreviewInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function LatestImportDiagnostics({
  job,
  runCount,
  isActive,
  onFocus,
  onSelectFilter,
  onSelectWorkQueue,
  onClear,
}: {
  job: SellerImportJob;
  runCount: number;
  isActive: boolean;
  onFocus: () => void;
  onSelectFilter: (filter: StageFilter) => void;
  onSelectWorkQueue: () => void;
  onClear: () => void;
}) {
  const metadata = metadataRecord(job.metadata);
  const sourceCursor = metadataRecord(job.source_cursor);
  const qualityEntries = metadataCountEntries(metadata, "quality_summary");
  const skipEntries = metadataCountEntries(metadata, "skip_reason_summary");
  const requestLimit =
    metadataNumberValue(sourceCursor, "limit") ?? metadataNumberValue(metadata, "limit");
  const totalAvailable = metadataNumberValue(sourceCursor, "total_available");
  const offset = metadataNumberValue(sourceCursor, "offset");
  const nextOffset = metadataNumberValue(sourceCursor, "next_offset");
  const fetchedAt = metadataTextValue(metadata, "fetched_at");

  if (
    requestLimit === null &&
    totalAvailable === null &&
    !fetchedAt &&
    qualityEntries.length === 0 &&
    skipEntries.length === 0
  ) {
    return null;
  }

  return (
    <div
      className={`mt-4 rounded-md border p-4 ${
        isActive
          ? "border-amber-300 bg-amber-50/60"
          : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
            {isActive ? "Focused Run Diagnostics" : "Latest Run Diagnostics"}
          </h4>
          <p className="mt-1 text-sm text-neutral-600">
            {isActive
              ? "Snapshot context and cleanup pressure captured with the seller eBay import run currently in focus."
              : "Snapshot context and cleanup pressure captured with the most recent seller eBay import run."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isActive ? (
            <span className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-black text-amber-900">
              FOCUSED
            </span>
          ) : null}
          <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-xs font-black text-neutral-700">
            Job {job.id.slice(0, 8)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onFocus}
          className={`rounded-md border bg-white px-3 py-2 text-xs font-bold ${
            isActive
              ? "border-amber-300 text-amber-900 hover:bg-amber-100"
              : "border-neutral-300 hover:bg-neutral-100"
          }`}
        >
          {isActive
            ? `Viewing This Run (${job.row_count || 0} rows)`
            : `Show This Run (${job.row_count || 0} rows)`}
        </button>
        {isActive ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            Show All Runs ({runCount})
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <PreviewInfo
          label="Request Limit"
          value={requestLimit === null ? "Not captured" : String(requestLimit)}
        />
        <PreviewInfo
          label="eBay Total"
          value={totalAvailable === null ? "Not returned" : String(totalAvailable)}
        />
        <PreviewInfo
          label="Batch Range"
          value={
            offset === null || nextOffset === null
              ? "Not captured"
              : nextOffset > offset
                ? `${offset + 1}-${nextOffset}`
                : `Offset ${offset}`
          }
        />
        <PreviewInfo label="Fetched At" value={shortDate(fetchedAt)} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DiagnosticSection
          title="Quality Signals"
          emptyLabel="No quality issues captured."
          kind="quality"
          entries={qualityEntries}
        />
        <DiagnosticSection
          title="Skipped Reasons"
          emptyLabel="No skipped rows on this run."
          kind="skip"
          entries={skipEntries}
        />
      </div>

      {job.current_summary ? (
        <div className="mt-4">
          <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
            {isActive ? "Focused Run Outcome" : "Run Outcome"}
          </p>
          <ImportRunOutcomeSummary summary={job.current_summary} />
          <ImportRunLaneButtons
            summary={job.current_summary}
            onReady={() => onSelectFilter("ready")}
            onDraftCleanup={() => onSelectFilter("draft_cleanup")}
            onReview={() => onSelectFilter("needs_review")}
            onBlocked={() => onSelectFilter("blocked")}
            onMapped={() => onSelectFilter("mapped")}
            onWorkQueue={onSelectWorkQueue}
          />
        </div>
      ) : null}
    </div>
  );
}

function ImportRunCard({
  job,
  runCount,
  isActive,
  onFocus,
  onSelectFilter,
  onSelectWorkQueue,
  onClear,
}: {
  job: SellerImportJob;
  runCount: number;
  isActive: boolean;
  onFocus: () => void;
  onSelectFilter: (filter: StageFilter) => void;
  onSelectWorkQueue: () => void;
  onClear: () => void;
}) {
  const metadata = metadataRecord(job.metadata);
  const qualityEntries = metadataCountEntries(metadata, "quality_summary");
  const skipEntries = metadataCountEntries(metadata, "skip_reason_summary");
  const diagnostics = [...qualityEntries.slice(0, 3), ...skipEntries.slice(0, 2)];
  const totalAvailable = metadataNumberValue(
    metadataRecord(job.source_cursor),
    "total_available",
  );

  return (
    <div
      className={`rounded-md border p-4 ${
        isActive
          ? "border-amber-300 bg-amber-50/40"
          : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Job {job.id.slice(0, 8)}
            </p>
            {isActive ? (
              <span className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-black text-amber-900">
                FOCUSED
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            Started {shortDate(job.started_at)} / Completed {shortDate(job.completed_at)}
          </p>
        </div>
        <span
          className={`rounded border px-2 py-1 text-[11px] font-black ${statusTone(
            job.status,
          )}`}
        >
          {label(job.status)}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <PreviewInfo label="Rows" value={String(job.row_count || 0)} />
        <PreviewInfo label="Staged" value={String(job.staged_count || 0)} />
        <PreviewInfo label="Skipped" value={String(job.skipped_count || 0)} />
        <PreviewInfo label="Errors" value={String(job.error_count || 0)} />
        <PreviewInfo
          label="eBay Total"
          value={totalAvailable === null ? "Not returned" : String(totalAvailable)}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onFocus}
          className={`rounded-md border px-3 py-2 text-xs font-bold ${
            isActive
              ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
              : "border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          {isActive
            ? `Viewing This Run (${job.row_count || 0} rows)`
            : `Show This Run (${job.row_count || 0} rows)`}
        </button>
        {isActive ? (
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
          >
            Show All Runs ({runCount})
          </button>
        ) : null}
      </div>

      <div className="mt-4">
        {job.current_summary ? (
          <div className="mb-4">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              {isActive ? "Focused Run Outcome" : "Run Outcome"}
            </p>
            <ImportRunOutcomeSummary summary={job.current_summary} compact />
            <ImportRunLaneButtons
              summary={job.current_summary}
              onReady={() => onSelectFilter("ready")}
              onDraftCleanup={() => onSelectFilter("draft_cleanup")}
              onReview={() => onSelectFilter("needs_review")}
              onBlocked={() => onSelectFilter("blocked")}
              onMapped={() => onSelectFilter("mapped")}
              onWorkQueue={onSelectWorkQueue}
            />
          </div>
        ) : null}

        {diagnostics.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {qualityEntries.slice(0, 3).map(([key, value]) => (
              <span
                key={`${job.id}-quality-${key}`}
                className={`rounded border px-2 py-1 text-[11px] font-black ${importDiagnosticTone(
                  "quality",
                  key,
                )}`}
              >
                {importDiagnosticLabel(key)}: {value}
              </span>
            ))}
            {skipEntries.slice(0, 2).map(([key, value]) => (
              <span
                key={`${job.id}-skip-${key}`}
                className={`rounded border px-2 py-1 text-[11px] font-black ${importDiagnosticTone(
                  "skip",
                  key,
                )}`}
              >
                {importDiagnosticLabel(key)}: {value}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500">
            No extra diagnostics were captured on this run.
          </p>
        )}
      </div>
    </div>
  );
}

function ImportRunOutcomeSummary({
  summary,
  compact,
}: {
  summary: NonNullable<SellerImportJob["current_summary"]>;
  compact?: boolean;
}) {
  const completion = importRunCompletion(summary);
  const metrics = [
    {
      key: "ready",
      label: "Ready",
      value: summary.ready,
      tone: outcomeTone("ready"),
    },
    {
      key: "draft_cleanup",
      label: "Draft Cleanup",
      value: summary.draft_cleanup,
      tone: outcomeTone("draft_cleanup"),
    },
    {
      key: "needs_review",
      label: "Review",
      value: summary.needs_review,
      tone: outcomeTone("review"),
    },
    {
      key: "blocked",
      label: "Blocked",
      value: summary.blocked,
      tone: outcomeTone("blocked"),
    },
    {
      key: "mapped",
      label: "Mapped",
      value: summary.mapped,
      tone: outcomeTone("mapped"),
    },
    {
      key: "promoted",
      label: "Promoted",
      value: summary.promoted,
      tone: outcomeTone("promoted"),
    },
    {
      key: "skipped",
      label: "Skipped",
      value: summary.skipped,
      tone: outcomeTone("skipped"),
    },
  ].filter((metric) => metric.value > 0 || metric.key === "ready");

  return (
    <div className="mt-3">
      <div className="rounded-md border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Cleanup State
            </p>
            <p className="mt-1 text-sm font-bold text-neutral-900">
              {completion.detail}
            </p>
          </div>
          <span
            className={`rounded border px-2 py-1 text-[11px] font-black uppercase ${completion.tone}`}
          >
            {completion.label}
          </span>
        </div>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div
            className={`h-full rounded-full transition-[width] ${completion.barTone}`}
            style={{ width: `${completion.percent}%` }}
          />
        </div>

        <p className="mt-2 text-xs font-semibold text-neutral-600">
          {completion.percent}% resolved
        </p>
      </div>

      <div className={`mt-3 grid gap-2 ${compact ? "md:grid-cols-3" : "md:grid-cols-6"}`}>
        {metrics.map((metric) => (
          <div
            key={metric.key}
            className={`rounded border px-3 py-2 text-xs font-black ${metric.tone}`}
          >
            <p className="uppercase tracking-[0.14em]">{metric.label}</p>
            <p className="mt-1 text-lg leading-none">{metric.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ImportRunLaneButtons({
  summary,
  onReady,
  onDraftCleanup,
  onReview,
  onBlocked,
  onMapped,
  onWorkQueue,
}: {
  summary: NonNullable<SellerImportJob["current_summary"]>;
  onReady: () => void;
  onDraftCleanup: () => void;
  onReview: () => void;
  onBlocked: () => void;
  onMapped: () => void;
  onWorkQueue: () => void;
}) {
  const workCounts = importRunWorkCounts(summary);

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onWorkQueue}
        disabled={workCounts.unresolved === 0}
        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Remaining Work (${workCounts.unresolved})`}
      </button>
      <button
        type="button"
        onClick={onReady}
        disabled={summary.ready === 0}
        className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Open Ready Rows (${summary.ready})`}
      </button>
      <button
        type="button"
        onClick={onDraftCleanup}
        disabled={summary.draft_cleanup === 0}
        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Open Draft Cleanup Rows (${summary.draft_cleanup})`}
      </button>
      <button
        type="button"
        onClick={onReview}
        disabled={summary.needs_review === 0}
        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Open Review Rows (${summary.needs_review})`}
      </button>
      <button
        type="button"
        onClick={onBlocked}
        disabled={summary.blocked === 0}
        className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Open Blocked Rows (${summary.blocked})`}
      </button>
      <button
        type="button"
        onClick={onMapped}
        disabled={summary.mapped === 0}
        className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {`Open Mapped Rows (${summary.mapped})`}
      </button>
    </div>
  );
}

function DiagnosticSection({
  title,
  emptyLabel,
  kind,
  entries,
}: {
  title: string;
  emptyLabel: string;
  kind: "quality" | "skip";
  entries: Array<readonly [string, number]>;
}) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
        {title}
      </p>
      {entries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {entries.map(([key, value]) => (
            <span
              key={`${kind}-${key}`}
              className={`rounded border px-2 py-1 text-[11px] font-black ${importDiagnosticTone(
                kind,
                key,
              )}`}
            >
              {importDiagnosticLabel(key)}: {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-500">{emptyLabel}</p>
      )}
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}
