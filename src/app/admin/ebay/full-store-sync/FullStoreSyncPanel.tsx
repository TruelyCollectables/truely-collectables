"use client";

import { useMemo, useState } from "react";

type SyncAction = {
  itemId: string;
  title: string;
  action: "insert" | "update" | "unchanged" | "deactivate" | "skip" | "error";
  reason: string;
  legacyProductId: number | null;
  remoteQuantity: number | null;
  localQuantity: number | null;
  remotePrice: number | null;
  localPrice: number | null;
  sku: string | null;
  categoryName: string | null;
};

type SyncResult = {
  mode: "preview" | "apply";
  durationMs: number;
  remoteFixedPriceTotal: number;
  pagesRead: number;
  cycleComplete: boolean;
  eligibleSportsCards: number;
  skippedNonCards: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  failed: number;
  localLinkedBefore: number;
  localLinkedAfter: number;
  actions: SyncAction[];
};

function money(value: number | null) {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
}

function tone(action: SyncAction["action"]) {
  if (action === "insert") return "border-blue-200 bg-blue-50 text-blue-950";
  if (action === "update") return "border-amber-200 bg-amber-50 text-amber-950";
  if (action === "unchanged") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (action === "deactivate" || action === "error") {
    return "border-rose-200 bg-rose-50 text-rose-950";
  }
  return "border-neutral-200 bg-neutral-100 text-neutral-700";
}

export default function FullStoreSyncPanel() {
  const [result, setResult] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const [deactivateEnded, setDeactivateEnded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const actions = result?.actions || [];
    return showAll
      ? actions
      : actions.filter((row) => !["unchanged", "skip"].includes(row.action));
  }, [result, showAll]);

  async function run(mode: "preview" | "apply") {
    if (busy) return;
    setBusy(mode);
    setError(null);

    try {
      const response = await fetch("/api/admin/ebay/full-store-sync", {
        method: mode === "preview" ? "GET" : "POST",
        headers:
          mode === "apply" ? { "Content-Type": "application/json" } : undefined,
        body: mode === "apply" ? JSON.stringify({ deactivateEnded }) : undefined,
      });
      const data = await response.json().catch(() => ({}));

      if ((!response.ok && response.status !== 207) || !data?.result) {
        throw new Error(data?.error || "The eBay full-store sync could not run.");
      }

      setResult(data.result as SyncResult);
      if (mode === "preview") setApplyConfirmed(false);
      if (data.result.failed > 0) {
        setError(
          `${data.result.failed} listing${data.result.failed === 1 ? "" : "s"} failed. Review the red rows below.`,
        );
      }
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : "The eBay full-store sync failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  const canApply = Boolean(
    !busy &&
      result?.mode === "preview" &&
      result.cycleComplete &&
      applyConfirmed,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border-2 border-neutral-950 bg-white p-6 shadow-[6px_6px_0_#111318]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
              Safe two-step launch sync
            </p>
            <h2 className="mt-2 text-3xl font-black">
              Preview the full store, then import it
            </h2>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
              Preview reads every active fixed-price eBay page. Apply creates the
              missing sports cards and refreshes title, price, quantity, image,
              SKU, and active status so each card enters the existing storefront
              and checkout flow.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void run("preview")}
              disabled={Boolean(busy)}
              className="border-2 border-neutral-950 bg-white px-5 py-3 text-sm font-black shadow-[3px_3px_0_#111318] disabled:opacity-50"
            >
              {busy === "preview" ? "Reading eBay..." : "Preview Full eBay Store"}
            </button>
            <button
              type="button"
              onClick={() => void run("apply")}
              disabled={!canApply}
              className="border-2 border-neutral-950 bg-blue-700 px-5 py-3 text-sm font-black text-white shadow-[3px_3px_0_#111318] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "apply" ? "Syncing inventory..." : "Apply Full eBay Sync"}
            </button>
          </div>
        </div>

        <label className="mt-5 flex max-w-3xl items-start gap-3 border-2 border-blue-200 bg-blue-50 p-4 text-sm font-bold text-blue-950">
          <input
            type="checkbox"
            checked={applyConfirmed}
            onChange={(event) => setApplyConfirmed(event.target.checked)}
            disabled={!result || result.mode !== "preview" || !result.cycleComplete}
            className="mt-1"
          />
          I reviewed a complete preview and approve importing/updating the
          eligible active eBay sports-card listings shown in the report.
        </label>

        <label className="mt-3 flex max-w-3xl items-start gap-3 border-2 border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-950">
          <input
            type="checkbox"
            checked={deactivateEnded}
            onChange={(event) => setDeactivateEnded(event.target.checked)}
            className="mt-1"
          />
          Also mark local eBay-linked products sold when a complete scan proves
          they are no longer active. Leave this off for the first launch sync.
        </label>

        {error ? (
          <p className="mt-4 border-2 border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-950">
            {error}
          </p>
        ) : null}
      </section>

      {result ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            <Metric label="eBay fixed-price" value={result.remoteFixedPriceTotal} />
            <Metric label="Eligible cards" value={result.eligibleSportsCards} />
            <Metric label="Local before" value={result.localLinkedBefore} />
            <Metric
              label={result.mode === "preview" ? "Missing" : "Inserted"}
              value={result.inserted}
            />
            <Metric
              label={result.mode === "preview" ? "Changes" : "Updated"}
              value={result.updated}
            />
            <Metric label="Failed" value={result.failed} danger={result.failed > 0} />
          </section>

          <section className="rounded-3xl border-2 border-neutral-950 bg-white p-5 shadow-[5px_5px_0_rgba(17,19,24,0.14)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">
                  {result.mode === "preview" ? "Proposed actions" : "Completed actions"}
                </h2>
                <p className="mt-1 text-sm font-semibold text-neutral-600">
                  {result.pagesRead} page{result.pagesRead === 1 ? "" : "s"} ·{" "}
                  {result.cycleComplete ? "complete store cycle" : "partial cycle"} ·{" "}
                  {(result.durationMs / 1000).toFixed(1)} seconds ·{" "}
                  {result.skippedNonCards} skipped/ineligible
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="border-2 border-neutral-950 bg-yellow-300 px-4 py-2 text-xs font-black"
              >
                {showAll ? "Attention only" : "Show all rows"}
              </button>
            </div>

            <div className="mt-5 overflow-x-auto border-2 border-neutral-950">
              <table className="w-full min-w-[1050px] text-left text-sm">
                <thead className="bg-neutral-950 text-xs font-black uppercase tracking-wide text-white">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Listing</th>
                    <th className="px-4 py-3">eBay ID / SKU</th>
                    <th className="px-4 py-3">Quantity</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-neutral-200">
                  {rows.length ? (
                    rows.slice(0, 1000).map((row) => (
                      <tr key={`${row.itemId}-${row.action}`} className="align-top">
                        <td className="px-4 py-4">
                          <span
                            className={`border px-2 py-1 text-[11px] font-black uppercase ${tone(row.action)}`}
                          >
                            {row.action}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <p className="max-w-xl font-black">{row.title}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {row.categoryName || "Category not returned"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p className="font-bold">{row.itemId}</p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {row.sku || "No SKU"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p>eBay: {row.remoteQuantity ?? "—"}</p>
                          <p className="text-xs text-neutral-500">
                            Local: {row.localQuantity ?? "—"}
                          </p>
                        </td>
                        <td className="px-4 py-4">
                          <p>eBay: {money(row.remotePrice)}</p>
                          <p className="text-xs text-neutral-500">
                            Local: {money(row.localPrice)}
                          </p>
                        </td>
                        <td className="px-4 py-4 font-semibold text-neutral-600">
                          {row.reason}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center font-semibold text-neutral-500"
                      >
                        No rows match this view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div
      className={`border-2 border-neutral-950 p-4 shadow-[3px_3px_0_#111318] ${danger ? "bg-rose-50" : "bg-white"}`}
    >
      <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-3xl font-black">{value}</p>
    </div>
  );
}
