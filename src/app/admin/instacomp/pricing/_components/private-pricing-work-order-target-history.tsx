"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ActivityAction =
  | "created"
  | "updated"
  | "auto_resolved"
  | "auto_reopened"
  | "review_scheduled"
  | "review_cleared"
  | "claimed"
  | "released"
  | "execution_updated"
  | "resolution_recorded";

type HistoryEvent = {
  rank: number;
  action: ActivityAction;
  status: string;
  priority: number;
  version: number;
  notesChanged: boolean;
  actorType: "admin" | "system";
  createdAt: string;
};

type HistoryReport = {
  generatedAt: string;
  boundary: "private_coverage_work_order_target_history_only";
  target: {
    status: string;
    priority: number;
    version: number;
    targetActive: boolean;
    sport: string;
    releaseYear: string;
    manufacturer: string;
    product: string;
    setName: string;
    gapType: string;
    actionabilityStatus: string;
  };
  summary: {
    totalEvents: number;
    adminEvents: number;
    systemEvents: number;
    noteChangeEvents: number;
    createdEvents: number;
    updatedEvents: number;
    autoResolvedEvents: number;
    autoReopenedEvents: number;
    reviewScheduledEvents: number;
    reviewClearedEvents: number;
    claimedEvents: number;
    releasedEvents: number;
    executionUpdatedEvents: number;
    resolutionRecordedEvents: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalEvents: number;
    hasMore: boolean;
  };
  rows: HistoryEvent[];
};

const LIMIT = 50;

const actionLabels: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Admin update",
  auto_resolved: "Auto-resolved",
  auto_reopened: "Auto-reopened",
  review_scheduled: "Review scheduled",
  review_cleared: "Review cleared",
  claimed: "Claimed",
  released: "Released",
  execution_updated: "Controls updated",
  resolution_recorded: "Resolution recorded",
};

export default function PrivatePricingWorkOrderTargetHistory({
  attackKey,
  label,
  disabled,
}: {
  attackKey: string;
  label: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        attackKey,
        limit: String(LIMIT),
        offset: String(offset),
      });
      const response = await fetch(
        `/api/instacomp/pricing/coverage/work-orders/execution/history?${query}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(
          payload?.error || "Work-order history could not be loaded.",
        );
      }
      setReport(payload.history as HistoryReport);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Work-order history could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [attackKey, offset, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const executionEvents = useMemo(
    () =>
      (report?.summary.claimedEvents || 0) +
      (report?.summary.releasedEvents || 0) +
      (report?.summary.executionUpdatedEvents || 0) +
      (report?.summary.resolutionRecordedEvents || 0),
    [report],
  );
  const reviewEvents = useMemo(
    () =>
      (report?.summary.reviewScheduledEvents || 0) +
      (report?.summary.reviewClearedEvents || 0),
    [report],
  );

  function openHistory() {
    setOffset(0);
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openHistory}
        disabled={disabled}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-black text-neutral-800 disabled:opacity-50"
      >
        View History
      </button>

      {open ? (
        <div className="fixed inset-0 z-[90] flex items-stretch justify-end bg-black/60 p-0 backdrop-blur-sm sm:p-4">
          <button
            type="button"
            aria-label="Close work-order history"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label={`History for ${label}`}
            className="relative z-10 flex h-full w-full max-w-[920px] flex-col overflow-hidden border border-neutral-700 bg-neutral-100 shadow-2xl sm:rounded-[2rem]"
          >
            <header className="border-b border-neutral-800 bg-neutral-950 p-5 text-white sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">
                    KINGMAKER Target History
                  </p>
                  <h2 className="mt-2 text-2xl font-black sm:text-3xl">
                    {report
                      ? `${report.target.releaseYear} ${report.target.manufacturer} ${report.target.product}`
                      : label}
                  </h2>
                  <p className="mt-2 font-semibold text-neutral-300">
                    Version-by-version lifecycle evidence for this work order.
                    Private notes, assignment labels, blockers, resolutions,
                    source material, pricing values, and the internal target key
                    remain sealed.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void load()}
                    disabled={loading}
                    className="rounded-full border border-white/20 px-4 py-2 text-sm font-black disabled:opacity-50"
                  >
                    {loading ? "Reloading…" : "Reload"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full bg-white px-4 py-2 text-sm font-black text-black"
                  >
                    Close
                  </button>
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {error ? (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-950">
                  {error}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric
                  label="All Events"
                  value={report?.summary.totalEvents}
                  loading={loading}
                />
                <Metric
                  label="Execution"
                  value={executionEvents}
                  loading={loading}
                />
                <Metric
                  label="Review"
                  value={reviewEvents}
                  loading={loading}
                />
                <Metric
                  label="Current Version"
                  value={report?.target.version}
                  loading={loading}
                />
              </div>

              {report ? (
                <div className="mt-4 flex flex-wrap gap-2 rounded-2xl border border-neutral-200 bg-white p-4 text-xs font-black uppercase tracking-wider text-neutral-600">
                  <Chip text={report.target.status.replaceAll("_", " ")} />
                  <Chip text={`Priority ${report.target.priority}`} />
                  <Chip text={report.target.sport} />
                  <Chip text={report.target.setName} />
                  <Chip
                    text={
                      report.target.targetActive
                        ? "Active coverage target"
                        : "Inactive coverage target"
                    }
                  />
                </div>
              ) : null}

              <section className="mt-4 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
                      Immutable Lifecycle Receipts
                    </p>
                    <h3 className="mt-1 text-xl font-black">
                      Newest event first
                    </h3>
                  </div>
                  <p className="text-sm font-bold text-neutral-500">
                    {report
                      ? `${formatInteger(report.pagination.offset + (report.pagination.returned ? 1 : 0))}–${formatInteger(report.pagination.offset + report.pagination.returned)} of ${formatInteger(report.pagination.totalEvents)}`
                      : "Loading…"}
                  </p>
                </div>

                <div className="divide-y divide-neutral-200">
                  {loading && !report ? (
                    Array.from({ length: 5 }, (_, index) => (
                      <LoadingEvent key={index} />
                    ))
                  ) : report?.rows.length ? (
                    report.rows.map((event) => (
                      <HistoryEventRow
                        key={`${event.rank}-${event.version}-${event.createdAt}`}
                        event={event}
                      />
                    ))
                  ) : (
                    <div className="p-10 text-center font-black text-neutral-500">
                      No lifecycle events are available for this work order.
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-neutral-200 p-4">
                  <button
                    type="button"
                    disabled={loading || offset === 0}
                    onClick={() =>
                      setOffset((current) => Math.max(0, current - LIMIT))
                    }
                    className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-black disabled:opacity-40"
                  >
                    Previous 50
                  </button>
                  <button
                    type="button"
                    disabled={loading || !report?.pagination.hasMore}
                    onClick={() => setOffset((current) => current + LIMIT)}
                    className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
                  >
                    Next 50
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function HistoryEventRow({ event }: { event: HistoryEvent }) {
  return (
    <article className="grid gap-3 p-4 sm:grid-cols-[180px_minmax(0,1fr)_150px] sm:items-center">
      <div>
        <span
          className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider ${actionTone(event.action)}`}
        >
          {actionLabels[event.action]}
        </span>
        <p className="mt-2 text-xs font-bold text-neutral-500">
          {formatTimestamp(event.createdAt)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Chip text={event.status.replaceAll("_", " ")} />
        <Chip text={`Priority ${event.priority}`} />
        <Chip
          text={
            event.actorType === "admin"
              ? "Administrator"
              : "System reconciliation"
          }
        />
        {event.notesChanged ? <Chip text="Private text changed" /> : null}
      </div>
      <div className="text-left sm:text-right">
        <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
          Work-order version
        </p>
        <p className="text-xl font-black">{formatInteger(event.version)}</p>
      </div>
    </article>
  );
}

function actionTone(action: ActivityAction) {
  if (action === "auto_resolved" || action === "resolution_recorded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }
  if (action === "auto_reopened" || action === "review_scheduled") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }
  if (action === "created" || action === "claimed") {
    return "border-cyan-200 bg-cyan-50 text-cyan-900";
  }
  if (action === "released" || action === "review_cleared") {
    return "border-neutral-300 bg-neutral-100 text-neutral-800";
  }
  return "border-violet-200 bg-violet-50 text-violet-900";
}

function Metric({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      {loading && value === undefined ? (
        <div className="mt-3 h-8 w-14 animate-pulse rounded-lg bg-neutral-200" />
      ) : (
        <p className="mt-2 text-2xl font-black">{formatInteger(value)}</p>
      )}
    </div>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-black capitalize text-neutral-700">
      {text}
    </span>
  );
}

function LoadingEvent() {
  return (
    <div className="p-4">
      <div className="h-14 animate-pulse rounded-xl bg-neutral-200" />
    </div>
  );
}

function formatInteger(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
