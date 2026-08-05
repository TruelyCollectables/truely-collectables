"use client";

import {
  FormEvent,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";

type Lane =
  | "unassigned"
  | "assigned"
  | "overdue"
  | "blocked"
  | "due_for_review"
  | "recently_resolved";
type Operation = "claim" | "release" | "update" | "resolve";
type Sort = "unlock_desc" | "priority_asc" | "due_asc" | "target_asc";
type Preset =
  | "p1_today"
  | "p2_tomorrow"
  | "missing_checklist"
  | "coverage_fixed";

type Row = {
  rank: number;
  attackKey: string;
  lane: Lane;
  status: string;
  priority: number;
  version: number;
  assignee: string | null;
  dueAt: string | null;
  nextReviewAt: string | null;
  blockedReason: string | null;
  resolutionCode: string | null;
  updatedAt: string | null;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  gapType: string;
  potentialUnlock: number;
};

type Report = {
  filters: { lane: Lane | null; search: string | null; sort: Sort };
  summary: {
    totalTargets: number;
    unassignedTargets: number;
    assignedTargets: number;
    overdueTargets: number;
    blockedTargets: number;
    dueForReviewTargets: number;
    recentlyResolvedTargets: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalTargets: number;
    hasMore: boolean;
  };
  rows: Row[];
};

type Draft = {
  assignee: string;
  priority: number;
  dueAt: string;
  blockedReason: string;
  resolutionCode: string;
};

type BatchFailure = {
  index: number;
  attackKey: string | null;
  error: string;
  code: string;
};

type BatchResponse = {
  ok: boolean;
  error?: string;
  batch?: {
    requested: number;
    completed: number;
    failed: number;
    failures: BatchFailure[];
  };
};

type LastBatch = {
  operation: Operation;
  draft: Draft;
  attemptedRows: Row[];
  requested: number;
  completed: number;
  failures: BatchFailure[];
};

const laneLabels: Record<Lane, string> = {
  unassigned: "Unassigned",
  assigned: "Assigned",
  overdue: "Overdue",
  blocked: "Blocked",
  due_for_review: "Due for review",
  recently_resolved: "Recently resolved",
};

const operationLabels: Record<Operation, string> = {
  claim: "Claim",
  release: "Release",
  update: "Save controls",
  resolve: "Resolve",
};

const blockedLabels: Record<string, string> = {
  missing_checklist: "Missing checklist",
  missing_pricing_source: "Missing pricing source",
  identity_conflict: "Identity conflict",
  insufficient_evidence: "Insufficient evidence",
  source_access_problem: "Source access problem",
  other: "Other",
};

const resolutionLabels: Record<string, string> = {
  coverage_fixed: "Coverage fixed",
  no_action_needed: "No action needed",
  invalid_target: "Invalid target",
  more_evidence_required: "More evidence required",
  dismissed_duplicate: "Duplicate target",
};

const quickViews: Array<{ value: Lane | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "unassigned", label: "Unassigned" },
  { value: "overdue", label: "Overdue" },
  { value: "blocked", label: "Blocked" },
  { value: "due_for_review", label: "Due Review" },
];

const defaultDraft = (): Draft => ({
  assignee: "Truely Collectables Admin",
  priority: 3,
  dueAt: "",
  blockedReason: "",
  resolutionCode: "",
});

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function localDueDate(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(17, 0, 0, 0);
  return localInput(date.toISOString());
}

function payloadFor(row: Row, operation: Operation, draft: Draft) {
  return {
    attackKey: row.attackKey,
    expectedVersion: row.version,
    operation,
    assignee: draft.assignee.trim() || null,
    priority: draft.priority,
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
    blockedReason: draft.blockedReason || null,
    resolutionCode: draft.resolutionCode || null,
  };
}

async function saveExecution(row: Row, operation: Operation, draft: Draft) {
  const response = await fetch(
    "/api/instacomp/pricing/coverage/work-orders/execution",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payloadFor(row, operation, draft)),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || "Execution control could not be saved.");
  }
}

async function saveExecutionBatch(
  rows: Row[],
  operation: Operation,
  draft: Draft,
) {
  const response = await fetch(
    "/api/instacomp/pricing/coverage/work-orders/execution",
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: rows.map((row) => payloadFor(row, operation, draft)),
      }),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as BatchResponse;
  if (!response.ok && !payload.batch) {
    throw new Error(payload.error || "Bulk execution controls could not be saved.");
  }
  return payload;
}

export default function PrivatePricingWorkOrderExecution() {
  const [report, setReport] = useState<Report | null>(null);
  const [lane, setLane] = useState<Lane | "">("");
  const [searchInput, setSearchInput] = useState("");
  const deferredSearch = useDeferredValue(searchInput.trim());
  const [sort, setSort] = useState<Sort>("unlock_desc");
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDraft, setBulkDraft] = useState<Draft>(defaultDraft);
  const [pendingCoverageResolution, setPendingCoverageResolution] =
    useState(false);
  const [lastBatch, setLastBatch] = useState<LastBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        sort,
      });
      if (lane) query.set("lane", lane);
      if (deferredSearch) query.set("search", deferredSearch);
      const response = await fetch(
        `/api/instacomp/pricing/coverage/work-orders/execution?${query}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Execution queue could not be loaded.");
      }
      const nextReport = payload.execution as Report;
      const total = nextReport.pagination.totalTargets;
      if (offset > 0 && offset >= total) {
        setOffset(total ? Math.floor((total - 1) / pageSize) * pageSize : 0);
        return;
      }
      setReport(nextReport);
      setSelected(new Set());
      setPendingCoverageResolution(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Execution queue could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [deferredSearch, lane, offset, pageSize, sort]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const rows = report?.rows || [];
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.attackKey)),
    [rows, selected],
  );
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const visibleUnlock = rows.reduce(
    (sum, row) => sum + row.potentialUnlock,
    0,
  );
  const selectedUnlock = selectedRows.reduce(
    (sum, row) => sum + row.potentialUnlock,
    0,
  );
  const pagination = report?.pagination;
  const page = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(
    1,
    Math.ceil((pagination?.totalTargets || 0) / pageSize),
  );

  function chooseLane(value: Lane | "") {
    setLane(value);
    setOffset(0);
    setPendingCoverageResolution(false);
  }

  function changeSearch(value: string) {
    setSearchInput(value);
    setOffset(0);
    setPendingCoverageResolution(false);
  }

  function changeSort(value: Sort) {
    setSort(value);
    setOffset(0);
    setPendingCoverageResolution(false);
  }

  function changePageSize(value: number) {
    setPageSize(value);
    setOffset(0);
    setPendingCoverageResolution(false);
  }

  function toggleAll() {
    setSelected(
      allSelected ? new Set() : new Set(rows.map((row) => row.attackKey)),
    );
    setPendingCoverageResolution(false);
  }

  function toggleOne(attackKey: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(attackKey)) next.delete(attackKey);
      else next.add(attackKey);
      return next;
    });
    setPendingCoverageResolution(false);
  }

  function jumpToPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const requested = Math.max(
      1,
      Math.min(totalPages, Number(data.get("page")) || 1),
    );
    setOffset((requested - 1) * pageSize);
    setPendingCoverageResolution(false);
  }

  async function mutate(row: Row, operation: Operation, draft: Draft) {
    setSaving(row.attackKey);
    setError(null);
    setNotice(null);
    try {
      await saveExecution(row, operation, draft);
      setNotice(
        `${row.releaseYear} ${row.manufacturer} ${row.product} updated.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Execution control could not be saved.",
      );
    } finally {
      setSaving(null);
    }
  }

  async function mutateBulk(
    operation: Operation,
    draft: Draft = bulkDraft,
    rowsToUpdate: Row[] = selectedRows,
  ) {
    if (!rowsToUpdate.length) return;
    if (operation === "resolve" && !draft.resolutionCode) {
      setError("Choose a resolution before recording bulk resolutions.");
      return;
    }
    const attemptedRows = [...rowsToUpdate];
    setBulkSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await saveExecutionBatch(attemptedRows, operation, draft);
      const batch = payload.batch;
      if (!batch) {
        throw new Error(
          payload.error || "Bulk execution controls could not be saved.",
        );
      }
      setLastBatch({
        operation,
        draft: { ...draft },
        attemptedRows,
        requested: batch.requested,
        completed: batch.completed,
        failures: batch.failures,
      });
      if (batch.failed) {
        setNotice(
          `${batch.completed} updated; ${batch.failed} failed. Review or retry the failed rows below.`,
        );
      } else {
        setNotice(
          `${batch.completed} work order${batch.completed === 1 ? "" : "s"} updated in one batch request.`,
        );
      }
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Bulk execution controls could not be saved.",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  async function retryFailedBatch() {
    if (!lastBatch?.failures.length || bulkSaving) return;
    const currentByKey = new Map(rows.map((row) => [row.attackKey, row]));
    const retryRows = lastBatch.failures
      .map((failure) => {
        if (failure.attackKey && currentByKey.has(failure.attackKey)) {
          return currentByKey.get(failure.attackKey) || null;
        }
        return lastBatch.attemptedRows[failure.index] || null;
      })
      .filter((row): row is Row => Boolean(row));
    if (!retryRows.length) {
      setError("The failed rows are no longer available in this queue view.");
      return;
    }
    setSelected(new Set(retryRows.map((row) => row.attackKey)));
    await mutateBulk(lastBatch.operation, lastBatch.draft, retryRows);
  }

  async function runPreset(preset: Preset) {
    if (!selectedRows.length || bulkSaving) return;
    const base = defaultDraft();
    if (preset === "p1_today") {
      const draft = { ...base, priority: 1, dueAt: localDueDate(0) };
      setBulkDraft(draft);
      await mutateBulk("claim", draft);
      return;
    }
    if (preset === "p2_tomorrow") {
      const draft = { ...base, priority: 2, dueAt: localDueDate(1) };
      setBulkDraft(draft);
      await mutateBulk("claim", draft);
      return;
    }
    if (preset === "missing_checklist") {
      const draft = {
        ...base,
        priority: 1,
        dueAt: localDueDate(0),
        blockedReason: "missing_checklist",
      };
      setBulkDraft(draft);
      await mutateBulk("update", draft);
      return;
    }
    setPendingCoverageResolution(true);
  }

  async function confirmCoverageResolution() {
    const draft = { ...defaultDraft(), resolutionCode: "coverage_fixed" };
    setPendingCoverageResolution(false);
    setBulkDraft(draft);
    await mutateBulk("resolve", draft);
  }

  return (
    <section className="bg-neutral-100 px-4 pb-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-4 rounded-[2rem] border border-neutral-900 bg-neutral-950 p-5 text-white shadow-xl lg:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              Tonight&apos;s Listing Operations
            </p>
            <h2 className="mt-1 text-3xl font-black">Execution Queue</h2>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-300">
              Search and sort the entire backlog, jump directly to any matching
              page, and update as many as 250 selected work orders in one
              protected batch.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || bulkSaving}
            className="rounded-xl bg-amber-300 px-4 py-2.5 font-black text-black disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/40 bg-red-950/60 p-4 font-bold text-red-100">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/60 p-4 font-bold text-emerald-100">
            {notice}
          </div>
        ) : null}
        {lastBatch ? (
          <BatchResultPanel
            result={lastBatch}
            busy={bulkSaving}
            onRetry={() => void retryFailedBatch()}
            onDismiss={() => setLastBatch(null)}
          />
        ) : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Unassigned" value={report?.summary.unassignedTargets} />
          <Metric label="Assigned" value={report?.summary.assignedTargets} />
          <Metric label="Overdue" value={report?.summary.overdueTargets} />
          <Metric label="Blocked" value={report?.summary.blockedTargets} />
          <Metric label="Due Review" value={report?.summary.dueForReviewTargets} />
          <Metric
            label="Resolved 14d"
            value={report?.summary.recentlyResolvedTargets}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {quickViews.map((view) => (
            <button
              key={view.value || "all"}
              type="button"
              onClick={() => chooseLane(view.value)}
              className={`rounded-full px-4 py-2 text-sm font-black ${
                lane === view.value
                  ? "bg-amber-300 text-black"
                  : "border border-white/20 bg-white/5 text-white"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-4 xl:grid-cols-[minmax(280px,1fr)_220px_180px_180px_auto]">
          <input
            value={searchInput}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search the full backlog by year, manufacturer, product, sport, set, gap, assignee, blocker, or resolution"
            className="rounded-xl border border-white/20 bg-neutral-900 px-4 py-3 font-bold text-white placeholder:text-neutral-500"
          />
          <select
            value={lane}
            onChange={(event) => chooseLane(event.target.value as Lane | "")}
            className="rounded-xl border border-white/20 bg-neutral-900 px-3 py-3 font-bold text-white"
          >
            <option value="">All execution lanes</option>
            {Object.entries(laneLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => changeSort(event.target.value as Sort)}
            className="rounded-xl border border-white/20 bg-neutral-900 px-3 py-3 font-bold text-white"
          >
            <option value="unlock_desc">Highest unlock</option>
            <option value="priority_asc">P1 first</option>
            <option value="due_asc">Due soonest</option>
            <option value="target_asc">Target A–Z</option>
          </select>
          <select
            value={pageSize}
            onChange={(event) => changePageSize(Number(event.target.value))}
            className="rounded-xl border border-white/20 bg-neutral-900 px-3 py-3 font-bold text-white"
          >
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
            <option value={250}>250 per page</option>
          </select>
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-4 py-3">
            <p className="text-xs font-black uppercase text-amber-200">
              Matching page
            </p>
            <p className="font-black">
              {rows.length} targets · {visibleUnlock.toLocaleString()} unlock
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-sky-300/30 bg-sky-300/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-black text-sky-100">One-click speed presets</p>
              <p className="text-sm font-bold text-neutral-300">
                Apply a complete claim, blocker, or resolution package to{" "}
                {selectedRows.length} selected · {selectedUnlock.toLocaleString()} potential unlock
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <PresetButton
                label="Claim P1 today"
                disabled={!selectedRows.length || bulkSaving}
                onClick={() => void runPreset("p1_today")}
              />
              <PresetButton
                label="Claim P2 tomorrow"
                disabled={!selectedRows.length || bulkSaving}
                onClick={() => void runPreset("p2_tomorrow")}
              />
              <PresetButton
                label="Block: missing checklist"
                disabled={!selectedRows.length || bulkSaving}
                onClick={() => void runPreset("missing_checklist")}
              />
              <PresetButton
                label="Resolve: coverage fixed"
                disabled={!selectedRows.length || bulkSaving}
                onClick={() => void runPreset("coverage_fixed")}
              />
            </div>
          </div>
          {pendingCoverageResolution ? (
            <div
              role="alert"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200/50 bg-neutral-950 p-4"
            >
              <p className="font-black text-white">
                Confirm resolution of {selectedRows.length} selected work orders
                as coverage fixed.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingCoverageResolution(false)}
                  disabled={bulkSaving}
                  className="rounded-lg border border-white/30 px-3 py-2 text-sm font-black"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmCoverageResolution()}
                  disabled={bulkSaving}
                  className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-black disabled:opacity-40"
                >
                  Confirm resolution
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-black text-amber-200">Bulk controls</p>
              <p className="text-sm font-bold text-neutral-300">
                {selectedRows.length} selected from {rows.length} visible · one
                request per action
              </p>
            </div>
            <button
              type="button"
              onClick={toggleAll}
              disabled={!rows.length || bulkSaving}
              className="rounded-lg border border-white/20 px-3 py-2 text-sm font-black disabled:opacity-40"
            >
              {allSelected ? "Clear visible" : "Select visible"}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <input
              value={bulkDraft.assignee}
              onChange={(event) =>
                setBulkDraft((draft) => ({
                  ...draft,
                  assignee: event.target.value,
                }))
              }
              placeholder="Assignee"
              className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"
            />
            <select
              value={bulkDraft.priority}
              onChange={(event) =>
                setBulkDraft((draft) => ({
                  ...draft,
                  priority: Number(event.target.value),
                }))
              }
              className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  P{value}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={bulkDraft.dueAt}
              onChange={(event) =>
                setBulkDraft((draft) => ({
                  ...draft,
                  dueAt: event.target.value,
                }))
              }
              className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"
            />
            <select
              value={bulkDraft.blockedReason}
              onChange={(event) =>
                setBulkDraft((draft) => ({
                  ...draft,
                  blockedReason: event.target.value,
                }))
              }
              className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"
            >
              <option value="">No blocker</option>
              {Object.entries(blockedLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={bulkDraft.resolutionCode}
              onChange={(event) =>
                setBulkDraft((draft) => ({
                  ...draft,
                  resolutionCode: event.target.value,
                }))
              }
              className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"
            >
              <option value="">No resolution yet</option>
              {Object.entries(resolutionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <BulkButton
              label="Claim selected"
              disabled={!selectedRows.length || bulkSaving}
              onClick={() => void mutateBulk("claim")}
            />
            <BulkButton
              label="Release selected"
              disabled={!selectedRows.length || bulkSaving}
              onClick={() => void mutateBulk("release")}
            />
            <BulkButton
              label="Save controls"
              disabled={!selectedRows.length || bulkSaving}
              onClick={() => void mutateBulk("update")}
            />
            <BulkButton
              label="Resolve selected"
              disabled={
                !selectedRows.length ||
                bulkSaving ||
                !bulkDraft.resolutionCode
              }
              onClick={() => void mutateBulk("resolve")}
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white text-neutral-950">
          <table className="w-full min-w-[1540px] text-left">
            <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-4 py-3">Select</th>
                <th className="px-4 py-3">Lane</th>
                <th className="px-4 py-3">Target</th>
                <th className="px-4 py-3">Unlock</th>
                <th className="px-4 py-3">Execution Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center font-black">
                    Loading the full execution queue…
                  </td>
                </tr>
              ) : rows.length ? (
                rows.map((row) => (
                  <ExecutionRow
                    key={`${row.attackKey}-${row.version}`}
                    row={row}
                    selected={selected.has(row.attackKey)}
                    saving={saving === row.attackKey || bulkSaving}
                    onToggle={toggleOne}
                    onMutate={mutate}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center font-black">
                    No work orders match the current full-backlog filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="font-bold text-neutral-300">
            Page {page} of {totalPages} · showing {pagination?.returned || 0} of{" "}
            {(pagination?.totalTargets || 0).toLocaleString()} matching work
            orders
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - pageSize))}
              className="rounded-lg border border-white/20 px-4 py-2 font-black disabled:opacity-40"
            >
              Previous
            </button>
            <form onSubmit={jumpToPage} className="flex gap-2">
              <input
                key={page}
                name="page"
                type="number"
                min={1}
                max={totalPages}
                defaultValue={page}
                aria-label="Page number"
                className="w-24 rounded-lg border border-white/20 bg-neutral-900 px-3 py-2 font-black text-white"
              />
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg border border-white/20 px-4 py-2 font-black disabled:opacity-40"
              >
                Go
              </button>
            </form>
            <button
              type="button"
              disabled={loading || !pagination?.hasMore}
              onClick={() => setOffset(offset + pageSize)}
              className="rounded-lg bg-amber-300 px-4 py-2 font-black text-black disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">
        {value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}

function BatchResultPanel({
  result,
  busy,
  onRetry,
  onDismiss,
}: {
  result: LastBatch;
  busy: boolean;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-violet-300/30 bg-violet-300/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-black text-violet-100">
            Last batch: {operationLabels[result.operation]}
          </p>
          <p className="mt-1 text-sm font-bold text-neutral-300">
            {result.completed} completed · {result.failures.length} failed ·{" "}
            {result.requested} requested
          </p>
        </div>
        <div className="flex gap-2">
          {result.failures.length ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={busy}
              className="rounded-lg bg-violet-200 px-3 py-2 text-sm font-black text-violet-950 disabled:opacity-40"
            >
              Retry failed rows
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-lg border border-white/20 px-3 py-2 text-sm font-black disabled:opacity-40"
          >
            Dismiss
          </button>
        </div>
      </div>
      {result.failures.length ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {result.failures.slice(0, 12).map((failure) => (
            <div
              key={`${failure.index}-${failure.attackKey || "unknown"}`}
              className="rounded-lg border border-red-300/20 bg-red-950/40 p-3"
            >
              <p className="text-xs font-black uppercase text-red-200">
                {failure.code.replaceAll("_", " ")}
              </p>
              <p className="mt-1 break-all text-sm font-bold text-white">
                {failure.attackKey || `Batch item ${failure.index + 1}`}
              </p>
              <p className="mt-1 text-sm font-semibold text-red-100">
                {failure.error}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BulkButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-black disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function PresetButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="rounded-lg bg-sky-200 px-3 py-2 text-sm font-black text-sky-950 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function ExecutionRow({
  row,
  selected,
  saving,
  onToggle,
  onMutate,
}: {
  row: Row;
  selected: boolean;
  saving: boolean;
  onToggle: (key: string) => void;
  onMutate: (
    row: Row,
    operation: Operation,
    draft: Draft,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>({
    assignee: row.assignee || "Truely Collectables Admin",
    priority: row.priority,
    dueAt: localInput(row.dueAt),
    blockedReason: row.blockedReason || "",
    resolutionCode: row.resolutionCode || "",
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onMutate(row, "update", draft);
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(row.attackKey)}
          disabled={saving}
          aria-label={`Select ${row.releaseYear} ${row.manufacturer} ${row.product}`}
          className="h-5 w-5"
        />
      </td>
      <td className="px-4 py-4">
        <span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-black text-white">
          {laneLabels[row.lane]}
        </span>
        <p className="mt-2 text-xs font-bold text-neutral-500">
          {row.status.replaceAll("_", " ")} · P{row.priority}
        </p>
      </td>
      <td className="px-4 py-4">
        <p className="font-black">
          {row.releaseYear} {row.manufacturer} {row.product}
        </p>
        <p className="mt-1 text-sm font-semibold text-neutral-600">
          {row.sport} · {row.setName} · {row.gapType.replaceAll("_", " ")}
        </p>
      </td>
      <td className="px-4 py-4 text-xl font-black">
        {row.potentialUnlock.toLocaleString()}
      </td>
      <td className="px-4 py-4">
        <form onSubmit={submit} className="grid grid-cols-6 gap-2">
          <input
            value={draft.assignee}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                assignee: event.target.value,
              }))
            }
            placeholder="Assignee"
            className="col-span-2 rounded-lg border px-2 py-2 font-bold"
          />
          <select
            value={draft.priority}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: Number(event.target.value),
              }))
            }
            className="rounded-lg border px-2 py-2 font-bold"
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                P{value}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={draft.dueAt}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                dueAt: event.target.value,
              }))
            }
            className="col-span-2 rounded-lg border px-2 py-2 font-bold"
          />
          <select
            value={draft.blockedReason}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                blockedReason: event.target.value,
              }))
            }
            className="col-span-3 rounded-lg border px-2 py-2 font-bold"
          >
            <option value="">No blocker</option>
            {Object.entries(blockedLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={draft.resolutionCode}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                resolutionCode: event.target.value,
              }))
            }
            className="col-span-3 rounded-lg border px-2 py-2 font-bold"
          >
            <option value="">No resolution yet</option>
            {Object.entries(resolutionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <div className="col-span-6 flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onMutate(row, "claim", draft)}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              Claim
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onMutate(row, "release", draft)}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-black disabled:opacity-50"
            >
              Release
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-black px-3 py-2 text-sm font-black text-white disabled:opacity-50"
            >
              Save Controls
            </button>
            <button
              type="button"
              disabled={saving || !draft.resolutionCode}
              onClick={() => void onMutate(row, "resolve", draft)}
              className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-black disabled:opacity-40"
            >
              Record Resolution
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}
