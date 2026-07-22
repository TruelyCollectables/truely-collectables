"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

type ImportBatchResult = {
  success: boolean;
  imported?: number;
  markedSold?: number;
  skipped?: number;
  policyAllowed?: number;
  policyNeedsReview?: number;
  policyBlocked?: number;
  offset?: number;
  limit?: number;
  received?: number;
  nextOffset?: number | null;
  runId?: string;
  debugSamples?: Array<Record<string, unknown>>;
  error?: string;
};

type Totals = {
  batches: number;
  received: number;
  imported: number;
  markedSold: number;
  skipped: number;
  policyAllowed: number;
  policyNeedsReview: number;
  policyBlocked: number;
};

const EMPTY_TOTALS: Totals = {
  batches: 0,
  received: 0,
  imported: 0,
  markedSold: 0,
  skipped: 0,
  policyAllowed: 0,
  policyNeedsReview: 0,
  policyBlocked: 0,
};

function addTotals(totals: Totals, result: ImportBatchResult): Totals {
  return {
    batches: totals.batches + 1,
    received: totals.received + Number(result.received || 0),
    imported: totals.imported + Number(result.imported || 0),
    markedSold: totals.markedSold + Number(result.markedSold || 0),
    skipped: totals.skipped + Number(result.skipped || 0),
    policyAllowed: totals.policyAllowed + Number(result.policyAllowed || 0),
    policyNeedsReview:
      totals.policyNeedsReview + Number(result.policyNeedsReview || 0),
    policyBlocked: totals.policyBlocked + Number(result.policyBlocked || 0),
  };
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function EbayImportRunner() {
  const stopRequestedRef = useRef(false);
  const importRunningRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Ready.");
  const [runId, setRunId] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(25);
  const [maxBatches, setMaxBatches] = useState(80);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [lastResult, setLastResult] = useState<ImportBatchResult | null>(null);
  const [error, setError] = useState("");

  const canContinue = useMemo(
    () => lastResult?.nextOffset !== null && lastResult?.nextOffset !== undefined,
    [lastResult],
  );

  async function runImport(startOffset: number) {
    if (importRunningRef.current || busy) {
      setStatus("An eBay import is already running. Wait for the current batch to finish or request a stop.");
      return;
    }

    if (startOffset !== 0 && !canContinue) {
      setStatus("No resumable eBay import cursor is available yet. Start from 0 or finish a batch first.");
      return;
    }

    const nextRunId = runId || new Date().toISOString();
    let nextOffset: number | null = startOffset;
    let batches = 0;
    let nextTotals = startOffset === 0 ? EMPTY_TOTALS : totals;

    importRunningRef.current = true;
    stopRequestedRef.current = false;
    setBusy(true);
    setError("");
    setRunId(nextRunId);
    setStatus(`Starting eBay import at offset ${startOffset}...`);
    if (startOffset === 0) {
      setTotals(EMPTY_TOTALS);
      setLastResult(null);
    }

    try {
      while (
        nextOffset !== null &&
        batches < maxBatches &&
        !stopRequestedRef.current
      ) {
        setStatus(
          `Importing batch ${batches + 1} — offset ${nextOffset}, limit ${limit}...`,
        );

        const params = new URLSearchParams({
          offset: String(nextOffset),
          limit: String(limit),
          runId: nextRunId,
        });
        const response = await fetch(`/api/ebay/import-listings?${params}`);
        const data = (await response.json().catch(() => ({
          success: false,
          error: `Import route returned ${response.status}.`,
        }))) as ImportBatchResult;

        setLastResult(data);

        if (!response.ok || data.success === false) {
          throw new Error(data.error || `Import failed at offset ${nextOffset}.`);
        }

        nextTotals = addTotals(nextTotals, data);
        setTotals(nextTotals);
        setOffset(Number(data.nextOffset ?? nextOffset));
        batches += 1;

        if (data.debugSamples?.length) {
          const failedSample = data.debugSamples.find((sample) =>
            String(sample.reason || "").includes("failed"),
          );
          if (failedSample) {
            setError(
              `Batch completed but reported ${String(failedSample.reason)}. See diagnostic sample below.`,
            );
          }
        }

        if (data.nextOffset === null || Number(data.received || 0) < limit) {
          nextOffset = null;
        } else if (Number(data.nextOffset) <= nextOffset) {
          throw new Error("eBay import cursor did not advance. Stopped to avoid a loop.");
        } else {
          nextOffset = Number(data.nextOffset);
        }
      }

      if (stopRequestedRef.current) {
        setStatus("Stopped by operator. You can resume from the current offset.");
      } else if (nextOffset === null) {
        setStatus("Import complete. Open TCOS inventory and verify the rows.");
      } else {
        setStatus(
          `Paused after ${batches} batch(es). Raise max batches or click resume to continue from offset ${nextOffset}.`,
        );
      }
    } catch (caught: any) {
      setError(caught.message || "eBay import failed.");
      setStatus("Import stopped with an error.");
    } finally {
      importRunningRef.current = false;
      setBusy(false);
    }
  }

  function stopImport() {
    if (!importRunningRef.current && !busy) {
      setStatus("No eBay import is running right now.");
      return;
    }

    stopRequestedRef.current = true;
    setStatus("Stop requested. Finishing current batch...");
  }

  return (
    <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-950 shadow-sm ring-1 ring-emerald-950/5">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-emerald-700">
            eBay import runner
          </p>
          <h2 className="mt-2 text-4xl font-black tracking-tight">
            Import eBay safely in resumable batches
          </h2>
          <p className="mt-2 max-w-4xl text-sm font-bold leading-6 text-emerald-900">
            This runs eBay in browser-driven batches, shows real progress, and
            stops with a clear diagnostic if the database blocks a row.
          </p>
        </div>

        <div className="flex min-w-[280px] flex-col gap-2">
          <button
            type="button"
            onClick={() => void runImport(0)}
            aria-disabled={busy}
            aria-busy={busy}
            className="rounded-xl bg-neutral-950 px-6 py-4 text-center text-base font-black uppercase tracking-[0.08em] text-white hover:bg-neutral-800 aria-disabled:cursor-wait aria-disabled:bg-neutral-500"
          >
            {busy ? "Import running..." : "Start import from 0"}
          </button>
          <button
            type="button"
            onClick={() => void runImport(offset)}
            aria-disabled={busy || !canContinue}
            aria-busy={busy}
            className="rounded-xl border border-emerald-300 bg-white px-6 py-3 text-center text-sm font-black text-emerald-950 hover:bg-emerald-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            Resume from offset {offset}
          </button>
          <button
            type="button"
            onClick={stopImport}
            aria-disabled={!busy}
            className="rounded-xl border border-rose-300 bg-white px-6 py-3 text-center text-sm font-black text-rose-800 hover:bg-rose-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          >
            Stop after current batch
          </button>
          <Link
            href="/admin/inventory"
            className="rounded-xl border border-emerald-300 bg-white px-6 py-3 text-center text-sm font-black text-emerald-950 hover:bg-emerald-100"
          >
            Open TCOS inventory
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <label className="text-sm font-black">
          Batch size
          <select
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded border border-emerald-300 bg-white px-3 py-2"
          >
            {[10, 25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value} listings
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-black">
          Max batches this run
          <input
            type="number"
            min="1"
            max="250"
            value={maxBatches}
            onChange={(event) => setMaxBatches(Number(event.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded border border-emerald-300 bg-white px-3 py-2"
          />
        </label>
        <label className="text-sm font-black">
          Current offset
          <input
            type="number"
            min="0"
            value={offset}
            onChange={(event) => setOffset(Number(event.target.value))}
            disabled={busy}
            className="mt-1 w-full rounded border border-emerald-300 bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="mt-5 rounded-xl border border-emerald-200 bg-white p-4">
        <p className="text-sm font-black text-neutral-950">{status}</p>
        {runId ? (
          <p className="mt-1 text-xs font-bold text-neutral-600">Run ID: {runId}</p>
        ) : null}
        {error ? (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-800">
            {error}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Batches" value={numberLabel(totals.batches)} />
        <Metric label="Received" value={numberLabel(totals.received)} />
        <Metric label="Imported" value={numberLabel(totals.imported)} />
        <Metric label="Marked Sold" value={numberLabel(totals.markedSold)} />
        <Metric label="Skipped" value={numberLabel(totals.skipped)} />
        <Metric label="Allowed" value={numberLabel(totals.policyAllowed)} />
        <Metric label="Review" value={numberLabel(totals.policyNeedsReview)} />
        <Metric label="Blocked" value={numberLabel(totals.policyBlocked)} />
      </div>

      {lastResult ? (
        <details className="mt-5 rounded-xl border border-neutral-200 bg-neutral-950 p-4 text-white">
          <summary className="cursor-pointer text-sm font-black">
            Last batch diagnostics receipt
          </summary>
          <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap text-xs leading-5">
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-emerald-200 bg-white p-3">
      <p className="text-[11px] font-black uppercase text-emerald-700">{label}</p>
      <p className="mt-1 text-2xl font-black text-neutral-950">{value}</p>
    </div>
  );
}
