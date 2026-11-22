"use client";

import Link from "next/link";
import { useState } from "react";

type HeldScan = { id: string; title: string; front: string; back: string };
type Result = { title?: string; error?: string; moved?: boolean; href?: string };

export default function RecoveryHeldScans({ scans }: { scans: HeldScan[] }) {
  const [results, setResults] = useState<Record<string, Result>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function retry(scan: HeldScan) {
    if (busy) return;
    setBusy(scan.id);
    try {
      const response = await fetch("/api/kingmaker/obbfb-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: scan.id }),
      });
      const payload = await response.json().catch(() => ({}));
      const moved = response.ok && payload.success === true && Boolean(payload.inventoryItemId)
        && payload.code !== "DUPLICATE_RECOVERABLE";
      setResults(previous => ({ ...previous, [scan.id]: {
        title: payload.title, moved, href: payload.reviewHref,
        error: moved ? undefined : payload.error || `Retry did not complete (HTTP ${response.status}).`,
      } }));
    } catch {
      setResults(previous => ({ ...previous, [scan.id]: { error: "Retry could not reach Kingmaker. The saved photos are still here." } }));
    } finally {
      setBusy(null);
    }
  }

  if (!scans.length) return null;
  return (
    <section className="mt-6 space-y-3" aria-label="Scans held before inventory">
      <h2 className="text-xl font-bold">{scans.filter(scan => !results[scan.id]?.moved).length} scans waiting for inventory</h2>
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
              <h3 className="font-bold">{result?.title || scan.title}</h3>
              {result?.moved ? (
                <Link href={result.href || "/kingmaker/listings?folder=pending"} className="text-emerald-300">
                  {result.href?.includes("need-to-merge") ? "Open Need to Merge" : "Open Resale Pending"}
                </Link>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => void retry(scan)}
                  className="rounded-lg border border-sky-500 px-3 py-2 font-semibold text-sky-200 disabled:opacity-60">
                  {busy === scan.id ? "Checking identification and sold comps…" : "Retry identification and comps"}
                </button>
              )}
              {result?.error ? <p role="status" className="text-sm text-amber-200">{result.error}</p> : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
