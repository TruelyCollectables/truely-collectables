"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Snapshot = {
  window: { receiptLimit: number; limited: boolean };
  receipts: {
    total: number;
    ready: number;
    reviewRequired: number;
    insufficientEvidence: number;
    readyRate: number | null;
    averageConfidence: number | null;
    averageSoldCompCount: number | null;
    estimatedProfitAtCeiling: number;
  };
  profiles: { active: number; hasDefault: boolean };
  savedViews: { active: number; hasDefault: boolean };
  audit: Array<{
    id: string;
    profileId: string | null;
    action: string;
    profileName: string;
    createdAt: string;
  }>;
  boundary: "advisory_only";
};

type Mode = "receipts" | "analytics" | "profiles" | "review" | "views" | "audit";

type Props = {
  mode: Mode;
  title: string;
  eyebrow: string;
  description: string;
};

const nav: Array<{ mode: Mode; label: string; href: string }> = [
  { mode: "receipts", label: "Receipts", href: "/admin/instacomp/pricing/receipts" },
  { mode: "analytics", label: "Analytics", href: "/admin/instacomp/pricing/analytics" },
  { mode: "profiles", label: "Profiles", href: "/admin/instacomp/pricing/profiles" },
  { mode: "review", label: "Review Queue", href: "/admin/instacomp/pricing/review" },
  { mode: "views", label: "Saved Views", href: "/admin/instacomp/pricing/views" },
  { mode: "audit", label: "Audit", href: "/admin/instacomp/pricing/audit" },
];

export default function PricingWorkbench({ mode, title, eyebrow, description }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/instacomp/pricing/command-center", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not load pricing operations.");
      setSnapshot(payload.snapshot as Snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load pricing operations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, []);

  const cards = useMemo(() => snapshot ? buildCards(mode, snapshot) : [], [mode, snapshot]);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-xl">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(245,158,11,0.22),_transparent_35%)] p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/instacomp/pricing" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  ← Command Center
                </Link>
                <Link href="/admin" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  Main Admin
                </Link>
              </div>
              <button onClick={() => void refresh()} disabled={loading} className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-black disabled:opacity-50">
                {loading ? "Refreshing…" : "Refresh Data"}
              </button>
            </div>
            <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-amber-300">{eyebrow}</p>
            <h1 className="mt-2 text-4xl font-black md:text-5xl">{title}</h1>
            <p className="mt-3 max-w-4xl font-semibold text-neutral-300">{description}</p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-emerald-200">Advisory only</span>
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-cyan-200">Owner scoped</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">No hidden mutations</span>
            </div>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm">
          {nav.map((item) => (
            <Link key={item.mode} href={item.href} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${item.mode === mode ? "bg-black text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
              {item.label}
            </Link>
          ))}
        </nav>

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider">Data unavailable</p>
            <h2 className="mt-1 text-2xl font-black">Pricing operations could not load</h2>
            <p className="mt-2 font-semibold">{error}</p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-3xl border border-neutral-200 bg-white" />
              ))
            : cards.map((card) => <MetricCard key={card.label} {...card} />)}
        </section>

        {!loading && snapshot ? <ModePanel mode={mode} snapshot={snapshot} /> : null}
      </div>
    </main>
  );
}

function buildCards(mode: Mode, snapshot: Snapshot): Array<{ label: string; value: string; detail: string }> {
  const r = snapshot.receipts;
  const percent = (value: number | null) => value === null ? "—" : `${Math.round(value * 100)}%`;
  const number = (value: number | null) => value === null ? "—" : value.toFixed(1);
  const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

  if (mode === "profiles") return [
    { label: "Active Profiles", value: String(snapshot.profiles.active), detail: "Available pricing configurations" },
    { label: "Default Profile", value: snapshot.profiles.hasDefault ? "Ready" : "Missing", detail: "Required for consistent decisions" },
    { label: "Recent Audit Events", value: String(snapshot.audit.length), detail: "Latest profile lifecycle activity" },
    { label: "Operating Boundary", value: "Advisory", detail: "No product or purchase mutation" },
  ];
  if (mode === "views") return [
    { label: "Active Views", value: String(snapshot.savedViews.active), detail: "Reusable operating filters" },
    { label: "Default View", value: snapshot.savedViews.hasDefault ? "Ready" : "Not set", detail: "Primary receipt workspace" },
    { label: "Receipt Window", value: String(snapshot.window.receiptLimit), detail: "Bounded operational snapshot" },
    { label: "Ready Decisions", value: String(r.ready), detail: "Available for saved filters" },
  ];
  if (mode === "review") return [
    { label: "Review Required", value: String(r.reviewRequired), detail: "Needs operator attention" },
    { label: "Insufficient Evidence", value: String(r.insufficientEvidence), detail: "Needs stronger sold evidence" },
    { label: "Average Confidence", value: percent(r.averageConfidence), detail: "Across the current window" },
    { label: "Average Sold Comps", value: number(r.averageSoldCompCount), detail: "Verified evidence depth" },
  ];
  if (mode === "audit") return [
    { label: "Visible Events", value: String(snapshot.audit.length), detail: "Newest immutable profile events" },
    { label: "Active Profiles", value: String(snapshot.profiles.active), detail: "Current configuration set" },
    { label: "Default Profile", value: snapshot.profiles.hasDefault ? "Present" : "Missing", detail: "Current operating default" },
    { label: "Boundary", value: "Read only", detail: "Audit history is not editable" },
  ];
  if (mode === "analytics") return [
    { label: "Ready Rate", value: percent(r.readyRate), detail: `${r.ready} of ${r.total} decisions ready` },
    { label: "Average Confidence", value: percent(r.averageConfidence), detail: "Identity and evidence strength" },
    { label: "Average Sold Comps", value: number(r.averageSoldCompCount), detail: "Verified evidence depth" },
    { label: "Estimated Profit", value: money(r.estimatedProfitAtCeiling), detail: "At advisory buy ceilings" },
  ];
  return [
    { label: "Receipt Window", value: String(r.total), detail: `Latest ${snapshot.window.receiptLimit} maximum` },
    { label: "Ready", value: String(r.ready), detail: "Advisory decisions ready for review" },
    { label: "Review Required", value: String(r.reviewRequired), detail: "Identity or economics need attention" },
    { label: "Insufficient Evidence", value: String(r.insufficientEvidence), detail: "Not enough verified sold comps" },
  ];
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-600">{detail}</p>
    </article>
  );
}

function ModePanel({ mode, snapshot }: { mode: Mode; snapshot: Snapshot }) {
  if (mode === "audit") return <AuditPanel events={snapshot.audit} />;
  if (mode === "review") return <ReviewPanel snapshot={snapshot} />;
  if (mode === "profiles") return <ProfilePanel snapshot={snapshot} />;
  if (mode === "views") return <ViewsPanel snapshot={snapshot} />;
  if (mode === "analytics") return <AnalyticsPanel snapshot={snapshot} />;
  return <ReceiptPanel snapshot={snapshot} />;
}

function ReceiptPanel({ snapshot }: { snapshot: Snapshot }) {
  const rows: Array<[string, number, string]> = [
    ["Ready", snapshot.receipts.ready, "Evidence and economics cleared"],
    ["Review required", snapshot.receipts.reviewRequired, "Operator judgment required"],
    ["Insufficient evidence", snapshot.receipts.insufficientEvidence, "More verified sold comps required"],
  ];
  return <DataTable title="Receipt status desk" rows={rows} />;
}

function AnalyticsPanel({ snapshot }: { snapshot: Snapshot }) {
  const total = Math.max(snapshot.receipts.total, 1);
  const bars = [
    ["Ready", snapshot.receipts.ready / total],
    ["Review required", snapshot.receipts.reviewRequired / total],
    ["Insufficient evidence", snapshot.receipts.insufficientEvidence / total],
  ] as const;
  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-black">Decision quality distribution</h2>
      <div className="mt-5 space-y-4">
        {bars.map(([label, value]) => <Progress key={label} label={label} value={value} />)}
      </div>
    </section>
  );
}

function ProfilePanel({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ActionCard title="Profile readiness" detail={snapshot.profiles.hasDefault ? "A default pricing profile is active and available for decisions." : "No default profile is available. Set one before relying on consistent economics."} href="/api/instacomp/pricing/profiles" action="Open profile API" />
      <ActionCard title="Profile comparison" detail="Compare up to ten profile scenarios before changing the active operating profile." href="/admin/instacomp/pricing/scenarios" action="Compare scenarios" />
    </section>
  );
}

function ReviewPanel({ snapshot }: { snapshot: Snapshot }) {
  const rows: Array<[string, number, string]> = [
    ["Review required", snapshot.receipts.reviewRequired, "Check identity, confidence, fees, shipping, and acquisition cost"],
    ["Insufficient evidence", snapshot.receipts.insufficientEvidence, "Do not act until verified sold evidence improves"],
  ];
  return <DataTable title="Exception queue" rows={rows} />;
}

function ViewsPanel({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <ActionCard title="Saved operating views" detail={`${snapshot.savedViews.active} active views are available. Views preserve common receipt filters without changing any pricing result.`} href="/api/instacomp/pricing/views" action="Open saved-view API" />
      <ActionCard title="Receipt workspace" detail="Apply saved filters against immutable pricing receipts and export the visible advisory set." href="/admin/instacomp/pricing/receipts" action="Open receipts" />
    </section>
  );
}

function AuditPanel({ events }: { events: Snapshot["audit"] }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 p-6"><h2 className="text-2xl font-black">Immutable profile activity</h2></div>
      <div className="divide-y divide-neutral-200">
        {events.length ? events.map((event) => (
          <div key={event.id} className="grid gap-2 p-5 md:grid-cols-[1fr_auto]">
            <div><p className="font-black">{event.profileName}</p><p className="text-sm font-semibold text-neutral-600">{event.action.replaceAll("_", " ")}</p></div>
            <time className="text-sm font-bold text-neutral-500">{new Date(event.createdAt).toLocaleString()}</time>
          </div>
        )) : <p className="p-6 font-semibold text-neutral-600">No profile activity is visible yet.</p>}
      </div>
    </section>
  );
}

function DataTable({ title, rows }: { title: string; rows: Array<[string, number, string]> }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 p-6"><h2 className="text-2xl font-black">{title}</h2></div>
      <div className="divide-y divide-neutral-200">
        {rows.map(([label, count, detail]) => (
          <div key={label} className="grid gap-3 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div><p className="font-black">{label}</p><p className="text-sm font-semibold text-neutral-600">{detail}</p></div>
            <span className="inline-flex min-w-14 justify-center rounded-full bg-neutral-950 px-4 py-2 text-lg font-black text-white">{count}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionCard({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return (
    <article className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-black">{title}</h2>
      <p className="mt-3 font-semibold leading-6 text-neutral-600">{detail}</p>
      <Link href={href} className="mt-5 inline-flex rounded-full bg-black px-4 py-2.5 text-sm font-black text-white">{action}</Link>
    </article>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const width = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
  return (
    <div>
      <div className="flex justify-between gap-3 text-sm font-black"><span>{label}</span><span>{width}</span></div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-neutral-200"><div className="h-full rounded-full bg-neutral-950" style={{ width }} /></div>
    </div>
  );
}
