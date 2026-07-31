"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  calculateCustomWebsitePricing,
  calculateDualMarketplacePricing,
  type DualMarketplaceFeeProfile,
  type DualMarketplacePriceBreakdown,
} from "@/src/lib/dual-marketplace-pricing";
import {
  chunkDualMarketplaceItems,
  type DualMarketplaceAction,
} from "@/src/lib/dual-marketplace-workflow";

type ListingRow = {
  inventoryItemId: string;
  legacyProductId: number | null;
  sku: string | null;
  inventoryStatus: string;
  websiteStatus: string;
  ebayStatus: string;
  ebayItemId: string | null;
  ebayOfferId: string | null;
  websiteTitle: string;
  websiteDescription: string;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  websitePrice: number;
  quantity: number;
  imageUrls: string[];
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  aspects: Record<string, string[]>;
  bestOfferEnabled: boolean;
  pricing: DualMarketplacePriceBreakdown;
  generated: {
    websiteTitle: string;
    websiteDescription: string;
    ebayTitle: string;
    ebayDescription: string;
    ebayCategoryId: string;
    ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
    cardCondition: string;
    grader: string;
    grade: string;
    certificationNumber: string;
    aspects: Record<string, string[]>;
  };
  readyWebsite: boolean;
  readyEbay: boolean;
  websiteProblems: string[];
  ebayProblems: string[];
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type EbayReadiness = {
  connected: boolean;
  ready: boolean;
  marketplaceId: string;
  merchantLocationKey: string | null;
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
  missing: string[];
  error: string | null;
};

type ListingFilter = "drafts" | "all" | "needs_review" | "live";

type ActionError = {
  inventoryItemId?: string;
  title?: string;
  error?: string;
  externalPublished?: boolean;
  ebayListingId?: string | null;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function shortDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusBadge(status: string, channel: string) {
  const tone =
    status === "active"
      ? "border-emerald-300 bg-emerald-100 text-emerald-800"
      : status === "error" || status === "reconciliation_required"
        ? "border-red-300 bg-red-100 text-red-800"
        : status === "publishing"
          ? "border-blue-300 bg-blue-100 text-blue-800"
          : "border-neutral-300 bg-neutral-100 text-neutral-700";
  const label = status.replaceAll("_", " ") || "draft";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-black uppercase tracking-wide ${tone}`}>
      {channel}: {label}
    </span>
  );
}

function payloadForRows(rows: ListingRow[]) {
  return rows.map((row) => ({
    inventoryItemId: row.inventoryItemId,
    websiteTitle: row.websiteTitle,
    websiteDescription: row.websiteDescription,
    ebayTitle: row.ebayTitle,
    ebayDescription: row.ebayDescription,
    ebayPrice: row.ebayPrice,
    websitePrice: row.websitePrice,
    quantity: row.quantity,
    ebayCategoryId: row.ebayCategoryId,
    ebayCondition: row.ebayCondition,
    cardCondition: row.cardCondition,
    grader: row.grader,
    grade: row.grade,
    certificationNumber: row.certificationNumber,
    aspects: row.aspects,
    bestOfferEnabled: row.bestOfferEnabled,
  }));
}

export default function AuditedDualMarketplaceListingStudio() {
  const [rows, setRows] = useState<ListingRow[]>([]);
  const rowsRef = useRef<ListingRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const dirtyIdsRef = useRef(new Set<string>());
  const [feeProfile, setFeeProfile] = useState<DualMarketplaceFeeProfile | null>(null);
  const [ebayReadiness, setEbayReadiness] = useState<EbayReadiness | null>(null);
  const [filter, setFilter] = useState<ListingFilter>("drafts");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workingAction, setWorkingAction] = useState<DualMarketplaceAction | null>(null);
  const workingActionRef = useRef<DualMarketplaceAction | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadRows = useCallback(
    async (options: { includeReadiness?: boolean; preserveEdits?: boolean } = {}) => {
      const initial = rowsRef.current.length === 0;
      if (initial) setLoading(true);
      else setRefreshing(true);

      try {
        const response = await fetch(
          `/api/admin/dual-marketplace-listings?includeReadiness=${
            options.includeReadiness === false ? "0" : "1"
          }`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load listing studio.");
        }

        const incomingRows = (Array.isArray(data.rows) ? data.rows : []) as ListingRow[];
        const currentById = new Map(
          rowsRef.current.map((row) => [row.inventoryItemId, row]),
        );
        const merged = incomingRows.map((row) =>
          options.preserveEdits && dirtyIdsRef.current.has(row.inventoryItemId)
            ? currentById.get(row.inventoryItemId) || row
            : row,
        );
        const availableIds = new Set(merged.map((row) => row.inventoryItemId));

        rowsRef.current = merged;
        setRows(merged);
        setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
        setFeeProfile(data.feeProfile as DualMarketplaceFeeProfile);
        if (data.ebayReadiness) {
          setEbayReadiness(data.ebayReadiness as EbayReadiness);
        }
        setError("");
      } catch (nextError: any) {
        setError(nextError?.message || "Could not load listing studio.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRows({ includeReadiness: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRows]);

  useEffect(() => {
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        !workingActionRef.current &&
        dirtyIdsRef.current.size === 0
      ) {
        void loadRows({ includeReadiness: false, preserveEdits: true });
      }
    };
    const interval = window.setInterval(refresh, 12_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadRows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const expandedSet = useMemo(() => new Set(expandedIds), [expandedIds]);
  const dirtySet = useMemo(() => new Set(dirtyIds), [dirtyIds]);
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (
        filter === "drafts" &&
        row.websiteStatus === "active" &&
        row.ebayStatus === "active"
      ) {
        return false;
      }
      if (
        filter === "needs_review" &&
        row.readyWebsite &&
        row.readyEbay &&
        !row.lastError
      ) {
        return false;
      }
      if (
        filter === "live" &&
        row.websiteStatus !== "active" &&
        row.ebayStatus !== "active"
      ) {
        return false;
      }
      if (!term) return true;
      return [
        row.websiteTitle,
        row.ebayTitle,
        row.sku || "",
        row.ebayItemId || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [filter, rows, search]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.inventoryItemId)),
    [rows, selectedSet],
  );
  const visibleIds = useMemo(
    () => filteredRows.map((row) => row.inventoryItemId),
    [filteredRows],
  );
  const visibleSelectedCount = visibleIds.filter((id) => selectedSet.has(id)).length;
  const busy = Boolean(workingAction);

  function applyRows(nextRows: ListingRow[]) {
    rowsRef.current = nextRows;
    setRows(nextRows);
  }

  function markDirty(ids: string[]) {
    for (const id of ids) dirtyIdsRef.current.add(id);
    setDirtyIds(Array.from(dirtyIdsRef.current));
  }

  function clearDirty(ids: string[]) {
    for (const id of ids) dirtyIdsRef.current.delete(id);
    setDirtyIds(Array.from(dirtyIdsRef.current));
  }

  function updateRow(
    inventoryItemId: string,
    updater: (row: ListingRow) => ListingRow,
  ) {
    markDirty([inventoryItemId]);
    applyRows(
      rowsRef.current.map((row) =>
        row.inventoryItemId === inventoryItemId ? updater(row) : row,
      ),
    );
  }

  function updateField<K extends keyof ListingRow>(
    inventoryItemId: string,
    field: K,
    value: ListingRow[K],
  ) {
    updateRow(inventoryItemId, (row) => ({ ...row, [field]: value }));
  }

  function updateEbayPrice(inventoryItemId: string, nextValue: number) {
    updateRow(inventoryItemId, (row) => {
      const ebayPrice = Math.max(0, nextValue);
      const pricing = calculateDualMarketplacePricing(
        ebayPrice,
        feeProfile || undefined,
      );
      return {
        ...row,
        ebayPrice,
        websitePrice: pricing.websitePrice,
        pricing,
      };
    });
  }

  function updateWebsitePrice(inventoryItemId: string, nextValue: number) {
    updateRow(inventoryItemId, (row) => {
      const websitePrice = Math.max(0, nextValue);
      return {
        ...row,
        websitePrice,
        pricing: calculateCustomWebsitePricing(
          row.ebayPrice,
          websitePrice,
          feeProfile || undefined,
        ),
      };
    });
  }

  function toggleSelected(inventoryItemId: string) {
    if (busy) return;
    setSelectedIds((current) =>
      current.includes(inventoryItemId)
        ? current.filter((id) => id !== inventoryItemId)
        : [...current, inventoryItemId],
    );
  }

  function selectAllShowing() {
    if (busy) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...visibleIds])));
  }

  function deselectAllShowing() {
    if (busy) return;
    const visible = new Set(visibleIds);
    setSelectedIds((current) => current.filter((id) => !visible.has(id)));
  }

  function selectReadyShowing() {
    if (busy) return;
    const readyIds = filteredRows
      .filter((row) => row.readyWebsite && row.readyEbay)
      .map((row) => row.inventoryItemId);
    setSelectedIds((current) => Array.from(new Set([...current, ...readyIds])));
  }

  function toggleExpanded(inventoryItemId: string) {
    setExpandedIds((current) =>
      current.includes(inventoryItemId)
        ? current.filter((id) => id !== inventoryItemId)
        : [...current, inventoryItemId],
    );
  }

  function regenerateSelected() {
    if (busy || !selectedRows.length || !feeProfile) return;
    markDirty(selectedRows.map((row) => row.inventoryItemId));
    applyRows(
      rowsRef.current.map((row) => {
        if (!selectedSet.has(row.inventoryItemId)) return row;
        const pricing = calculateDualMarketplacePricing(row.ebayPrice, feeProfile);
        return {
          ...row,
          websiteTitle: row.generated.websiteTitle,
          websiteDescription: row.generated.websiteDescription,
          ebayTitle: row.generated.ebayTitle,
          ebayDescription: row.generated.ebayDescription,
          ebayCategoryId: row.generated.ebayCategoryId,
          ebayCondition: row.generated.ebayCondition,
          cardCondition: row.generated.cardCondition,
          grader: row.generated.grader,
          grade: row.generated.grade,
          certificationNumber: row.generated.certificationNumber,
          aspects: row.generated.aspects,
          websitePrice: pricing.websitePrice,
          pricing,
        };
      }),
    );
    setNotice(`Regenerated ${selectedRows.length} selected listing${selectedRows.length === 1 ? "" : "s"}.`);
    setError("");
  }

  function clientActionProblems(action: DualMarketplaceAction, targetRows: ListingRow[]) {
    const problems: string[] = [];
    for (const row of targetRows) {
      if (action === "publish-website" || action === "publish-both") {
        if (row.quantity < 1) problems.push(`${row.websiteTitle}: quantity is zero`);
        if (row.websitePrice <= 0 || row.websitePrice >= row.ebayPrice) {
          problems.push(`${row.websiteTitle}: website price must be positive and lower than eBay`);
        }
      }
      if (action === "publish-ebay" || action === "publish-both") {
        if (row.quantity < 1) problems.push(`${row.ebayTitle}: quantity is zero`);
        if (!row.cardCondition && row.ebayCondition === "USED_VERY_GOOD") {
          problems.push(`${row.ebayTitle}: raw-card condition needs review`);
        }
      }
    }
    return problems;
  }

  async function runAction(action: DualMarketplaceAction) {
    if (busy) return;
    const targetRows = selectedRows.slice();
    if (!targetRows.length) {
      setError("Select at least one listing first.");
      return;
    }

    const includesEbay = action === "publish-ebay" || action === "publish-both";
    if (includesEbay && ebayReadiness?.ready !== true) {
      setError(
        ebayReadiness?.error ||
          "eBay publishing readiness has not completed successfully.",
      );
      return;
    }

    const clientProblems = clientActionProblems(action, targetRows);
    if (clientProblems.length) {
      setError(clientProblems.slice(0, 6).join(" | "));
      return;
    }

    if (includesEbay) {
      const total = targetRows.reduce((sum, row) => sum + row.ebayPrice, 0);
      const confirmed = window.confirm(
        `Create or update ${targetRows.length} REAL eBay listing${
          targetRows.length === 1 ? "" : "s"
        } with ${money(total)} in combined asking prices? TCOS will process them in safe five-card batches.`,
      );
      if (!confirmed) return;
    }

    workingActionRef.current = action;
    setWorkingAction(action);
    setNotice("");
    setError("");

    const allResults: any[] = [];
    const allErrors: ActionError[] = [];
    const chunks = chunkDualMarketplaceItems(targetRows, action);
    let completed = 0;

    try {
      for (const rowChunk of chunks) {
        setNotice(
          `${action.replaceAll("-", " ")} ${completed + 1}–${Math.min(
            completed + rowChunk.length,
            targetRows.length,
          )} of ${targetRows.length}...`,
        );
        const response = await fetch("/api/admin/dual-marketplace-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            items: payloadForRows(rowChunk),
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok && !Array.isArray(data.results) && !Array.isArray(data.errors)) {
          throw new Error(data.error || "Listing action failed.");
        }
        allResults.push(...(Array.isArray(data.results) ? data.results : []));
        allErrors.push(...(Array.isArray(data.errors) ? data.errors : []));
        completed += rowChunk.length;
      }

      const successfulIds = allResults
        .map((result) => String(result.inventoryItemId || ""))
        .filter(Boolean);
      clearDirty(successfulIds);
      setSelectedIds((current) =>
        current.filter((id) => !successfulIds.includes(id)),
      );
      setNotice(
        `${allResults.length} listing${allResults.length === 1 ? "" : "s"} completed${
          allErrors.length ? `; ${allErrors.length} need review` : " successfully"
        }.`,
      );

      if (allErrors.length) {
        setError(
          allErrors
            .slice(0, 8)
            .map((entry) => {
              const external = entry.externalPublished
                ? ` [EXTERNAL LISTING IS LIVE${entry.ebayListingId ? `: ${entry.ebayListingId}` : ""}]`
                : "";
              return `${entry.title || entry.inventoryItemId}: ${entry.error || "failed"}${external}`;
            })
            .join(" | "),
        );
      }

      await loadRows({ includeReadiness: true, preserveEdits: true });
    } catch (nextError: any) {
      setError(nextError?.message || "Listing action failed.");
    } finally {
      workingActionRef.current = null;
      setWorkingAction(null);
    }
  }

  function renameAspect(inventoryItemId: string, oldName: string, newName: string) {
    const cleaned = newName.trim();
    if (!cleaned || cleaned === oldName) return;
    if (cleaned.length > 40) {
      setError("eBay item-specific names must be 40 characters or fewer.");
      return;
    }

    updateRow(inventoryItemId, (row) => {
      const next = { ...row.aspects };
      const existing = next[cleaned] || [];
      const values = next[oldName] || [];
      delete next[oldName];
      next[cleaned] = Array.from(new Set([...existing, ...values]));
      return { ...row, aspects: next };
    });
  }

  function updateAspectValues(
    inventoryItemId: string,
    aspectName: string,
    value: string,
  ) {
    updateRow(inventoryItemId, (row) => ({
      ...row,
      aspects: {
        ...row.aspects,
        [aspectName]: value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      },
    }));
  }

  function removeAspect(inventoryItemId: string, aspectName: string) {
    updateRow(inventoryItemId, (row) => {
      const next = { ...row.aspects };
      delete next[aspectName];
      return { ...row, aspects: next };
    });
  }

  function addAspect(inventoryItemId: string) {
    updateRow(inventoryItemId, (row) => {
      let index = 1;
      let name = "New Item Specific";
      while (row.aspects[name]) {
        index += 1;
        name = `New Item Specific ${index}`;
      }
      return { ...row, aspects: { ...row.aspects, [name]: [] } };
    });
  }

  return (
    <section className="mt-8 overflow-hidden rounded-[2rem] border border-neutral-900 bg-white shadow-2xl shadow-neutral-950/10">
      <div className="border-b border-neutral-800 bg-neutral-950 p-6 text-white lg:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">
              Audited Channel Builder
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Website + eBay Listing Studio
            </h2>
            <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-neutral-300">
              Nothing is selected automatically. Review the cards, select the exact rows,
              save edits, then explicitly confirm any real eBay publishing action.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Cards" value={rows.length} />
            <Stat label="Selected" value={selectedRows.length} />
            <Stat
              label="Website Live"
              value={rows.filter((row) => row.websiteStatus === "active").length}
            />
            <Stat
              label="eBay Live"
              value={rows.filter((row) => row.ebayStatus === "active").length}
            />
          </div>
        </div>
      </div>

      <div className="border-b border-neutral-200 bg-neutral-50 p-4 lg:p-6">
        <div
          className={`rounded-2xl border p-4 text-sm font-bold ${
            ebayReadiness?.ready
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}
        >
          {ebayReadiness?.ready
            ? `eBay publisher ready: ${ebayReadiness.marketplaceId}; one inventory location and all three policies resolved.`
            : ebayReadiness?.error ||
              "Checking the eBay seller token, inventory location, and policies..."}
        </div>

        <p className="mt-3 text-xs font-bold text-neutral-600">
          Fee comparison is an item-price-only estimate. Actual eBay fees can also use
          shipping, handling, sales tax, and other order amounts.
        </p>

        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <ToolbarButton onClick={selectAllShowing} disabled={busy || !visibleIds.length}>
              Select All Showing ({filteredRows.length})
            </ToolbarButton>
            <ToolbarButton onClick={selectReadyShowing} disabled={busy || !filteredRows.length}>
              Select Ready for Both
            </ToolbarButton>
            <ToolbarButton onClick={deselectAllShowing} disabled={busy || !visibleSelectedCount}>
              Clear Showing
            </ToolbarButton>
            <ToolbarButton onClick={regenerateSelected} disabled={busy || !selectedRows.length}>
              Regenerate Selected
            </ToolbarButton>
            <ToolbarButton
              onClick={() => void loadRows({ includeReadiness: true, preserveEdits: true })}
              disabled={busy || refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh Drafts"}
            </ToolbarButton>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as ListingFilter)}
              className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-bold"
            >
              <option value="drafts">Draft / Not Fully Live</option>
              <option value="needs_review">Needs Review</option>
              <option value="live">Live Somewhere</option>
              <option value="all">All Listings</option>
            </select>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, SKU, eBay ID"
              className="min-w-64 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-neutral-300 bg-white p-3 shadow-sm">
          <ActionButton
            onClick={() => void runAction("save")}
            disabled={busy || !selectedRows.length}
            label={workingAction === "save" ? "Saving..." : "Save Selected Drafts"}
          />
          <ActionButton
            onClick={() => void runAction("publish-website")}
            disabled={busy || !selectedRows.length}
            label={
              workingAction === "publish-website"
                ? "Publishing Website..."
                : "Publish Website Only"
            }
          />
          <ActionButton
            onClick={() => void runAction("publish-ebay")}
            disabled={busy || !selectedRows.length || ebayReadiness?.ready !== true}
            label={workingAction === "publish-ebay" ? "Publishing eBay..." : "Publish eBay Only"}
          />
          <button
            type="button"
            onClick={() => void runAction("publish-both")}
            disabled={busy || !selectedRows.length || ebayReadiness?.ready !== true}
            className="rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-neutral-950 shadow-sm transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {workingAction === "publish-both"
              ? `Publishing ${selectedRows.length} to Both...`
              : `Publish Selected to Website + eBay (${selectedRows.length})`}
          </button>
        </div>

        {notice ? (
          <p aria-live="polite" className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900">
            {error}
          </p>
        ) : null}
      </div>

      <div className="p-4 lg:p-6">
        {loading ? (
          <div className="rounded-2xl border border-neutral-200 p-12 text-center font-bold text-neutral-500">
            Loading InstaComp™ drafts...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-400 bg-neutral-50 p-12 text-center">
            <p className="text-xl font-black">No matching listing drafts yet.</p>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              Create InstaComp™ listing drafts above; up to 500 admin-owned cards appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-5">
            {filteredRows.map((row, index) => {
              const selected = selectedSet.has(row.inventoryItemId);
              const expanded = expandedSet.has(row.inventoryItemId);
              const dirty = dirtySet.has(row.inventoryItemId);
              const invalidWebsitePrice =
                row.websitePrice <= 0 || row.websitePrice >= row.ebayPrice;
              const allProblems = Array.from(
                new Set([...row.websiteProblems, ...row.ebayProblems]),
              );

              return (
                <article
                  key={row.inventoryItemId}
                  className={`overflow-hidden rounded-3xl border-2 shadow-sm ${
                    selected
                      ? "border-amber-400 bg-amber-50/40"
                      : "border-neutral-200 bg-white"
                  }`}
                >
                  <div className="flex flex-col gap-4 border-b border-neutral-200 p-4 lg:flex-row lg:items-start lg:p-5">
                    <label className="flex min-w-12 cursor-pointer items-center gap-2 font-black">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleSelected(row.inventoryItemId)}
                        disabled={busy}
                        className="h-5 w-5 accent-amber-500"
                      />
                      <span>#{index + 1}</span>
                    </label>

                    <div className="flex gap-2">
                      {[row.imageUrls[0], row.imageUrls[1]].map((imageUrl, imageIndex) =>
                        imageUrl ? (
                          <div
                            key={`${imageUrl}-${imageIndex}`}
                            className="relative h-32 w-24 overflow-hidden rounded-xl border border-neutral-300 bg-neutral-100"
                          >
                            <Image
                              src={imageUrl}
                              alt={`${row.websiteTitle} ${imageIndex === 0 ? "front" : "back"}`}
                              fill
                              unoptimized
                              className="object-contain"
                              sizes="96px"
                            />
                          </div>
                        ) : null,
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {statusBadge(row.websiteStatus, "Site")}
                        {statusBadge(row.ebayStatus, "eBay")}
                        {dirty ? (
                          <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-black uppercase text-amber-900">
                            Unsaved Edits
                          </span>
                        ) : null}
                        {!dirty && row.readyWebsite && row.readyEbay ? (
                          <span className="rounded-full border border-sky-300 bg-sky-100 px-2.5 py-1 text-xs font-black uppercase text-sky-800">
                            Server Ready
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 truncate text-xs font-bold uppercase tracking-wide text-neutral-500">
                        SKU {row.sku || "Missing"} · Stock {row.quantity} · Updated {shortDate(row.updatedAt)}
                        {row.ebayItemId ? ` · eBay ${row.ebayItemId}` : ""}
                      </p>
                      {row.lastError ? (
                        <p className="mt-2 rounded-xl border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-800">
                          {row.lastError}
                        </p>
                      ) : null}
                      {!dirty && allProblems.length ? (
                        <p className="mt-2 text-xs font-bold text-amber-800">
                          Review: {allProblems.join(" · ")}
                        </p>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.inventoryItemId)}
                      className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black hover:bg-neutral-100"
                    >
                      {expanded ? "Collapse Editor" : "Open Full Editor"}
                    </button>
                  </div>

                  <div className="grid gap-4 p-4 lg:grid-cols-2 lg:p-5">
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
                        TruelyCollectables.com
                      </p>
                      <TextInput
                        label="Website Title"
                        value={row.websiteTitle}
                        maxLength={200}
                        onChange={(value) =>
                          updateField(row.inventoryItemId, "websiteTitle", value)
                        }
                      />
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <PriceInput
                          label="Website Price"
                          value={row.websitePrice}
                          onChange={(value) => updateWebsitePrice(row.inventoryItemId, value)}
                          invalid={invalidWebsitePrice}
                        />
                        <NumberInput
                          label="Quantity"
                          value={row.quantity}
                          minimum={0}
                          onChange={(value) =>
                            updateField(row.inventoryItemId, "quantity", Math.max(0, value))
                          }
                        />
                      </div>
                      <p className={`mt-2 text-xs font-bold ${invalidWebsitePrice ? "text-red-700" : "text-emerald-800"}`}>
                        {invalidWebsitePrice
                          ? "Website price must be lower than the eBay price before website publishing."
                          : `${money(row.pricing.customerSavings)} cheaper for the customer.`}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-800">
                          eBay
                        </p>
                        <span className="text-xs font-black text-neutral-500">
                          {row.ebayTitle.length}/80
                        </span>
                      </div>
                      <TextInput
                        label="eBay Title"
                        value={row.ebayTitle}
                        maxLength={80}
                        onChange={(value) =>
                          updateField(row.inventoryItemId, "ebayTitle", value)
                        }
                      />
                      <div className="mt-3 grid grid-cols-2 gap-3">
                        <PriceInput
                          label="eBay Selling Price"
                          value={row.ebayPrice}
                          onChange={(value) => updateEbayPrice(row.inventoryItemId, value)}
                        />
                        <label className="block text-xs font-black uppercase text-neutral-600">
                          Best Offer
                          <select
                            value={row.bestOfferEnabled ? "yes" : "no"}
                            onChange={(event) =>
                              updateField(
                                row.inventoryItemId,
                                "bestOfferEnabled",
                                event.target.value === "yes",
                              )
                            }
                            className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-bold normal-case text-neutral-950"
                          >
                            <option value="yes">Enabled</option>
                            <option value="no">Disabled</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="mx-4 mb-4 grid gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 sm:grid-cols-2 lg:mx-5 lg:mb-5 lg:grid-cols-5">
                    <NetStat label="eBay Fees" value={row.pricing.ebayEstimatedFees} />
                    <NetStat label="eBay Net" value={row.pricing.ebayEstimatedNet} />
                    <NetStat label="Site Fees" value={row.pricing.websiteEstimatedFees} />
                    <NetStat label="Site Net" value={row.pricing.websiteEstimatedNet} />
                    <NetStat label="Net Difference" value={row.pricing.netDifference} signed />
                  </div>

                  {expanded ? (
                    <div className="border-t border-neutral-200 bg-neutral-50 p-4 lg:p-5">
                      <div className="grid gap-5 xl:grid-cols-2">
                        <EditorPanel title="Website Description">
                          <textarea
                            value={row.websiteDescription}
                            maxLength={100_000}
                            onChange={(event) =>
                              updateField(
                                row.inventoryItemId,
                                "websiteDescription",
                                event.target.value,
                              )
                            }
                            rows={14}
                            className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm font-medium leading-6"
                          />
                        </EditorPanel>

                        <EditorPanel title="eBay Description (Safe HTML Only)">
                          <textarea
                            value={row.ebayDescription}
                            maxLength={100_000}
                            onChange={(event) =>
                              updateField(
                                row.inventoryItemId,
                                "ebayDescription",
                                event.target.value,
                              )
                            }
                            rows={14}
                            className="w-full rounded-xl border border-neutral-300 bg-white p-3 font-mono text-xs leading-6"
                          />
                          <p className="mt-2 text-xs font-bold text-neutral-500">
                            Scripts, forms, iframes, event handlers, and javascript URLs are blocked server-side.
                          </p>
                        </EditorPanel>
                      </div>

                      <div className="mt-5 grid gap-5 xl:grid-cols-2">
                        <EditorPanel title="eBay Category + Condition">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <LabeledSelect
                              label="Category"
                              value={row.ebayCategoryId}
                              onChange={(value) =>
                                updateField(row.inventoryItemId, "ebayCategoryId", value)
                              }
                              options={[
                                ["261328", "Sports Trading Card Singles"],
                                ["183454", "CCG Individual Cards"],
                                ["183050", "Non-Sport Trading Card Singles"],
                              ]}
                            />
                            <LabeledSelect
                              label="Card Type"
                              value={row.ebayCondition}
                              onChange={(value) =>
                                updateField(
                                  row.inventoryItemId,
                                  "ebayCondition",
                                  value as ListingRow["ebayCondition"],
                                )
                              }
                              options={[
                                ["USED_VERY_GOOD", "Raw / Ungraded"],
                                ["LIKE_NEW", "Professionally Graded"],
                              ]}
                            />
                          </div>

                          {row.ebayCondition === "LIKE_NEW" ? (
                            <div className="mt-3 grid gap-3 sm:grid-cols-3">
                              <TextInput
                                label="Grader"
                                value={row.grader}
                                maxLength={120}
                                onChange={(value) => updateField(row.inventoryItemId, "grader", value)}
                              />
                              <TextInput
                                label="Grade"
                                value={row.grade}
                                maxLength={40}
                                onChange={(value) => updateField(row.inventoryItemId, "grade", value)}
                              />
                              <TextInput
                                label="Certification #"
                                value={row.certificationNumber}
                                maxLength={30}
                                onChange={(value) =>
                                  updateField(row.inventoryItemId, "certificationNumber", value)
                                }
                              />
                            </div>
                          ) : (
                            <div className="mt-3">
                              <LabeledSelect
                                label="Card Condition"
                                value={row.cardCondition}
                                onChange={(value) =>
                                  updateField(row.inventoryItemId, "cardCondition", value)
                                }
                                options={[
                                  ["", "Review required"],
                                  ["Near Mint or Better", "Near Mint or Better"],
                                  ["Excellent", "Excellent"],
                                  ["Very Good", "Very Good"],
                                  ["Good", "Good"],
                                  ["Poor", "Poor"],
                                ]}
                              />
                            </div>
                          )}
                        </EditorPanel>

                        <EditorPanel title="eBay Item Specifics">
                          <div className="grid gap-2">
                            {Object.entries(row.aspects).map(([name, values]) => (
                              <div
                                key={name}
                                className="grid gap-2 rounded-xl border border-neutral-200 bg-white p-2 sm:grid-cols-[0.8fr_1.2fr_auto]"
                              >
                                <input
                                  defaultValue={name}
                                  maxLength={40}
                                  onBlur={(event) =>
                                    renameAspect(row.inventoryItemId, name, event.target.value)
                                  }
                                  className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-black"
                                />
                                <input
                                  value={values.join(", ")}
                                  onChange={(event) =>
                                    updateAspectValues(row.inventoryItemId, name, event.target.value)
                                  }
                                  className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-semibold"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeAspect(row.inventoryItemId, name)}
                                  className="rounded-lg border border-red-200 px-2 py-1 text-xs font-black text-red-700 hover:bg-red-50"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => addAspect(row.inventoryItemId)}
                            className="mt-3 rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black hover:bg-neutral-100"
                          >
                            + Add Item Specific
                          </button>
                        </EditorPanel>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-center">
      <p className="text-2xl font-black">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-300">{label}</p>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-black shadow-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-black shadow-sm hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {label}
    </button>
  );
}

function PriceInput({
  label,
  value,
  onChange,
  invalid,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  invalid?: boolean;
}) {
  return (
    <label className="block text-xs font-black uppercase text-neutral-600">
      {label}
      <div className={`mt-1 flex overflow-hidden rounded-xl border bg-white ${invalid ? "border-red-500" : "border-neutral-300"}`}>
        <span className="border-r border-neutral-200 px-3 py-2 text-sm font-black">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={Number.isFinite(value) ? value : 0}
          onChange={(event) => onChange(Number(event.target.value || 0))}
          className="min-w-0 flex-1 px-3 py-2 text-sm font-black text-neutral-950 outline-none"
        />
      </div>
    </label>
  );
}

function NumberInput({
  label,
  value,
  minimum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-black uppercase text-neutral-600">
      {label}
      <input
        type="number"
        min={minimum}
        step="1"
        value={value}
        onChange={(event) => onChange(Number(event.target.value || minimum))}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-black text-neutral-950"
      />
    </label>
  );
}

function NetStat({
  label,
  value,
  signed,
}: {
  label: string;
  value: number;
  signed?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-black">
        {signed && value > 0 ? "+" : ""}
        {money(value)}
      </p>
    </div>
  );
}

function EditorPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-neutral-700">{title}</h3>
      {children}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
}) {
  return (
    <label className="mt-3 block text-xs font-black uppercase text-neutral-600">
      {label}
      <input
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-bold normal-case text-neutral-950"
      />
    </label>
  );
}

function LabeledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block text-xs font-black uppercase text-neutral-600">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-bold normal-case text-neutral-950"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || "blank"} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
