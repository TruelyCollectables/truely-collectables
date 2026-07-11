"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AUTHENTICITY_STATUSES,
  AUTOGRAPH_SOURCES,
  authenticityStatusLabel,
  autographSourceLabel,
  buildAuthenticityBadges,
  type AuthenticityBadge,
  type AuthenticityProfile,
} from "../../../lib/authenticity";
import {
  getAccountSession,
  type StoredAccountSession,
} from "../../account/account-session";

type SellerInventorySummary = {
  totalItems: number;
  draftCount: number;
  draftReadyCount: number;
  draftNeedsWorkCount: number;
  activeCount: number;
  archivedCount: number;
  instacompDraftCount: number;
  instacompReadyDraftCount: number;
  totalQuantity: number;
  totalDraftValue: number;
};

type SellerInventoryItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  description: string | null;
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
  authenticity: AuthenticityProfile;
  shippingPlan: {
    method: "STANDARD_ENVELOPE" | "GROUND_ADVANTAGE" | "PRIORITY_MAIL";
    label: string;
    estimatedOunces: number;
    postageEstimate: number;
    coverageProvider: string;
    coverageRequired: boolean;
    coverageType: string;
    reason: string | null;
  };
  instaComp?: {
    isInstaCompDraft: boolean;
    source: string | null;
    scanId: string | null;
    serialNumber: string | null;
    marketPrice: number | null;
    listingPrice: number | null;
    listingPriceSource: string | null;
    hasBackImage: boolean;
  };
  activationReadiness: {
    ready: boolean;
    blockers: string[];
  };
};

type StatusFilter = "all" | "draft" | "active" | "archived";
type ReadinessFilter = "all" | "ready" | "needs_work";
type SourceFilter = "all" | "instacomp" | "manual";
type MarketplaceStageFilter =
  | "all"
  | "needs_review"
  | "staged"
  | "mapped"
  | "skipped"
  | "blocked"
  | "ready";
type OrderQueueFilter =
  | "all"
  | "action_required"
  | "shipping"
  | "cash_out"
  | "completed";
type PayoutRequestFilter = "all" | "blocked" | "open" | "paid" | "attention";
type BulkInventoryAction = "activate" | "archive";
type BulkInventoryResult = {
  inventoryItemId: string;
  success: boolean;
  status: number;
  message: string;
  blockers?: string[];
};

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Drafts" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const readinessFilters: Array<{
  value: ReadinessFilter;
  label: string;
}> = [
  { value: "all", label: "All readiness" },
  { value: "ready", label: "Ready" },
  { value: "needs_work", label: "Needs work" },
];

const sourceFilters: Array<{
  value: SourceFilter;
  label: string;
}> = [
  { value: "all", label: "All sources" },
  { value: "instacomp", label: "InstaComp" },
  { value: "manual", label: "Manual/other" },
];

function parseStatusFilter(value: string | null): StatusFilter {
  return value === "draft" || value === "active" || value === "archived"
    ? value
    : "all";
}

function parseReadinessFilter(value: string | null): ReadinessFilter {
  return value === "ready" || value === "needs_work" ? value : "all";
}

function parseSourceFilter(value: string | null): SourceFilter {
  return value === "instacomp" || value === "manual" ? value : "all";
}

function initialInventoryFilters() {
  if (typeof window === "undefined") {
    return {
      search: "",
      status: "all" as StatusFilter,
      readiness: "all" as ReadinessFilter,
      source: "all" as SourceFilter,
    };
  }

  const params = new URLSearchParams(window.location.search);

  return {
    search: params.get("search") || "",
    status: parseStatusFilter(params.get("status")),
    readiness: parseReadinessFilter(params.get("readiness")),
    source: parseSourceFilter(params.get("source")),
  };
}

function label(value: string | null | undefined) {
  if (!value) return "Not set";
  return value.replaceAll("_", " ").toUpperCase();
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  return String(value).replace(/\s+/g, " ").trim();
}

function csvCell(value: unknown) {
  return `"${exportCell(value).replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const marketplaceExportWarning =
  "Outbound marketplace packet only. Verify platform category, shipping, item specifics, and final listing rules before publishing externally.";

const marketplaceExportShippingWarning =
  "Shipping values are planning estimates only. This export does not buy postage, create Coverage policies, or publish to an external marketplace.";

function shortDate(value: string | null | undefined) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusTone(value: string | null | undefined) {
  if (value === "active") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (value === "draft") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "archived") {
    return "border-neutral-200 bg-neutral-100 text-neutral-700";
  }

  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function readinessTone(ready: boolean) {
  return ready
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : "border-amber-200 bg-amber-50 text-amber-900";
}

function sourceTone(item: SellerInventoryItem) {
  return item.instaComp?.isInstaCompDraft
    ? "border-sky-200 bg-sky-50 text-sky-900"
    : "border-neutral-200 bg-neutral-100 text-neutral-700";
}

function inventorySourceLabel(item: SellerInventoryItem) {
  return item.instaComp?.isInstaCompDraft ? "INSTACOMP" : "MANUAL";
}

function marketplaceExportRows(items: SellerInventoryItem[]) {
  return items.map((item, index) => ({
    row: index + 1,
    tcosInventoryItemId: item.inventoryItemId,
    legacyProductId: item.legacyProductId || "",
    source: inventorySourceLabel(item),
    marketplaceStatus: "ready_to_crosslist",
    marketplaceExportPurpose: "crosslist_prep_only",
    externalPublishingApproved: false,
    title: item.title,
    sku: item.sku || "",
    price: item.price,
    quantity: item.quantity,
    category: label(item.category),
    condition: label(item.condition),
    description: item.description || "",
    imageUrl: item.imageUrl || "",
    ebayItemId: item.ebayItemId || "",
    shippingMethod: item.shippingPlan.label,
    shippingEstimatedOunces: item.shippingPlan.estimatedOunces,
    shippingPostageEstimate: item.shippingPlan.postageEstimate,
    shippingCoverageProvider: item.shippingPlan.coverageProvider,
    shippingCoverageRequired: item.shippingPlan.coverageRequired,
    shippingCoverageType: item.shippingPlan.coverageType,
    shippingPlanNote: item.shippingPlan.reason || "",
    shippingPurchaseIncluded: false,
    shippingPurchaseMode: "not_included_in_marketplace_export",
    shippingWarning: marketplaceExportShippingWarning,
    instacompScanId: item.instaComp?.scanId || "",
    serialNumber: item.instaComp?.serialNumber || "",
    instacompMarketPrice: item.instaComp?.marketPrice || "",
    listingPriceSource: item.instaComp?.listingPriceSource || "",
    hasBackImage: item.instaComp?.hasBackImage || false,
    activationReady: item.activationReadiness.ready,
    activationBlockers: item.activationReadiness.blockers
      .map(readinessBlockerLabel)
      .join("; "),
    tcosSellerInventoryUrl: `/seller/inventory?search=${encodeURIComponent(
      item.sku || item.title,
    )}`,
  }));
}

function marketplaceExportCsv(items: SellerInventoryItem[]) {
  const rows = marketplaceExportRows(items);

  if (!rows.length) return "";

  const headers = Object.keys(rows[0]) as Array<keyof (typeof rows)[number]>;

  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
}

function authenticityBadgeTone(tone: AuthenticityBadge["tone"]) {
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

function canActivateInventoryItem(item: SellerInventoryItem) {
  return ["draft", "archived"].includes(item.status) && item.activationReadiness.ready;
}

function canArchiveInventoryItem(item: SellerInventoryItem) {
  return item.status !== "archived" && item.status !== "sold";
}

function inventorySelectionGuidance(summary: {
  total: number;
  ready: number;
  needsWork: number;
  draft: number;
  active: number;
  archived: number;
}) {
  if (summary.total === 0) return null;

  if (summary.ready > 0 && summary.needsWork > 0) {
    return "This selection mixes ready listings with needs-work drafts. Trim to ready rows before activation or isolate the cleanup work first.";
  }

  if (summary.active > 0 && (summary.draft > 0 || summary.archived > 0)) {
    return "This selection mixes live listings with draft or archived items. Split the selection if you want a cleaner bulk action.";
  }

  if (summary.draft > 0 && summary.archived > 0) {
    return "This selection mixes fresh drafts with archived listings. Separate them if you want a cleaner reactivation or cleanup pass.";
  }

  return null;
}

function bulkActionVerb(action: BulkInventoryAction | null) {
  if (action === "activate") return "activated";
  if (action === "archive") return "archived";
  return "updated";
}

function bulkActionQueueLabel(action: BulkInventoryAction | null) {
  if (action === "activate") return "Open Active Inventory";
  if (action === "archive") return "Open Archived Inventory";
  return "Open Seller Inventory";
}

function sellerOrdersQueueHref(queue: OrderQueueFilter, search?: string) {
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

function sellerPayoutQueueHref(request: PayoutRequestFilter, search?: string) {
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

function inventoryOrdersHref(item: SellerInventoryItem) {
  const search = item.title.trim();

  if (item.status === "active") {
    return sellerOrdersQueueHref("shipping", search);
  }

  if (!item.activationReadiness.ready) {
    return sellerOrdersQueueHref("action_required", search);
  }

  return sellerOrdersQueueHref("all", search);
}

function inventoryOrdersLabel(item: SellerInventoryItem) {
  if (item.status === "active") {
    return "Open Shipping Orders";
  }

  if (!item.activationReadiness.ready) {
    return "Open Action Orders";
  }

  return "Open Seller Orders";
}

function inventoryPayoutHref(item: SellerInventoryItem) {
  const search = item.title.trim();

  if (item.status === "active") {
    return sellerPayoutQueueHref("open", search);
  }

  return sellerPayoutQueueHref("all", search);
}

function inventoryPayoutLabel(item: SellerInventoryItem) {
  if (item.status === "active") {
    return "Open Cash-Out Payouts";
  }

  return "Open Seller Payouts";
}

function inventoryQueueHref(item: SellerInventoryItem) {
  const search = item.sku?.trim() || item.title.trim();

  if (item.status === "draft") {
    return item.activationReadiness.ready
      ? `/seller/inventory?status=draft&readiness=ready&search=${encodeURIComponent(search)}`
      : `/seller/inventory?status=draft&readiness=needs_work&search=${encodeURIComponent(search)}`;
  }

  if (item.status === "active" || item.status === "archived") {
    return `/seller/inventory?status=${item.status}&search=${encodeURIComponent(search)}`;
  }

  return `/seller/inventory?search=${encodeURIComponent(search)}`;
}

function sellerMarketplaceHref(options?: {
  stage?: MarketplaceStageFilter;
  search?: string;
}) {
  const params = new URLSearchParams();

  if (options?.stage && options.stage !== "all") {
    params.set("stage", options.stage);
  }

  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }

  const query = params.toString();
  return query ? `/seller/marketplaces?${query}` : "/seller/marketplaces";
}

function inventoryMarketplaceItemLink(item: SellerInventoryItem) {
  const search =
    item.ebayItemId?.trim() || item.sku?.trim() || item.title.trim();
  const readiness =
    item.status === "draft"
      ? item.activationReadiness.ready
        ? "ready"
        : "needs_work"
      : "all";

  return {
    href: inventoryMarketplaceWorkspaceHref({
      search,
      readiness,
    }),
    label: inventoryMarketplaceWorkspaceLabel({
      search,
      readiness,
    }),
  };
}

function inventoryMarketplaceWorkspaceHref(params: {
  search?: string;
  readiness?: ReadinessFilter;
}) {
  const stage =
    params.readiness === "needs_work"
      ? "needs_review"
      : params.readiness === "ready"
        ? "ready"
        : "all";

  return sellerMarketplaceHref({
    stage,
    search: params.search,
  });
}

function inventoryMarketplaceWorkspaceLabel(params: {
  search?: string;
  readiness?: ReadinessFilter;
}) {
  if (params.readiness === "needs_work") {
    return "Open Review Rows";
  }

  if (params.readiness === "ready") {
    return "Open Ready Rows";
  }

  if (params.search?.trim()) {
    return "Search Marketplace Rows";
  }

  return "Open Marketplace Rows";
}

function inventoryMarketplaceSummaryHref(draftNeedsWorkCount: number) {
  return sellerMarketplaceHref({
    stage: draftNeedsWorkCount > 0 ? "needs_review" : "ready",
  });
}

function bulkOrdersFollowUp(action: BulkInventoryAction | null) {
  if (action === "activate") {
    return {
      href: sellerOrdersQueueHref("shipping"),
      label: "Open Shipping Orders",
    };
  }

  if (action === "archive") {
    return {
      href: sellerOrdersQueueHref("action_required"),
      label: "Open Action Orders",
    };
  }

  return {
    href: sellerOrdersQueueHref("all"),
    label: "Open Seller Orders",
  };
}

export default function SellerInventoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [session] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [initialFilters] = useState(initialInventoryFilters);
  const [summary, setSummary] = useState<SellerInventorySummary | null>(null);
  const [items, setItems] = useState<SellerInventoryItem[]>([]);
  const [loading, setLoading] = useState(() => Boolean(session?.access_token));
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [activatingItemId, setActivatingItemId] = useState<string | null>(null);
  const [archivingItemId, setArchivingItemId] = useState<string | null>(null);
  const [selectedInventoryItemIds, setSelectedInventoryItemIds] = useState<
    string[]
  >([]);
  const [bulkAction, setBulkAction] = useState<BulkInventoryAction | null>(null);
  const [lastBulkInventoryAction, setLastBulkInventoryAction] =
    useState<BulkInventoryAction | null>(null);
  const [lastBulkInventorySuccesses, setLastBulkInventorySuccesses] = useState<
    BulkInventoryResult[]
  >([]);
  const [lastBulkInventoryFailures, setLastBulkInventoryFailures] = useState<
    BulkInventoryResult[]
  >([]);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editorTitle, setEditorTitle] = useState("");
  const [editorPrice, setEditorPrice] = useState("");
  const [editorQuantity, setEditorQuantity] = useState("");
  const [editorDescription, setEditorDescription] = useState("");
  const [editorAuthenticityStatus, setEditorAuthenticityStatus] =
    useState<AuthenticityProfile["status"]>("not_applicable");
  const [editorAutographSource, setEditorAutographSource] =
    useState<AuthenticityProfile["autographSource"]>("none");
  const [editorCertProvider, setEditorCertProvider] = useState("");
  const [editorCertNumber, setEditorCertNumber] = useState("");
  const [editorGuaranteedAuthenticators, setEditorGuaranteedAuthenticators] =
    useState("");
  const [editorProvenanceEvidence, setEditorProvenanceEvidence] = useState("");
  const [editorAuthenticityNotes, setEditorAuthenticityNotes] = useState("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [descriptionActionItemId, setDescriptionActionItemId] = useState<
    string | null
  >(null);
  const [descriptionActionMode, setDescriptionActionMode] = useState<
    "regenerate" | "ai" | null
  >(null);
  const [search, setSearch] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialFilters.status,
  );
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>(
    initialFilters.readiness,
  );
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>(
    initialFilters.source,
  );

  function syncInventoryUrl(next: {
    search?: string;
    status?: StatusFilter;
    readiness?: ReadinessFilter;
    source?: SourceFilter;
  }) {
    const finalSearch = next.search ?? search;
    const finalStatus = next.status ?? statusFilter;
    const finalReadiness = next.readiness ?? readinessFilter;
    const finalSource = next.source ?? sourceFilter;
    const params = new URLSearchParams();

    if (finalSearch.trim()) {
      params.set("search", finalSearch.trim());
    }

    if (finalStatus !== "all") {
      params.set("status", finalStatus);
    }

    if (finalReadiness !== "all") {
      params.set("readiness", finalReadiness);
    }

    if (finalSource !== "all") {
      params.set("source", finalSource);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function setInventoryView(next: {
    search?: string;
    status?: StatusFilter;
    readiness?: ReadinessFilter;
    source?: SourceFilter;
  }) {
    const finalSearch = next.search ?? search;
    const finalStatus = next.status ?? statusFilter;
    const finalReadiness = next.readiness ?? readinessFilter;
    const finalSource = next.source ?? sourceFilter;

    setSearch(finalSearch);
    setStatusFilter(finalStatus);
    setReadinessFilter(finalReadiness);
    setSourceFilter(finalSource);
    syncInventoryUrl({
      search: finalSearch,
      status: finalStatus,
      readiness: finalReadiness,
      source: finalSource,
    });
  }

  function applyLoadedInventory(
    nextSummary: SellerInventorySummary | null,
    nextItems: SellerInventoryItem[],
  ) {
    const itemIdSet = new Set(nextItems.map((item) => item.inventoryItemId));
    setSummary(nextSummary);
    setItems(nextItems);
    setSelectedInventoryItemIds((current) =>
      current.filter((id) => itemIdSet.has(id)),
    );
    setLastBulkInventorySuccesses((current) =>
      current.filter((entry) => itemIdSet.has(entry.inventoryItemId)),
    );
    setLastBulkInventoryFailures((current) =>
      current.filter((entry) => itemIdSet.has(entry.inventoryItemId)),
    );
  }

  function clearBulkInventoryFollowUp() {
    setLastBulkInventoryAction(null);
    setLastBulkInventorySuccesses([]);
    setLastBulkInventoryFailures([]);
  }

  async function loadInventory(accessToken: string, options?: { silent?: boolean }) {
    if (options?.silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/account/seller/inventory", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load seller inventory.");
      }

      applyLoadedInventory(
        (data.summary || null) as SellerInventorySummary | null,
        (data.items || []) as SellerInventoryItem[],
      );
      setError("");
    } catch (nextError: any) {
      applyLoadedInventory(null, []);
      setError(nextError.message || "Could not load seller inventory.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!session?.access_token) return;

    let cancelled = false;

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/account/seller/inventory", {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          });
          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || "Could not load seller inventory.");
          }

          if (!cancelled) {
            applyLoadedInventory(
              (data.summary || null) as SellerInventorySummary | null,
              (data.items || []) as SellerInventoryItem[],
            );
            setError("");
          }
        } catch (nextError: any) {
          if (!cancelled) {
            applyLoadedInventory(null, []);
            setError(nextError.message || "Could not load seller inventory.");
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [session?.access_token]);

  const filteredItems = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }

      if (readinessFilter === "ready" && !item.activationReadiness.ready) {
        return false;
      }

      if (readinessFilter === "needs_work" && item.activationReadiness.ready) {
        return false;
      }

      if (sourceFilter === "instacomp" && !item.instaComp?.isInstaCompDraft) {
        return false;
      }

      if (sourceFilter === "manual" && item.instaComp?.isInstaCompDraft) {
        return false;
      }

      if (!searchTerm) {
        return true;
      }

      const haystack = [
        item.title,
        item.sku || "",
        item.category,
        item.condition,
        item.ebayItemId || "",
        inventorySourceLabel(item),
        item.instaComp?.scanId || "",
        item.instaComp?.serialNumber || "",
        item.instaComp?.listingPriceSource || "",
        item.shippingPlan.label,
        item.shippingPlan.coverageProvider,
        item.shippingPlan.coverageType,
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(searchTerm);
    });
  }, [items, readinessFilter, search, sourceFilter, statusFilter]);

  const visibleInventoryItemIds = useMemo(
    () => filteredItems.map((item) => item.inventoryItemId),
    [filteredItems],
  );

  const readyVisibleInventoryItemIds = useMemo(
    () =>
      filteredItems
        .filter((item) => canActivateInventoryItem(item))
        .map((item) => item.inventoryItemId),
    [filteredItems],
  );

  const selectedInventoryItemIdSet = useMemo(
    () => new Set(selectedInventoryItemIds),
    [selectedInventoryItemIds],
  );

  const selectedVisibleCount = useMemo(() => {
    const visibleIdSet = new Set(visibleInventoryItemIds);
    return selectedInventoryItemIds.filter((id) => visibleIdSet.has(id)).length;
  }, [selectedInventoryItemIds, visibleInventoryItemIds]);
  const selectedItems = useMemo(
    () =>
      items.filter((item) =>
        selectedInventoryItemIdSet.has(item.inventoryItemId),
      ),
    [items, selectedInventoryItemIdSet],
  );
  const selectedSummary = useMemo(
    () =>
      selectedItems.reduce(
        (summary, item) => {
          summary.total += 1;

          if (item.activationReadiness.ready) {
            summary.ready += 1;
          } else {
            summary.needsWork += 1;
          }

          if (item.status === "draft") summary.draft += 1;
          if (item.status === "active") summary.active += 1;
          if (item.status === "archived") summary.archived += 1;

          return summary;
        },
        {
          total: 0,
          ready: 0,
          needsWork: 0,
          draft: 0,
          active: 0,
          archived: 0,
        },
      ),
    [selectedItems],
  );
  const selectedReadyInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => item.activationReadiness.ready)
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedMarketplaceReadyItems = useMemo(
    () => selectedItems.filter((item) => item.activationReadiness.ready),
    [selectedItems],
  );
  const selectedShippingSummary = useMemo(
    () =>
      selectedItems.reduce(
        (summary, item) => {
          summary.totalPostage += item.shippingPlan.postageEstimate || 0;

          if (item.shippingPlan.method === "STANDARD_ENVELOPE") {
            summary.standardEnvelope += 1;
          }

          if (item.shippingPlan.method === "GROUND_ADVANTAGE") {
            summary.groundAdvantage += 1;
          }

          if (item.shippingPlan.method === "PRIORITY_MAIL") {
            summary.priorityMail += 1;
          }

          if (item.shippingPlan.coverageRequired) {
            summary.coverageRequired += 1;
          }

          if (item.shippingPlan.reason) {
            summary.forcedMethod += 1;
          }

          return summary;
        },
        {
          standardEnvelope: 0,
          groundAdvantage: 0,
          priorityMail: 0,
          coverageRequired: 0,
          forcedMethod: 0,
          totalPostage: 0,
        },
      ),
    [selectedItems],
  );
  const selectedNeedsWorkInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => !item.activationReadiness.ready)
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedDraftInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => item.status === "draft")
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedActiveInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => item.status === "active")
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedArchivedInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => item.status === "archived")
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedActivatableInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => canActivateInventoryItem(item))
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectedArchivableInventoryItemIds = useMemo(
    () =>
      selectedItems
        .filter((item) => canArchiveInventoryItem(item))
        .map((item) => item.inventoryItemId),
    [selectedItems],
  );
  const selectionGuidance = useMemo(
    () => inventorySelectionGuidance(selectedSummary),
    [selectedSummary],
  );

  const blockerSummary = useMemo(() => {
    const counts = new Map<string, number>();

    items.forEach((item) => {
      if (item.status !== "draft" || item.activationReadiness.ready) {
        return;
      }

      item.activationReadiness.blockers.forEach((blocker) => {
        counts.set(blocker, (counts.get(blocker) || 0) + 1);
      });
    });

    return Array.from(counts.entries())
      .map(([blocker, count]) => ({ blocker, count }))
      .sort((left, right) => right.count - left.count);
  }, [items]);
  const blockerItemIds = useMemo(() => {
    const entries = new Map<string, string[]>();

    items.forEach((item) => {
      if (item.status !== "draft" || item.activationReadiness.ready) {
        return;
      }

      item.activationReadiness.blockers.forEach((blocker) => {
        const current = entries.get(blocker) || [];
        current.push(item.inventoryItemId);
        entries.set(blocker, current);
      });
    });

    return entries;
  }, [items]);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.inventoryItemId, item])),
    [items],
  );
  const bulkSuccessItemIds = useMemo(
    () => lastBulkInventorySuccesses.map((entry) => entry.inventoryItemId),
    [lastBulkInventorySuccesses],
  );
  const bulkFailureItemIds = useMemo(
    () => lastBulkInventoryFailures.map((entry) => entry.inventoryItemId),
    [lastBulkInventoryFailures],
  );
  const bulkFailureBlockerItemIds = useMemo(
    () =>
      lastBulkInventoryFailures
        .filter((entry) => (entry.blockers || []).length > 0)
        .map((entry) => entry.inventoryItemId),
    [lastBulkInventoryFailures],
  );
  const bulkPayoutFailureCount = useMemo(
    () =>
      lastBulkInventoryFailures.filter((entry) =>
        entry.message.toLowerCase().includes("payout verification"),
      ).length,
    [lastBulkInventoryFailures],
  );
  const actionOrdersHref = sellerOrdersQueueHref("action_required");
  const blockedPayoutsHref = sellerPayoutQueueHref("blocked");
  const bulkOrdersFollowUpLink = bulkOrdersFollowUp(lastBulkInventoryAction);
  const ordersWorkspaceLink =
    selectedActiveInventoryItemIds.length > 0 || statusFilter === "active"
      ? {
          href: sellerOrdersQueueHref("shipping"),
          label: "Shipping Orders",
        }
      : selectedNeedsWorkInventoryItemIds.length > 0 ||
          readinessFilter === "needs_work"
        ? {
            href: sellerOrdersQueueHref("action_required"),
            label: "Action Orders",
          }
        : {
            href: sellerOrdersQueueHref("all"),
            label: "Seller Orders",
          };
  const payoutWorkspaceLink =
    bulkPayoutFailureCount > 0
      ? {
          href: sellerPayoutQueueHref("blocked"),
          label: "Blocked Payouts",
        }
      : selectedActiveInventoryItemIds.length > 0 || statusFilter === "active"
        ? {
            href: sellerPayoutQueueHref("open"),
            label: "Cash-Out Payouts",
          }
        : {
            href: sellerPayoutQueueHref("all"),
            label: "Seller Payouts",
          };

  function keepBulkInventorySelection(ids: string[]) {
    if (ids.length === 0) return;
    setSelectedInventoryItemIds(ids);
  }

  function openBulkInventoryQueue(
    status: StatusFilter,
    readiness: ReadinessFilter,
    ids: string[],
  ) {
    if (ids.length === 0) return;
    setInventoryView({
      search: "",
      status,
      readiness,
      source: "all",
    });
    setSelectedInventoryItemIds(ids);
  }

  function focusBlockerQueue(blocker: string) {
    const ids = blockerItemIds.get(blocker) || [];

    setInventoryView({
      search: "",
      status: "draft",
      readiness: "needs_work",
      source: "all",
    });
    setSelectedInventoryItemIds(ids);
  }

  async function activateSellerInventoryItem(inventoryItemId: string) {
    if (!session?.access_token) return;

    setActivatingItemId(inventoryItemId);
    clearBulkInventoryFollowUp();
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}/activate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not activate seller inventory item.",
        );
      }

      await loadInventory(session.access_token, { silent: true });
    } catch (nextError: any) {
      setError(
        nextError.message || "Could not activate seller inventory item.",
      );
    } finally {
      setActivatingItemId(null);
    }
  }

  async function archiveSellerInventoryItem(inventoryItemId: string) {
    if (!session?.access_token) return;

    setArchivingItemId(inventoryItemId);
    clearBulkInventoryFollowUp();
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}/archive`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not archive seller inventory item.");
      }

      await loadInventory(session.access_token, { silent: true });
    } catch (nextError: any) {
      setError(
        nextError.message || "Could not archive seller inventory item.",
      );
    } finally {
      setArchivingItemId(null);
    }
  }

  function openEditor(item: SellerInventoryItem) {
    setEditingItemId(item.inventoryItemId);
    setEditorTitle(item.title);
    setEditorPrice(String(item.price));
    setEditorQuantity(String(item.quantity));
    setEditorDescription(item.description || "");
    setEditorAuthenticityStatus(item.authenticity.status);
    setEditorAutographSource(item.authenticity.autographSource);
    setEditorCertProvider(item.authenticity.certProvider || "");
    setEditorCertNumber(item.authenticity.certNumber || "");
    setEditorGuaranteedAuthenticators(
      item.authenticity.guaranteedAuthenticators.join(", "),
    );
    setEditorProvenanceEvidence(item.authenticity.provenanceEvidence || "");
    setEditorAuthenticityNotes(item.authenticity.authenticityNotes || "");
    setNotice("");
    setError("");
  }

  function closeEditor() {
    setEditingItemId(null);
    setEditorTitle("");
    setEditorPrice("");
    setEditorQuantity("");
    setEditorDescription("");
    setEditorAuthenticityStatus("not_applicable");
    setEditorAutographSource("none");
    setEditorCertProvider("");
    setEditorCertNumber("");
    setEditorGuaranteedAuthenticators("");
    setEditorProvenanceEvidence("");
    setEditorAuthenticityNotes("");
  }

  async function saveSellerInventoryItem(inventoryItemId: string) {
    if (!session?.access_token) return;

    setSavingItemId(inventoryItemId);
    clearBulkInventoryFollowUp();
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            title: editorTitle,
            price: Number(editorPrice || 0),
            quantity: Number(editorQuantity || 0),
            description: editorDescription,
            authenticity: {
              status: editorAuthenticityStatus,
              autographSource: editorAutographSource,
              certProvider: editorCertProvider,
              certNumber: editorCertNumber,
              guaranteedAuthenticators: editorGuaranteedAuthenticators,
              provenanceEvidence: editorProvenanceEvidence,
              authenticityNotes: editorAuthenticityNotes,
            },
          }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not save seller inventory item.");
      }

      await loadInventory(session.access_token, { silent: true });
      closeEditor();
    } catch (nextError: any) {
      setError(nextError.message || "Could not save seller inventory item.");
    } finally {
      setSavingItemId(null);
    }
  }

  async function generateSellerDescription(
    inventoryItemId: string,
    mode: "regenerate" | "ai",
  ) {
    if (!session?.access_token) return;

    setDescriptionActionItemId(inventoryItemId);
    setDescriptionActionMode(mode);
    clearBulkInventoryFollowUp();
    setNotice("");
    setError("");

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}/description`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ mode }),
        },
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not generate seller description.");
      }

      const nextDescription = data.item?.description;

      if (typeof nextDescription === "string") {
        setEditorDescription(nextDescription);
      }

      await loadInventory(session.access_token, { silent: true });
    } catch (nextError: any) {
      setError(nextError.message || "Could not generate seller description.");
    } finally {
      setDescriptionActionItemId(null);
      setDescriptionActionMode(null);
    }
  }

  function toggleInventoryItemSelection(inventoryItemId: string) {
    setSelectedInventoryItemIds((current) =>
      current.includes(inventoryItemId)
        ? current.filter((id) => id !== inventoryItemId)
        : [...current, inventoryItemId],
    );
  }

  function selectVisibleInventoryItems() {
    setSelectedInventoryItemIds((current) =>
      Array.from(new Set([...current, ...visibleInventoryItemIds])),
    );
  }

  function selectReadyVisibleInventoryItems() {
    setSelectedInventoryItemIds((current) =>
      Array.from(new Set([...current, ...readyVisibleInventoryItemIds])),
    );
  }

  function keepInventorySelection(ids: string[]) {
    if (ids.length === 0) return;
    setSelectedInventoryItemIds(ids);
  }

  function clearInventorySelection() {
    setSelectedInventoryItemIds([]);
  }

  async function copySelectedMarketplacePacket() {
    if (!selectedMarketplaceReadyItems.length) {
      setNotice("Select at least one ready listing before copying a marketplace packet.");
      setError("");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      scope: "selected_ready_seller_inventory_marketplace_packet",
      packetPurpose: "crosslist_prep_only",
      itemCount: selectedMarketplaceReadyItems.length,
      externalPublishingApproved: false,
      shippingPurchaseIncluded: false,
      warning: marketplaceExportWarning,
      shippingWarning: marketplaceExportShippingWarning,
      rows: marketplaceExportRows(selectedMarketplaceReadyItems),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice(
        `Copied ${selectedMarketplaceReadyItems.length} ready listing${
          selectedMarketplaceReadyItems.length === 1 ? "" : "s"
        } as a marketplace packet.`,
      );
      setError("");
    } catch {
      setError("Could not copy the marketplace packet.");
    }
  }

  function downloadSelectedMarketplaceCsv() {
    if (!selectedMarketplaceReadyItems.length) {
      setNotice(
        "Select at least one ready listing before downloading a marketplace CSV.",
      );
      setError("");
      return;
    }

    downloadTextFile(
      `tcos-marketplace-ready-listings-${exportTimestamp()}.csv`,
      marketplaceExportCsv(selectedMarketplaceReadyItems),
      "text/csv;charset=utf-8",
    );
    setNotice(
      `Downloaded ${selectedMarketplaceReadyItems.length} ready listing${
        selectedMarketplaceReadyItems.length === 1 ? "" : "s"
      } for marketplace cross-listing.`,
    );
    setError("");
  }

  async function runBulkInventoryAction(params: {
    action: BulkInventoryAction;
    inventoryItemIds: string[];
    emptyMessage: string;
  }) {
    const { action, inventoryItemIds, emptyMessage } = params;

    if (!session?.access_token || selectedInventoryItemIds.length === 0) return;
    if (inventoryItemIds.length === 0) {
      setNotice(emptyMessage);
      setError("");
      return;
    }

    setBulkAction(action);
    clearBulkInventoryFollowUp();
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/account/seller/inventory/bulk-status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action,
          inventoryItemIds,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not run the selected seller inventory action.",
        );
      }

      const results = Array.isArray(data.results)
        ? (data.results as BulkInventoryResult[])
        : [];
      const successCount = Number(data.summary?.successCount || 0);
      const failureCount = Number(data.summary?.failureCount || 0);
      const verb = bulkActionVerb(action);
      const firstFailure = results.find((result) => !result.success) || null;
      const successfulIds = results
        .filter((result) => result.success)
        .map((result) => result.inventoryItemId);

      setNotice(
        failureCount > 0
          ? `${successCount} selected listing${successCount === 1 ? "" : "s"} ${verb}. ${failureCount} could not be processed${firstFailure?.message ? `: ${firstFailure.message}` : "."}`
          : `${successCount} selected listing${successCount === 1 ? "" : "s"} ${verb}.`,
      );

      await loadInventory(session.access_token, { silent: true });
      setLastBulkInventoryAction(action);
      setLastBulkInventorySuccesses(results.filter((result) => result.success));
      setLastBulkInventoryFailures(results.filter((result) => !result.success));
      setSelectedInventoryItemIds((current) => current.filter((id) => !successfulIds.includes(id)));
    } catch (nextError: any) {
      setError(
        nextError.message || "Could not run the selected seller inventory action.",
      );
    } finally {
      setBulkAction(null);
    }
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[#f4f1ea] p-6 text-neutral-950">
        <div className="mx-auto max-w-4xl rounded-md border border-neutral-200 bg-white p-6">
          <h1 className="text-3xl font-black">Seller Inventory</h1>
          <p className="mt-3 text-sm text-neutral-600">
            Log in through your TCOS account first, then come back here to review
            seller-owned drafts, active inventory, and activation blockers.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/account/login"
              className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white"
            >
              Log In
            </Link>
            <Link
              href={sellerMarketplaceHref()}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold"
            >
              Seller Marketplaces
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b border-neutral-200 bg-[#101418] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
              TCOS Seller
            </p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">
              Inventory Workspace
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-300">
              Review seller-owned drafts, spot activation blockers, and keep your
              active catalog moving without touching shared store inventory.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <HeaderLink href="/seller" label="Seller Home" />
            <HeaderLink href="/account" label="Account" />
            <HeaderLink
              href={inventoryMarketplaceWorkspaceHref({
                search,
                readiness: readinessFilter,
              })}
              label={inventoryMarketplaceWorkspaceLabel({
                search,
                readiness: readinessFilter,
              })}
            />
            <HeaderLink
              href={payoutWorkspaceLink.href}
              label={workspaceHeaderLabel(payoutWorkspaceLink.label)}
            />
            <HeaderLink
              href={ordersWorkspaceLink.href}
              label={workspaceHeaderLabel(ordersWorkspaceLink.label)}
            />
            <HeaderLink href="/seller-terms" label="Seller Terms" primary />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-8">
          <Metric
            label="Seller Items"
            value={loading ? "..." : String(summary?.totalItems || 0)}
          />
          <Metric
            label="Drafts"
            value={loading ? "..." : String(summary?.draftCount || 0)}
          />
          <Metric
            label="Draft Ready"
            value={loading ? "..." : String(summary?.draftReadyCount || 0)}
          />
          <Metric
            label="Needs Work"
            value={loading ? "..." : String(summary?.draftNeedsWorkCount || 0)}
          />
          <Metric
            label="InstaComp Drafts"
            value={loading ? "..." : String(summary?.instacompDraftCount || 0)}
          />
          <Metric
            label="InstaComp Ready"
            value={
              loading ? "..." : String(summary?.instacompReadyDraftCount || 0)
            }
          />
          <Metric
            label="Active"
            value={loading ? "..." : String(summary?.activeCount || 0)}
          />
          <Metric
            label="Units"
            value={loading ? "..." : String(summary?.totalQuantity || 0)}
          />
          <Metric
            label="Draft Value"
            value={loading ? "..." : formatCurrency(summary?.totalDraftValue || 0)}
          />
        </section>

        {error ? (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm font-semibold text-amber-950">
            {error}
          </section>
        ) : null}

        {notice ? (
          <section className="rounded-md border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-950">
            {notice}
          </section>
        ) : null}

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 p-5">
            <div>
              <h2 className="text-2xl font-black">Activation Readiness Board</h2>
              <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                Drafts only become painless to activate when the listing basics are
                complete. This board keeps the cleanup work obvious.
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                session?.access_token &&
                loadInventory(session.access_token, { silent: true })
              }
              disabled={refreshing || loading || !session?.access_token}
              className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing..." : "Refresh Inventory"}
            </button>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-xs font-black uppercase text-neutral-500">
                  Ready Draft Share
                </p>
                <p className="mt-2 text-2xl font-black">
                  {summary?.draftCount
                    ? `${Math.round(
                        ((summary.draftReadyCount || 0) / summary.draftCount) * 100,
                      )}%`
                    : "0%"}
                </p>
                <p className="mt-2 text-sm text-neutral-600">
                  Drafts that can move forward without more cleanup.
                </p>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-xs font-black uppercase text-neutral-500">
                  Drafts Needing Work
                </p>
                <p className="mt-2 text-2xl font-black">
                  {summary?.draftNeedsWorkCount || 0}
                </p>
                <p className="mt-2 text-sm text-neutral-600">
                  Drafts still blocked by missing listing data.
                </p>
              </div>
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <p className="text-xs font-black uppercase text-neutral-500">
                  Active Catalog
                </p>
                <p className="mt-2 text-2xl font-black">
                  {summary?.activeCount || 0}
                </p>
                <p className="mt-2 text-sm text-neutral-600">
                  Seller-owned items already live inside the active store.
                </p>
              </div>
            </div>

            <aside className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <h3 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
                Top Blockers
              </h3>

              {blockerSummary.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-600">
                  No draft blockers are showing right now.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {blockerSummary.map((entry) => (
                    <button
                      type="button"
                      key={entry.blocker}
                      onClick={() => focusBlockerQueue(entry.blocker)}
                      className="flex w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3 py-2 text-left hover:border-neutral-300 hover:bg-neutral-50"
                    >
                      <span className="text-sm font-bold text-neutral-800">
                        {readinessBlockerLabel(entry.blocker)}
                      </span>
                      <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-black text-amber-900">
                        {entry.count}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={inventoryMarketplaceSummaryHref(
                    summary?.draftNeedsWorkCount || 0,
                  )}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                >
                  {(summary?.draftNeedsWorkCount || 0) > 0
                    ? "Open Review Rows"
                    : "Open Ready Rows"}
                </Link>
                <Link
                  href={actionOrdersHref}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                >
                  Open Action Orders
                </Link>
              </div>
            </aside>
          </div>
        </section>

        <section className="rounded-md border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">Seller Inventory Workspace</h2>
                <p className="mt-1 max-w-3xl text-sm text-neutral-600">
                  This list stays seller-scoped. Draft readiness is calculated from
                  the inventory record plus linked product image coverage.
                </p>
              </div>

              <p className="rounded border border-neutral-200 bg-neutral-100 px-3 py-1 text-xs font-black uppercase text-neutral-700">
                {filteredItems.length} showing
              </p>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Search inventory
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) =>
                    setInventoryView({ search: event.target.value })
                  }
                  placeholder="Title, SKU, category, condition, or eBay item ID"
                  className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
                />
              </label>

              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Status
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {statusFilters.map((filter) => (
                      <FilterChip
                        key={filter.value}
                        active={statusFilter === filter.value}
                        label={filter.label}
                        onClick={() => setInventoryView({ status: filter.value })}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Readiness
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {readinessFilters.map((filter) => (
                      <FilterChip
                        key={filter.value}
                        active={readinessFilter === filter.value}
                        label={filter.label}
                        onClick={() =>
                          setInventoryView({ readiness: filter.value })
                        }
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                    Source
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sourceFilters.map((filter) => (
                      <FilterChip
                        key={filter.value}
                        active={sourceFilter === filter.value}
                        label={filter.label}
                        onClick={() => setInventoryView({ source: filter.value })}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                  Bulk controls
                </p>
                <p className="mt-1 text-sm text-neutral-700">
                  {selectedInventoryItemIds.length} selected across the workspace,{" "}
                  {selectedVisibleCount} visible in the current filter view.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectVisibleInventoryItems}
                  disabled={visibleInventoryItemIds.length === 0}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Visible
                </button>
                <button
                  type="button"
                  onClick={selectReadyVisibleInventoryItems}
                  disabled={readyVisibleInventoryItemIds.length === 0}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Select Ready Visible
                </button>
                <button
                  type="button"
                  onClick={clearInventorySelection}
                  disabled={selectedInventoryItemIds.length === 0}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Selection
                </button>
                <button
                  type="button"
                  onClick={() => void copySelectedMarketplacePacket()}
                  disabled={selectedMarketplaceReadyItems.length === 0}
                  className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-900 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Copy Marketplace Packet ({selectedMarketplaceReadyItems.length})
                </button>
                <button
                  type="button"
                  onClick={downloadSelectedMarketplaceCsv}
                  disabled={selectedMarketplaceReadyItems.length === 0}
                  className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-900 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Download Marketplace CSV ({selectedMarketplaceReadyItems.length})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runBulkInventoryAction({
                      action: "activate",
                      inventoryItemIds: selectedActivatableInventoryItemIds,
                      emptyMessage:
                        "No selected seller listings are currently ready to activate.",
                    })
                  }
                  disabled={
                    bulkAction !== null ||
                    selectedActivatableInventoryItemIds.length === 0
                  }
                  className="rounded-md bg-neutral-950 px-3 py-2 text-xs font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                >
                  {bulkAction === "activate"
                    ? "Activating..."
                    : `Activate Ready (${selectedActivatableInventoryItemIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runBulkInventoryAction({
                      action: "archive",
                      inventoryItemIds: selectedArchivableInventoryItemIds,
                      emptyMessage:
                        "No selected seller listings can be archived right now.",
                    })
                  }
                  disabled={
                    bulkAction !== null ||
                    selectedArchivableInventoryItemIds.length === 0
                  }
                  className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {bulkAction === "archive"
                    ? "Archiving..."
                    : `Archive Eligible (${selectedArchivableInventoryItemIds.length})`}
                </button>
              </div>
            </div>

            {selectedInventoryItemIds.length > 0 ? (
              <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                      Selection Summary
                    </p>
                    <p className="mt-1 text-sm text-neutral-700">
                      Bulk actions only target the listings that are actually eligible for that move.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded border border-emerald-200 bg-white px-2 py-1 text-[11px] font-black text-emerald-800">
                      {selectedSummary.ready} ready
                    </span>
                    <span className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-900">
                      {selectedSummary.needsWork} needs work
                    </span>
                    <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-black text-neutral-700">
                      {selectedSummary.draft} draft
                    </span>
                    <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-black text-neutral-700">
                      {selectedSummary.active} active
                    </span>
                    <span className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] font-black text-neutral-700">
                      {selectedSummary.archived} archived
                    </span>
                    <span className="rounded border border-sky-200 bg-white px-2 py-1 text-[11px] font-black text-sky-900">
                      {selectedMarketplaceReadyItems.length} export ready
                    </span>
                  </div>
                </div>

                <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-emerald-950">
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    Selected Shipping Mix
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-black">
                      Standard Envelope {selectedShippingSummary.standardEnvelope}
                    </span>
                    <span className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-black">
                      Ground Advantage {selectedShippingSummary.groundAdvantage}
                    </span>
                    <span className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-black">
                      Priority Mail {selectedShippingSummary.priorityMail}
                    </span>
                    <span className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-black">
                      Coverage Required {selectedShippingSummary.coverageRequired}
                    </span>
                    <span className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-black">
                      Est. Postage {formatCurrency(selectedShippingSummary.totalPostage)}
                    </span>
                    {selectedShippingSummary.forcedMethod > 0 ? (
                      <span className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-black text-amber-900">
                        Forced Method {selectedShippingSummary.forcedMethod}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs font-semibold">
                    This is the selected-row shipping estimate before external
                    marketplace export or TCOS activation; exact purchase remains
                    blocked until a live shipping adapter is approved.
                  </p>
                </div>

                <p className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-950">
                  Marketplace packets are outbound prep files only. They do not publish
                  to eBay, Whatnot, or any external storefront until a connected
                  publishing flow is approved and wired.
                </p>

                {selectionGuidance ? (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-sky-950">
                    <p className="text-sm font-semibold">{selectionGuidance}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => keepInventorySelection(selectedReadyInventoryItemIds)}
                        disabled={selectedReadyInventoryItemIds.length === 0}
                        className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Ready Only
                      </button>
                      <button
                        type="button"
                        onClick={() => keepInventorySelection(selectedNeedsWorkInventoryItemIds)}
                        disabled={selectedNeedsWorkInventoryItemIds.length === 0}
                        className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Needs Work Only
                      </button>
                      <button
                        type="button"
                        onClick={() => keepInventorySelection(selectedDraftInventoryItemIds)}
                        disabled={selectedDraftInventoryItemIds.length === 0}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Drafts Only
                      </button>
                      <button
                        type="button"
                        onClick={() => keepInventorySelection(selectedActiveInventoryItemIds)}
                        disabled={selectedActiveInventoryItemIds.length === 0}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Active Only
                      </button>
                      <button
                        type="button"
                        onClick={() => keepInventorySelection(selectedArchivedInventoryItemIds)}
                        disabled={selectedArchivedInventoryItemIds.length === 0}
                        className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Keep Archived Only
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {lastBulkInventorySuccesses.length > 0 ? (
              <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-950">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      Bulk Action Results
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {lastBulkInventorySuccesses.length} listing(s) {bulkActionVerb(lastBulkInventoryAction)} in the seller inventory workspace.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => keepBulkInventorySelection(bulkSuccessItemIds)}
                      className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                    >
                      Keep Changed Only
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openBulkInventoryQueue(
                          lastBulkInventoryAction === "archive" ? "archived" : "active",
                          "all",
                          bulkSuccessItemIds,
                        )
                      }
                      className="rounded-md border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100"
                    >
                      {bulkActionQueueLabel(lastBulkInventoryAction)}
                    </button>
                    <Link
                      href={bulkOrdersFollowUpLink.href}
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                    >
                      {bulkOrdersFollowUpLink.label}
                    </Link>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {lastBulkInventorySuccesses.slice(0, 3).map((entry) => {
                    const item = itemsById.get(entry.inventoryItemId);

                    return (
                      <div
                        key={`${entry.inventoryItemId}-${entry.status}-success`}
                        className="rounded-md border border-emerald-200 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-neutral-900">
                              {item?.title || "Seller listing"}
                            </p>
                            <p className="text-xs font-semibold text-emerald-800">
                              {entry.message}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item
                              ? (() => {
                                  const marketplaceLink =
                                    inventoryMarketplaceItemLink(item);

                                  return (
                                    <>
                                      <Link
                                        href={inventoryQueueHref(item)}
                                        className="text-xs font-bold text-neutral-700 underline"
                                      >
                                        Open Seller Inventory
                                      </Link>
                                      <Link
                                        href={marketplaceLink.href}
                                        className="text-xs font-bold text-neutral-700 underline"
                                      >
                                        {marketplaceLink.label}
                                      </Link>
                                    </>
                                  );
                                })()
                              : null}
                            {item?.legacyProductId ? (
                              <Link
                                href={`/admin/products/${item.legacyProductId}`}
                                className="text-xs font-bold text-neutral-700 underline"
                              >
                                Open Admin Product
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {lastBulkInventorySuccesses.length > 3 ? (
                    <p className="text-xs font-semibold text-emerald-800">
                      {lastBulkInventorySuccesses.length - 3} more changed listing(s) remain in the current selection.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {lastBulkInventoryFailures.length > 0 ? (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.14em]">
                      Bulk Action Follow-Up
                    </p>
                    <p className="mt-1 text-sm font-semibold">
                      {lastBulkInventoryFailures.length} listing(s) still need attention before this bulk action can fully finish.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => keepBulkInventorySelection(bulkFailureItemIds)}
                      className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                    >
                      Keep Failed Only
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openBulkInventoryQueue("all", "all", bulkFailureItemIds)
                      }
                      className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-800 hover:bg-neutral-100"
                    >
                      Open Failed Inventory
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openBulkInventoryQueue(
                          "draft",
                          "needs_work",
                          bulkFailureBlockerItemIds,
                        )
                      }
                      disabled={bulkFailureBlockerItemIds.length === 0}
                      className="rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {`Open Needs Work (${bulkFailureBlockerItemIds.length})`}
                    </button>
                    {bulkPayoutFailureCount > 0 ? (
                      <Link
                        href={blockedPayoutsHref}
                        className="rounded-md border border-rose-300 bg-white px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100"
                      >
                        Open Blocked Payouts
                      </Link>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-900">
                    {lastBulkInventoryFailures.length} failed
                  </span>
                  {bulkFailureBlockerItemIds.length > 0 ? (
                    <span className="rounded border border-amber-200 bg-white px-2 py-1 text-[11px] font-black text-amber-900">
                      {bulkFailureBlockerItemIds.length} blockers
                    </span>
                  ) : null}
                  {bulkPayoutFailureCount > 0 ? (
                    <span className="rounded border border-rose-200 bg-white px-2 py-1 text-[11px] font-black text-rose-800">
                      {bulkPayoutFailureCount} payout hold
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2">
                  {lastBulkInventoryFailures.slice(0, 3).map((entry) => {
                    const item = itemsById.get(entry.inventoryItemId);

                    return (
                      <div
                        key={`${entry.inventoryItemId}-${entry.status}-failure`}
                        className="rounded-md border border-amber-200 bg-white px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-neutral-900">
                              {item?.title || "Seller listing"}
                            </p>
                            <p className="mt-1 text-xs font-semibold text-amber-900">
                              {entry.message}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {item
                              ? (() => {
                                  const marketplaceLink =
                                    inventoryMarketplaceItemLink(item);

                                  return (
                                    <>
                                      <Link
                                        href={inventoryQueueHref(item)}
                                        className="text-xs font-bold text-neutral-700 underline"
                                      >
                                        Open Seller Inventory
                                      </Link>
                                      <Link
                                        href={marketplaceLink.href}
                                        className="text-xs font-bold text-neutral-700 underline"
                                      >
                                        {marketplaceLink.label}
                                      </Link>
                                    </>
                                  );
                                })()
                              : null}
                            {item?.legacyProductId ? (
                              <Link
                                href={`/admin/products/${item.legacyProductId}`}
                                className="text-xs font-bold text-neutral-700 underline"
                              >
                                Open Admin Product
                              </Link>
                            ) : null}
                          </div>
                        </div>
                        {(entry.blockers || []).length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(entry.blockers || []).map((blocker) => (
                              <span
                                key={`${entry.inventoryItemId}-${blocker}`}
                                className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                              >
                                {readinessBlockerLabel(blocker)}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {lastBulkInventoryFailures.length > 3 ? (
                    <p className="text-xs font-semibold text-amber-900">
                      {lastBulkInventoryFailures.length - 3} more failed listing(s) remain selected for follow-up.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {loading ? (
            <p className="p-5 text-sm text-neutral-600">Loading seller inventory...</p>
          ) : filteredItems.length === 0 ? (
            <div className="p-5">
              <p className="text-sm text-neutral-600">
                No seller inventory matches the current filters yet.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setInventoryView({
                      search: "",
                      status: "all",
                      readiness: "all",
                      source: "all",
                    });
                  }}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  Reset Filters
                </button>
                <Link
                  href={inventoryMarketplaceWorkspaceHref({
                    search,
                    readiness: readinessFilter,
                  })}
                  className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-bold hover:bg-neutral-50"
                >
                  {inventoryMarketplaceWorkspaceLabel({
                    search,
                    readiness: readinessFilter,
                  })}
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 p-5 xl:grid-cols-2">
              {filteredItems.map((item) => (
                <article
                  key={item.inventoryItemId}
                  className="rounded-md border border-neutral-200 bg-neutral-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedInventoryItemIdSet.has(
                          item.inventoryItemId,
                        )}
                        onChange={() =>
                          toggleInventoryItemSelection(item.inventoryItemId)
                        }
                        className="mt-1 h-4 w-4 rounded border-neutral-300 text-neutral-950 focus:ring-neutral-500"
                        aria-label={`Select ${item.title}`}
                      />

                      <div className="min-w-0">
                        <h3 className="text-lg font-black text-neutral-950">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-xs text-neutral-500">
                          SKU {item.sku || "Not set"}
                          {item.ebayItemId ? ` / eBay ${item.ebayItemId}` : ""}
                        </p>
                      </div>
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
                        className={`rounded border px-2 py-1 text-[11px] font-black ${readinessTone(
                          item.activationReadiness.ready,
                        )}`}
                      >
                        {item.activationReadiness.ready ? "READY" : "NEEDS WORK"}
                      </span>
                      <span
                        className={`rounded border px-2 py-1 text-[11px] font-black ${sourceTone(
                          item,
                        )}`}
                      >
                        {inventorySourceLabel(item)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Info label="Category" value={label(item.category)} />
                    <Info label="Condition" value={label(item.condition)} />
                    <Info label="Quantity" value={String(item.quantity)} />
                    <Info label="Price" value={formatCurrency(item.price)} />
                    <Info label="Shipping" value={item.shippingPlan.label} />
                    <Info
                      label="Est. postage"
                      value={formatCurrency(item.shippingPlan.postageEstimate)}
                    />
                    <Info label="Updated" value={shortDate(item.updatedAt)} />
                    <Info label="Created" value={shortDate(item.createdAt)} />
                  </div>

                  <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-900">
                      Shipping plan
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-emerald-950">
                      <Info label="Method" value={item.shippingPlan.label} />
                      <Info
                        label="Est. weight"
                        value={`${item.shippingPlan.estimatedOunces} oz`}
                      />
                      <Info
                        label="Coverage"
                        value={
                          item.shippingPlan.coverageRequired
                            ? `${item.shippingPlan.coverageProvider} required`
                            : item.shippingPlan.coverageProvider
                        }
                      />
                      <Info
                        label="Coverage type"
                        value={label(item.shippingPlan.coverageType)}
                      />
                    </div>
                    {item.shippingPlan.reason ? (
                      <p className="mt-2 text-xs font-semibold text-emerald-950">
                        {item.shippingPlan.reason}
                      </p>
                    ) : null}
                  </div>

                  {item.instaComp?.isInstaCompDraft ? (
                    <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-sky-900">
                        InstaComp draft
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-sky-950">
                        <Info
                          label="Scan"
                          value={item.instaComp.scanId || "Recorded"}
                        />
                        <Info
                          label="Serial"
                          value={item.instaComp.serialNumber || "Not detected"}
                        />
                        <Info
                          label="Price source"
                          value={label(item.instaComp.listingPriceSource)}
                        />
                        <Info
                          label="Back image"
                          value={item.instaComp.hasBackImage ? "Yes" : "No"}
                        />
                      </div>
                    </div>
                  ) : null}

                  {buildAuthenticityBadges(item.authenticity).length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                        Authenticity
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {buildAuthenticityBadges(item.authenticity).map((badge) => (
                          <span
                            key={`${item.inventoryItemId}-${badge.label}`}
                            className={`rounded border px-2 py-1 text-[11px] font-black ${authenticityBadgeTone(
                              badge.tone,
                            )}`}
                          >
                            {badge.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {item.activationReadiness.blockers.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                        Activation blockers
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.activationReadiness.blockers.map((blocker) => (
                          <span
                            key={`${item.inventoryItemId}-${blocker}`}
                            className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black text-amber-900"
                          >
                            {readinessBlockerLabel(blocker)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">
                      This item is ready for activation review.
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {(() => {
                      const marketplaceLink = inventoryMarketplaceItemLink(item);

                      return (
                        <>
                    {item.status !== "sold" && item.status !== "reserved" ? (
                      <button
                        type="button"
                        onClick={() =>
                          editingItemId === item.inventoryItemId
                            ? closeEditor()
                            : openEditor(item)
                        }
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                      >
                        {editingItemId === item.inventoryItemId
                          ? "Close Editor"
                          : "Edit Listing"}
                      </button>
                    ) : null}
                    {["draft", "archived"].includes(item.status) &&
                    item.activationReadiness.ready ? (
                      <button
                        type="button"
                        onClick={() =>
                          void activateSellerInventoryItem(item.inventoryItemId)
                        }
                        disabled={activatingItemId === item.inventoryItemId}
                        className="rounded-md bg-neutral-950 px-3 py-2 text-xs font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                      >
                        {activatingItemId === item.inventoryItemId
                          ? "Activating..."
                          : item.status === "archived"
                            ? "Reactivate Listing"
                            : "Activate Listing"}
                      </button>
                    ) : null}
                    {item.status !== "archived" && item.status !== "sold" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void archiveSellerInventoryItem(item.inventoryItemId)
                        }
                        disabled={archivingItemId === item.inventoryItemId}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {archivingItemId === item.inventoryItemId
                          ? "Archiving..."
                          : item.status === "active"
                            ? "Pause Listing"
                            : "Archive Draft"}
                      </button>
                    ) : null}
                    <Link
                      href={marketplaceLink.href}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                    >
                      {marketplaceLink.label}
                    </Link>
                    <Link
                      href={inventoryOrdersHref(item)}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                    >
                      {inventoryOrdersLabel(item)}
                    </Link>
                    <Link
                      href={inventoryPayoutHref(item)}
                      className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                    >
                      {inventoryPayoutLabel(item)}
                    </Link>
                    {item.legacyProductId ? (
                      <Link
                        href={`/admin/products/${item.legacyProductId}`}
                        className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-white"
                      >
                        Open Admin Product
                      </Link>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>

                  {editingItemId === item.inventoryItemId ? (
                    <div className="mt-4 rounded-md border border-neutral-200 bg-white p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-[0.14em] text-neutral-600">
                            Seller Editor
                          </h4>
                          <p className="mt-1 text-sm text-neutral-600">
                            Update the listing details, authenticity disclosure,
                            and buyer-facing provenance notes without leaving the
                            seller workspace.
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void generateSellerDescription(
                                item.inventoryItemId,
                                "regenerate",
                              )
                            }
                            disabled={
                              descriptionActionItemId === item.inventoryItemId
                            }
                            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {descriptionActionItemId === item.inventoryItemId &&
                            descriptionActionMode === "regenerate"
                              ? "Refreshing..."
                              : "Refresh Description"}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void generateSellerDescription(
                                item.inventoryItemId,
                                "ai",
                              )
                            }
                            disabled={
                              descriptionActionItemId === item.inventoryItemId
                            }
                            className="rounded-md border border-neutral-300 px-3 py-2 text-xs font-bold hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {descriptionActionItemId === item.inventoryItemId &&
                            descriptionActionMode === "ai"
                              ? "Writing..."
                              : "AI Description"}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 lg:grid-cols-2">
                        <label className="block">
                          <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                            Title
                          </span>
                          <input
                            type="text"
                            value={editorTitle}
                            onChange={(event) =>
                              setEditorTitle(event.target.value)
                            }
                            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Price
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editorPrice}
                              onChange={(event) =>
                                setEditorPrice(event.target.value)
                              }
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>

                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Quantity
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={editorQuantity}
                              onChange={(event) =>
                                setEditorQuantity(event.target.value)
                              }
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                      </div>

                      <label className="mt-4 block">
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                          Description
                        </span>
                        <textarea
                          value={editorDescription}
                          onChange={(event) =>
                            setEditorDescription(event.target.value)
                          }
                          rows={5}
                          className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                        />
                      </label>

                      <div className="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-4">
                        <div>
                          <h5 className="text-xs font-black uppercase tracking-[0.14em] text-neutral-600">
                            Authenticity And Provenance
                          </h5>
                          <p className="mt-1 text-sm text-neutral-600">
                            Match the listing disclosure to the exact support you
                            can stand behind.
                          </p>
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Authenticity Status
                            </span>
                            <select
                              value={editorAuthenticityStatus}
                              onChange={(event) =>
                                setEditorAuthenticityStatus(
                                  event.target.value as AuthenticityProfile["status"],
                                )
                              }
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            >
                              {AUTHENTICITY_STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  {authenticityStatusLabel(status)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Autograph Source
                            </span>
                            <select
                              value={editorAutographSource}
                              onChange={(event) =>
                                setEditorAutographSource(
                                  event.target.value as AuthenticityProfile["autographSource"],
                                )
                              }
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            >
                              {AUTOGRAPH_SOURCES.map((source) => (
                                <option key={source} value={source}>
                                  {autographSourceLabel(source)}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Certification Provider
                            </span>
                            <input
                              type="text"
                              value={editorCertProvider}
                              onChange={(event) =>
                                setEditorCertProvider(event.target.value)
                              }
                              placeholder="PSA, JSA, Beckett, SGC, CGC"
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>

                          <label className="block">
                            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                              Certification Number
                            </span>
                            <input
                              type="text"
                              value={editorCertNumber}
                              onChange={(event) =>
                                setEditorCertNumber(event.target.value)
                              }
                              placeholder="Cert or lookup number"
                              className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                            />
                          </label>
                        </div>

                        <label className="mt-4 block">
                          <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                            Pass Guarantee Authenticators
                          </span>
                          <input
                            type="text"
                            value={editorGuaranteedAuthenticators}
                            onChange={(event) =>
                              setEditorGuaranteedAuthenticators(event.target.value)
                            }
                            placeholder="JSA, PSA DNA, Beckett"
                            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="mt-4 block">
                          <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                            Provenance Evidence
                          </span>
                          <textarea
                            value={editorProvenanceEvidence}
                            onChange={(event) =>
                              setEditorProvenanceEvidence(event.target.value)
                            }
                            rows={3}
                            placeholder="Envelope, fan club return, ticket, signing photo, letter, receipt, or other support"
                            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="mt-4 block">
                          <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                            Authenticity Notes
                          </span>
                          <textarea
                            value={editorAuthenticityNotes}
                            onChange={(event) =>
                              setEditorAuthenticityNotes(event.target.value)
                            }
                            rows={3}
                            placeholder="Extra buyer-facing disclosure that should travel with the listing"
                            className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            void saveSellerInventoryItem(item.inventoryItemId)
                          }
                          disabled={savingItemId === item.inventoryItemId}
                          className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-500"
                        >
                          {savingItemId === item.inventoryItemId
                            ? "Saving..."
                            : "Save Changes"}
                        </button>
                        <button
                          type="button"
                          onClick={closeEditor}
                          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-bold hover:bg-neutral-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-5">
      <p className="text-sm font-bold uppercase text-neutral-500">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase text-neutral-500">{label}</dt>
      <dd className="mt-1 break-words font-bold text-neutral-900">{value}</dd>
    </div>
  );
}

function HeaderLink({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const className = primary
    ? "bg-amber-300 text-neutral-950 hover:bg-amber-200"
    : "border border-white/20 text-white hover:bg-white/10";

  return (
    <Link
      href={href}
      className={`rounded-md px-4 py-2 text-sm font-bold ${className}`}
    >
      {label}
    </Link>
  );
}

function workspaceHeaderLabel(label: string) {
  if (
    label.startsWith("Open ") ||
    label.startsWith("Search ") ||
    label.startsWith("Back To ") ||
    label.startsWith("Return To ")
  ) {
    return label;
  }

  return `Open ${label}`;
}

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-2 text-xs font-black uppercase tracking-[0.14em] transition ${
        active
          ? "border-neutral-950 bg-neutral-950 text-white"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}
