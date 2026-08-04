"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  runVerifiedInstaCompPricing,
  runVerifiedInstaCompPricingBatch,
} from "../../../lib/instacomp-verified-pricing-client";
import { getFreshAccountSession } from "../../account/account-session";

type ReadinessItem = {
  inventoryItemId: string;
  title: string;
  receipt: {
    status: "identified" | "review_required";
    registryIdentityId: string | null;
    registryFingerprintSha256: string | null;
    checkedAt: string | null;
    reasons: string[];
    lockedFields: Record<string, unknown>;
  };
  readyForMarketplaceComps: boolean;
  readyForPublish: boolean;
  blockers: string[];
  updatedAt: string | null;
};

type ReadinessPayload = {
  items: ReadinessItem[];
  summary: {
    total: number;
    identified: number;
    reviewRequired: number;
    publishReady: number;
  };
};

type View = "all" | "review" | "publish_ready";

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactHash(value: string | null) {
  if (!value) return "Not issued";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function identityLine(item: ReadinessItem) {
  const fields = item.receipt.lockedFields || {};
  return [
    text(fields.year),
    text(fields.manufacturer),
    text(fields.product) || text(fields.setName),
    text(fields.player),
    text(fields.cardNumber) ? `#${text(fields.cardNumber)}` : null,
    text(fields.parallel),
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function ChecklistReadinessDashboard() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [view, setView] = useState<View>("review");
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) return;
      const response = await fetch("/api/account/seller/instacomp-pending/readiness", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Could not load Registry readiness.");
      setPayload(next as ReadinessPayload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Registry readiness.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const unresolvedIds = useMemo(
    () =>
      (payload?.items || [])
        .filter((item) => !item.readyForMarketplaceComps)
        .map((item) => item.inventoryItemId),
    [payload],
  );

  const visibleItems = useMemo(() => {
    const items = payload?.items || [];
    if (view === "review") return items.filter((item) => !item.readyForMarketplaceComps);
    if (view === "publish_ready") return items.filter((item) => item.readyForPublish);
    return items;
  }, [payload, view]);

  async function refreshAfterRun() {
    await load();
    window.dispatchEvent(new CustomEvent("instacomp:readiness-updated"));
  }

  async function runOne(inventoryItemId: string) {
    if (running || runningId) return;
    setRunningId(inventoryItemId);
    setMessage("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to verify this pending card.");
      const result = await runVerifiedInstaCompPricing({
        inventoryItemId,
        accessToken: session.access_token,
        forceIdentityRescan: true,
      });
      setMessage(
        result.identity?.status === "identified"
          ? "Registry identity locked and marketplace pricing completed."
          : "This card still requires identity review.",
      );
      await refreshAfterRun();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify this pending card.");
    } finally {
      setRunningId(null);
    }
  }

  async function runUnresolved() {
    if (!unresolvedIds.length || running || runningId) return;
    setRunning(true);
    setMessage("");
    setProgress({ completed: 0, total: unresolvedIds.length });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to verify pending cards.");
      const result = await runVerifiedInstaCompPricingBatch({
        inventoryItemIds: unresolvedIds,
        accessToken: session.access_token,
        concurrency: 3,
        onProgress: ({ completed, total }) => setProgress({ completed, total }),
      });
      const passed = result.completed - result.failed;
      setMessage(
        `${passed} card${passed === 1 ? "" : "s"} verified and priced; ${result.failed} remain in review.`,
      );
      await refreshAfterRun();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify pending cards.");
    } finally {
      setRunning(false);
    }
  }

  if (loading && !payload) return null;
  const summary = payload?.summary || {
    total: 0,
    identified: 0,
    reviewRequired: 0,
    publishReady: 0,
  };

  return (
    <aside className="sticky top-0 z-50 border-b-2 border-neutral-900 bg-amber-100 shadow-[0_4px_0_#111]">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex flex-wrap items-center gap-3 text-sm font-black">
          <button type="button" onClick={() => setExpanded((value) => !value)} className="underline">
            Checklist Registry {expanded ? "▲" : "▼"}
          </button>
          <span className="rounded-full border-2 border-neutral-900 bg-white px-3 py-1">
            {summary.identified}/{summary.total} identified
          </span>
          <span className="rounded-full border-2 border-neutral-900 bg-white px-3 py-1">
            {summary.publishReady} publish-ready
          </span>
          <span className="rounded-full border-2 border-neutral-900 bg-white px-3 py-1">
            {summary.reviewRequired} review required
          </span>
          <button
            type="button"
            onClick={() => void runUnresolved()}
            disabled={running || Boolean(runningId) || unresolvedIds.length === 0}
            className="rounded-lg border-2 border-neutral-900 bg-neutral-950 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running
              ? `Verifying ${progress.completed}/${progress.total}`
              : unresolvedIds.length
                ? `Identify + price ${unresolvedIds.length} unresolved`
                : "All identities locked"}
          </button>
          {message ? <span className="font-bold text-neutral-700">{message}</span> : null}
        </div>

        {expanded ? (
          <div className="mt-3 rounded-xl border-2 border-neutral-900 bg-white p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              {(["review", "publish_ready", "all"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={`rounded-lg border-2 border-neutral-900 px-3 py-1 text-xs font-black ${
                    view === option ? "bg-neutral-950 text-white" : "bg-white"
                  }`}
                >
                  {option === "review" ? "Needs review" : option === "publish_ready" ? "Publish ready" : "All cards"}
                </button>
              ))}
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {visibleItems.length ? (
                visibleItems.map((item) => (
                  <article key={item.inventoryItemId} className="rounded-lg border-2 border-neutral-300 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-black">{item.title}</p>
                        <p className="text-xs font-bold text-neutral-600">
                          {identityLine(item) || "Canonical identity not locked"}
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">
                          ID {compactHash(item.receipt.registryIdentityId)} · Fingerprint {compactHash(item.receipt.registryFingerprintSha256)}
                        </p>
                      </div>
                      <span className={`rounded-full border-2 border-neutral-900 px-3 py-1 text-xs font-black ${
                        item.readyForPublish ? "bg-emerald-200" : "bg-rose-200"
                      }`}>
                        {item.readyForPublish ? "Publish ready" : "Blocked"}
                      </span>
                    </div>

                    {item.blockers.length || item.receipt.reasons.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {[...item.blockers, ...item.receipt.reasons].map((blocker) => (
                          <span key={blocker} className="rounded bg-neutral-100 px-2 py-1 text-[11px] font-bold">
                            {label(blocker)}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {!item.readyForMarketplaceComps ? (
                      <button
                        type="button"
                        onClick={() => void runOne(item.inventoryItemId)}
                        disabled={running || Boolean(runningId)}
                        className="mt-3 rounded-lg border-2 border-neutral-900 bg-amber-300 px-3 py-2 text-xs font-black disabled:opacity-40"
                      >
                        {runningId === item.inventoryItemId ? "Rechecking Registry…" : "Re-identify + price"}
                      </button>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="py-4 text-center text-sm font-bold text-neutral-500">No cards in this view.</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}