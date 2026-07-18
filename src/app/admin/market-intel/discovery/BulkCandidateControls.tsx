"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
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

function BulkSubmitButton({
  children,
  pendingChildren,
  disabled = false,
  name,
  value,
  className,
  type = "submit",
  onClick,
}: {
  children: React.ReactNode;
  pendingChildren: React.ReactNode;
  disabled?: boolean;
  name: string;
  value: string;
  className: string;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type={type}
      name={name}
      value={value}
      disabled={disabled || pending}
      onClick={onClick}
      aria-busy={pending}
      className={className}
    >
      {pending ? pendingChildren : children}
    </button>
  );
}

export default function BulkCandidateControls({
  candidates,
}: {
  candidates: BulkCandidate[];
}) {
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targets, setTargets] = useState<PortalTarget[]>([]);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const candidateKey = useMemo(
    () => candidates.map((candidate) => candidate.id).join("|"),
    [candidates],
  );

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

  function toggleCandidate(id: string) {
    setRejectConfirmOpen(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(candidates.map((candidate) => candidate.id)));
    setRejectConfirmOpen(false);
  }

  function selectReady() {
    setSelected(new Set(readyCandidates.map((candidate) => candidate.id)));
    setRejectConfirmOpen(false);
  }

  function clearSelected() {
    setSelected(new Set());
    setRejectConfirmOpen(false);
  }

  const handoff = searchParams.get("admin_handoff");
  const action = handoff
    ? `/api/admin/market-intel/discovery/bulk?admin_handoff=${encodeURIComponent(handoff)}`
    : "/api/admin/market-intel/discovery/bulk";

  const bulkResult = searchParams.get("bulk") === "1";
  const approved = Number(searchParams.get("approved") || 0);
  const rejected = Number(searchParams.get("rejected") || 0);
  const skipped = Number(searchParams.get("skipped") || 0);
  const firstError = searchParams.get("firstError");
  const bulkFailed =
    bulkResult && approved === 0 && rejected === 0 && skipped > 0;

  return (
    <>
      {targets.map((target) =>
        createPortal(
          <label className="flex cursor-pointer items-start gap-3 border-b border-neutral-200 bg-[#fffbea] px-5 py-3">
            <input
              type="checkbox"
              checked={selected.has(target.id)}
              onChange={() => toggleCandidate(target.id)}
              className="mt-0.5 h-5 w-5 accent-black"
              aria-label={`Select ${target.player}`}
            />
            <span className="min-w-0">
              <span className="block text-sm font-black">
                Select this candidate
              </span>
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

      {candidates.length > 0 ? (
        <form
          method="post"
          action={action}
          className="fixed inset-x-4 bottom-4 z-[60] mx-auto max-w-5xl rounded-xl border border-neutral-700 bg-[#101418] p-4 text-white shadow-2xl"
        >
          {Array.from(selected).map((candidateId) => (
            <input
              key={candidateId}
              type="hidden"
              name="candidateIds"
              value={candidateId}
            />
          ))}

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
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={allSelected ? clearSelected : selectAll}
                className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black"
              >
                {allSelected ? "Clear All" : "Select All"}
              </button>
              <button
                type="button"
                onClick={selectReady}
                className="rounded-md border border-cyan-500 bg-cyan-950 px-3 py-2 text-sm font-black text-cyan-100"
              >
                Select Ready Only ({readyCandidates.length})
              </button>
              <BulkSubmitButton
                name="action"
                value="approve"
                disabled={selectedCount === 0}
                onClick={() => setRejectConfirmOpen(false)}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                pendingChildren="Approving selected..."
              >
                Approve Selected
              </BulkSubmitButton>
              <BulkSubmitButton
                type={rejectConfirmOpen ? "submit" : "button"}
                name="action"
                value="reject"
                disabled={selectedCount === 0}
                onClick={() => {
                  if (!rejectConfirmOpen) setRejectConfirmOpen(true);
                }}
                className="rounded-md bg-rose-700 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                pendingChildren="Rejecting selected..."
              >
                {rejectConfirmOpen ? "Confirm Reject Selected" : "Reject Selected"}
              </BulkSubmitButton>
              {rejectConfirmOpen ? (
                <button
                  type="button"
                  onClick={() => setRejectConfirmOpen(false)}
                  className="rounded-md border border-neutral-500 bg-white/10 px-3 py-2 text-sm font-black"
                >
                  Cancel Reject
                </button>
              ) : null}
            </div>
          </div>
          {rejectConfirmOpen ? (
            <p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-black text-rose-950">
              Confirm rejecting {selectedCount} selected candidate
              {selectedCount === 1 ? "" : "s"}. This will submit the selected
              rows to the bulk reject action.
            </p>
          ) : null}
        </form>
      ) : null}
    </>
  );
}
