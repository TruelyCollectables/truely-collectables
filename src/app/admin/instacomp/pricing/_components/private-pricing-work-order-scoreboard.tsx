"use client";

import { useCallback, useEffect, useState } from "react";

type Scoreboard = {
  generatedAt: string;
  boundary: "private_coverage_work_order_scoreboard_only";
  summary: {
    totalTargets: number;
    totalPotentialUnlock: number;
    unassignedTargets: number;
    assignedTargets: number;
    overdueTargets: number;
    blockedTargets: number;
    highPriorityTargets: number;
    highPriorityUnassignedTargets: number;
    dueWithin24HoursTargets: number;
    activeAssignees: number;
  };
  priorities: Array<{
    priority: number;
    targets: number;
    potentialUnlock: number;
    overdueTargets: number;
    blockedTargets: number;
  }>;
  assignees: Array<{
    assignee: string;
    targets: number;
    potentialUnlock: number;
    overdueTargets: number;
    blockedTargets: number;
    highPriorityTargets: number;
    dueWithin24HoursTargets: number;
  }>;
};

export default function PrivatePricingWorkOrderScoreboard() {
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        "/api/instacomp/pricing/coverage/work-orders/execution/scoreboard",
        { cache: "no-store", credentials: "same-origin" },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(
          payload?.error || "KINGMAKER operations scoreboard could not load.",
        );
      }
      setScoreboard(payload.scoreboard as Scoreboard);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "KINGMAKER operations scoreboard could not load.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <section className="bg-neutral-100 px-4 pt-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] overflow-hidden rounded-[2rem] border border-neutral-900 bg-white shadow-xl">
        <header className="border-b border-neutral-800 bg-neutral-950 p-5 text-white lg:p-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                KINGMAKER Operations Command
              </p>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">
                Workload Scoreboard
              </h1>
              <p className="mt-2 max-w-4xl font-semibold text-neutral-300">
                See the complete protected queue by assignment, urgency,
                overdue concentration, blocked work, and potential card unlock
                before changing individual work orders.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-right text-xs font-bold text-neutral-400">
                Generated
                <br />
                {scoreboard?.generatedAt
                  ? formatTimestamp(scoreboard.generatedAt)
                  : "—"}
              </p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-xl bg-cyan-300 px-4 py-2.5 font-black text-cyan-950 disabled:opacity-50"
              >
                {loading ? "Loading…" : "Reload scoreboard"}
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-950">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric
              label="All Targets"
              value={scoreboard?.summary.totalTargets}
              loading={loading}
            />
            <Metric
              label="Potential Unlock"
              value={scoreboard?.summary.totalPotentialUnlock}
              loading={loading}
            />
            <Metric
              label="Unassigned"
              value={scoreboard?.summary.unassignedTargets}
              loading={loading}
              warning={Boolean(scoreboard?.summary.unassignedTargets)}
            />
            <Metric
              label="P1/P2 Unassigned"
              value={scoreboard?.summary.highPriorityUnassignedTargets}
              loading={loading}
              warning={Boolean(
                scoreboard?.summary.highPriorityUnassignedTargets,
              )}
            />
            <Metric
              label="Overdue"
              value={scoreboard?.summary.overdueTargets}
              loading={loading}
              warning={Boolean(scoreboard?.summary.overdueTargets)}
            />
            <Metric
              label="Blocked"
              value={scoreboard?.summary.blockedTargets}
              loading={loading}
              warning={Boolean(scoreboard?.summary.blockedTargets)}
            />
            <Metric
              label="Due in 24h"
              value={scoreboard?.summary.dueWithin24HoursTargets}
              loading={loading}
            />
            <Metric
              label="Active Assignees"
              value={scoreboard?.summary.activeAssignees}
              loading={loading}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.75fr)_minmax(720px,1.7fr)]">
            <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-neutral-50">
              <div className="border-b border-neutral-200 bg-white p-5">
                <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
                  Priority Distribution
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  Queue urgency and unlock
                </h2>
              </div>
              <div className="divide-y divide-neutral-200">
                {loading
                  ? Array.from({ length: 5 }, (_, index) => (
                      <LoadingRow key={index} />
                    ))
                  : scoreboard?.priorities.map((priority) => (
                      <div
                        key={priority.priority}
                        className="grid grid-cols-[70px_1fr_auto] items-center gap-3 p-4"
                      >
                        <span className="inline-flex w-fit rounded-full bg-neutral-950 px-3 py-1.5 text-sm font-black text-white">
                          P{priority.priority}
                        </span>
                        <div>
                          <p className="font-black">
                            {formatInteger(priority.targets)} targets
                          </p>
                          <p className="text-sm font-bold text-neutral-500">
                            {formatInteger(priority.overdueTargets)} overdue ·{" "}
                            {formatInteger(priority.blockedTargets)} blocked
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xl font-black">
                            {formatInteger(priority.potentialUnlock)}
                          </p>
                          <p className="text-xs font-black uppercase text-neutral-500">
                            unlock
                          </p>
                        </div>
                      </div>
                    ))}
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-neutral-200 p-5">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-neutral-500">
                    Operator Workload
                  </p>
                  <h2 className="mt-1 text-2xl font-black">
                    Most urgent assignments first
                  </h2>
                </div>
                <p className="max-w-xl text-sm font-bold text-neutral-500">
                  Sorted by overdue work, then high-priority workload and
                  potential unlock. Private notes and source evidence are never
                  included.
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-left">
                  <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500">
                    <tr>
                      <th className="px-4 py-3">Assignee</th>
                      <th className="px-4 py-3">Targets</th>
                      <th className="px-4 py-3">P1/P2</th>
                      <th className="px-4 py-3">Overdue</th>
                      <th className="px-4 py-3">Blocked</th>
                      <th className="px-4 py-3">Due 24h</th>
                      <th className="px-4 py-3 text-right">Unlock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {loading ? (
                      Array.from({ length: 4 }, (_, index) => (
                        <tr key={index}>
                          <td colSpan={7} className="p-4">
                            <div className="h-10 animate-pulse rounded-xl bg-neutral-200" />
                          </td>
                        </tr>
                      ))
                    ) : scoreboard?.assignees.length ? (
                      scoreboard.assignees.map((assignee) => (
                        <tr key={assignee.assignee} className="align-middle">
                          <td className="px-4 py-4 font-black">
                            {assignee.assignee}
                          </td>
                          <td className="px-4 py-4 font-bold">
                            {formatInteger(assignee.targets)}
                          </td>
                          <td className="px-4 py-4 font-bold">
                            {formatInteger(assignee.highPriorityTargets)}
                          </td>
                          <td className="px-4 py-4">
                            <AttentionCount value={assignee.overdueTargets} />
                          </td>
                          <td className="px-4 py-4">
                            <AttentionCount value={assignee.blockedTargets} />
                          </td>
                          <td className="px-4 py-4 font-bold">
                            {formatInteger(assignee.dueWithin24HoursTargets)}
                          </td>
                          <td className="px-4 py-4 text-right text-lg font-black">
                            {formatInteger(assignee.potentialUnlock)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-10 text-center font-black text-neutral-500"
                        >
                          No assigned work orders yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  loading,
  warning = false,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  warning?: boolean;
}) {
  return (
    <article
      className={`rounded-2xl border p-4 ${
        warning
          ? "border-amber-300 bg-amber-50"
          : "border-neutral-200 bg-neutral-50"
      }`}
    >
      <p className="text-[11px] font-black uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      {loading ? (
        <div className="mt-3 h-8 w-16 animate-pulse rounded-lg bg-neutral-200" />
      ) : (
        <p className="mt-2 text-2xl font-black">{formatInteger(value)}</p>
      )}
    </article>
  );
}

function AttentionCount({ value }: { value: number }) {
  return value ? (
    <span className="inline-flex rounded-full bg-red-100 px-3 py-1 text-sm font-black text-red-900">
      {formatInteger(value)}
    </span>
  ) : (
    <span className="font-bold text-neutral-400">0</span>
  );
}

function LoadingRow() {
  return (
    <div className="p-4">
      <div className="h-12 animate-pulse rounded-xl bg-neutral-200" />
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
