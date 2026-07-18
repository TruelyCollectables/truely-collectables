"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";

type BulkCandidate = {
  id: string;
  player: string;
  ready: boolean;
  missing: string[];
};

type PortalTarget = BulkCandidate & {
  element: HTMLDivElement;
};

type BulkApiResult = {
  requested: number;
  approved: number;
  rejected: number;
  skipped: number;
  errors: Array<{ candidateId: string; message: string }>;
};

type BulkProgress = {
  processed: number;
  total: number;
  approved: number;
  rejected: number;
  skipped: number;
};

type EnrichmentApiResult = {
  requested: number;
  attempted: number;
  recovered: number;
  titleRecovered: number;
  aspectRecovered: number;
  quantityUpdated: number;
  unresolved: number;
  skipped: number;
  errors: Array<{ candidateId: string; message: string }>;
};

type EnrichmentProgress = {
  processed: number;
  total: number;
  recovered: number;
  unresolved: number;
  errors: number;
};

const BULK_CHUNK_SIZE = 3;
const ENRICHMENT_CHUNK_SIZE = 5;

export default function BulkCandidateControls({
  candidates,
}: {
  candidates: BulkCandidate[];
}) {
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<PortalTarget[]>([]);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [enrichmentBusy, setEnrichmentBusy] = useState(false);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [progress, setProgress] = useState<BulkProgress>({
    processed: 0,
    total: 0,
    approved: 0,
    rejected: 0,
    skipped: 0,
  });
  const [enrichmentProgress, setEnrichmentProgress] =
    useState<EnrichmentProgress>({
      processed: 0,
      total: 0,
      recovered: 0,
      unresolved: 0,
      errors: 0,
    });
  const candidateKey = useMemo(
    () => candidates.map((candidate) => candidate.id).join("|"),
    [candidates],
  );
  const busy = bulkBusy || enrichmentBusy;
  const busyReason = enrichmentBusy
    ? "Card-number recovery is already running."
    : bulkBusy
      ? "Bulk discovery review is already running."
      : "";

  function showBusyBlocked(action: string) {
    if (!busyReason) return false;

    setBulkError(`${busyReason} Finish it before ${action}.`);
    return true;
  }

  useEffect(() => {
    const approvedHeading = Array.from(document.querySelectorAll("h2")).find(
      (heading) => heading.textContent?.trim() === "Recently Approved",
    );
    const approvedSection = approvedHeading?.closest("section");
    if (approvedSection instanceof HTMLElement) {
      approvedSection.style.display = "none";
    }

    const nextTargets: PortalTarget[] = [];
    for (const candidate of candidates) {
      const article = document.getElementById(`candidate-${candidate.id}`);
      if (!(article instanceof HTMLElement)) continue;

      let target = article.querySelector<HTMLDivElement>(
        `[data-bulk-target="${candidate.id}"]`,
      );
      if (!target) {
        target = document.createElement("div");
        target.dataset.bulkTarget = candidate.id;
        article.prepend(target);
      }
      nextTargets.push({ ...candidate, element: target });
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTargets(nextTargets);
    });

    return () => {
      cancelled = true;
    };
  }, [candidateKey, candidates]);

  const selectedCount = selected.size;
  const selectedCandidates = candidates.filter((candidate) =>
    selected.has(candidate.id),
  );
  const selectedReady = selectedCandidates.filter((candidate) => candidate.ready)
    .length;
  const selectedIncomplete = selectedCount - selectedReady;
  const allSelected =
    candidates.length > 0 && selectedCount === candidates.length;
  const readyCandidates = candidates.filter((candidate) => candidate.ready);
  const missingCardNumberCandidates = candidates.filter((candidate) =>
    candidate.missing.includes("exact card number"),
  );

  function toggleCandidate(id: string) {
    if (showBusyBlocked("changing selected candidates")) return;
    setRejectConfirmOpen(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (showBusyBlocked("selecting all candidates")) return;
    setSelected(new Set(candidates.map((candidate) => candidate.id)));
    setRejectConfirmOpen(false);
  }

  function selectReady() {
    if (showBusyBlocked("selecting ready candidates")) return;
    if (readyCandidates.length === 0) {
      setBulkError("No candidates are approval-ready yet.");
      return;
    }

    setSelected(new Set(readyCandidates.map((candidate) => candidate.id)));
    setRejectConfirmOpen(false);
  }

  function clearSelected() {
    if (showBusyBlocked("clearing selected candidates")) return;
    setSelected(new Set());
    setRejectConfirmOpen(false);
  }

  function cancelRejectConfirmation() {
    if (showBusyBlocked("canceling reject confirmation")) return;
    setRejectConfirmOpen(false);
  }

  function rejectSelected() {
    if (showBusyBlocked("rejecting selected candidates")) return;

    if (selectedCount === 0) {
      setBulkError("Select at least one candidate before rejecting.");
      return;
    }

    if (rejectConfirmOpen) {
      void processSelected("reject");
      return;
    }

    setRejectConfirmOpen(true);
    setBulkError(null);
  }

  const handoff = searchParams.get("admin_handoff");
  const actionUrl = handoff
    ? `/api/admin/market-intel/discovery/bulk?admin_handoff=${encodeURIComponent(handoff)}`
    : "/api/admin/market-intel/discovery/bulk";
  const enrichmentUrl = handoff
    ? `/api/admin/market-intel/discovery/enrich-card-numbers?admin_handoff=${encodeURIComponent(handoff)}`
    : "/api/admin/market-intel/discovery/enrich-card-numbers";

  async function processSelected(action: "approve" | "reject") {
    if (showBusyBlocked(`${action === "approve" ? "approving" : "rejecting"} selected candidates`)) {
      return;
    }

    if (selectedCount === 0) {
      setBulkError("Select at least one discovery candidate first.");
      return;
    }

    if (action === "approve" && selectedReady === 0) {
      setBulkError(
        "No selected candidates are approval-ready. Select ready rows or fix the missing review fields first.",
      );
      return;
    }

    const ids = Array.from(selected);
    let approved = 0;
    let rejected = 0;
    let skipped = 0;
    let processed = 0;
    let firstError = "";

    setBulkBusy(true);
    setBulkError(null);
    setEnrichmentError(null);
    setRejectConfirmOpen(false);
    setProgress({
      processed: 0,
      total: ids.length,
      approved: 0,
      rejected: 0,
      skipped: 0,
    });

    try {
      for (let index = 0; index < ids.length; index += BULK_CHUNK_SIZE) {
        const chunk = ids.slice(index, index + BULK_CHUNK_SIZE);
        const formData = new FormData();
        formData.set("action", action);
        if (action === "reject") {
          formData.set("reason", "Bulk rejected during Discovery Desk review.");
        }
        chunk.forEach((candidateId) => formData.append("candidateIds", candidateId));

        const response = await fetch(actionUrl, {
          method: "POST",
          body: formData,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });

        const payload = (await response.json().catch(() => null)) as
          | { success: true; result: BulkApiResult }
          | { success: false; error: string }
          | null;

        if (!response.ok || !payload || payload.success !== true) {
          const message =
            payload && "error" in payload
              ? payload.error
              : `Bulk ${action} chunk failed with HTTP ${response.status}.`;
          firstError ||= message;
          skipped += ids.length - processed;
          setBulkError(message);
          setProgress({
            processed,
            total: ids.length,
            approved,
            rejected,
            skipped,
          });
          break;
        }

        approved += payload.result.approved;
        rejected += payload.result.rejected;
        skipped += payload.result.skipped;
        processed += chunk.length;
        firstError ||= payload.result.errors[0]?.message || "";
        setProgress({
          processed,
          total: ids.length,
          approved,
          rejected,
          skipped,
        });
      }

      const params = new URLSearchParams({
        bulk: "1",
        requested: String(ids.length),
        approved: String(approved),
        rejected: String(rejected),
        skipped: String(skipped),
        processed: String(processed),
      });
      if (firstError) params.set("firstError", firstError.slice(0, 220));
      if (handoff) params.set("admin_handoff", handoff);
      window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Unable to bulk ${action} candidates.`;
      setBulkError(message);
      setBulkBusy(false);
    }
  }

  async function recoverMissingCardNumbers() {
    if (showBusyBlocked("recovering missing card numbers")) return;

    if (missingCardNumberCandidates.length === 0) {
      setEnrichmentError("No discovery candidates are missing exact card numbers.");
      return;
    }

    const ids = missingCardNumberCandidates.map((candidate) => candidate.id);
    let processed = 0;
    let recovered = 0;
    let unresolved = 0;
    let errors = 0;
    let firstError = "";

    setEnrichmentBusy(true);
    setEnrichmentError(null);
    setBulkError(null);
    setRejectConfirmOpen(false);
    setEnrichmentProgress({
      processed: 0,
      total: ids.length,
      recovered: 0,
      unresolved: 0,
      errors: 0,
    });

    try {
      for (let index = 0; index < ids.length; index += ENRICHMENT_CHUNK_SIZE) {
        const chunk = ids.slice(index, index + ENRICHMENT_CHUNK_SIZE);
        const response = await fetch(enrichmentUrl, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({ candidateIds: chunk }),
        });
        const payload = (await response.json().catch(() => null)) as
          | { success: true; result: EnrichmentApiResult }
          | { success: false; error: string }
          | null;

        if (!response.ok || !payload || payload.success !== true) {
          const message =
            payload && "error" in payload
              ? payload.error
              : `Card-number recovery failed with HTTP ${response.status}.`;
          firstError ||= message;
          errors += chunk.length;
          setEnrichmentError(message);
          break;
        }

        processed += chunk.length;
        recovered += payload.result.recovered;
        unresolved += payload.result.unresolved;
        errors += payload.result.errors.length;
        firstError ||= payload.result.errors[0]?.message || "";
        setEnrichmentProgress({
          processed,
          total: ids.length,
          recovered,
          unresolved,
          errors,
        });
      }

      const params = new URLSearchParams({
        enriched: "1",
        requested: String(ids.length),
        processed: String(processed),
        recovered: String(recovered),
        unresolved: String(unresolved),
        enrichmentErrors: String(errors),
      });
      if (firstError) params.set("enrichmentError", firstError.slice(0, 220));
      if (handoff) params.set("admin_handoff", handoff);
      window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to recover card numbers.";
      setEnrichmentError(message);
      setEnrichmentBusy(false);
    }
  }

  const bulkResult = searchParams.get("bulk") === "1";
  const approved = Number(searchParams.get("approved") || 0);
  const rejected = Number(searchParams.get("rejected") || 0);
  const skipped = Number(searchParams.get("skipped") || 0);
  const processed = Number(searchParams.get("processed") || 0);
  const requested = Number(searchParams.get("requested") || 0);
  const firstError = searchParams.get("firstError");
  const bulkFailed =
    bulkResult && approved === 0 && rejected === 0 && skipped > 0;

  const enrichmentResult = searchParams.get("enriched") === "1";
  const enrichmentRecovered = Number(searchParams.get("recovered") || 0);
  const enrichmentUnresolved = Number(searchParams.get("unresolved") || 0);
  const enrichmentErrors = Number(searchParams.get("enrichmentErrors") || 0);
  const enrichmentRequested = Number(searchParams.get("requested") || 0);
  const enrichmentProcessed = Number(searchParams.get("processed") || 0);
  const enrichmentFirstError = searchParams.get("enrichmentError");

  return (
    <>
      {targets.map((target) =>
        createPortal(
          <label className="flex cursor-pointer items-start gap-3 border-b border-neutral-200 bg-[#fffbea] px-5 py-3">
            <input
              type="checkbox"
              checked={selected.has(target.id)}
              onChange={() => toggleCandidate(target.id)}
              disabled={busy}
              className="mt-0.5 h-5 w-5 accent-black disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={`Select ${target.player}`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-black">Select this candidate</span>
              <span
                className={
                  target.ready
                    ? "block text-xs font-bold text-emerald-800"
                    : "block text-xs font-bold text-amber-800"
                }
              >
                {target.ready
                  ? "Bulk approval ready"
                  : `Needs review: ${target.missing.join(", ")}`}
              </span>
            </span>
          </label>,
          target.element,
          `bulk-select-${target.id}`,
        ),
      )}

      {bulkResult ? (
        <div
          role={bulkFailed ? "alert" : "status"}
          aria-live={bulkFailed ? "assertive" : "polite"}
          className={
            bulkFailed
              ? "fixed right-5 top-5 z-[70] max-w-md rounded-xl border border-rose-400 bg-rose-50 p-4 text-rose-950 shadow-2xl"
              : "fixed right-5 top-5 z-[70] max-w-md rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 shadow-2xl"
          }
        >
          <p className="font-black">
            {bulkFailed ? "Bulk review failed" : "Bulk review complete"}
          </p>
          <p className="mt-1 text-sm font-bold">
            Approved {approved} · Rejected {rejected} · Skipped {skipped}
          </p>
          {requested > 0 ? (
            <p className="mt-1 text-xs font-semibold">
              Processed {processed || requested} of {requested} selected candidates.
            </p>
          ) : null}
          {firstError ? (
            <p
              className={
                bulkFailed
                  ? "mt-2 text-xs font-semibold text-rose-900"
                  : "mt-2 text-xs font-semibold text-amber-900"
              }
            >
              {bulkFailed ? "Failure reason" : "First skipped reason"}: {firstError}
            </p>
          ) : null}
        </div>
      ) : null}

      {enrichmentResult ? (
        <div
          role={enrichmentErrors > 0 ? "alert" : "status"}
          aria-live={enrichmentErrors > 0 ? "assertive" : "polite"}
          className="fixed right-5 top-5 z-[71] max-w-md rounded-xl border border-cyan-400 bg-cyan-50 p-4 text-cyan-950 shadow-2xl"
        >
          <p className="font-black">Card-number recovery complete</p>
          <p className="mt-1 text-sm font-bold">
            Recovered {enrichmentRecovered} · Still unresolved {enrichmentUnresolved} · Errors {enrichmentErrors}
          </p>
          <p className="mt-1 text-xs font-semibold">
            Processed {enrichmentProcessed || enrichmentRequested} of {enrichmentRequested} candidates.
          </p>
          {enrichmentFirstError ? (
            <p className="mt-2 text-xs font-semibold text-amber-900">
              First error: {enrichmentFirstError}
            </p>
          ) : null}
        </div>
      ) : null}

      {candidates.length > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-5xl rounded-xl border border-neutral-700 bg-[#101418] p-4 text-white shadow-2xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">
                Bulk Discovery Review
              </p>
              <p className="mt-1 font-black">
                {selectedCount} selected · {selectedReady} approval-ready
                {selectedIncomplete > 0
                  ? ` · ${selectedIncomplete} incomplete will be skipped`
                  : ""}
              </p>
              {missingCardNumberCandidates.length > 0 && !busy ? (
                <p className="mt-1 text-xs font-bold text-amber-300">
                  {missingCardNumberCandidates.length} candidate
                  {missingCardNumberCandidates.length === 1 ? " is" : "s are"} missing an exact card number.
                </p>
              ) : null}
              {bulkBusy ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-2 text-sm font-black text-amber-300"
                >
                  Processing {progress.processed} of {progress.total} · Approved {progress.approved} · Rejected {progress.rejected} · Skipped {progress.skipped}
                </p>
              ) : null}
              {enrichmentBusy ? (
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-2 text-sm font-black text-cyan-300"
                >
                  Recovering card numbers {enrichmentProgress.processed} of {enrichmentProgress.total} · Found {enrichmentProgress.recovered} · Unresolved {enrichmentProgress.unresolved} · Errors {enrichmentProgress.errors}
                </p>
              ) : null}
              {bulkError ? (
                <p
                  role="alert"
                  aria-live="assertive"
                  className="mt-2 rounded-md border border-rose-400 bg-rose-950 px-3 py-2 text-sm font-bold text-rose-100"
                >
                  {bulkError}
                </p>
              ) : null}
              {enrichmentError ? (
                <p
                  role="alert"
                  aria-live="assertive"
                  className="mt-2 rounded-md border border-rose-400 bg-rose-950 px-3 py-2 text-sm font-bold text-rose-100"
                >
                  {enrichmentError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={allSelected ? clearSelected : selectAll}
                aria-disabled={busy}
                title={busyReason || (allSelected ? "Clear selected candidates." : "Select every visible discovery candidate.")}
                aria-busy={busy}
                className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              >
                {allSelected ? "Clear All" : "Select All"}
              </button>
              <button
                type="button"
                onClick={selectReady}
                aria-disabled={busy || readyCandidates.length === 0}
                title={
                  busyReason ||
                  (readyCandidates.length === 0
                    ? "No candidates are approval-ready yet."
                    : "Select only candidates that have all approval fields.")
                }
                aria-busy={busy}
                className="rounded-md border border-cyan-500 bg-cyan-950 px-3 py-2 text-sm font-black text-cyan-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              >
                Select Ready Only ({readyCandidates.length})
              </button>
              {missingCardNumberCandidates.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void recoverMissingCardNumbers()}
                  aria-disabled={busy}
                  title={busyReason || "Recover exact card numbers for candidates missing that field."}
                  aria-busy={enrichmentBusy}
                  className="rounded-md bg-amber-500 px-4 py-2 text-sm font-black text-black aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                >
                  {enrichmentBusy
                    ? "Recovering Card Numbers..."
                    : `Recover Card Numbers (${missingCardNumberCandidates.length})`}
                </button>
              ) : null}
              <button
                type="button"
                aria-disabled={selectedReady === 0 || busy}
                onClick={() => void processSelected("approve")}
                title={
                  busyReason ||
                  (selectedReady === 0
                    ? "Select at least one approval-ready candidate first."
                    : "Approve selected ready candidates in committed chunks.")
                }
                aria-busy={bulkBusy}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              >
                {bulkBusy ? "Processing selected..." : "Approve Selected"}
              </button>
              <button
                type="button"
                aria-disabled={selectedCount === 0 || busy}
                onClick={rejectSelected}
                title={
                  busyReason ||
                  (selectedCount === 0
                    ? "Select at least one candidate before rejecting."
                    : "Reject selected candidates after confirmation.")
                }
                aria-busy={bulkBusy}
                className="rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              >
                {rejectConfirmOpen ? "Confirm Reject Selected" : "Reject Selected"}
              </button>
              {rejectConfirmOpen ? (
                <button
                  type="button"
                  onClick={cancelRejectConfirmation}
                  aria-disabled={busy}
                  title={busyReason || "Cancel the pending reject confirmation."}
                  aria-busy={busy}
                  className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                >
                  Cancel Reject
                </button>
              ) : null}
            </div>
          </div>
          {rejectConfirmOpen ? (
            <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-black text-rose-950">
              Confirm rejecting {selectedCount} selected candidate
              {selectedCount === 1 ? "" : "s"}. The browser will process them in small, committed chunks.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
