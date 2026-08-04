"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Lane = "unassigned" | "assigned" | "overdue" | "blocked" | "due_for_review" | "recently_resolved";
type Operation = "claim" | "release" | "update" | "resolve";
type Row = {
  rank: number; attackKey: string; lane: Lane; status: string; priority: number; version: number;
  assignee: string | null; dueAt: string | null; nextReviewAt: string | null;
  blockedReason: string | null; resolutionCode: string | null; updatedAt: string | null;
  sport: string; releaseYear: string; manufacturer: string; product: string; setName: string;
  gapType: string; potentialUnlock: number;
};
type Report = {
  summary: { totalTargets: number; unassignedTargets: number; assignedTargets: number; overdueTargets: number; blockedTargets: number; dueForReviewTargets: number; recentlyResolvedTargets: number };
  rows: Row[];
};
type Draft = { assignee: string; priority: number; dueAt: string; blockedReason: string; resolutionCode: string };

const laneLabels: Record<Lane, string> = {
  unassigned: "Unassigned", assigned: "Assigned", overdue: "Overdue", blocked: "Blocked", due_for_review: "Due for review", recently_resolved: "Recently resolved",
};
const blockedLabels: Record<string, string> = {
  missing_checklist: "Missing checklist", missing_pricing_source: "Missing pricing source", identity_conflict: "Identity conflict", insufficient_evidence: "Insufficient evidence", source_access_problem: "Source access problem", other: "Other",
};
const resolutionLabels: Record<string, string> = {
  coverage_fixed: "Coverage fixed", no_action_needed: "No action needed", invalid_target: "Invalid target", more_evidence_required: "More evidence required", dismissed_duplicate: "Duplicate target",
};
const defaultDraft = (): Draft => ({ assignee: "Truely Collectables Admin", priority: 3, dueAt: "", blockedReason: "", resolutionCode: "" });

function localInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
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
  const response = await fetch("/api/instacomp/pricing/coverage/work-orders/execution", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify(payloadFor(row, operation, draft)),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || "Execution control could not be saved.");
}

export default function PrivatePricingWorkOrderExecution() {
  const [report, setReport] = useState<Report | null>(null);
  const [lane, setLane] = useState<Lane | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDraft, setBulkDraft] = useState<Draft>(defaultDraft);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ limit: "100", offset: "0" });
      if (lane) query.set("lane", lane);
      const response = await fetch(`/api/instacomp/pricing/coverage/work-orders/execution?${query}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || "Execution queue could not be loaded.");
      setReport(payload.execution as Report);
      setSelected(new Set());
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Execution queue could not be loaded."); }
    finally { setLoading(false); }
  }, [lane]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const rows = report?.rows || [];
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.attackKey)), [rows, selected]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  function toggleAll() { setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.attackKey))); }
  function toggleOne(attackKey: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(attackKey)) next.delete(attackKey); else next.add(attackKey);
      return next;
    });
  }

  async function mutate(row: Row, operation: Operation, draft: Draft) {
    setSaving(row.attackKey); setError(null); setNotice(null);
    try {
      await saveExecution(row, operation, draft);
      setNotice(`${row.releaseYear} ${row.manufacturer} ${row.product} updated.`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Execution control could not be saved."); }
    finally { setSaving(null); }
  }

  async function mutateBulk(operation: Operation) {
    if (!selectedRows.length) return;
    if (operation === "resolve" && !bulkDraft.resolutionCode) { setError("Choose a resolution before recording bulk resolutions."); return; }
    setBulkSaving(true); setError(null); setNotice(null);
    const failures: string[] = [];
    let completed = 0;
    for (const row of selectedRows) {
      try { await saveExecution(row, operation, bulkDraft); completed += 1; }
      catch (cause) { failures.push(`${row.releaseYear} ${row.manufacturer} ${row.product}: ${cause instanceof Error ? cause.message : "failed"}`); }
    }
    if (failures.length) setError(`${completed} updated; ${failures.length} failed. ${failures.slice(0, 3).join(" | ")}`);
    else setNotice(`${completed} work order${completed === 1 ? "" : "s"} updated.`);
    await load();
    setBulkSaving(false);
  }

  return (
    <section className="bg-neutral-100 px-4 pb-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1680px] space-y-4 rounded-[2rem] border border-neutral-900 bg-neutral-950 p-5 text-white shadow-xl lg:p-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">Tonight&apos;s Listing Operations</p>
            <h2 className="mt-1 text-3xl font-black">Execution Queue</h2>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-300">Claim, assign, schedule, block, release, or resolve one work order—or apply the same controls to a selected batch.</p>
          </div>
          <div className="flex gap-2">
            <select value={lane} onChange={(event) => setLane(event.target.value as Lane | "")} className="rounded-xl border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white">
              <option value="">All execution lanes</option>
              {Object.entries(laneLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" onClick={() => void load()} disabled={loading || bulkSaving} className="rounded-xl bg-amber-300 px-4 py-2.5 font-black text-black disabled:opacity-50">{loading ? "Loading…" : "Reload"}</button>
          </div>
        </div>

        {error ? <div className="rounded-2xl border border-red-400/40 bg-red-950/60 p-4 font-bold text-red-100">{error}</div> : null}
        {notice ? <div className="rounded-2xl border border-emerald-400/40 bg-emerald-950/60 p-4 font-bold text-emerald-100">{notice}</div> : null}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Unassigned" value={report?.summary.unassignedTargets} />
          <Metric label="Assigned" value={report?.summary.assignedTargets} />
          <Metric label="Overdue" value={report?.summary.overdueTargets} />
          <Metric label="Blocked" value={report?.summary.blockedTargets} />
          <Metric label="Due Review" value={report?.summary.dueForReviewTargets} />
          <Metric label="Resolved 14d" value={report?.summary.recentlyResolvedTargets} />
        </div>

        <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-black text-amber-200">Bulk controls</p><p className="text-sm font-bold text-neutral-300">{selectedRows.length} selected from this page</p></div>
            <button type="button" onClick={toggleAll} disabled={!rows.length || bulkSaving} className="rounded-lg border border-white/20 px-3 py-2 text-sm font-black disabled:opacity-40">{allSelected ? "Clear page" : "Select page"}</button>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <input value={bulkDraft.assignee} onChange={(e) => setBulkDraft((d) => ({ ...d, assignee: e.target.value }))} placeholder="Assignee" className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white" />
            <select value={bulkDraft.priority} onChange={(e) => setBulkDraft((d) => ({ ...d, priority: Number(e.target.value) }))} className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white">{[1,2,3,4,5].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
            <input type="datetime-local" value={bulkDraft.dueAt} onChange={(e) => setBulkDraft((d) => ({ ...d, dueAt: e.target.value }))} className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white" />
            <select value={bulkDraft.blockedReason} onChange={(e) => setBulkDraft((d) => ({ ...d, blockedReason: e.target.value }))} className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"><option value="">No blocker</option>{Object.entries(blockedLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
            <select value={bulkDraft.resolutionCode} onChange={(e) => setBulkDraft((d) => ({ ...d, resolutionCode: e.target.value }))} className="rounded-lg border border-white/20 bg-neutral-900 px-3 py-2.5 font-bold text-white"><option value="">No resolution yet</option>{Object.entries(resolutionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <BulkButton label="Claim selected" disabled={!selectedRows.length || bulkSaving} onClick={() => void mutateBulk("claim")} />
            <BulkButton label="Release selected" disabled={!selectedRows.length || bulkSaving} onClick={() => void mutateBulk("release")} />
            <BulkButton label="Save controls" disabled={!selectedRows.length || bulkSaving} onClick={() => void mutateBulk("update")} />
            <BulkButton label="Resolve selected" disabled={!selectedRows.length || bulkSaving || !bulkDraft.resolutionCode} onClick={() => void mutateBulk("resolve")} />
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white text-neutral-950">
          <table className="min-w-[1540px] w-full text-left">
            <thead className="bg-neutral-100 text-xs font-black uppercase tracking-wider text-neutral-500"><tr><th className="px-4 py-3">Select</th><th className="px-4 py-3">Lane</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Unlock</th><th className="px-4 py-3">Execution Controls</th></tr></thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? <tr><td colSpan={5} className="p-8 text-center font-black">Loading execution queue…</td></tr> : rows.length ? rows.map((row) => <ExecutionRow key={`${row.attackKey}-${row.version}`} row={row} selected={selected.has(row.attackKey)} saving={saving === row.attackKey || bulkSaving} onToggle={toggleOne} onMutate={mutate} />) : <tr><td colSpan={5} className="p-8 text-center font-black">No work orders match this lane.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value?: number }) { return <div className="rounded-2xl border border-white/10 bg-white/5 p-3"><p className="text-xs font-black uppercase tracking-wider text-neutral-400">{label}</p><p className="mt-1 text-2xl font-black">{value === undefined ? "—" : value.toLocaleString()}</p></div>; }
function BulkButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) { return <button type="button" disabled={disabled} onClick={onClick} className="rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-black disabled:opacity-40">{label}</button>; }

function ExecutionRow({ row, selected, saving, onToggle, onMutate }: { row: Row; selected: boolean; saving: boolean; onToggle: (attackKey: string) => void; onMutate: (row: Row, operation: Operation, draft: Draft) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>({ assignee: row.assignee || "Truely Collectables Admin", priority: row.priority, dueAt: localInput(row.dueAt), blockedReason: row.blockedReason || "", resolutionCode: row.resolutionCode || "" });
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void onMutate(row, "update", draft); }
  return <tr className="align-top">
    <td className="px-4 py-4"><input type="checkbox" checked={selected} onChange={() => onToggle(row.attackKey)} disabled={saving} aria-label={`Select ${row.releaseYear} ${row.manufacturer} ${row.product}`} className="h-5 w-5" /></td>
    <td className="px-4 py-4"><span className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-black text-white">{laneLabels[row.lane]}</span><p className="mt-2 text-xs font-bold text-neutral-500">{row.status.replaceAll("_", " ")}</p></td>
    <td className="px-4 py-4"><p className="font-black">{row.releaseYear} {row.manufacturer} {row.product}</p><p className="mt-1 text-sm font-semibold text-neutral-600">{row.sport} · {row.setName} · {row.gapType.replaceAll("_", " ")}</p></td>
    <td className="px-4 py-4 text-xl font-black">{row.potentialUnlock.toLocaleString()}</td>
    <td className="px-4 py-4">
      <form onSubmit={submit} className="grid grid-cols-6 gap-2">
        <input value={draft.assignee} onChange={(e) => setDraft((d) => ({ ...d, assignee: e.target.value }))} placeholder="Assignee" className="col-span-2 rounded-lg border px-2 py-2 font-bold" />
        <select value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: Number(e.target.value) }))} className="rounded-lg border px-2 py-2 font-bold">{[1,2,3,4,5].map((value) => <option key={value} value={value}>P{value}</option>)}</select>
        <input type="datetime-local" value={draft.dueAt} onChange={(e) => setDraft((d) => ({ ...d, dueAt: e.target.value }))} className="col-span-2 rounded-lg border px-2 py-2 font-bold" />
        <select value={draft.blockedReason} onChange={(e) => setDraft((d) => ({ ...d, blockedReason: e.target.value }))} className="col-span-3 rounded-lg border px-2 py-2 font-bold"><option value="">No blocker</option>{Object.entries(blockedLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <select value={draft.resolutionCode} onChange={(e) => setDraft((d) => ({ ...d, resolutionCode: e.target.value }))} className="col-span-3 rounded-lg border px-2 py-2 font-bold"><option value="">No resolution yet</option>{Object.entries(resolutionLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
        <div className="col-span-6 flex flex-wrap gap-2 pt-1">
          <button type="button" disabled={saving} onClick={() => void onMutate(row, "claim", draft)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white disabled:opacity-50">Claim</button>
          <button type="button" disabled={saving} onClick={() => void onMutate(row, "release", draft)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-black disabled:opacity-50">Release</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-black px-3 py-2 text-sm font-black text-white disabled:opacity-50">Save Controls</button>
          <button type="button" disabled={saving || !draft.resolutionCode} onClick={() => void onMutate(row, "resolve", draft)} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-black disabled:opacity-40">Record Resolution</button>
        </div>
      </form>
    </td>
  </tr>;
}
