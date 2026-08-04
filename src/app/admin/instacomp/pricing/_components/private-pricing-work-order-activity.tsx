"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ActivityAction = "created" | "updated" | "auto_resolved" | "auto_reopened";
type ActivityActor = "admin" | "system";
type ActivityStatus =
  | "queued"
  | "in_progress"
  | "blocked"
  | "resolved"
  | "completed"
  | "dismissed";

type ActivityRow = {
  rank: number;
  action: ActivityAction;
  status: ActivityStatus;
  priority: number;
  version: number;
  notesChanged: boolean;
  actorType: ActivityActor;
  createdAt: string;
  targetActive: boolean;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  gapType: "missing_release" | "checklist_pending" | "set_gap" | "identity_gap";
  actionabilityStatus: "actionable" | "parser_review";
};

type ActivityReport = {
  generatedAt: string;
  boundary: "private_coverage_work_order_activity_only";
  summary: {
    totalEvents: number;
    adminEvents: number;
    systemEvents: number;
    noteChangeEvents: number;
    createdEvents: number;
    updatedEvents: number;
    autoResolvedEvents: number;
    autoReopenedEvents: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalEvents: number;
    hasMore: boolean;
  };
  rows: ActivityRow[];
};

type Filters = {
  action: ActivityAction | "";
  actorType: ActivityActor | "";
};

const LIMIT = 100;

const actionLabels: Record<ActivityAction, string> = {
  created: "Created",
  updated: "Admin update",
  auto_resolved: "Auto-resolved",
  auto_reopened: "Auto-reopened",
};

const statusLabels: Record<ActivityStatus, string> = {
  queued: "Queued",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
  completed: "Completed",
  dismissed: "Dismissed",
};

const gapLabels: Record<ActivityRow["gapType"], string> = {
  missing_release: "Missing release",
  checklist_pending: "Checklist pending",
  set_gap: "Set gap",
  identity_gap: "Identity gap",
};

export default function PrivatePricingWorkOrderActivity() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({ action: "", actorType: "" });
  const [draftFilters, setDraftFilters] = useState<Filters>(filters);

  const loadActivity = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
      });
      if (filters.action) query.set("action", filters.action);
      if (filters.actorType) query.set("actorType", filters.actorType);

      const response = await fetch(
        `/api/instacomp/pricing/coverage/work-orders/activity?${query}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Work-order activity could not be loaded.");
      }
      setReport(payload.activity as ActivityReport);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Work-order activity could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, offset, open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadActivity(), 0);
    return () => window.clearTimeout(timer);
  }, [loadActivity, open]);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const activeFilterCount = useMemo(
    () => [filters.action, filters.actorType].filter(Boolean).length,
    [filters],
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setFilters(draftFilters);
  }

  function clearFilters() {
    const empty: Filters = { action: "", actorType: "" };
    setDraftFilters(empty);
    setFilters(empty);
    setOffset(0);
  }

  const firstVisible = report?.pagination.returned
    ? report.pagination.offset + 1
    : 0;
  const lastVisible = report
    ? report.pagination.offset + report.pagination.returned
    : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 rounded-full border border-emerald-300 bg-neutral-950 px-5 py-3 text-sm font-black text-white shadow-xl transition hover:bg-neutral-800"
      >
        Open Audit Timeline
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-end bg-black/55 p-0 backdrop-blur-sm sm:p-4">
          <button
            type="button"
            aria-label="Close audit timeline"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-label="Coverage work-order audit timeline"
            className="relative z-10 flex h-full w-full max-w-[1320px] flex-col overflow-hidden border border-neutral-700 bg-neutral-100 shadow-2xl sm:rounded-[2rem]"
          >
            <header className="border-b border-neutral-800 bg-neutral-950 p-5 text-white sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
                    KINGMAKER Private Operations
                  </p>
                  <h2 className="mt-2 text-3xl font-black sm:text-4xl">Coverage Work-Order Audit Timeline</h2>
                  <p className="mt-2 max-w-4xl font-semibold text-neutral-300">
                    Review manual and automatic lifecycle events without exposing private operator text, source material, target keys, or pricing values.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void loadActivity()}
                    disabled={loading}
                    className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15 disabled:opacity-50"
                  >
                    {loading ? "Reloading…" : "Reload"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-full bg-white px-4 py-2 text-sm font-black text-black hover:bg-neutral-200"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
                <HeaderChip text="Immutable receipts" />
                <HeaderChip text="Admin + system actors" />
                <HeaderChip text="No private text" />
                <HeaderChip text="No source disclosure" />
                <HeaderChip text="No price promotion" />
              </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              {error ? (
                <section className="mb-4 rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950">
                  <p className="font-black">Audit timeline could not load</p>
                  <p className="mt-1 font-semibold">{error}</p>
                </section>
              ) : null}

              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
                <MetricCard label="All Events" value={report?.summary.totalEvents} loading={loading} />
                <MetricCard label="Admin" value={report?.summary.adminEvents} loading={loading} />
                <MetricCard label="System" value={report?.summary.systemEvents} loading={loading} />
                <MetricCard label="Text Changed" value={report?.summary.noteChangeEvents} loading={loading} />
                <MetricCard label="Created" value={report?.summary.createdEvents} loading={loading} />
                <MetricCard label="Updated" value={report?.summary.updatedEvents} loading={loading} />
                <MetricCard label="Resolved" value={report?.summary.autoResolvedEvents} loading={loading} />
                <MetricCard label="Reopened" value={report?.summary.autoReopenedEvents} loading={loading} />
              </section>

              <form onSubmit={applyFilters} className="mt-4 rounded-3xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="min-w-[220px] flex-1">
                    <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Event action</span>
                    <select
                      value={draftFilters.action}
                      onChange={(event) => setDraftFilters((current) => ({
                        ...current,
                        action: event.target.value as Filters["action"],
                      }))}
                      className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-bold outline-none focus:border-black"
                    >
                      <option value="">All actions</option>
                      {Object.entries(actionLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="min-w-[220px] flex-1">
                    <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Actor</span>
                    <select
                      value={draftFilters.actorType}
                      onChange={(event) => setDraftFilters((current) => ({
                        ...current,
                        actorType: event.target.value as Filters["actorType"],
                      }))}
                      className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-bold outline-none focus:border-black"
                    >
                      <option value="">All actors</option>
                      <option value="admin">Administrator</option>
                      <option value="system">System reconciliation</option>
                    </select>
                  </label>
                  <button type="submit" className="rounded-xl bg-black px-5 py-3 font-black text-white hover:bg-neutral-800">
                    Apply Filters
                  </button>
                  <button
                    type="button"
                    onClick={clearFilters}
                    disabled={!activeFilterCount && !draftFilters.action && !draftFilters.actorType}
                    className="rounded-xl border border-neutral-300 px-5 py-3 font-black text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </form>

              <section className="mt-4 overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-5">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-neutral-500">Source-Neutral Lifecycle Evidence</p>
                    <h3 className="mt-1 text-2xl font-black">Newest work-order event first</h3>
                  </div>
                  <div className="text-right text-sm font-bold text-neutral-500">
                    <p>{report ? `${formatInteger(firstVisible)}–${formatInteger(lastVisible)} of ${formatInteger(report.pagination.totalEvents)}` : "Loading…"}</p>
                    <p className="mt-1 text-xs">Generated {report?.generatedAt ? formatTimestamp(report.generatedAt) : "—"}</p>
                  </div>
                </div>

                <div className="divide-y divide-neutral-200">
                  {loading
                    ? Array.from({ length: 6 }, (_, index) => <LoadingEvent key={index} />)
                    : report?.rows.length
                      ? report.rows.map((row) => <ActivityEvent key={`${row.rank}-${row.createdAt}-${row.version}`} row={row} />)
                      : (
                        <div className="px-6 py-14 text-center">
                          <p className="text-xl font-black">No audit events match these filters</p>
                          <p className="mt-2 font-semibold text-neutral-500">Clear or broaden the filters to restore the timeline.</p>
                        </div>
                      )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 p-4">
                  <button
                    type="button"
                    disabled={loading || offset === 0}
                    onClick={() => setOffset((current) => Math.max(0, current - LIMIT))}
                    className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-black hover:bg-neutral-100 disabled:opacity-40"
                  >
                    ← Previous 100
                  </button>
                  <p className="text-sm font-bold text-neutral-500">
                    Lifecycle facts only; private content remains sealed.
                  </p>
                  <button
                    type="button"
                    disabled={loading || !report?.pagination.hasMore}
                    onClick={() => setOffset((current) => current + LIMIT)}
                    className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-black hover:bg-neutral-100 disabled:opacity-40"
                  >
                    Next 100 →
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

function ActivityEvent({ row }: { row: ActivityRow }) {
  return (
    <article className="grid gap-4 p-5 hover:bg-neutral-50 lg:grid-cols-[190px_minmax(0,1.4fr)_minmax(0,1fr)_170px] lg:items-center">
      <div>
        <ActionBadge action={row.action} />
        <p className="mt-2 text-xs font-bold text-neutral-500">{formatTimestamp(row.createdAt)}</p>
        <p className="mt-1 text-xs font-semibold text-neutral-500">Version {formatInteger(row.version)}</p>
      </div>

      <div>
        <p className="font-black">{row.releaseYear} {row.manufacturer} {row.product}</p>
        <p className="mt-1 text-sm font-bold text-neutral-600">{row.sport} · {row.setName}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <SmallBadge text={gapLabels[row.gapType]} />
          <SmallBadge text={row.actionabilityStatus === "actionable" ? "Actionable" : "Parser review"} />
          <SmallBadge text={row.targetActive ? "Active target" : "Inactive target"} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={row.status} />
        <SmallBadge text={`Priority ${row.priority}`} />
        <SmallBadge text={row.actorType === "admin" ? "Administrator" : "System reconciliation"} />
        {row.notesChanged ? <SmallBadge text="Private text changed" /> : null}
      </div>

      <div className="text-left lg:text-right">
        <p className="text-xs font-black uppercase tracking-wider text-neutral-500">Evidence boundary</p>
        <p className="mt-1 text-sm font-bold text-neutral-800">Lifecycle metadata only</p>
      </div>
    </article>
  );
}

function ActionBadge({ action }: { action: ActivityAction }) {
  const tone = action === "auto_resolved"
    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
    : action === "auto_reopened"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : action === "created"
        ? "border-cyan-200 bg-cyan-50 text-cyan-900"
        : "border-violet-200 bg-violet-50 text-violet-900";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${tone}`}>
      {actionLabels[action]}
    </span>
  );
}

function StatusBadge({ status }: { status: ActivityStatus }) {
  const tone = status === "blocked"
    ? "border-red-200 bg-red-50 text-red-900"
    : status === "resolved" || status === "completed"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : status === "in_progress"
        ? "border-cyan-200 bg-cyan-50 text-cyan-900"
        : status === "queued"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-300 bg-neutral-100 text-neutral-700";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${tone}`}>
      {statusLabels[status]}
    </span>
  );
}

function HeaderChip({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">
      {text}
    </span>
  );
}

function SmallBadge({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-black text-neutral-700">
      {text}
    </span>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">{label}</p>
      {loading
        ? <div className="mt-3 h-8 w-16 animate-pulse rounded-lg bg-neutral-200" />
        : <p className="mt-2 text-2xl font-black">{formatInteger(value)}</p>}
    </article>
  );
}

function LoadingEvent() {
  return (
    <div className="grid gap-4 p-5 lg:grid-cols-[190px_minmax(0,1.4fr)_minmax(0,1fr)_170px]">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-xl bg-neutral-200" />
      ))}
    </div>
  );
}

function formatInteger(value: number | undefined | null) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
