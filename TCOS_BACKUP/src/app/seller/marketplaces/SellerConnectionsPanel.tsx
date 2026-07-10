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
  getAccountSession,
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

const EBAY_THIRD_PARTY_ACCESS_URL =
  "https://accounts.ebay.com/acctsec/security-center/third-party-app-access";
const EBAY_IDENTITY_SCOPE =
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly";

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

  if (
    item.promotion_guard?.blocked &&
    item.promotion_guard.matches.some((match) => match.sellerScope === "same_seller")
  ) {
    signals.push({ label: "Existing seller match", tone: "warning" });
  } else if (item.promotion_guard?.blocked) {
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
  if (item.promotion_guard?.blocked) return "blocked";
  if (item.stage_status === "needs_review") return "needs_review";
  if (hasDraftActivationCleanup(item)) return "draft_cleanup";
  if (isDraftActivationReadyStageItem(item)) return "ready";
  if (item.stage_status === "mapped") return "mapped";
  if (item.stage_status === "skipped") return "skipped";
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
  if (item.promotion_guard?.blocked) return 0;
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
          item.promotion_guard?.blocked === true,
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
      .filter((item) => item.promotion_guard?.blocked === true)
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
  if (filter === "skipped") return "Skipped lane";
  return "All staged rows";
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
    return "These rows are currently out of the active staging workflow.";
  }

  return "This workspace mixes every stage lane together so you can inspect the full seller staging picture.";
}

function stageLaneSelectionLabel(filter: StageFilter) {
  if (filter === "ready") return "Select ready lane";
  if (filter === "draft_cleanup") return "Select cleanup lane";
  if (filter === "blocked") return "Select blocked lane";
  if (filter === "needs_review") return "Select review lane";
  if (filter === "mapped") return "Select mapped lane";
  if (filter === "skipped") return "Select skipped lane";
  if (filter === "staged") return "Select staged lane";
  return "Select visible lane";
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

  if (!response.ok) {
    throw new Error(data.error || "Could not load seller eBay import preview.");
  }

  return data.preview as SellerEbayInventoryPreview;
}

async function fetchSellerStagedItems(
  accessToken: string,
  options?: { importJobId?: string | null },
) {
  const searchParams = new URLSearchParams({
    limit: options?.importJobId ? "250" : "100",
    importJobLimit: "8",
  });

  if (options?.importJobId) {
    searchParams.set("importJobId", options.importJobId);
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

  if (!response.ok) {
    throw new Error(data.error || "Could not load seller staged listings.");
  }

  return {
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    latestImportJob: (data.latestImportJob || null) as SellerImportJob | null,
    recentImportJobs: (data.recentImportJobs || []) as SellerImportJob[],
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

  if (!response.ok) {
    throw new Error(data.error || "Could not stage seller eBay listings.");
  }

  return data.result as {
    importJobId: string | null;
    offset: number;
    nextOffset: number;
    hasMore: boolean;
    stagedCount: number;
    skippedCount: number;
    totalAvailable: number | null;
    fetchedAt: string;
    sampleItems: SellerEbayPreviewItem[];
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

  if (!response.ok) {
    throw new Error(data.error || "Could not update seller staged item.");
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    updatedCount: Number(data.updatedCount || 0),
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

  if (!response.ok) {
    throw new Error(data.error || "Could not save seller staged item review.");
  }

  return {
    stagedItem: (data.stagedItem || null) as SellerStagedItem | null,
    stagedItems: (data.stagedItems || []) as SellerStagedItem[],
    updatedCount: Number(data.updatedCount || 0),
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

  if (!response.ok) {
    throw new Error(data.error || "Could not promote seller staged item.");
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
  };
}

export default function SellerConnectionsPanel({
  ebaySyncEnabled,
}: {
  ebaySyncEnabled: boolean;
}) {
  const [initialStageWorkspace] = useState(initialStageWorkspaceState);
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
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
  const [isLoading, setIsLoading] = useState(
    () => Boolean(session?.access_token),
  );
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
      });
      setStagedItems(data.stagedItems);
      setLatestImportJob(data.latestImportJob);
      setRecentImportJobs(data.recentImportJobs);
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
        setMessage(error.message || "Could not load seller staged listings.");
      }
      return null;
    } finally {
      setIsLoadingStaged(false);
    }
  }, [activeImportJobId]);

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
  }, [refreshSellerInventoryState, refreshSellerStageState, session?.access_token]);

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

      if (!response.ok) {
        throw new Error(
          data.error || "Could not save seller marketplace connection.",
        );
      }

      if (provider === "ebay" && data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
        return;
      }

      setMessage(`${label(provider)} connection request saved.`);
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
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

      if (!response.ok) {
        throw new Error(data.error || "Could not refresh seller eBay status.");
      }

      setMessage("Seller eBay status refreshed.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
      setMessage(error.message || "Could not refresh seller eBay status.");
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

      if (!response.ok) {
        throw new Error(data.error || "Could not disconnect seller eBay.");
      }

      setPreview(null);
      setStageAllProgress(null);
      setMessage(
        "Seller eBay disconnected and TCOS credentials deleted. To invalidate eBay's authorization immediately, also remove TCOS under eBay Third-party app access.",
      );
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
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
      setPreview(nextPreview);
      setMessage("Seller eBay preview loaded.");
      const nextConnections = await fetchSellerConnections(session.access_token);
      setConnections(nextConnections);
    } catch (error: any) {
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
        setMessage(
          `Seller eBay staging stopped safely after ${processedCount} listing${processedCount === 1 ? "" : "s"} in ${batchesCompleted} completed batch${batchesCompleted === 1 ? "" : "es"}. Run Stage All Remaining to resume at listing ${nextOffset + 1}.`,
        );
      } else {
        setMessage(
          `Seller eBay staging complete. ${processedCount} listing${processedCount === 1 ? "" : "s"} processed across ${batchesCompleted} batch${batchesCompleted === 1 ? "" : "es"}; ${stagedCount} captured and ${skippedCount} skipped.`,
        );
      }
    } catch (error: any) {
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

  async function setStageStatus(
    stagedItemId: string,
    stageStatus: "staged" | "needs_review" | "mapped" | "skipped",
  ) {
    if (!session?.access_token) return;

    setUpdatingStageItemId(stagedItemId);
    setMessage("");

    try {
      await updateSellerStagedItemStatus({
        accessToken: session.access_token,
        stagedItemId,
        stageStatus,
      });
      setLastBulkPromotionSuccesses([]);
      setLastBulkPromotionErrors([]);
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      setMessage(`Staged item moved to ${label(stageStatus)}.`);
    } catch (error: any) {
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
      await updateSellerStagedItemReview({
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
      await refreshSellerStageState(session.access_token, { silent: true });
      closeStageReviewEditor();
      setMessage("Staged listing review details saved.");
    } catch (error: any) {
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
      setMessage(
        promotionMode === "draft_cleanup"
          ? `Created seller draft product #${result.promotedItem?.legacyProductId} with activation cleanup still required.`
          : `Created seller draft product #${result.promotedItem?.legacyProductId}.`,
      );
    } catch (error: any) {
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

    try {
      const result = await promoteSellerStagedItem({
        accessToken: session.access_token,
        stagedItemIds: params.stageItemIds,
      });
      promotedCount = result.promotedCount || result.promotedItems.length;
      promotedStageItemIds = result.promotedItems.map((item) => item.stagedItemId);
      promotedItems = result.promotedItems;
      promotionErrors = result.errors;
      firstError = result.errors[0]?.error || "";
    } catch (error: any) {
      firstError = error.message || "Could not bulk promote seller staged items.";
    }

    await refreshSellerStageState(session.access_token, { silent: true });
    await refreshSellerInventoryState(session.access_token, { silent: true });
    if (promotedStageItemIds.length > 0) {
      setSelectedStageItemIds((current) =>
        current.filter((id) => !promotedStageItemIds.includes(id)),
      );
    }
    setLastBulkPromotionSuccesses(promotedItems);
    setLastBulkPromotionErrors(promotionErrors);

    if (firstError && promotedCount > 0) {
      setMessage(
        params.mode === "draft_cleanup"
          ? `Promoted ${promotedCount} staged listing(s) into drafts that still need activation cleanup. ${firstError}`
          : `Promoted ${promotedCount} staged listing(s). ${firstError}`,
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
      await refreshSellerStageState(session.access_token, { silent: true });
      await refreshSellerInventoryState(session.access_token, { silent: true });
      setSelectedStageItemIds((current) =>
        current.filter((id) => !stageItemIds.includes(id)),
      );
      setMessage(
        `${result.updatedCount || stageItemIds.length} staged listing(s) moved to ${label(stageStatus)}.`,
      );
    } catch (error: any) {
      setMessage(error.message || "Could not update seller staged items.");
    } finally {
      setUpdatingStageItemId("");
    }
  }

  const ebayConnection = connections.find(
    (connection) => connection.provider === "ebay",
  );
  const canUseSellerEbayTools =
    Boolean(session?.access_token) &&
    ebaySyncEnabled &&
    ebayConnection?.connectionStatus === "connected";
  const ebayRevocationProtectionReady =
    ebayConnection?.connectionStatus === "connected" &&
    ebayConnection.oauthScope.includes(EBAY_IDENTITY_SCOPE) &&
    Boolean(ebayConnection.providerAccountId);
  const ebayRevocationProtectionNeedsReconnect =
    ebayConnection?.connectionStatus === "connected" &&
    !ebayRevocationProtectionReady;
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

      if (item.promotion_guard?.blocked) {
        summary.blocked += 1;
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
      if (stageFilter === "blocked") return item.promotion_guard?.blocked === true;
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
    .filter((item) => item.promotion_guard?.blocked === true)
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
    .filter((item) => item.promotion_guard?.blocked)
    .sort(
      (left, right) =>
        new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
    );
  const blockedStageItemIds = blockedStageItems.map((item) => item.id);
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

      if (item.promotion_guard?.blocked) {
        summary.blocked += 1;
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
    .filter((item) => item.promotion_guard?.blocked)
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

      if (item.promotion_guard?.blocked) {
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

  async function copyWorkspaceLink() {
    if (typeof window === "undefined") return;

    const href = window.location.href;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = href;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }

      setMessage("Workspace link copied.");
    } catch {
      setMessage("Could not copy workspace link.");
    }
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

      {message ? (
        <div className="border-b border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          {message}
        </div>
      ) : null}

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
                className="rounded-md border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-black text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStagingAll ? "Staging All Remaining..." : "Stage All Remaining"}
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
                    ["all", `All (${stagedSummary.total})`],
                    ["ready", `Ready (${stagedSummary.ready})`],
                    ["draft_cleanup", `Draft Cleanup (${stagedSummary.draft_cleanup})`],
                    ["blocked", `Blocked (${stagedSummary.blocked})`],
                    ["needs_review", `Needs Review (${stagedSummary.needs_review})`],
                    ["staged", `Staged (${stagedSummary.staged})`],
                    ["mapped", `Mapped (${stagedSummary.mapped})`],
                    ["skipped", `Skipped (${stagedSummary.skipped})`],
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
                </div>

                <div className="flex flex-wrap gap-2">
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
                            {label(item.stage_status)}
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
                    connection.connectionStatus === "connected" ? (
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
                    connection.connectionStatus === "connected" ? (
                      <div className="flex max-w-xs flex-wrap gap-2">
                        {ebaySyncEnabled ? (
                          <button
                            type="button"
                            onClick={() => refreshEbayStatus()}
                            disabled={isSavingProvider.length > 0}
                            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Refresh Status
                          </button>
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
