"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type GapType =
  | "missing_release"
  | "checklist_pending"
  | "set_gap"
  | "identity_gap";

type CoverageRow = {
  rank: number;
  gapType: GapType;
  sport: string;
  releaseYear: string;
  manufacturer: string;
  product: string;
  setName: string;
  potentialUnlock: number;
  unmatchedRows: number;
  ambiguousRows: number;
  distinctCardNumbers: number;
  guideCount: number;
  averageParseConfidence: number | null;
  latestReferenceDate: string | null;
  registryReleaseCount: number;
  activeVersionCount: number;
  matchingSetCount: number;
  activeIdentityCount: number;
  recommendedAction: string;
};

type Coverage = {
  generatedAt: string;
  boundary: "aggregate_private_reference_only";
  summary: {
    totalGroups: number;
    unresolvedRows: number;
    unmatchedRows: number;
    ambiguousRows: number;
    missingReleaseRows: number;
    checklistPendingRows: number;
    setGapRows: number;
    identityGapRows: number;
    largestUnlock: number;
  };
  pagination: {
    limit: number;
    offset: number;
    returned: number;
    totalGroups: number;
    hasMore: boolean;
  };
  rows: CoverageRow[];
};

type ActiveFilters = {
  gapType: GapType | "";
  sport: string;
  search: string;
};

const LIMIT = 100;

const pricingNav = [
  ["Receipts", "/admin/instacomp/pricing/receipts"],
  ["Analytics", "/admin/instacomp/pricing/analytics"],
  ["Profiles", "/admin/instacomp/pricing/profiles"],
  ["Review Queue", "/admin/instacomp/pricing/review"],
  ["Coverage", "/admin/instacomp/pricing/coverage"],
  ["Saved Views", "/admin/instacomp/pricing/views"],
  ["Audit", "/admin/instacomp/pricing/audit"],
] as const;

const gapLabels: Record<GapType, string> = {
  missing_release: "Missing release",
  checklist_pending: "Checklist pending",
  set_gap: "Set gap",
  identity_gap: "Identity gap",
};

const gapDetails: Record<GapType, string> = {
  missing_release: "No matching Registry release exists yet.",
  checklist_pending: "The release exists, but no active checklist version is available.",
  set_gap: "An active release exists, but this set is missing or mismatched.",
  identity_gap: "The set exists, but card-level identity details still do not resolve.",
};

export default function PrivatePricingCoverage() {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<ActiveFilters>({
    gapType: "",
    sport: "",
    search: "",
  });
  const [draft, setDraft] = useState<ActiveFilters>(filters);

  const loadCoverage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(offset),
      });
      if (filters.gapType) query.set("gapType", filters.gapType);
      if (filters.sport.trim()) query.set("sport", filters.sport.trim());
      if (filters.search.trim()) query.set("search", filters.search.trim());

      const response = await fetch(`/api/instacomp/pricing/coverage?${query}`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok !== true) {
        throw new Error(payload?.error || "Private pricing coverage could not be loaded.");
      }
      setCoverage(payload.coverage as Coverage);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Private pricing coverage could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCoverage();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCoverage]);

  const firstVisible = coverage && coverage.pagination.returned
    ? coverage.pagination.offset + 1
    : 0;
  const lastVisible = coverage
    ? coverage.pagination.offset + coverage.pagination.returned
    : 0;

  const activeFilterCount = useMemo(
    () => [filters.gapType, filters.sport.trim(), filters.search.trim()].filter(Boolean).length,
    [filters],
  );

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setFilters({
      gapType: draft.gapType,
      sport: draft.sport.trim(),
      search: draft.search.trim(),
    });
  }

  function clearFilters() {
    const empty: ActiveFilters = { gapType: "", sport: "", search: "" };
    setDraft(empty);
    setFilters(empty);
    setOffset(0);
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-5">
        <header className="overflow-hidden rounded-[2rem] border border-neutral-900 bg-neutral-950 text-white shadow-xl">
          <div className="bg-[radial-gradient(circle_at_top_right,_rgba(34,211,238,0.2),_transparent_36%),radial-gradient(circle_at_bottom_left,_rgba(245,158,11,0.18),_transparent_34%)] p-6 lg:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <Link href="/admin/instacomp/pricing" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  ← Command Center
                </Link>
                <Link href="/admin" className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15">
                  Main Admin
                </Link>
              </div>
              <button
                type="button"
                onClick={() => void loadCoverage()}
                disabled={loading}
                className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-black disabled:opacity-50"
              >
                {loading ? "Refreshing…" : "Refresh Coverage"}
              </button>
            </div>

            <p className="mt-6 text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
              KINGMAKER Private Pricing
            </p>
            <h1 className="mt-2 text-4xl font-black md:text-5xl">Coverage Attack Queue</h1>
            <p className="mt-3 max-w-5xl font-semibold text-neutral-300">
              Rank unresolved private reference rows by the Registry work that unlocks the most pricing coverage first.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.14em]">
              <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-cyan-200">Aggregate metadata only</span>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-2 text-emerald-200">Admin only</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">No price promotion</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-neutral-200">No source disclosure</span>
            </div>
          </div>
        </header>

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm">
          {pricingNav.map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${
                href.endsWith("/coverage")
                  ? "bg-black text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        {error ? (
          <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-950 shadow-sm">
            <p className="text-xs font-black uppercase tracking-wider">Coverage unavailable</p>
            <h2 className="mt-1 text-2xl font-black">The private coverage queue could not load</h2>
            <p className="mt-2 font-semibold">{error}</p>
          </section>
        ) : null}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Unresolved Rows"
            value={formatInteger(coverage?.summary.unresolvedRows)}
            detail={`${formatInteger(coverage?.summary.totalGroups)} grouped work items`}
            loading={loading}
          />
          <MetricCard
            label="Missing Releases"
            value={formatInteger(coverage?.summary.missingReleaseRows)}
            detail="Create and import the release"
            loading={loading}
          />
          <MetricCard
            label="Pending Checklists"
            value={formatInteger(coverage?.summary.checklistPendingRows)}
            detail="Validate and activate a version"
            loading={loading}
          />
          <MetricCard
            label="Set + Identity Gaps"
            value={formatInteger(
              (coverage?.summary.setGapRows || 0) +
                (coverage?.summary.identityGapRows || 0),
            )}
            detail="Repair active Registry coverage"
            loading={loading}
          />
          <MetricCard
            label="Largest Unlock"
            value={formatInteger(coverage?.summary.largestUnlock)}
            detail="Rows unlocked by one work item"
            loading={loading}
          />
        </section>

        <form onSubmit={applyFilters} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[190px] flex-1">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Gap type</span>
              <select
                value={draft.gapType}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  gapType: event.target.value as ActiveFilters["gapType"],
                }))}
                className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-bold outline-none focus:border-black"
              >
                <option value="">All gap types</option>
                <option value="missing_release">Missing release</option>
                <option value="checklist_pending">Checklist pending</option>
                <option value="set_gap">Set gap</option>
                <option value="identity_gap">Identity gap</option>
              </select>
            </label>

            <label className="min-w-[180px] flex-1">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Sport</span>
              <input
                value={draft.sport}
                onChange={(event) => setDraft((current) => ({ ...current, sport: event.target.value }))}
                placeholder="Baseball, Hockey…"
                className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-bold outline-none focus:border-black"
              />
            </label>

            <label className="min-w-[260px] flex-[2]">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-500">Search release</span>
              <input
                value={draft.search}
                onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
                placeholder="Year, manufacturer, product, or set"
                className="mt-2 w-full rounded-xl border border-neutral-300 px-3 py-3 font-bold outline-none focus:border-black"
              />
            </label>

            <button type="submit" className="rounded-xl bg-black px-5 py-3 font-black text-white hover:bg-neutral-800">
              Apply Filters
            </button>
            <button
              type="button"
              onClick={clearFilters}
              disabled={!activeFilterCount && !draft.gapType && !draft.sport && !draft.search}
              className="rounded-xl border border-neutral-300 px-5 py-3 font-black text-neutral-700 hover:bg-neutral-100 disabled:opacity-40"
            >
              Clear
            </button>
          </div>
          <p className="mt-3 text-sm font-semibold text-neutral-500">
            {activeFilterCount
              ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}. Rankings recalculate inside the filtered queue.`
              : "Ranked by potential rows unlocked, then Registry gap stage."}
          </p>
        </form>

        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 p-5">
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-neutral-500">Ranked Work Queue</p>
              <h2 className="mt-1 text-2xl font-black">Highest-impact Registry work first</h2>
            </div>
            <p className="text-sm font-bold text-neutral-500">
              {coverage
                ? `${formatInteger(firstVisible)}–${formatInteger(lastVisible)} of ${formatInteger(coverage.pagination.totalGroups)}`
                : "Loading…"}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full border-collapse text-left">
              <thead className="bg-neutral-50 text-xs font-black uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Gap</th>
                  <th className="px-4 py-3">Release / Set</th>
                  <th className="px-4 py-3 text-right">Potential Unlock</th>
                  <th className="px-4 py-3 text-right">Distinct Cards</th>
                  <th className="px-4 py-3">Registry State</th>
                  <th className="px-4 py-3">Next Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {loading
                  ? Array.from({ length: 8 }, (_, index) => <LoadingRow key={index} />)
                  : coverage?.rows.length
                    ? coverage.rows.map((row) => <CoverageTableRow key={`${row.rank}-${row.sport}-${row.releaseYear}-${row.manufacturer}-${row.product}-${row.setName}`} row={row} />)
                    : (
                      <tr>
                        <td colSpan={7} className="px-6 py-14 text-center">
                          <p className="text-xl font-black">No coverage gaps match these filters</p>
                          <p className="mt-2 font-semibold text-neutral-500">Clear or broaden the filters to restore the ranked queue.</p>
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
            <p className="text-sm font-bold text-neutral-500">
              Updated {coverage?.generatedAt ? new Date(coverage.generatedAt).toLocaleString() : "—"}
            </p>
            <button
              type="button"
              disabled={loading || !coverage?.pagination.hasMore}
              onClick={() => setOffset((current) => current + LIMIT)}
              className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-black hover:bg-neutral-100 disabled:opacity-40"
            >
              Next 100 →
            </button>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(gapLabels) as GapType[]).map((type) => (
            <article key={type} className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
              <GapBadge type={type} />
              <h3 className="mt-3 text-xl font-black">{gapLabels[type]}</h3>
              <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">{gapDetails[type]}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}

function CoverageTableRow({ row }: { row: CoverageRow }) {
  return (
    <tr className="align-top hover:bg-neutral-50/70">
      <td className="px-4 py-4 text-lg font-black">#{formatInteger(row.rank)}</td>
      <td className="px-4 py-4"><GapBadge type={row.gapType} /></td>
      <td className="px-4 py-4">
        <p className="font-black">{row.releaseYear} {row.manufacturer} {row.product}</p>
        <p className="mt-1 text-sm font-bold text-neutral-600">{row.sport} · {row.setName}</p>
        <p className="mt-1 text-xs font-semibold text-neutral-500">
          Latest reference {formatDate(row.latestReferenceDate)} · {formatInteger(row.guideCount)} edition{row.guideCount === 1 ? "" : "s"}
        </p>
      </td>
      <td className="px-4 py-4 text-right">
        <p className="text-2xl font-black">{formatInteger(row.potentialUnlock)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-500">
          {formatInteger(row.unmatchedRows)} unmatched · {formatInteger(row.ambiguousRows)} ambiguous
        </p>
      </td>
      <td className="px-4 py-4 text-right">
        <p className="text-lg font-black">{formatInteger(row.distinctCardNumbers)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-500">
          Parse confidence {formatPercent(row.averageParseConfidence)}
        </p>
      </td>
      <td className="px-4 py-4 text-sm font-bold text-neutral-700">
        <p>{formatInteger(row.registryReleaseCount)} release match{row.registryReleaseCount === 1 ? "" : "es"}</p>
        <p>{formatInteger(row.activeVersionCount)} active version{row.activeVersionCount === 1 ? "" : "s"}</p>
        <p>{formatInteger(row.matchingSetCount)} matching set{row.matchingSetCount === 1 ? "" : "s"}</p>
        <p>{formatInteger(row.activeIdentityCount)} active identities</p>
      </td>
      <td className="max-w-[330px] px-4 py-4">
        <p className="font-bold leading-6 text-neutral-700">{row.recommendedAction}</p>
      </td>
    </tr>
  );
}

function GapBadge({ type }: { type: GapType }) {
  const tone = type === "missing_release"
    ? "border-red-200 bg-red-50 text-red-800"
    : type === "checklist_pending"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : type === "set_gap"
        ? "border-violet-200 bg-violet-50 text-violet-900"
        : "border-cyan-200 bg-cyan-50 text-cyan-900";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider ${tone}`}>
      {gapLabels[type]}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  loading,
}: {
  label: string;
  value: string;
  detail: string;
  loading: boolean;
}) {
  return (
    <article className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wider text-neutral-500">{label}</p>
      {loading
        ? <div className="mt-3 h-9 w-24 animate-pulse rounded-lg bg-neutral-200" />
        : <p className="mt-2 text-3xl font-black">{value}</p>}
      <p className="mt-2 text-sm font-semibold text-neutral-600">{detail}</p>
    </article>
  );
}

function LoadingRow() {
  return (
    <tr>
      {Array.from({ length: 7 }, (_, index) => (
        <td key={index} className="px-4 py-5">
          <div className="h-5 animate-pulse rounded bg-neutral-200" />
        </td>
      ))}
    </tr>
  );
}

function formatInteger(value: number | undefined | null) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value || 0);
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}
