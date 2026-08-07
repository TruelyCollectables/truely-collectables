"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Job = {
  job_id?: string;
  trigger?: string;
  status?: string;
  started_at?: string | null;
  completed_at?: string | null;
  heartbeat_at?: string | null;
  total_targets?: number;
  processed_targets?: number;
  found_count?: number;
  downloaded_count?: number;
  imported_count?: number;
  duplicate_count?: number;
  failed_count?: number;
  current_target_key?: string | null;
  progress_percent?: number;
  error?: string | null;
};

type SentinelStatus = {
  name?: string;
  enabled?: boolean;
  schedule_hours?: number;
  checkpoint_seconds?: number;
  freeze_protection?: {
    stale?: boolean;
    sqlite_wal?: boolean;
    atomic_downloads?: boolean;
    heartbeat?: boolean;
    resume_pending_targets?: boolean;
  };
  targets?: { pending?: number; total?: number; [key: string]: number | undefined };
  latest_job?: Job | null;
  registry_import_configured?: boolean;
  target_feed_configured?: boolean;
};

type ProxyPayload = {
  ok?: boolean;
  data?: SentinelStatus | Record<string, unknown>;
  error?: string;
  code?: string;
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wide ${
        ok
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          : "border-red-400/40 bg-red-400/10 text-red-200"
      }`}
    >
      {children}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs font-bold uppercase tracking-[0.16em] text-neutral-400">{label}</div>
      <div className="mt-2 text-3xl font-black text-white">{value}</div>
    </div>
  );
}

export default function ChecklistSentinelAdminPage() {
  const [status, setStatus] = useState<SentinelStatus | null>(null);
  const [downloads, setDownloads] = useState<Record<string, unknown>[]>([]);
  const [findings, setFindings] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [statusResponse, downloadsResponse, findingsResponse] = await Promise.all([
        fetch("/api/instacomp/checklist-sentinel?view=status", { cache: "no-store" }),
        fetch("/api/instacomp/checklist-sentinel?view=downloads", { cache: "no-store" }),
        fetch("/api/instacomp/checklist-sentinel?view=findings", { cache: "no-store" }),
      ]);
      const [statusPayload, downloadsPayload, findingsPayload] = (await Promise.all([
        statusResponse.json(),
        downloadsResponse.json(),
        findingsResponse.json(),
      ])) as ProxyPayload[];
      if (!statusResponse.ok || !statusPayload.ok) {
        throw new Error(statusPayload.error || "Sentinel status could not be loaded.");
      }
      setStatus(statusPayload.data as SentinelStatus);
      const downloadData = downloadsPayload.data as { downloads?: Record<string, unknown>[] } | undefined;
      const findingData = findingsPayload.data as { findings?: Record<string, unknown>[] } | undefined;
      setDownloads(Array.isArray(downloadData?.downloads) ? downloadData.downloads : []);
      setFindings(Array.isArray(findingData?.findings) ? findingData.findings : []);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Sentinel dashboard failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
    };
  }, [load]);

  async function action(actionName: "run" | "refresh-targets") {
    setWorking(true);
    setError(null);
    try {
      const response = await fetch("/api/instacomp/checklist-sentinel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: actionName }),
      });
      const payload = (await response.json()) as ProxyPayload;
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Sentinel action failed.");
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Sentinel action failed.");
    } finally {
      setWorking(false);
    }
  }

  const job = status?.latest_job || null;
  const progress = Math.max(0, Math.min(100, number(job?.progress_percent)));
  const connectionHealthy = Boolean(
    status?.enabled && !status.freeze_protection?.stale,
  );
  const archived = useMemo(
    () =>
      downloads.filter((row) =>
        String(row.status || "").includes("imported_registry"),
      ).length,
    [downloads],
  );
  const leadOnly = useMemo(
    () => findings.filter((row) => String(row.status || "") === "lead_only").length,
    [findings],
  );

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-white sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-cyan-300/20 bg-gradient-to-br from-cyan-400/10 via-neutral-950 to-blue-500/10 p-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.24em] text-cyan-300">InstaComp AI</div>
            <h1 className="mt-2 text-3xl font-black sm:text-5xl">Checklist Sentinel™</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-neutral-300">
              The Mac owns the 24-hour checklist search. This page securely controls and reads it through Vercel and the permanent Cloudflare tunnel.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill ok={connectionHealthy}>{connectionHealthy ? "Mac connected" : "Mac unavailable"}</StatusPill>
            <StatusPill ok={Boolean(status?.registry_import_configured)}>
              {status?.registry_import_configured ? "Central archive on" : "Central archive off"}
            </StatusPill>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-400/40 bg-red-400/10 p-4 font-bold text-red-100">{error}</div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Metric label="Progress" value={`${progress.toFixed(1)}%`} />
          <Metric label="Pending targets" value={number(status?.targets?.pending)} />
          <Metric label="Processed" value={number(job?.processed_targets)} />
          <Metric label="Found" value={number(job?.found_count)} />
          <Metric label="Downloaded" value={number(job?.downloaded_count)} />
          <Metric label="Archived" value={Math.max(number(job?.imported_count), archived)} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-black">Current run</h2>
              <p className="mt-1 text-sm text-neutral-400">{job?.status || (loading ? "Loading…" : "No run recorded")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={working}
                onClick={() => void action("run")}
                className="rounded-xl bg-cyan-300 px-4 py-3 text-sm font-black text-neutral-950 disabled:opacity-50"
              >
                Run now
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void action("refresh-targets")}
                className="rounded-xl border border-white/20 px-4 py-3 text-sm font-black disabled:opacity-50"
              >
                Refresh targets
              </button>
              <button
                type="button"
                disabled={working}
                onClick={() => void load()}
                className="rounded-xl border border-white/20 px-4 py-3 text-sm font-black disabled:opacity-50"
              >
                Refresh status
              </button>
            </div>
          </div>
          <div className="mt-5 h-4 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-cyan-300 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-neutral-500">Current target:</span><br />{job?.current_target_key || "None"}</div>
            <div><span className="text-neutral-500">Started:</span><br />{dateTime(job?.started_at)}</div>
            <div><span className="text-neutral-500">Heartbeat:</span><br />{dateTime(job?.heartbeat_at)}</div>
            <div><span className="text-neutral-500">Failures:</span><br />{number(job?.failed_count)}</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-black">Freeze protection</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <StatusPill ok={Boolean(status?.freeze_protection?.sqlite_wal)}>SQLite WAL</StatusPill>
              <StatusPill ok={Boolean(status?.freeze_protection?.atomic_downloads)}>Atomic files</StatusPill>
              <StatusPill ok={Boolean(status?.freeze_protection?.heartbeat)}>Heartbeat</StatusPill>
              <StatusPill ok={Boolean(status?.freeze_protection?.resume_pending_targets)}>Safe resume</StatusPill>
            </div>
            <p className="mt-5 text-sm text-neutral-400">
              Checkpoint every {number(status?.checkpoint_seconds)} seconds. Daily schedule: {number(status?.schedule_hours)} hours.
            </p>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <h2 className="text-xl font-black">Latest evidence</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Metric label="Download receipts" value={downloads.length} />
              <Metric label="Community leads" value={leadOnly} />
            </div>
            <p className="mt-4 text-sm text-neutral-400">
              Community sources remain lead-only until provenance and redistribution permission are verified.
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-neutral-500">
          <span>Dashboard refreshes every five minutes. Last read: {updatedAt ? updatedAt.toLocaleString() : "Not yet"}</span>
          <Link href="/admin" className="font-bold text-cyan-300 hover:text-cyan-200">Back to Admin</Link>
        </div>
      </div>
    </main>
  );
}
