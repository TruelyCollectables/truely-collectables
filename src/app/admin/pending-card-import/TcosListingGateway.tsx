"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chunkDualMarketplaceItems,
  type DualMarketplaceAction,
} from "@/src/lib/dual-marketplace-workflow";
import { TCOS_MARKETPLACE_CHANNELS } from "@/src/lib/tcos-marketplace-channels";

type ListingRow = {
  inventoryItemId: string;
  legacyProductId: number | null;
  sku: string | null;
  websiteStatus: string;
  ebayStatus: string;
  ebayItemId: string | null;
  websiteTitle: string;
  websiteDescription: string;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  websitePrice: number;
  quantity: number;
  imageUrls: string[];
  frontImageUrl: string | null;
  backImageUrl: string | null;
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  aspects: Record<string, string[]>;
  bestOfferEnabled: boolean;
  readyWebsite: boolean;
  readyEbay: boolean;
  websiteProblems: string[];
  ebayProblems: string[];
  lastError: string | null;
  instaCompStatus: string;
  instaCompVersion: string;
  instaCompScanId: string | null;
  instaCompConfidence: number | null;
  instaCompSuggestedPrice: number | null;
};

type EbayReadiness = {
  ready: boolean;
  connected: boolean;
  missing: string[];
  error: string | null;
};

type Destination = "website" | "website-ebay";

type PendingPublish = {
  action: "publish-both" | "publish-ebay";
  ids: string[];
};

type PendingDelete = {
  ids: string[];
  label: string;
};

type PreviewImage = {
  url: string;
  title: string;
  side: string;
};

type InstaCompProgress = {
  total: number;
  processed: number;
  completed: number;
  failed: number;
  active: string[];
};

const ASPECT_FIELDS = [
  ["Player", "Player / subject"],
  ["Team", "Team"],
  ["Sport", "Sport"],
  ["Year", "Year"],
  ["Brand", "Brand"],
  ["Set", "Set"],
  ["Card Number", "Card number"],
  ["Parallel/Variety", "Parallel / variation"],
] as const;

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

function aspectValue(row: ListingRow, name: string) {
  const key = Object.keys(row.aspects || {}).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? String(row.aspects[key]?.[0] || "") : "";
}

function setAspect(row: ListingRow, name: string, value: string) {
  const aspects = { ...(row.aspects || {}) };
  for (const key of Object.keys(aspects)) {
    if (key.toLowerCase() === name.toLowerCase() && key !== name) delete aspects[key];
  }
  if (value.trim()) aspects[name] = [value.trim()];
  else delete aspects[name];
  return { ...row, aspects };
}

function money(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function canDeleteDraft(row: ListingRow) {
  const blocked = new Set(["active", "publishing", "reconciliation_required"]);
  return (
    !blocked.has(row.websiteStatus) &&
    !blocked.has(row.ebayStatus) &&
    !row.ebayItemId
  );
}

function statusTone(status: string) {
  if (status === "complete") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "error") return "border-red-300 bg-red-50 text-red-900";
  return "border-amber-300 bg-amber-50 text-amber-900";
}

export default function TcosListingGateway() {
  const [rows, setRows] = useState<ListingRow[]>([]);
  const rowsRef = useRef<ListingRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<EbayReadiness | null>(null);
  const [destination, setDestination] = useState<Destination>("website");
  const [pendingPublish, setPendingPublish] = useState<PendingPublish | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const [instaCompProgress, setInstaCompProgress] =
    useState<InstaCompProgress | null>(null);
  const [recentResults, setRecentResults] = useState<
    Array<{ id: string; title: string; status: "complete" | "failed"; message?: string }>
  >([]);

  const working = Boolean(busy);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const loadRows = useCallback(async (selectIds: string[] = []) => {
    setLoading(true);
    try {
      const response = await fetch(
        "/api/admin/card-listing-queue?includeReadiness=1",
        { cache: "no-store", credentials: "same-origin" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load the TCOS listing queue.");
      }
      const incoming = (Array.isArray(data.rows) ? data.rows : []) as ListingRow[];
      const drafts = incoming.filter(
        (row) => row.websiteStatus !== "active" || row.ebayStatus !== "active",
      );
      setRows(drafts);
      setReadiness((data.ebayReadiness || null) as EbayReadiness | null);
      const available = new Set(drafts.map((row) => row.inventoryItemId));
      setSelectedIds((current) =>
        Array.from(new Set([...current, ...selectIds])).filter((id) => available.has(id)),
      );
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load the TCOS listing queue.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadRows(), 0);
    const onDraftsCreated = (event: Event) => {
      const custom = event as CustomEvent<{ inventoryItemIds?: string[] }>;
      void loadRows(custom.detail?.inventoryItemIds || []);
    };
    window.addEventListener("tcos:simple-list-drafts-created", onDraftsCreated);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("tcos:simple-list-drafts-created", onDraftsCreated);
    };
  }, [loadRows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.inventoryItemId)),
    [rows, selectedSet],
  );
  const futureChannels = TCOS_MARKETPLACE_CHANNELS.filter(
    (channel) => channel.phase === "connector_slot",
  );

  function updateRow(id: string, updater: (row: ListingRow) => ListingRow) {
    setRows((current) =>
      current.map((row) => (row.inventoryItemId === id ? updater(row) : row)),
    );
  }

  function updateField<K extends keyof ListingRow>(
    id: string,
    field: K,
    value: ListingRow[K],
  ) {
    updateRow(id, (row) => ({ ...row, [field]: value }));
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  function validate(action: DualMarketplaceAction, targetRows: ListingRow[]) {
    const problems: string[] = [];
    for (const row of targetRows) {
      if (!row.websiteTitle.trim()) problems.push("A listing title is blank.");
      if (row.quantity < 1) {
        problems.push(`${row.websiteTitle}: quantity must be at least 1.`);
      }
      if (
        (action === "publish-website" || action === "publish-both") &&
        row.websitePrice <= 0
      ) {
        problems.push(`${row.websiteTitle}: website price must be positive.`);
      }
      if (
        (action === "publish-ebay" || action === "publish-both") &&
        row.ebayPrice <= 0
      ) {
        problems.push(`${row.ebayTitle}: eBay price must be positive.`);
      }
      if (
        (action === "publish-both" || action === "publish-website") &&
        row.ebayPrice > 0 &&
        row.websitePrice >= row.ebayPrice
      ) {
        problems.push(`${row.websiteTitle}: website price must be lower than eBay price.`);
      }
    }
    return Array.from(new Set(problems));
  }

  async function runListingAction(
    action: DualMarketplaceAction,
    ids = selectedIds,
    confirmed = false,
  ) {
    if (working) return;
    const idSet = new Set(ids);
    const targets = rowsRef.current.filter((row) => idSet.has(row.inventoryItemId));
    if (!targets.length) {
      setError("Select at least one card first.");
      return;
    }
    const includesEbay = action === "publish-ebay" || action === "publish-both";
    if (includesEbay && readiness?.ready !== true) {
      setError(
        readiness?.error ||
          `eBay is not ready: ${(readiness?.missing || []).join(", ") || "setup incomplete"}.`,
      );
      return;
    }
    const problems = validate(action, targets);
    if (problems.length) {
      setError(problems.slice(0, 8).join(" | "));
      return;
    }
    if (includesEbay && !confirmed) {
      setPendingPublish({
        action: action as "publish-both" | "publish-ebay",
        ids,
      });
      setError("");
      return;
    }

    setBusy(action);
    setNotice("");
    setError("");
    setPendingPublish(null);
    const results: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    let completed = 0;

    try {
      for (const chunk of chunkDualMarketplaceItems(targets, action)) {
        setNotice(
          `${action.replaceAll("-", " ")} ${completed + 1}–${Math.min(
            completed + chunk.length,
            targets.length,
          )} of ${targets.length}...`,
        );
        const response = await fetch("/api/admin/dual-marketplace-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action, items: payloadForRows(chunk) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !Array.isArray(data.results) && !Array.isArray(data.errors)) {
          throw new Error(data.error || "Listing action failed.");
        }
        results.push(...(Array.isArray(data.results) ? data.results : []));
        errors.push(...(Array.isArray(data.errors) ? data.errors : []));
        completed += chunk.length;
      }

      setNotice(
        `${results.length} card${results.length === 1 ? "" : "s"} completed${
          errors.length ? `; ${errors.length} need review` : " successfully"
        }.`,
      );
      if (errors.length) {
        setError(
          errors
            .slice(0, 8)
            .map(
              (entry) =>
                `${String(entry.title || entry.inventoryItemId || "Card")}: ${String(
                  entry.error || "failed",
                )}`,
            )
            .join(" | "),
        );
      }
      const successfulIds = new Set(
        results.map((entry) => String(entry.inventoryItemId || "")),
      );
      setSelectedIds((current) =>
        current.filter((id) => !successfulIds.has(id)),
      );
      await loadRows();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Listing action failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function runSelectedDestination() {
    await runListingAction(
      destination === "website-ebay" ? "publish-both" : "publish-website",
    );
  }

  async function runInstaComp(ids = selectedIds) {
    if (working) return;
    const idSet = new Set(ids);
    const targets = rowsRef.current.filter((row) => idSet.has(row.inventoryItemId));
    if (!targets.length) {
      setError("Select at least one card for InstaComp 2.0.");
      return;
    }

    setBusy("instacomp");
    setError("");
    setNotice(`Starting InstaComp 2.0 for ${targets.length} card${targets.length === 1 ? "" : "s"}...`);
    setRecentResults([]);
    setInstaCompProgress({
      total: targets.length,
      processed: 0,
      completed: 0,
      failed: 0,
      active: [],
    });

    let cursor = 0;
    let processed = 0;
    let completed = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const latestResults: Array<{
      id: string;
      title: string;
      status: "complete" | "failed";
      message?: string;
    }> = [];

    async function worker() {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const row = targets[index];
        setInstaCompProgress((current) => ({
          ...(current || {
            total: targets.length,
            processed,
            completed,
            failed,
            active: [],
          }),
          active: Array.from(
            new Set([...(current?.active || []), row.websiteTitle]),
          ).slice(-2),
        }));

        try {
          const response = await fetch("/api/admin/card-listing-queue", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              action: "instacomp",
              inventoryItemId: row.inventoryItemId,
            }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.success) {
            throw new Error(data.error || "InstaComp 2.0 failed.");
          }
          completed += 1;
          latestResults.unshift({
            id: row.inventoryItemId,
            title: String(data.result?.title || row.websiteTitle),
            status: "complete",
            message: data.result?.suggestedPrice
              ? `Suggested ${money(Number(data.result.suggestedPrice))}`
              : "Identity completed",
          });
        } catch (nextError) {
          failed += 1;
          failedIds.push(row.inventoryItemId);
          latestResults.unshift({
            id: row.inventoryItemId,
            title: row.websiteTitle,
            status: "failed",
            message:
              nextError instanceof Error
                ? nextError.message
                : "InstaComp 2.0 failed.",
          });
        } finally {
          processed += 1;
          setRecentResults(latestResults.slice(0, 12));
          setInstaCompProgress((current) => ({
            total: targets.length,
            processed,
            completed,
            failed,
            active: (current?.active || []).filter(
              (title) => title !== row.websiteTitle,
            ),
          }));
        }
      }
    }

    try {
      await Promise.all(
        Array.from({ length: Math.min(2, targets.length) }, () => worker()),
      );
      setNotice(
        `InstaComp 2.0 finished ${processed}/${targets.length}: ${completed} completed, ${failed} failed.`,
      );
      if (failed) {
        setError(`${failed} card${failed === 1 ? "" : "s"} need review. The failed cards remain selected.`);
      }
      setSelectedIds(failedIds);
      await loadRows(failedIds);
    } finally {
      setBusy(null);
    }
  }

  async function deleteDrafts(ids: string[]) {
    if (working || !ids.length) return;
    setBusy("delete");
    setError("");
    setNotice(`Deleting ${ids.length} draft${ids.length === 1 ? "" : "s"}...`);
    setPendingDelete(null);

    try {
      const response = await fetch("/api/admin/card-listing-queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ inventoryItemIds: ids }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok && !Array.isArray(data.results) && !Array.isArray(data.errors)) {
        throw new Error(data.error || "Draft deletion failed.");
      }
      const deletedIds = new Set(
        (Array.isArray(data.results) ? data.results : []).map((entry: any) =>
          String(entry.inventoryItemId || ""),
        ),
      );
      setRows((current) =>
        current.filter((row) => !deletedIds.has(row.inventoryItemId)),
      );
      setSelectedIds((current) => current.filter((id) => !deletedIds.has(id)));
      setNotice(data.message || `${deletedIds.size} drafts deleted.`);
      if (Array.isArray(data.errors) && data.errors.length) {
        setError(
          data.errors
            .slice(0, 8)
            .map(
              (entry: any) =>
                `${entry.inventoryItemId || "Card"}: ${entry.error || "could not be deleted"}`,
            )
            .join(" | "),
        );
      }
      await loadRows();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Draft deletion failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  const instaCompPercent = instaCompProgress?.total
    ? Math.round(
        (instaCompProgress.processed / instaCompProgress.total) * 100,
      )
    : 0;

  return (
    <section
      id="listing-queue"
      className="rounded-3xl border-2 border-neutral-950 bg-white p-4 shadow-[7px_7px_0_#facc15] sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
            Step 2 · InstaComp, review, and distribute
          </p>
          <h2 className="mt-2 text-3xl font-black">TCOS Listing Gateway</h2>
          <p className="mt-2 max-w-4xl font-semibold text-neutral-600">
            View the exact front and back, run InstaComp 2.0, fix or delete bad drafts,
            then send selected inventory to Truely Collectables or Truely Collectables + eBay.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/instacomp/v2"
            className="rounded-xl bg-cyan-700 px-4 py-2 font-black text-white"
          >
            Open InstaComp 2.0 workbench
          </Link>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={working || loading}
            className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black disabled:opacity-40"
          >
            Refresh queue
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border-2 border-cyan-700 bg-cyan-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-800">
              InstaComp 2.0
            </p>
            <h3 className="text-xl font-black">Price and identify the selected cards</h3>
            <p className="mt-1 font-semibold text-cyan-950">
              Uses the stored front and back images. Purchase cost is not sent into market pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runInstaComp()}
            disabled={working || !selectedRows.length}
            className="min-h-12 rounded-xl bg-cyan-800 px-5 py-3 font-black text-white disabled:bg-neutral-400"
          >
            {busy === "instacomp"
              ? `Running InstaComp 2.0 · ${instaCompPercent}%`
              : `Run InstaComp 2.0 on ${selectedRows.length || "selected"}`}
          </button>
        </div>
        {instaCompProgress ? (
          <div className="mt-4" role="status" aria-live="polite">
            <div
              className="h-5 overflow-hidden rounded-full border border-cyan-900 bg-white"
              role="progressbar"
              aria-label="InstaComp 2.0 batch progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={instaCompPercent}
            >
              <div
                className="h-full bg-cyan-700 transition-[width] duration-300"
                style={{ width: `${instaCompPercent}%` }}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-black text-cyan-950">
              <span>{instaCompPercent}%</span>
              <span>{instaCompProgress.processed}/{instaCompProgress.total} processed</span>
              <span>{instaCompProgress.completed} completed</span>
              <span>{instaCompProgress.failed} failed</span>
            </div>
            {instaCompProgress.active.length ? (
              <p className="mt-2 text-sm font-bold text-cyan-950">
                Processing now: {instaCompProgress.active.join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {readiness && !readiness.ready ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-bold text-amber-900">
          Website listing is available. eBay remains selectable but blocked until setup is ready
          {readiness.missing?.length ? `: ${readiness.missing.join(", ")}` : ""}.
        </p>
      ) : null}
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 font-bold text-red-900"
        >
          {error}
        </p>
      ) : null}

      {recentResults.length ? (
        <details className="mt-4 rounded-2xl border border-neutral-300 bg-neutral-50 p-4">
          <summary className="cursor-pointer font-black">Latest InstaComp 2.0 results</summary>
          <div className="mt-3 grid gap-2">
            {recentResults.map((result) => (
              <div
                key={`${result.id}-${result.status}`}
                className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                  result.status === "complete"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-red-300 bg-red-50 text-red-900"
                }`}
              >
                {result.title} · {result.message || result.status}
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-5 rounded-2xl border-2 border-neutral-950 bg-neutral-950 p-4 text-white">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-yellow-300">
          Marketplace destinations
        </p>
        <h3 className="mt-1 text-2xl font-black">Choose where selected inventory goes</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-2xl border-2 p-4 ${
              destination === "website"
                ? "border-yellow-300 bg-yellow-300 text-neutral-950"
                : "border-white/25 bg-white/10"
            }`}
          >
            <input
              type="radio"
              name="destination"
              value="website"
              checked={destination === "website"}
              onChange={() => setDestination("website")}
              className="mr-2"
            />
            <span className="font-black">Truely Collectables only</span>
            <span className="mt-1 block text-sm font-semibold">
              Publish on our website and keep eBay as a draft.
            </span>
          </label>
          <label
            className={`rounded-2xl border-2 p-4 ${
              readiness?.ready === true ? "cursor-pointer" : "cursor-not-allowed opacity-65"
            } ${
              destination === "website-ebay"
                ? "border-yellow-300 bg-yellow-300 text-neutral-950"
                : "border-white/25 bg-white/10"
            }`}
          >
            <input
              type="radio"
              name="destination"
              value="website-ebay"
              checked={destination === "website-ebay"}
              disabled={readiness?.ready !== true}
              onChange={() => setDestination("website-ebay")}
              className="mr-2"
            />
            <span className="font-black">Truely Collectables + eBay</span>
            <span className="mt-1 block text-sm font-semibold">
              Publish one TCOS inventory item to both live channels.
            </span>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {futureChannels.map((channel) => (
            <span
              key={channel.id}
              className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-black text-neutral-300"
              title={channel.description}
            >
              {channel.shortLabel} · connector slot
            </span>
          ))}
        </div>
      </div>

      {pendingPublish ? (
        <div className="mt-4 rounded-2xl border-2 border-red-700 bg-red-50 p-4">
          <h3 className="text-xl font-black text-red-900">Confirm marketplace publishing</h3>
          <p className="mt-2 font-bold text-red-900">
            This will publish {pendingPublish.ids.length} selected card
            {pendingPublish.ids.length === 1 ? "" : "s"} to the website and eBay.
            Real marketplace listings and inventory changes may occur.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                void runListingAction(
                  pendingPublish.action,
                  pendingPublish.ids,
                  true,
                )
              }
              className="rounded-xl bg-red-800 px-5 py-3 font-black text-white"
            >
              Yes, list selected cards
            </button>
            <button
              type="button"
              onClick={() => setPendingPublish(null)}
              className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm draft deletion"
          className="mt-4 rounded-2xl border-2 border-red-800 bg-red-50 p-4"
        >
          <h3 className="text-xl font-black text-red-950">Delete draft inventory?</h3>
          <p className="mt-2 font-bold text-red-900">
            Delete {pendingDelete.label}. This removes the unpublished TCOS inventory
            record and its stored images. Active or marketplace-linked inventory is blocked.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void deleteDrafts(pendingDelete.ids)}
              className="rounded-xl bg-red-800 px-5 py-3 font-black text-white"
            >
              Yes, delete permanently
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="sticky top-4 z-20 mt-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-neutral-950 bg-yellow-300 p-3 shadow-lg">
        <strong>{selectedRows.length} selected of {rows.length}</strong>
        <button
          type="button"
          onClick={() => setSelectedIds(rows.map((row) => row.inventoryItemId))}
          disabled={working || !rows.length}
          className="rounded-xl border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-40"
        >
          Select all
        </button>
        <button
          type="button"
          onClick={() => setSelectedIds([])}
          disabled={working || !selectedIds.length}
          className="rounded-xl border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-40"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void runInstaComp()}
          disabled={working || !selectedRows.length}
          className="rounded-xl bg-cyan-800 px-4 py-2 font-black text-white disabled:bg-neutral-500"
        >
          InstaComp 2.0 selected
        </button>
        <button
          type="button"
          onClick={() => void runListingAction("save")}
          disabled={working || !selectedRows.length}
          className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black disabled:opacity-40"
        >
          Save selected
        </button>
        <button
          type="button"
          onClick={() =>
            setPendingDelete({
              ids: selectedRows.map((row) => row.inventoryItemId),
              label: `${selectedRows.length} selected draft${
                selectedRows.length === 1 ? "" : "s"
              }`,
            })
          }
          disabled={
            working ||
            !selectedRows.length ||
            selectedRows.some((row) => !canDeleteDraft(row))
          }
          className="rounded-xl bg-red-800 px-5 py-3 font-black text-white disabled:bg-neutral-500"
        >
          Delete selected
        </button>
        <button
          type="button"
          onClick={() => void runSelectedDestination()}
          disabled={
            working ||
            !selectedRows.length ||
            (destination === "website-ebay" && readiness?.ready !== true)
          }
          className="rounded-xl bg-neutral-950 px-5 py-3 font-black text-white disabled:bg-neutral-500"
        >
          {destination === "website-ebay"
            ? "List selected on website + eBay"
            : "List selected on website only"}
        </button>
      </div>

      {loading ? <p className="mt-6 font-black">Loading TCOS listing queue...</p> : null}
      {!loading && !rows.length ? (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-neutral-400 p-8 text-center text-lg font-black">
          No card drafts are waiting. Import a card package above.
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        {rows.map((row, index) => {
          const front = row.frontImageUrl || row.imageUrls?.[0] || "";
          const back =
            row.backImageUrl ||
            row.imageUrls?.find((url) => url && url !== front) ||
            "";
          return (
            <article
              key={row.inventoryItemId}
              className={`rounded-2xl border-2 p-4 ${
                selectedSet.has(row.inventoryItemId)
                  ? "border-blue-700 bg-blue-50/40"
                  : "border-neutral-300"
              }`}
            >
              <div className="flex flex-col gap-3 border-b border-neutral-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-3 font-black">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(row.inventoryItemId)}
                    disabled={working}
                    onChange={() => toggleSelected(row.inventoryItemId)}
                    className="h-6 w-6"
                  />
                  Card {index + 1}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusTone(
                      row.instaCompStatus,
                    )}`}
                  >
                    InstaComp 2.0: {row.instaCompStatus.replaceAll("_", " ")}
                  </span>
                  <button
                    type="button"
                    onClick={() => void runInstaComp([row.inventoryItemId])}
                    disabled={working || row.websiteStatus === "active"}
                    className="rounded-xl bg-cyan-800 px-4 py-2 text-sm font-black text-white disabled:bg-neutral-400"
                  >
                    Run InstaComp 2.0
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingDelete({
                        ids: [row.inventoryItemId],
                        label: row.websiteTitle,
                      })
                    }
                    disabled={working || !canDeleteDraft(row)}
                    title={
                      canDeleteDraft(row)
                        ? "Delete this unpublished draft"
                        : "Active or marketplace-linked inventory cannot be deleted here"
                    }
                    className="rounded-xl border-2 border-red-800 bg-white px-4 py-2 text-sm font-black text-red-800 disabled:border-neutral-300 disabled:text-neutral-400"
                  >
                    Delete card
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[330px_1fr]">
                <div>
                  <div className="grid grid-cols-2 gap-3">
                    <CardImage
                      url={front}
                      side="Front"
                      title={row.websiteTitle}
                      onPreview={setPreview}
                    />
                    <CardImage
                      url={back}
                      side="Back"
                      title={row.websiteTitle}
                      onPreview={setPreview}
                    />
                  </div>
                  <p className="mt-2 text-xs font-black uppercase text-neutral-500">
                    Website: {row.websiteStatus} · eBay: {row.ebayStatus}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <Metric label="InstaComp suggested" value={money(row.instaCompSuggestedPrice)} />
                    <Metric
                      label="Identity confidence"
                      value={
                        row.instaCompConfidence
                          ? `${Math.round(row.instaCompConfidence)}%`
                          : "—"
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Listing title" className="sm:col-span-2 lg:col-span-4">
                    <input
                      value={row.websiteTitle}
                      maxLength={200}
                      onChange={(event) =>
                        updateRow(row.inventoryItemId, (current) => ({
                          ...current,
                          websiteTitle: event.target.value,
                          ebayTitle: event.target.value.slice(0, 80),
                        }))
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Description" className="sm:col-span-2 lg:col-span-4">
                    <textarea
                      value={row.websiteDescription}
                      rows={6}
                      onChange={(event) =>
                        updateRow(row.inventoryItemId, (current) => ({
                          ...current,
                          websiteDescription: event.target.value,
                          ebayDescription: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </Field>
                  {ASPECT_FIELDS.map(([name, label]) => (
                    <Field key={name} label={label}>
                      <input
                        value={aspectValue(row, name)}
                        onChange={(event) =>
                          updateRow(row.inventoryItemId, (current) =>
                            setAspect(current, name, event.target.value),
                          )
                        }
                        className="input"
                      />
                    </Field>
                  ))}
                  <Field label="Card condition">
                    <input
                      value={row.cardCondition}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "cardCondition",
                          event.target.value,
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Grader">
                    <input
                      value={row.grader}
                      onChange={(event) =>
                        updateField(row.inventoryItemId, "grader", event.target.value)
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Grade">
                    <input
                      value={row.grade}
                      onChange={(event) =>
                        updateField(row.inventoryItemId, "grade", event.target.value)
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Certification #">
                    <input
                      value={row.certificationNumber}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "certificationNumber",
                          event.target.value,
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Website price">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.websitePrice}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "websitePrice",
                          Math.max(0, Number(event.target.value)),
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="eBay price">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={row.ebayPrice}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "ebayPrice",
                          Math.max(0, Number(event.target.value)),
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="Quantity">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={row.quantity}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "quantity",
                          Math.max(0, Math.floor(Number(event.target.value))),
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <Field label="eBay category">
                    <input
                      value={row.ebayCategoryId}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "ebayCategoryId",
                          event.target.value,
                        )
                      }
                      className="input"
                    />
                  </Field>
                  <label className="flex items-center gap-2 font-black sm:col-span-2 lg:col-span-4">
                    <input
                      type="checkbox"
                      checked={row.bestOfferEnabled}
                      onChange={(event) =>
                        updateField(
                          row.inventoryItemId,
                          "bestOfferEnabled",
                          event.target.checked,
                        )
                      }
                      className="h-5 w-5"
                    />
                    Enable Best Offer on eBay
                  </label>
                  {row.websiteProblems?.length ||
                  row.ebayProblems?.length ||
                  row.lastError ? (
                    <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900 sm:col-span-2 lg:col-span-4">
                      {[
                        ...(row.websiteProblems || []),
                        ...(row.ebayProblems || []),
                        row.lastError,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {preview ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.side} card image preview`}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-blue-700">
                  {preview.side}
                </p>
                <h3 className="font-black">{preview.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black"
              >
                Close
              </button>
            </div>
            <div className="relative mt-4 h-[75vh] overflow-hidden rounded-xl bg-neutral-100">
              <Image
                src={preview.url}
                alt={`${preview.title} ${preview.side}`}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}

      <style jsx>{`
        .input {
          margin-top: 0.25rem;
          width: 100%;
          border: 2px solid #d4d4d4;
          border-radius: 0.65rem;
          padding: 0.7rem 0.8rem;
          background: white;
          font-weight: 650;
        }
        .input:focus {
          border-color: #111318;
          outline: none;
          box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.45);
        }
      `}</style>
    </section>
  );
}

function CardImage({
  url,
  side,
  title,
  onPreview,
}: {
  url: string;
  side: "Front" | "Back";
  title: string;
  onPreview: (image: PreviewImage) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-black uppercase tracking-[0.12em] text-neutral-600">
        {side}
      </p>
      {url ? (
        <button
          type="button"
          onClick={() => onPreview({ url, side, title })}
          className="relative block aspect-[4/5] w-full overflow-hidden rounded-xl border-2 border-neutral-300 bg-neutral-100 transition hover:border-blue-700"
        >
          <Image
            src={url}
            alt={`${title} ${side}`}
            fill
            unoptimized
            className="object-contain"
          />
        </button>
      ) : (
        <div className="flex aspect-[4/5] items-center justify-center rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-3 text-center text-sm font-black text-neutral-500">
          {side} image missing
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </p>
      <p className="mt-1 font-black">{value}</p>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm font-black text-neutral-700 ${className}`}>
      {label}
      {children}
    </label>
  );
}
