"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  reconcileEbayDuplicateKeeperSelection,
  reconcileEbayDuplicateRowSelection,
} from "../../../../lib/ebay-duplicate-selection";

type DuplicateRow = {
  productId: number;
  inventoryItemId: string | null;
  sku: string | null;
  title: string;
  price: number;
  quantity: number;
  imageUrl: string | null;
  ebayItemId: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  inventoryStatus: string;
  inventoryQuantity: number | null;
  inventoryPrice: number | null;
};

type DuplicateGroup = {
  key: string;
  title: string;
  price: number;
  count: number;
  totalQuantity: number;
  recommendedKeeperProductId: number | null;
  rows: DuplicateRow[];
};

type Summary = {
  groups: number;
  duplicateRows: number;
  totalRowsInGroups: number;
};

type DuplicateAction =
  | {
      groupKey: string;
      kind: "merge" | "end";
      productId?: number;
      stage: "previewing" | "applying";
    }
  | null;

type ActionNoticeTone = "success" | "error" | "info";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function shortDate(value: string | null) {
  if (!value) return "Not synced";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function duplicateRowLabel(row: DuplicateRow | null | undefined) {
  if (!row) return "selected product";

  return row.title?.trim() || `product #${row.productId}`;
}

function duplicateRowScope(row: DuplicateRow | null | undefined) {
  if (!row) return "selected product";

  return `${duplicateRowLabel(row)} (#${row.productId}, quantity ${row.quantity})`;
}

export default function EbayDuplicateFinderClient() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const keepersRef = useRef<Record<string, number>>({});
  const [duplicates, setDuplicates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<DuplicateAction>(null);
  const workingActionRef = useRef<DuplicateAction>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function setActiveDuplicateAction(action: DuplicateAction) {
    workingActionRef.current = action;
    setWorkingAction(action);
  }

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setError("");
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
    setNotice("");
  }, []);

  const clearMessages = useCallback(() => {
    setNotice("");
    setError("");
  }, []);

  function duplicateActionBlockedReason(action: string) {
    if (workingActionRef.current) {
      return `Finish the current duplicate cleanup action before ${action}.`;
    }

    if (loading) {
      return "Duplicate scan is already running.";
    }

    return "";
  }

  function showDuplicateActionBlocked(action: string) {
    const blockedReason = duplicateActionBlockedReason(action);

    if (!blockedReason) return false;

    showError(blockedReason);
    return true;
  }

  function selectedKeeperProductIdForGroup(group: DuplicateGroup) {
    return (
      keepersRef.current[group.key] ||
      keepers[group.key] ||
      group.recommendedKeeperProductId ||
      0
    );
  }

  const fetchGroups = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/ebay-duplicates", {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load duplicate groups.");
      }

      const nextGroups = (data.groups || []) as DuplicateGroup[];
      const nextKeepers = reconcileEbayDuplicateKeeperSelection(
        nextGroups,
        keepersRef.current,
      );

      keepersRef.current = nextKeepers;
      setGroups(nextGroups);
      setSummary((data.summary || null) as Summary | null);
      setKeepers(nextKeepers);
      setDuplicates((current) => {
        return reconcileEbayDuplicateRowSelection(
          nextGroups,
          current,
          nextKeepers,
        );
      });
    } catch (nextError: any) {
      showError(nextError.message || "Could not load duplicate groups.");
      setGroups([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  async function loadGroups(options?: {
    preserveMessages?: boolean;
    allowDuringAction?: boolean;
  }) {
    if (!options?.allowDuringAction && showDuplicateActionBlocked("rescanning duplicates")) {
      return;
    }

    setLoading(true);
    if (!options?.preserveMessages) {
      clearMessages();
    }
    await fetchGroups();
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void fetchGroups();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, [fetchGroups]);

  const hasGroups = groups.length > 0;
  const totalDuplicateRows = useMemo(
    () => groups.reduce((sum, group) => sum + Math.max(0, group.count - 1), 0),
    [groups],
  );

  function chooseKeeper(group: DuplicateGroup, productId: number) {
    if (showDuplicateActionBlocked("changing the keeper row")) return;

    setKeepers((current) => {
      const next = { ...current, [group.key]: productId };
      keepersRef.current = next;
      return next;
    });
    setDuplicates((current) => {
      if (current[group.key] !== productId) return current;

      const nextDuplicate = group.rows.find((row) => row.productId !== productId);
      return {
        ...current,
        [group.key]: nextDuplicate?.productId || 0,
      };
    });
  }

  function chooseDuplicate(group: DuplicateGroup, productId: number) {
    if (showDuplicateActionBlocked("changing the duplicate row")) return;

    const keeperProductId = selectedKeeperProductIdForGroup(group);

    if (productId === keeperProductId) {
      showError(
        "That row is marked as the keeper. Pick a different row to end, or choose another keeper first.",
      );
      return;
    }

    setDuplicates((current) => ({
      ...current,
      [group.key]: productId,
    }));
  }

  async function runDuplicateMerge({
    group,
    duplicateProductIds,
    mode,
  }: {
    group: DuplicateGroup;
    duplicateProductIds: number[];
    mode: "selected" | "all";
  }) {
    if (showDuplicateActionBlocked("starting another merge or end/archive")) return;

    const keeperProductId = selectedKeeperProductIdForGroup(group);
    const normalizedDuplicateProductIds = Array.from(
      new Set(
        duplicateProductIds.filter(
          (productId) => productId && productId !== keeperProductId,
        ),
      ),
    );
    const keeperRow =
      group.rows.find((row) => row.productId === keeperProductId) || null;
    const targetDuplicateRows = group.rows.filter((row) =>
      normalizedDuplicateProductIds.includes(row.productId),
    );
    const visibleMergedQuantity =
      Number(keeperRow?.quantity || 0) +
      targetDuplicateRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    if (!keeperProductId || normalizedDuplicateProductIds.length === 0) {
      showError("Pick one keeper with at least one different duplicate row first.");
      return;
    }

    const actionLabel =
      mode === "all" ? "all non-keeper duplicates" : "the selected duplicate";
    const duplicateScope = `${targetDuplicateRows.length} duplicate row${
      targetDuplicateRows.length === 1 ? "" : "s"
    } totaling quantity ${targetDuplicateRows.reduce(
      (sum, row) => sum + Number(row.quantity || 0),
      0,
    )}`;
    const keeperScope = duplicateRowScope(keeperRow);
    const requestBody =
      mode === "all"
        ? {
            action: "merge-duplicates",
            keeperProductId,
            duplicateProductIds: normalizedDuplicateProductIds,
            confirm: "MERGE_DUPLICATES",
          }
        : {
            action: "merge-duplicate",
            keeperProductId,
            duplicateProductId: normalizedDuplicateProductIds[0],
            confirm: "MERGE_DUPLICATE",
          };

    setActiveDuplicateAction({
      groupKey: group.key,
      kind: "merge",
      productId: mode === "all" ? undefined : normalizedDuplicateProductIds[0],
      stage: "previewing",
    });
    showNotice(
      `Previewing merge for ${actionLabel}: ${duplicateScope} into keeper ${keeperScope}...`,
    );

    try {
      const previewResponse = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestBody,
          dryRun: true,
        }),
      });
      const previewData = await previewResponse.json().catch(() => ({}));

      if (!previewResponse.ok || !previewData.success) {
        throw new Error(previewData.error || "Could not preview duplicate merge.");
      }

      const preview = previewData.result || {};
      const serverMergedQuantity = Number(preview.mergedQuantity || 0);

      if (serverMergedQuantity !== visibleMergedQuantity) {
        showNotice(
          `Server preview refreshed the merge math: keeper quantity ${preview.previousKeeperQuantity} + duplicate quantity ${preview.duplicateQuantity} = ${preview.mergedQuantity}.`,
        );
      }

      setActiveDuplicateAction({
        groupKey: group.key,
        kind: "merge",
        productId: mode === "all" ? undefined : normalizedDuplicateProductIds[0],
        stage: "applying",
      });
      showNotice(
        `Merging ${actionLabel} now: keeper ${keeperScope} will change from quantity ${preview.previousKeeperQuantity} to ${preview.mergedQuantity}; duplicate quantity ${preview.duplicateQuantity} will be archived to 0.`,
      );

      const response = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not merge duplicate.");
      }

      const result = data.result || {};
      const ebayWarnings = Array.isArray(result.ebayActions)
        ? result.ebayActions
            .filter((action: any) => action && action.ok === false)
            .map((action: any) => action.message)
            .filter(Boolean)
        : [];

      showNotice(
        `${data.message || "Duplicate merged."}${
          ebayWarnings.length ? ` eBay warning: ${ebayWarnings.join(" | ")}` : ""
        }`,
      );
      await loadGroups({ preserveMessages: true, allowDuringAction: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not merge duplicate.");
    } finally {
      setActiveDuplicateAction(null);
    }
  }

  async function mergeGroup(group: DuplicateGroup) {
    const keeperProductId = selectedKeeperProductIdForGroup(group);
    const duplicateProductIds = group.rows
      .map((row) => row.productId)
      .filter((productId) => productId !== keeperProductId);

    await runDuplicateMerge({
      group,
      duplicateProductIds,
      mode: "all",
    });
  }

  async function mergeSelectedDuplicate(group: DuplicateGroup) {
    const keeperProductId = selectedKeeperProductIdForGroup(group);
    const duplicateProductId =
      duplicates[group.key] ||
      group.rows.find((row) => row.productId !== keeperProductId)?.productId ||
      0;

    await runDuplicateMerge({
      group,
      duplicateProductIds: duplicateProductId ? [duplicateProductId] : [],
      mode: "selected",
    });
  }

  async function endDuplicate(group: DuplicateGroup, duplicateProductId: number) {
    if (showDuplicateActionBlocked("starting another merge or end/archive")) return;

    const keeperProductId = selectedKeeperProductIdForGroup(group);
    const duplicateRow =
      group.rows.find((row) => row.productId === duplicateProductId) || null;
    const duplicateScope = duplicateRowScope(duplicateRow);

    if (!duplicateProductId) {
      showError("Pick a duplicate row to end/archive first.");
      return;
    }

    if (duplicateProductId === keeperProductId) {
      showError("That row is marked as the keeper. Pick a different row to end, or choose another keeper first.");
      return;
    }

    setActiveDuplicateAction({
      groupKey: group.key,
      kind: "end",
      productId: duplicateProductId,
      stage: "previewing",
    });
    showNotice(`Previewing end/archive for duplicate ${duplicateScope}...`);

    try {
      const previewResponse = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end-duplicate",
          duplicateProductId,
          dryRun: true,
          confirm: "END_DUPLICATE",
        }),
      });
      const previewData = await previewResponse.json().catch(() => ({}));

      if (!previewResponse.ok || !previewData.success) {
        throw new Error(previewData.error || "Could not preview duplicate end/archive.");
      }

      const preview = previewData.result || {};

      setActiveDuplicateAction({
        groupKey: group.key,
        kind: "end",
        productId: duplicateProductId,
        stage: "applying",
      });
      showNotice(
        `Ending now: duplicate ${duplicateScope} will move from quantity ${preview.previousQuantity} to archived quantity 0.`,
      );

      const response = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end-duplicate",
          duplicateProductId,
          confirm: "END_DUPLICATE",
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not end/archive duplicate.");
      }

      const result = data.result || {};
      const ebayWarnings = Array.isArray(result.ebayActions)
        ? result.ebayActions
            .filter((action: any) => action && action.ok === false)
            .map((action: any) => action.message)
            .filter(Boolean)
        : [];

      showNotice(
        `${data.message || "Duplicate ended/archived."}${
          ebayWarnings.length ? ` eBay warning: ${ebayWarnings.join(" | ")}` : ""
        }`,
      );
      await loadGroups({ preserveMessages: true, allowDuringAction: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not end/archive duplicate.");
    } finally {
      setActiveDuplicateAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 py-6">
      <section className="rounded-3xl border border-amber-200/80 bg-white/85 p-6 text-amber-950 shadow-sm ring-1 ring-black/[0.02] backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-3xl font-black">Duplicate cleanup queue</h2>
            <p className="mt-2 max-w-4xl text-sm font-bold leading-6">
              This finder only flags exact same-title/same-price active eBay rows.
              Pick the row to keep, pick the duplicate to end/archive, then merge.
              TCOS rolls quantity into the keeper and attempts the matching eBay
              offer cleanup.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadGroups()}
            aria-disabled={loading || Boolean(workingAction)}
            aria-busy={loading}
            className="rounded-full bg-neutral-950 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            {loading ? "Scanning..." : "Rescan Duplicates"}
          </button>
        </div>
      </section>

      {summary ? (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric label="Duplicate Groups" value={String(summary.groups)} />
          <Metric label="Rows To Clean" value={String(totalDuplicateRows)} tone="amber" />
          <Metric
            label="Rows In Groups"
            value={String(summary.totalRowsInGroups)}
            tone="sky"
          />
        </section>
      ) : null}

      {error ? (
        <ActionNotice tone="error">
          {error}
        </ActionNotice>
      ) : null}

      {notice ? (
        <ActionNotice tone={workingAction ? "info" : "success"}>
          {notice}
        </ActionNotice>
      ) : null}

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-3xl border border-neutral-200 bg-white/85 p-10 text-sm font-bold text-neutral-600 shadow-sm ring-1 ring-black/[0.02]">
            Scanning active eBay rows for duplicates...
          </div>
        ) : !hasGroups ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/90 p-10 text-sm font-black text-emerald-900 shadow-sm ring-1 ring-emerald-900/5">
            No exact duplicate groups found right now.
          </div>
        ) : (
          groups.map((group) => {
            const duplicateCleanupBusy = Boolean(workingAction);
            const groupWorking = workingAction?.groupKey === group.key;
            const groupMergingAll =
              groupWorking && workingAction?.kind === "merge" && !workingAction.productId;
            const actionBlockedTitle = duplicateCleanupBusy
              ? "Finish the current duplicate cleanup action before changing this group."
              : "";
            const keeperProductId =
              keepers[group.key] || group.recommendedKeeperProductId || 0;
            const duplicateProductId =
              duplicates[group.key] ||
              group.rows.find((row) => row.productId !== keeperProductId)?.productId ||
              0;
            const keeperRow =
              group.rows.find((row) => row.productId === keeperProductId) || null;
            const duplicateRow =
              group.rows.find((row) => row.productId === duplicateProductId) || null;
            const allDuplicateRows = group.rows.filter(
              (row) => row.productId !== keeperProductId,
            );
            const duplicateQuantity = allDuplicateRows.reduce(
              (sum, row) => sum + Number(row.quantity || 0),
              0,
            );
            const mergedQuantity =
              Number(keeperRow?.quantity || 0) + duplicateQuantity;
            const selectedDuplicateQuantity = Number(duplicateRow?.quantity || 0);
            const selectedMergedQuantity =
              Number(keeperRow?.quantity || 0) + selectedDuplicateQuantity;
            const keeperScope = duplicateRowScope(keeperRow);
            const duplicateScope = duplicateRowScope(duplicateRow);
            const mergeActionTitle =
              keeperRow && allDuplicateRows.length
                ? `Merge ${allDuplicateRows.length} duplicate row${
                    allDuplicateRows.length === 1 ? "" : "s"
                  } totaling quantity ${duplicateQuantity} into keeper ${keeperScope}; keeper becomes quantity ${mergedQuantity}.`
                : "";
            const selectedMergeTitle =
              keeperRow && duplicateRow
                ? `Merge selected duplicate ${duplicateScope} into keeper ${keeperScope}; keeper becomes quantity ${selectedMergedQuantity}. Other duplicate rows stay active.`
                : "";
            const endSelectedTitle = duplicateRow
              ? `End/archive selected duplicate ${duplicateScope}; this leaves keeper ${keeperScope} untouched.`
              : "";
            const mergeUnavailable =
              duplicateCleanupBusy ||
              !keeperProductId ||
              allDuplicateRows.length === 0;
            const selectedMergeUnavailable =
              duplicateCleanupBusy ||
              !keeperProductId ||
              !duplicateProductId ||
              keeperProductId === duplicateProductId;
            const endSelectedUnavailable =
              duplicateCleanupBusy ||
              !duplicateProductId ||
              keeperProductId === duplicateProductId;
            const groupMergingSelected =
              groupWorking &&
              workingAction?.kind === "merge" &&
              workingAction.productId === duplicateProductId;

            return (
              <article
                key={group.key}
                className="rounded-3xl border border-neutral-200 bg-white/90 p-5 shadow-sm ring-1 ring-black/[0.02] backdrop-blur"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.1em] text-amber-700">
                      {group.count} matching listings · {group.totalQuantity} total quantity ·{" "}
                      {money(group.price)}
                    </p>
                    <h3 className="mt-1 text-2xl font-black">{group.title}</h3>
                    <p className="mt-1 text-xs font-bold text-neutral-500">
                      Exact match rule: normalized title + same price.
                    </p>
                    {keeperRow && duplicateRow ? (
                      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.14em]">
                          Duplicate merge plan
                        </p>
                        <p className="mt-2 text-sm font-black leading-6">
                          Merge Selected Only archives the highlighted duplicate.
                          Merge All archives every non-keeper row. The selected
                          duplicate also controls End Selected Only.
                        </p>
                        <div className="mt-3 grid gap-2 text-xs font-black sm:grid-cols-3">
                          <div className="rounded-xl border border-amber-200 bg-white p-3">
                            <p className="uppercase text-amber-700">Keeper</p>
                            <p className="mt-1 text-neutral-950">
                              #{keeperRow.productId} quantity {keeperRow.quantity}
                            </p>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-white p-3">
                            <p className="uppercase text-amber-700">Archive</p>
                            <p className="mt-1 text-neutral-950">
                              {allDuplicateRows.length} row
                              {allDuplicateRows.length === 1 ? "" : "s"} quantity{" "}
                              {duplicateQuantity}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                              Selected duplicate quantity {selectedDuplicateQuantity}
                            </p>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-white p-3">
                            <p className="uppercase text-amber-700">Result</p>
                            <p className="mt-1 text-neutral-950">
                              keeper quantity {mergedQuantity}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500">
                              Selected merge quantity {selectedMergedQuantity}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void mergeSelectedDuplicate(group)}
                      aria-disabled={selectedMergeUnavailable}
                      aria-busy={groupMergingSelected}
                      title={
                        actionBlockedTitle ||
                        (!keeperProductId
                          ? "Choose the listing to keep before merging duplicate quantities."
                          : !duplicateProductId
                            ? "Choose the duplicate row to merge into the keeper first."
                            : keeperProductId === duplicateProductId
                              ? "The selected row is the keeper. Choose a different duplicate before merging it."
                              : selectedMergeTitle)
                      }
                      className={`rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 ${
                        selectedMergeUnavailable
                          ? "cursor-not-allowed bg-neutral-400"
                          : "bg-neutral-950 hover:bg-neutral-800"
                      }`}
                    >
                      {groupMergingSelected
                        ? workingAction?.stage === "previewing"
                          ? "Previewing selected merge..."
                          : "Merging selected..."
                        : keeperRow && duplicateRow
                          ? `Merge Selected → quantity ${selectedMergedQuantity}`
                          : "Merge Selected Only"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void mergeGroup(group)}
                      aria-disabled={mergeUnavailable}
                      aria-busy={groupMergingAll}
                      title={
                        actionBlockedTitle ||
                        (!keeperProductId
                          ? "Choose the listing to keep before merging duplicate quantities."
                          : allDuplicateRows.length === 0
                            ? "This group has no duplicate row different from the keeper."
                        : mergeActionTitle)
                      }
                      className={`rounded-full px-5 py-3 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 ${
                        mergeUnavailable
                          ? "cursor-not-allowed bg-neutral-400"
                          : "bg-rose-700 hover:bg-rose-800"
                      }`}
                    >
                      {groupMergingAll
                        ? workingAction?.stage === "previewing"
                          ? "Previewing merge..."
                          : "Merging..."
                        : keeperRow && allDuplicateRows.length
                          ? `Merge All → quantity ${mergedQuantity}`
                          : "Merge All Duplicates"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void endDuplicate(group, duplicateProductId)}
                      aria-disabled={endSelectedUnavailable}
                      aria-busy={groupWorking && workingAction?.kind === "end"}
                      title={
                        actionBlockedTitle ||
                        (!duplicateProductId
                          ? "Choose the duplicate row to end/archive first."
                          : keeperProductId === duplicateProductId
                            ? "The selected row is the keeper. Choose a different duplicate before ending it."
                            : endSelectedTitle)
                      }
                      className={`rounded-full border px-5 py-3 text-sm font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                        endSelectedUnavailable
                          ? "cursor-not-allowed border-neutral-300 bg-white text-neutral-400"
                          : "border-rose-300 bg-white text-rose-800 hover:bg-rose-50"
                      }`}
                    >
                      {groupWorking && workingAction?.kind === "end"
                        ? workingAction.stage === "previewing"
                          ? "Previewing end..."
                          : "Ending..."
                        : "End Selected Only"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {group.rows.map((row) => {
                    const isKeeper = keeperProductId === row.productId;
                    const isDuplicate = duplicateProductId === row.productId;
                    const rowScope = duplicateRowScope(row);
                    const rowEnding =
                      groupWorking &&
                      workingAction?.kind === "end" &&
                      workingAction.productId === row.productId;
                    const selectDuplicateUnavailable = duplicateCleanupBusy || isKeeper;
                    const endRowUnavailable = duplicateCleanupBusy || isKeeper;

                    return (
                      <div
                        key={row.productId}
                        className={`rounded-2xl border p-4 shadow-sm ${
                          isKeeper
                            ? "border-emerald-300 bg-emerald-50"
                            : isDuplicate
                              ? "border-rose-300 bg-rose-50"
                              : "border-neutral-200 bg-neutral-50"
                        }`}
                      >
                        <div className="flex gap-3">
                          <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
                            <Image
                              src={row.imageUrl || "/placeholder.png"}
                              alt={row.title}
                              fill
                              sizes="80px"
                              unoptimized
                              className="object-cover"
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-black leading-5">
                              {row.title}
                            </p>
                            <p className="mt-1 text-xs font-bold text-neutral-600">
                              SKU {row.sku || "missing"} · eBay{" "}
                              {row.ebayItemId || "missing"}
                            </p>
                            <p className="mt-1 text-xs font-bold text-neutral-600">
                              {money(row.price)} · Quantity {row.quantity} · Inventory{" "}
                              {row.inventoryStatus}
                            </p>
                            <p className="mt-1 text-xs text-neutral-500">
                              Last sync: {shortDate(row.lastSeenAt)}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => chooseKeeper(group, row.productId)}
                            aria-disabled={duplicateCleanupBusy}
                            title={
                              duplicateCleanupBusy
                                ? "Finish the current duplicate cleanup action before changing keepers."
                                : `Keep ${rowScope} as the survivor for this duplicate group.`
                            }
                            className={`rounded-full border px-3 py-2 text-xs font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 ${
                              duplicateCleanupBusy
                                ? "cursor-not-allowed opacity-50"
                                : isKeeper
                                  ? "border-emerald-700 bg-emerald-700 text-white"
                                  : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"
                            }`}
                          >
                            Keep this listing
                          </button>
                          <button
                            type="button"
                            onClick={() => chooseDuplicate(group, row.productId)}
                            aria-disabled={selectDuplicateUnavailable}
                            title={
                              duplicateCleanupBusy
                                ? "Finish the current duplicate cleanup action before changing duplicate rows."
                                : isKeeper
                                  ? "This row is marked as the keeper, so it cannot be selected as the duplicate."
                                  : `Select ${rowScope} as the duplicate to end or merge.`
                            }
                            className={`rounded-full border px-3 py-2 text-xs font-black shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400 ${
                              isDuplicate
                                ? "border-rose-700 bg-rose-700 text-white"
                                : selectDuplicateUnavailable
                                  ? "cursor-not-allowed border-rose-300 bg-white text-rose-900 opacity-40"
                                  : "border-rose-300 bg-white text-rose-900 hover:bg-rose-50"
                            }`}
                          >
                            {isDuplicate ? "Selected for merge/end" : "Select as duplicate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void endDuplicate(group, row.productId)}
                            aria-disabled={endRowUnavailable}
                            aria-busy={rowEnding}
                            title={
                              duplicateCleanupBusy
                                ? "Finish the current duplicate cleanup action before ending another row."
                                : isKeeper
                                  ? "This row is marked as the keeper. Choose another keeper before ending it."
                                  : `Preview and end/archive duplicate ${rowScope}; quantity will become 0 after confirmation.`
                            }
                            className={`rounded-full border px-3 py-2 text-xs font-black text-orange-900 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 ${
                              endRowUnavailable
                                ? "cursor-not-allowed opacity-40"
                                : "border-orange-300 bg-white hover:bg-orange-50"
                            }`}
                          >
                            {rowEnding
                              ? workingAction?.stage === "previewing"
                                ? "Previewing end..."
                                : "Ending..."
                              : "End this row now"}
                          </button>
                          {row.ebayItemId ? (
                            <a
                              href={`https://www.ebay.com/itm/${row.ebayItemId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-xs font-black shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400"
                            >
                              eBay
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function ActionNotice({
  tone,
  children,
}: {
  tone: ActionNoticeTone;
  children: ReactNode;
}) {
  const className =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-sky-200 bg-sky-50 text-sky-900";

  return (
    <section
      aria-live={tone === "info" ? "polite" : "assertive"}
      className={`rounded-2xl border px-4 py-3 text-sm font-black shadow-sm ring-1 ring-black/[0.02] ${className}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber" | "sky";
}) {
  const toneClass =
    tone === "amber"
      ? "border-amber-200 bg-amber-50"
      : tone === "sky"
        ? "border-sky-200 bg-sky-50"
        : "border-neutral-200 bg-white";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ring-1 ring-black/[0.02] ${toneClass}`}>
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
