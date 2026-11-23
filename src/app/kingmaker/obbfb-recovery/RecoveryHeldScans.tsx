"use client";

import Link from "next/link";
import { useRef, useState } from "react";

type HeldScan = { id: string; title: string; front: string; back: string };
type Result = { title?: string; error?: string; notes?: string; moved?: boolean; needsMerge?: boolean };

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 600) || undefined : undefined;
}

async function retryScan(scanId: string): Promise<Result> {
  try {
    const response = await fetch("/api/kingmaker/obbfb-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanId }),
    });
    const payload = object(await response.json().catch(() => null));
    const moved = response.ok && payload.success === true && Boolean(displayText(payload.inventoryItemId));
    const error = displayText(payload.error) || displayText(object(payload.error).message) || displayText(payload.detail);
    return {
      title: displayText(payload.title),
      moved,
      needsMerge: payload.code === "NEED_TO_MERGE" || payload.stage === "need_to_merge",
      notes: displayText(object(payload.ai).notes),
      error: moved ? undefined : error || `Retry did not complete (HTTP ${response.status}).`,
    };
  } catch {
    return { error: "Retry could not reach Kingmaker. The saved photos are still here." };
  }
}

export default function RecoveryHeldScans({ scans }: { scans: HeldScan[] }) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const waiting = scans.filter(scan => !results[scan.id]?.moved);
  const selectedScans = waiting.filter(scan => selected.has(scan.id));
  const allSelected = waiting.length > 0 && selectedScans.length === waiting.length;

  function toggle(scanId: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(scanId)) next.delete(scanId);
      else next.add(scanId);
      return next;
    });
  }

  async function retry(queue: HeldScan[]) {
    if (running.current || !queue.length) return;
    running.current = true;
    let moved = 0;
    try {
      for (const [index, scan] of queue.entries()) {
        setWorkingId(scan.id);
        setMessage(`Checking ${index + 1} of ${queue.length}. ${moved} moved to inventory.`);
        const result = await retryScan(scan.id);
        setResults(previous => ({ ...previous, [scan.id]: result }));
        if (result.moved) {
          moved++;
          setSelected(previous => {
            const next = new Set(previous);
            next.delete(scan.id);
            return next;
          });
        }
      }
      setMessage(`Checked ${queue.length}. ${moved} moved to inventory. ${queue.length - moved} still in recovery.`);
    } finally {
      running.current = false;
      setWorkingId(null);
    }
  }

  if (!scans.length) return null;
  return (
    <section className="mt-6 space-y-3" aria-label="Scans held before inventory">
      <h2 className="text-xl font-bold">{waiting.length} scans waiting for inventory</h2>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={workingId !== null || !waiting.length}
          onClick={() => setSelected(new Set(allSelected ? [] : waiting.map(scan => scan.id)))}
          className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-semibold disabled:opacity-60">
          {allSelected ? "Clear selection" : "Select All"}
        </button>
        <button type="button" disabled={workingId !== null || !selectedScans.length}
          onClick={() => void retry(selectedScans)}
          className="rounded-lg bg-sky-500 px-3 py-2 text-sm font-bold text-slate-950 disabled:opacity-60">
          Retry Selected ({selectedScans.length})
        </button>
        <p role="status" className="text-sm text-slate-300">{message}</p>
      </div>
      {scans.map(scan => {
        const result = results[scan.id];
        return (
          <article key={scan.id} className="flex flex-wrap gap-4 rounded-xl border border-slate-700 bg-slate-900 p-4">
            {[scan.front, scan.back].map((src, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={index ? "Saved back" : "Saved front"} loading="lazy"
                className="h-36 w-24 rounded-md bg-slate-950 object-contain" />
            ))}
            <div className="min-w-56 flex-1 space-y-3">
              <h3 className="flex items-center gap-2 font-bold">
                {!result?.moved ? (
                  <input type="checkbox" checked={selected.has(scan.id)} disabled={workingId !== null}
                    aria-label={`Select ${result?.title || scan.title}`} onChange={() => toggle(scan.id)}
                    className="accent-sky-500" />
                ) : null}
                {result?.title || scan.title}
              </h3>
              {result?.moved ? (
                <Link href={result.needsMerge ? "/kingmaker/need-to-merge" : "/kingmaker/listings?folder=pending"}
                  prefetch={false} className="text-emerald-300">
                  {result.needsMerge ? "Open Need to Merge" : "Open Resale Pending"}
                </Link>
              ) : (
                <button type="button" disabled={workingId !== null} onClick={() => void retry([scan])}
                  className="rounded-lg border border-sky-500 px-3 py-2 font-semibold text-sky-200 disabled:opacity-60">
                  {workingId === scan.id ? "Checking identification and sold comps…" : "Retry identification and comps"}
                </button>
              )}
              {result?.notes && !result.moved ? <p className="text-sm text-slate-300">{result.notes}</p> : null}
              {result?.error ? <p role="status" className="text-sm text-amber-200">{result.error}</p> : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
