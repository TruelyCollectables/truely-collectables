"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { runVerifiedInstaCompPricingBatch } from "../../../lib/instacomp-verified-pricing-client";
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
  };
  readyForMarketplaceComps: boolean;
  readyForPublish: boolean;
  blockers: string[];
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

export default function ChecklistReadinessDashboard() {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [message, setMessage] = useState("");

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

  async function runUnresolved() {
    if (!unresolvedIds.length || running) return;
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
      await load();
      window.dispatchEvent(new CustomEvent("instacomp:readiness-updated"));
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
    <aside className="sticky top-0 z-50 border-b-2 border-neutral-900 bg-amber-100 px-4 py-3 shadow-[0_4px_0_#111]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 text-sm font-black">
        <span>Checklist Registry</span>
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
          disabled={running || unresolvedIds.length === 0}
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
    </aside>
  );
}
