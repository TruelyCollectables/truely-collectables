"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type WorkStatus =
  | "untracked"
  | "queued"
  | "in_progress"
  | "blocked"
  | "completed"
  | "dismissed";

type SaveStatus = Exclude<WorkStatus, "untracked">;

type WorkOrder = {
  status: WorkStatus;
  priority: number;
  notes: string;
  version: number;
  updatedAt: string | null;
  startedAt: string | null;
  blockedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
};

type WorkOrderRow = {
  rank: number;
  attackKey: string;
  targetActive: boolean;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  gapType: "missing_release" | "checklist_pending" | "set_gap" | "identity_gap";
  actionabilityStatus: "actionable" | "parser_review";
  actionabilityReasons: string[];
  recommendedAction: string;
  potentialUnlock: number;
  distinctCardNumbers: number;
  sourceRefreshedAt: string | null;
  workOrder: WorkOrder;
};

type WorkOrdersReport = {
  generatedAt: string;
  boundary: "private_coverage_work_orders_only";
  summary: {
    totalTargets: number;
    trackedTargets: number;
    untrackedTargets: number;
    queuedTargets: number;
    inProgressTargets: number;
    blockedTargets: number;
    completedTargets: number;
    dismissedTargets: number;
    inactiveTargets: number;
    activePotentialUnlock: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalTargets: number;
    hasMore: boolean;
  };
  rows: WorkOrderRow[];
};

type Filters = {
  status: WorkStatus | "";
  search: string;
};

type SaveDraft = {
  status: SaveStatus;
  priority: number;
  notes: string;
};

const LIMIT = 100;

const statusLabels: Record<WorkStatus, string> = {
  untracked: "Untracked",
  queued: "Queued",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  dismissed: "Dismissed",
};

const gapLabels: Record<WorkOrderRow["gapType"], string> = {
  missing_release: "Missing release",
  checklist_pending: "Checklist pending",
  set_gap: "Set gap",
  identity_gap: "Identity gap",
};

export default function PrivatePricingWorkOrders() {
  const [report, setReport] = useState<WorkOrdersReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>({ status: "", search: "" });
  const [draftFilters, setDraftFilters] = useState<Filters>(filters);

  const loadWorkOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
      });
      if (filters.status) query.set("status", filters.status);
      if (filters.search.trim()) query.set("search", filters.search.trim());
      const response = await fetch(
        `/api/instacomp/pricing/coverage/work-orders?${query}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Coverage work orders could not be loaded.");
      }
      setReport(payload.workOrders as WorkOrdersReport);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Coverage work orders could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkOrders(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkOrders]);

  const activeFilterCount = useMemo(
    () => [filters.status, filters.search.trim()].filter(Boolean).length,
    [filters],
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setFilters({
      status: draftFilters.status,
      search: draftFilters.search.trim(),
    });
  }

  function clearFilters() {
    const empty: Filters = { status: "", search: "" };
    setDraftFilters(empty);
    setFilters(empty);
    setOffset(0);
  }

  async function saveWorkOrder(row: WorkOrderRow, draft: SaveDraft) {
    setSavingKey(row.attackKey);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        "/api/instacomp/pricing/coverage/work-orders",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            attackKey: row.attackKey,
            status: draft.status,
            priority: draft.priority,
            notes: draft.notes,
            expectedVersion: row.workOrder.version,
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Coverage work order could not be saved.");
      }
      setNotice(
        `${row.releaseYear} ${row.manufacturer} ${row.product} saved as ${statusLabels[draft.status].toLowerCase()}.`,
      );
      await loadWorkOrders();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Coverage work order could not be saved.",
      );
    } finally {
      setSavingKey(null);
    }
  }

  const firstVisible = report?.pagination.returned
    ? report.pagination.offset + 1
    : 0;
  const lastVisible = report
    ? report.pagination.offset + report.pagination.returned
    : 0;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-5">
        <header className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-xl">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.22),_transparent_36%),radial-gradient(circle_at_bottom_left,_rgba(34,211,238,0.18),_transparent_34%)] p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/instacomp/pricing/coverage" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  ← Coverage Queue
                </Link>
                <Link href="/admin/instacomp/pricing" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  Pricing Command Center
                </Link>
              </div>
              <button
                type="button"
                onClick={() => void loadWorkOrders()}
                disabled={loading}
                className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                {loading ? "Reloading…" : "Reload Workbench"}
              </button>
            </div>

            <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
              KINGMAKER Private Pricing Operations
            </p>
            <h1 className="mt-2 text-4xl font-black md:text-5xl">Coverage Work Orders</h1>
            <p className="mt-3 max-w-5xl font-semibold text-neutral-300">
              Claim ranked Registry targets, preserve operator notes, track blockers, and retain completed work after the live gap clears.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
              <HeaderChip text="Versioned updates" tone="emerald" />
              <HeaderChip text="Immutable audit" tone="cyan" />
              <HeaderChip text="Admin only" tone="emerald" />
              <HeaderChip text="No price promotion" tone="neutral" />
              <HeaderChip text="No source disclosure" tone="neutral" />
            </div>
          </div>
        </header>

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950 shadow-sm">
            <p className="font-black">Work-order operation failed</p>
            <p className="mt-1 font-semibold">{error}</p>
          </section>
        ) : null}

        {notice ? (
          <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-sm">
            <p className="font-black">{notice}</p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard label="In Progress" value={report?.summary.inProgressTargets} loading={loading} />
          <MetricCard label="Blocked" value={report?.summary.blockedTargets} loading={loading} />
          <MetricCard label="Queued" value={report?.summary.queuedTargets} loading={loading} />
          <MetricCard label="Untracked" value={report?.summary.untrackedTargets} loading={loading} />
          <MetricCard label="Completed" value={report?.summary.completedTargets} loading={loading} />
          <MetricCard label="Active Unlock" value={report?.summary.activePotentialUnlock} loading={loading} />
        </section>

        <form onSubmit={applyFilters} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[220px] flex-1">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Work status</span>
              <select
                value={draftFilters.status}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  status: event.target.value as Filters["status"],
                }))}
                className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-bold outline-none focus:border-black"
              >
                <option value="">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="min-w-[300px] flex-[2]">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Search target</span>
              <input
                value={draftFilters.search}
                onChange={(event) => setDraftFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))}
                placeholder="Sport, year, manufacturer, product, or set"
                className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-bold outline-none focus:border-black"
              />
            </label>
            <button type="submit" className="rounded-xl bg-black px-5 py-3 font-black text-white hover:bg-neutral-800">
              Apply Filters
            </button>
            <button
              type="button"
              onClick={clearFilters}
              disabled={!activeFilterCount && !draftFilters.status && !draftFilters.search}
              className="rounded-xl border border-neutral-300 px-5 py-3 font-black text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-neutral-500">Private Operating Queue</p>
              <h2 className="mt-1 text-2xl font-black">Move the highest-unlock targets to completion</h2>
            </div>
            <div className="text-right text-sm font-bold text-neutral-500">
              <p>{report ? `${formatInteger(firstVisible)}–${formatInteger(lastVisible)} of ${formatInteger(report.pagination.totalTargets)}` : "Loading…"}</p>
              <p className="mt-1 text-xs">{formatInteger(report?.summary.inactiveTargets)} retained inactive target(s)</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1580px] w-full border-collapse text-left">
              <thead className="bg-neutral-50 text-xs font-black uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3 text-right">Unlock</th>
                  <th className="px-4 py-3">Gap / Quality</th>
                  <th className="px-4 py-3">Work Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {loading
                  ? Array.from({ length: 7 }, (_, index) => <LoadingRow key={index} />)
                  : report?.rows.length
                    ? report.rows.map((row) => (
                        <WorkOrderTableRow
                          key={`${row.attackKey}-${row.workOrder.version}`}
                          row={row}
                          saving={savingKey === row.attackKey}
                          onSave={saveWorkOrder}
                        />
                      ))
                    : (
                      <tr>
                        <td colSpan={6} className="px-6 py-14 text-center">
                          <p className="text-xl font-black">No work orders match these filters</p>
                          <p className="mt-2 font-semibold text-neutral-500">Clear or broaden the filters to restore the queue.</p>
                        </td>
                      </tr>
                    )}
              </tbody>
            </table>
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
            <p className="text-sm font-bold text-neutral-500">Updated {report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : "—"}</p>
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
    </main>
  );
}

function WorkOrderTableRow({
  row,
  saving,
  onSave,
}: {
  row: WorkOrderRow;
  saving: boolean;
  onSave: (row: WorkOrderRow, draft: SaveDraft) => Promise<void>;
}) {
  const [status, setStatus] = useState<SaveStatus>(
    row.workOrder.status === "untracked" ? "queued" : row.workOrder.status,
  );
  const [priority, setPriority] = useState(row.workOrder.priority || 3);
  const [notes, setNotes] = useState(row.workOrder.notes);
  const dirty = status !== (row.workOrder.status === "untracked" ? "queued" : row.workOrder.status)
    || priority !== row.workOrder.priority
    || notes.trim() !== row.workOrder.notes;

  return (
    <tr className="align-top hover:bg-neutral-50/70">
      <td className="px-4 py-4 text-lg font-black">#{formatInteger(row.rank)}</td>
      <td className="px-4 py-4">
        <StatusBadge status={row.workOrder.status} />
        <p className="mt-2 text-xs font-bold text-neutral-500">
          {row.targetActive ? "Active gap" : "Gap cleared or replaced"}
        </p>
        {row.workOrder.updatedAt ? (
          <p className="mt-1 text-xs font-semibold text-neutral-500">Saved {formatTimestamp(row.workOrder.updatedAt)}</p>
        ) : null}
      </td>
      <td className="max-w-[370px] px-4 py-4">
        <p className="font-black">{row.releaseYear} {row.manufacturer} {row.product}</p>
        <p className="mt-1 text-sm font-bold text-neutral-600">{row.sport} · {row.setName}</p>
        <p className="mt-2 text-sm font-semibold leading-5 text-neutral-600">
          {row.actionabilityStatus === "actionable"
            ? row.recommendedAction
            : "Correct or confirm parsed release labels before Registry work."}
        </p>
      </td>
      <td className="px-4 py-4 text-right">
        <p className="text-2xl font-black">{formatInteger(row.potentialUnlock)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-500">{formatInteger(row.distinctCardNumbers)} card numbers</p>
      </td>
      <td className="px-4 py-4">
        <span className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-neutral-800">
          {gapLabels[row.gapType]}
        </span>
        <span className={`mt-2 block w-fit rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${
          row.actionabilityStatus === "actionable"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900"
        }`}>
          {row.actionabilityStatus === "actionable" ? "Actionable" : "Parser review"}
        </span>
      </td>
      <td className="min-w-[520px] px-4 py-4">
        <div className="grid grid-cols-[minmax(150px,0.8fr)_110px_minmax(220px,1.8fr)_auto] items-end gap-2">
          <label>
            <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as SaveStatus)}
              disabled={!row.targetActive || saving}
              className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-bold disabled:bg-neutral-100"
            >
              <option value="queued">Queued</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="completed">Completed</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Priority</span>
            <select
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
              disabled={!row.targetActive || saving}
              className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm font-bold disabled:bg-neutral-100"
            >
              <option value={1}>1 · Highest</option>
              <option value={2}>2 · High</option>
              <option value={3}>3 · Normal</option>
              <option value={4}>4 · Low</option>
              <option value={5}>5 · Lowest</option>
            </select>
          </label>
          <label>
            <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Private notes</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
              disabled={!row.targetActive || saving}
              placeholder="Blocker, acquisition plan, or next verification step"
              className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm font-semibold disabled:bg-neutral-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void onSave(row, { status, priority, notes: notes.trim() })}
            disabled={!row.targetActive || saving || (!dirty && row.workOrder.version > 0)}
            className="rounded-xl bg-black px-4 py-2.5 text-sm font-black text-white hover:bg-neutral-800 disabled:opacity-40"
          >
            {saving ? "Saving…" : row.workOrder.version ? "Save" : "Create"}
          </button>
        </div>
        {!row.targetActive ? (
          <p className="mt-2 text-xs font-semibold text-neutral-500">Retained for history. Inactive targets cannot be changed from this workbench.</p>
        ) : null}
      </td>
    </tr>
  );
}

function HeaderChip({ text, tone }: { text: string; tone: "cyan" | "emerald" | "neutral" }) {
  const toneClass = tone === "cyan"
    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-200"
    : tone === "emerald"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
      : "border-white/15 bg-white/10 text-neutral-200";
  return <span className={`rounded-full border px-3 py-2 ${toneClass}`}>{text}</span>;
}

function StatusBadge({ status }: { status: WorkStatus }) {
  const tone = status === "in_progress"
    ? "border-cyan-200 bg-cyan-50 text-cyan-900"
    : status === "blocked"
      ? "border-red-200 bg-red-50 text-red-900"
      : status === "completed"
        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
        : status === "dismissed"
          ? "border-neutral-300 bg-neutral-100 text-neutral-700"
          : status === "queued"
            ? "border-amber-200 bg-amber-50 text-amber-900"
            : "border-neutral-200 bg-white text-neutral-700";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${tone}`}>
      {statusLabels[status]}
    </span>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: number | undefined; loading: boolean }) {
  return (
    <article className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      {loading
        ? <div className="mt-3 h-9 w-24 animate-pulse rounded-lg bg-neutral-200" />
        : <p className="mt-2 text-3xl font-black">{formatInteger(value)}</p>}
    </article>
  );
}

function LoadingRow() {
  return (
    <tr>
      {Array.from({ length: 6 }, (_, index) => (
        <td key={index} className="px-4 py-5"><div className="h-6 animate-pulse rounded bg-neutral-200" /></td>
      ))}
    </tr>
  );
}

function formatInteger(value: number | undefined | null) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
