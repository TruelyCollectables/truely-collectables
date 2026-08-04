"use client";

import { useCallback, useEffect, useState } from "react";

type ReviewState = "overdue" | "due_soon" | "scheduled" | "unscheduled";
type Row = { rank: number; attackKey: string; status: "queued" | "in_progress" | "blocked"; priority: number; version: number; nextReviewAt: string | null; reviewState: ReviewState; sport: string; releaseYear: string; manufacturer: string; product: string; setName: string; potentialUnlock: number };
type Report = { boundary: "private_coverage_work_order_reviews_only"; summary: { totalOpenTargets: number; overdueTargets: number; dueSoonTargets: number; scheduledTargets: number; unscheduledTargets: number }; rows: Row[] };

const labels: Record<ReviewState, string> = { overdue: "Overdue", due_soon: "Due soon", scheduled: "Scheduled", unscheduled: "Unscheduled" };
function dateInput(value: string | null) { return value ? new Date(value).toISOString().slice(0, 10) : ""; }

export default function PrivatePricingWorkOrderReviews() {
  const [report, setReport] = useState<Report | null>(null);
  const [filter, setFilter] = useState<ReviewState | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: "100", offset: "0" });
      if (filter) query.set("reviewState", filter);
      const response = await fetch(`/api/instacomp/pricing/coverage/work-orders/reviews?${query}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || "Review planner could not be loaded.");
      setReport(payload.reviews as Report);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review planner could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(row: Row, nextReviewAt: string) {
    setSaving(row.attackKey);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/instacomp/pricing/coverage/work-orders/reviews", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attackKey: row.attackKey, nextReviewAt: nextReviewAt ? `${nextReviewAt}T12:00:00.000Z` : null, expectedVersion: row.version }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || "Review date could not be saved.");
      setNotice(nextReviewAt ? "Review date scheduled." : "Review date cleared.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review date could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return <section className="mt-8 w-full rounded-2xl border border-slate-700 bg-slate-950 p-6 text-slate-100">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Private operating layer</p><h2 className="mt-1 text-2xl font-bold">Coverage Review Planner</h2><p className="mt-2 max-w-3xl text-sm text-slate-300">Schedule follow-up dates for open coverage work. Overdue and due-soon work rises first; private notes and pricing values are never returned here.</p></div>
      <label className="text-sm text-slate-300">Attention state <select className="ml-2 rounded border border-slate-600 bg-slate-900 px-3 py-2" value={filter} onChange={(event) => setFilter(event.target.value as ReviewState | "")}><option value="">All open work</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {report && <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">{[["Open", report.summary.totalOpenTargets], ["Overdue", report.summary.overdueTargets], ["Due soon", report.summary.dueSoonTargets], ["Scheduled", report.summary.scheduledTargets], ["Unscheduled", report.summary.unscheduledTargets]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-700 bg-slate-900 p-3"><div className="text-xs text-slate-400">{label}</div><div className="text-xl font-semibold">{value}</div></div>)}</div>}
    {error && <p className="mt-4 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
    {notice && <p className="mt-4 rounded border border-emerald-700 bg-emerald-950/50 p-3 text-sm text-emerald-200">{notice}</p>}
    {loading ? <p className="mt-6 text-sm text-slate-400">Loading review planner…</p> : <div className="mt-6 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="p-2">Target</th><th className="p-2">State</th><th className="p-2">Priority</th><th className="p-2">Unlock</th><th className="p-2">Next review</th><th className="p-2">Action</th></tr></thead><tbody>{report?.rows.map((row) => <ReviewRow key={`${row.attackKey}:${row.nextReviewAt ?? "none"}`} row={row} saving={saving === row.attackKey} onSave={save} />)}</tbody></table>{!report?.rows.length && <p className="py-8 text-center text-slate-400">No open work matches this attention state.</p>}</div>}
  </section>;
}

function ReviewRow({ row, saving, onSave }: { row: Row; saving: boolean; onSave: (row: Row, value: string) => Promise<void> }) {
  const [value, setValue] = useState(dateInput(row.nextReviewAt));
  return <tr className="border-t border-slate-800 align-top"><td className="p-2"><div className="font-medium">{row.releaseYear} {row.manufacturer} {row.product}</div><div className="text-xs text-slate-400">{row.setName} · {row.sport}</div></td><td className="p-2">{labels[row.reviewState]}</td><td className="p-2">P{row.priority}</td><td className="p-2">{row.potentialUnlock.toLocaleString()}</td><td className="p-2"><input type="date" className="rounded border border-slate-600 bg-slate-900 px-2 py-1" value={value} onChange={(event) => setValue(event.target.value)} /></td><td className="p-2"><div className="flex gap-2"><button type="button" disabled={saving} className="rounded bg-cyan-700 px-3 py-1 font-medium disabled:opacity-50" onClick={() => void onSave(row, value)}>{saving ? "Saving…" : "Save"}</button><button type="button" disabled={saving || !row.nextReviewAt} className="rounded border border-slate-600 px-3 py-1 disabled:opacity-50" onClick={() => { setValue(""); void onSave(row, ""); }}>Clear</button></div></td></tr>;
}
