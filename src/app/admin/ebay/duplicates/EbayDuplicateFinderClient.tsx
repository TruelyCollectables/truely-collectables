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

export default function EbayDuplicateFinderClient() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const keepersRef = useRef<Record<string, number>>({});
  const [duplicates, setDuplicates] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [workingAction, setWorkingAction] = useState<DuplicateAction>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

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

  async function loadGroups(options?: { preserveMessages?: boolean }) {
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

  async function mergeGroup(group: DuplicateGroup) {
    const keeperProductId = keepers[group.key] || group.recommendedKeeperProductId || 0;
    const duplicateProductIds = group.rows
      .map((row) => row.productId)
      .filter((productId) => productId !== keeperProductId);
    const keeperRow =
      group.rows.find((row) => row.productId === keeperProductId) || null;
    const allDuplicateRows = group.rows.filter(
      (row) => row.productId !== keeperProductId,
    );
    const visibleMergedQuantity =
      Number(keeperRow?.quantity || 0) +
      allDuplicateRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    if (!keeperProductId || duplicateProductIds.length === 0) {
      showError("Pick one keeper with at least one different duplicate row first.");
      return;
    }

    setWorkingAction({ groupKey: group.key, kind: "merge", stage: "previewing" });
    showNotice(
      `Previewing merge for ${duplicateProductIds.length} duplicate row${
        duplicateProductIds.length === 1 ? "" : "s"
      } into keeper #${keeperProductId}...`,
    );

    try {
      const previewResponse = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge-duplicates",
          keeperProductId,
          duplicateProductIds,
          dryRun: true,
          confirm: "MERGE_DUPLICATES",
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
          `Server preview refreshed the merge math: keeper qty ${preview.previousKeeperQuantity} + duplicate qty ${preview.duplicateQuantity} = ${preview.mergedQuantity}.`,
        );
      }

      setWorkingAction({ groupKey: group.key, kind: "merge", stage: "applying" });
      showNotice(
        `Merging now: keeper qty ${preview.previousKeeperQuantity} + duplicate qty ${preview.duplicateQuantity} = ${preview.mergedQuantity}.`,
      );

      const response = await fetch("/api/admin/ebay-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge-duplicates",
          keeperProductId,
          duplicateProductIds,
          confirm: "MERGE_DUPLICATES",
        }),
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
      await loadGroups({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not merge duplicate.");
    } finally {
      setWorkingAction(null);
    }
  }

  async function endDuplicate(group: DuplicateGroup, duplicateProductId: number) {
    const keeperProductId = keepers[group.key] || group.recommendedKeeperProductId || 0;

    if (!duplicateProductId) {
      showError("Pick a duplicate row to end/archive first.");
      return;
    }

    if (duplicateProductId === keeperProductId) {
      showError("That row is marked as the keeper. Pick a different row to end, or choose another keeper first.");
      return;
    }

    setWorkingAction({
      groupKey: group.key,
      kind: "end",
      productId: duplicateProductId,
      stage: "previewing",
    });
    showNotice(`Previewing end/archive for duplicate product #${duplicateProductId}...`);

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

      setWorkingAction({
        groupKey: group.key,
        kind: "end",
        productId: duplicateProductId,
        stage: "applying",
      });
      showNotice(
        `Ending now: product #${duplicateProductId} will move from qty ${preview.previousQuantity} to archived qty 0.`,
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
      await loadGroups({ preserveMessages: true });
    } catch (nextError: any) {
      showError(nextError.message || "Could not end/archive duplicate.");
    } finally {
      setWorkingAction(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
      <section className="rounded-xl border-4 border-amber-300 bg-amber-50 p-5 text-amber-950">
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
            disabled={loading || Boolean(workingAction)}
            aria-busy={loading}
            className="rounded-md bg-neutral-950 px-5 py-3 text-sm font-black text-white hover:bg-neutral-800 disabled:opacity-50"
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
          <div className="rounded-md border border-neutral-200 bg-white p-8 text-sm font-bold text-neutral-600">
            Scanning active eBay rows for duplicates...
          </div>
        ) : !hasGroups ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-8 text-sm font-black text-emerald-900">
            No exact duplicate groups found right now.
          </div>
        ) : (
          groups.map((group) => {
            const groupWorking = workingAction?.groupKey === group.key;
            const groupMerging =
              groupWorking && workingAction?.kind === "merge";
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

            return (
              <article
                key={group.key}
                className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.1em] text-amber-700">
                      {group.count} matching listings · {group.totalQuantity} total qty ·{" "}
                      {money(group.price)}
                    </p>
                    <h3 className="mt-1 text-2xl font-black">{group.title}</h3>
                    <p className="mt-1 text-xs font-bold text-neutral-500">
                      Exact match rule: normalized title + same price.
                    </p>
                    {keeperRow && duplicateRow ? (
                      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-950">
                        Merge-all preview: keep product #{keeperRow.productId} qty{" "}
                        {keeperRow.quantity}, archive {allDuplicateRows.length} duplicate
                        row{allDuplicateRows.length === 1 ? "" : "s"} qty{" "}
                        {duplicateQuantity}, keeper becomes qty {mergedQuantity}.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void mergeGroup(group)}
                      disabled={
                        groupWorking ||
                        !keeperProductId ||
                        allDuplicateRows.length === 0
                      }
                      aria-busy={groupMerging}
                      className="rounded-md bg-rose-700 px-5 py-3 text-sm font-black text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
                    >
                      {groupMerging
                        ? workingAction?.stage === "previewing"
                          ? "Previewing merge..."
                          : "Merging..."
                        : keeperRow && allDuplicateRows.length
                          ? `Merge All → qty ${mergedQuantity}`
                          : "Merge All Duplicates"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void endDuplicate(group, duplicateProductId)}
                      disabled={
                        groupWorking ||
                        !duplicateProductId ||
                        keeperProductId === duplicateProductId
                      }
                      aria-busy={groupWorking && workingAction?.kind === "end"}
                      className="rounded-md border border-rose-300 bg-white px-5 py-3 text-sm font-black text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-neutral-300 disabled:text-neutral-400"
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
                    const rowEnding =
                      groupWorking &&
                      workingAction?.kind === "end" &&
                      workingAction.productId === row.productId;

                    return (
                      <div
                        key={row.productId}
                        className={`rounded-lg border p-4 ${
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
                              {money(row.price)} · Qty {row.quantity} · Inventory{" "}
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
                            className={`rounded-md border px-3 py-2 text-xs font-black ${
                              isKeeper
                                ? "border-emerald-700 bg-emerald-700 text-white"
                                : "border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50"
                            }`}
                          >
                            Keep this listing
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDuplicates((current) => ({
                                ...current,
                                [group.key]: row.productId,
                              }))
                            }
                            disabled={isKeeper}
                            className={`rounded-md border px-3 py-2 text-xs font-black ${
                              isDuplicate
                                ? "border-rose-700 bg-rose-700 text-white"
                                : "border-rose-300 bg-white text-rose-900 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                            }`}
                          >
                            {isDuplicate ? "Selected for merge/end" : "Select as duplicate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void endDuplicate(group, row.productId)}
                            disabled={groupWorking || isKeeper}
                            aria-busy={rowEnding}
                            className="rounded-md border border-orange-300 bg-white px-3 py-2 text-xs font-black text-orange-900 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-40"
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
                              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-black hover:bg-neutral-50"
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
      className={`rounded-md border px-4 py-3 text-sm font-black ${className}`}
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
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <p className="text-xs font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
