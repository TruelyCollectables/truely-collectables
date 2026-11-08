"use client";

import { useState } from "react";

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto rounded-2xl border border-neutral-800 bg-neutral-950 p-4 text-xs leading-5 text-emerald-200">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function LaunchReadySyncClient() {
  const [loading, setLoading] = useState<"preview" | "apply" | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState("");

  async function run(mode: "preview" | "apply") {
    if (loading) return;
    setLoading(mode);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/admin/ebay/launch-ready-sync", {
        method: mode === "preview" ? "GET" : "POST",
        headers: mode === "apply" ? { "Content-Type": "application/json" } : undefined,
        body:
          mode === "apply"
            ? JSON.stringify({ deactivateEnded: true })
            : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      setResult(payload);
      if (!response.ok || payload.success !== true) {
        throw new Error(
          payload.error ||
            "The sync completed with listings that still need attention. Review the report below.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The launch-ready sync failed.",
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-amber-300 bg-amber-50 p-6 text-amber-950 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700">
          Tomorrow launch workflow
        </p>
        <h2 className="mt-2 text-3xl font-black">Launch-Ready eBay Sync</h2>
        <p className="mt-3 max-w-4xl font-semibold leading-7">
          Preview first, then apply. Apply imports every active eBay sports-card listing that passes launch policy, updates prices and quantities, reconciles up to 20 photos, enriches descriptions and Best Offer evidence, stamps Truely Collectables shipping rules, deactivates ended listings, and fails closed when anything is not ready.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void run("preview")}
            disabled={Boolean(loading)}
            className="min-h-12 rounded-2xl border-2 border-neutral-950 bg-white px-5 py-3 font-black disabled:opacity-50"
          >
            {loading === "preview" ? "Checking…" : "Preview eBay Sync"}
          </button>
          <button
            type="button"
            onClick={() => void run("apply")}
            disabled={Boolean(loading)}
            className="min-h-12 rounded-2xl bg-neutral-950 px-5 py-3 font-black text-white disabled:opacity-50"
          >
            {loading === "apply" ? "Syncing and Auditing…" : "Apply Launch-Ready Sync"}
          </button>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-4 font-bold text-red-950">
          {error}
        </section>
      ) : null}

      {result ? (
        <section className="space-y-3 rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-2xl font-black">Sync and Audit Report</h2>
          <p className="text-sm font-semibold text-neutral-600">
            Success means the eBay catalog cycle completed, image reconciliation had no errors, enrichment had no failures, and every imported listing passed the launch-readiness audit.
          </p>
          <JsonBlock value={result} />
        </section>
      ) : null}
    </div>
  );
}
