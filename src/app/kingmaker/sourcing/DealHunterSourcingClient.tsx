"use client";

import { useState } from "react";
import Image from "next/image";

export type ProspectTarget = {
  name: string;
  sport: string;
  team: string;
  priority: string;
  role: string;
  status: "ACTIVE" | "EXCLUDED" | "DISABLED";
};

export type DealCandidate = {
  id: string | number;
  title: string;
  watched_person?: string | null;
  marketplace?: string | null;
  seller_name?: string | null;
  delivered_cost?: number | null;
  conservative_resale?: number | null;
  expected_net_profit?: number | null;
  roi_percent?: number | null;
  deal_label?: string | null;
  listing_url: string;
  image_url?: string | null;
  evaluation?: { reason?: string } | null;
  actionable?: boolean;
  alertworthy?: boolean;
  created_at?: string;
};

export type DealHunterRun = {
  id: string | number;
  status: string;
  discovery_count: number;
  evaluated_count: number;
  actionable_count: number;
  manual_review_count: number;
  failure_count: number;
  completed_at: string | null;
  created_at?: string;
};

type Props = {
  targets: ProspectTarget[];
  candidates: DealCandidate[];
  runs: DealHunterRun[];
  pendingOutboxCount: number;
  activeEbayCount: number;
  lastSyncAt: string | null;
  triggeredMessage?: string | null;
  errorMessage?: string | null;
};

function money(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : "—";
}

function percent(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num > 0 ? "+" : ""}${num.toFixed(1)}%` : "—";
}

function timeAgo(dateString?: string | null) {
  if (!dateString) return "Never";
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return "Recently";
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function dealLabelBadge(label?: string | null) {
  const clean = String(label || "").toUpperCase();
  if (clean.includes("MUST BUY")) {
    return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  }
  if (clean.includes("BORDERLINE")) {
    return "bg-cyan-500/20 text-cyan-300 border-cyan-500/40";
  }
  if (clean.includes("TOO GOOD")) {
    return "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/40";
  }
  return "bg-slate-800 text-slate-300 border-slate-700";
}

export default function DealHunterSourcingClient({
  targets,
  candidates,
  runs,
  pendingOutboxCount,
  activeEbayCount,
  lastSyncAt,
  triggeredMessage,
  errorMessage,
}: Props) {
  const [selectedTarget, setSelectedTarget] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<"profit" | "roi" | "recent">("profit");
  const [showRuns, setShowRuns] = useState<boolean>(false);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);

  // Filter deals
  const filteredDeals = candidates.filter((deal) => {
    if (selectedTarget !== "ALL") {
      const dealPerson = String(deal.watched_person || "").toLowerCase();
      const targetLower = selectedTarget.toLowerCase();
      if (!dealPerson.includes(targetLower) && !deal.title.toLowerCase().includes(targetLower)) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !deal.title.toLowerCase().includes(q) &&
        !String(deal.watched_person || "").toLowerCase().includes(q) &&
        !String(deal.seller_name || "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  // Sort deals
  const sortedDeals = [...filteredDeals].sort((a, b) => {
    if (sortBy === "profit") {
      return Number(b.expected_net_profit || 0) - Number(a.expected_net_profit || 0);
    }
    if (sortBy === "roi") {
      return Number(b.roi_percent || 0) - Number(a.roi_percent || 0);
    }
    return Date.parse(String(b.created_at || 0)) - Date.parse(String(a.created_at || 0));
  });

  const latestRun = runs[0] || null;

  return (
    <div className="space-y-6">
      {/* Top Banner / Feedback */}
      {triggeredMessage ? (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 font-bold text-emerald-200">
          ✓ {triggeredMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 font-bold text-rose-200">
          ⚠ {errorMessage}
        </div>
      ) : null}

      {/* Header & Live Trigger Bar */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 backdrop-blur shadow-2xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-300 border border-emerald-500/30">
                PROSPECT ACQUISITION RADAR
              </span>
              <span className="text-xs font-bold text-slate-400">
                Daemon Last Active: {timeAgo(latestRun?.completed_at)}
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl text-white">
              Deal Hunter Command & Sourcing
            </h1>
            <p className="mt-2 max-w-3xl text-sm font-semibold text-slate-400 leading-relaxed">
              Automated high-priority prospect scans, computer-vision card matching, exact completed sales comps, and 3-way cross-marketplace inventory sync.
            </p>
          </div>

          <form
            method="post"
            action="/api/admin/market-intel/deal-hunter/run"
            onSubmit={() => setIsTriggering(true)}
            className="flex items-center gap-3"
          >
            <button
              type="submit"
              disabled={isTriggering}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-7 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-400/20 transition hover:bg-emerald-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {isTriggering ? (
                <span>⚡ DISPATCHING LIVE SCAN...</span>
              ) : (
                <>
                  <span className="text-lg">⚡</span> TRIGGER LIVE DEAL HUNTER RUN
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {/* 3-Way Marketplace Sync Status */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">
              CROSS-MARKETPLACE INVENTORY INTEGRATION
            </p>
            <h2 className="text-xl font-black text-white mt-1">
              3-Way Delist Lockstep (eBay ↔ Website ↔ Mercari)
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black text-emerald-400 border border-emerald-400/30">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              ONLINE & ACTIVE
            </span>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-400">1. eBay Sold</span>
              <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">Every 5m</span>
            </div>
            <p className="mt-2 text-lg font-black text-white">Auto-Delist Website & Mercari</p>
            <p className="mt-1 text-xs text-slate-400 leading-normal">
              Inbound order sweep detects eBay sales, zeros quantity in Supabase, and drops Mercari listing automatically.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-400">2. Website Sold</span>
              <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">Every 15m</span>
            </div>
            <p className="mt-2 text-lg font-black text-white">Auto-Delist eBay & Mercari</p>
            <p className="mt-1 text-xs text-slate-400 leading-normal">
              Website purchase triggers outbox queue (<span className="text-amber-400 font-bold">{pendingOutboxCount} pending</span>). Scheduler ends eBay listing immediately.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase text-slate-400">3. Mercari Sold</span>
              <span className="text-[10px] font-black uppercase text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">Scraper Sync</span>
            </div>
            <p className="mt-2 text-lg font-black text-white">Auto-Delist Website & eBay</p>
            <p className="mt-1 text-xs text-slate-400 leading-normal">
              Chrome scraper detects sold/ended item on Mercari, archives website product, and ends active eBay listing.
            </p>
          </div>
        </div>
      </section>

      {/* Active Prospect Acquisition Roster */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-300">
              ACQUISITION SYNDICATE TARGETS
            </p>
            <h2 className="text-xl font-black text-white mt-1">
              Active Prospect Priority Roster
            </h2>
          </div>
          <p className="text-xs font-bold text-slate-400">
            <span className="text-emerald-400 font-black">8 Active Targets</span> · Cooper Flagg & Jaxson Dart Excluded
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {targets.map((target) => {
            const isSelected = selectedTarget.toLowerCase() === target.name.toLowerCase();
            return (
              <button
                key={target.name}
                type="button"
                onClick={() => setSelectedTarget(isSelected ? "ALL" : target.name)}
                className={`text-left rounded-2xl border p-4 transition ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-950/30 ring-1 ring-emerald-400"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-emerald-400/20 px-2.5 py-0.5 text-xs font-black text-emerald-300 border border-emerald-400/30">
                    P-{target.priority}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {target.sport}
                  </span>
                </div>
                <h3 className="mt-2 text-base font-black text-white">{target.name}</h3>
                <p className="text-xs font-bold text-slate-300">{target.team}</p>
                <p className="mt-1.5 text-xs text-slate-400 truncate">{target.role}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Filter / Search Bar */}
      <section className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedTarget("ALL")}
            className={`rounded-xl px-4 py-2 text-xs font-black transition ${
              selectedTarget === "ALL"
                ? "bg-emerald-400 text-slate-950"
                : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
          >
            All Deals ({candidates.length})
          </button>
          {targets.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setSelectedTarget(t.name)}
              className={`rounded-xl px-3.5 py-2 text-xs font-black transition ${
                selectedTarget === t.name
                  ? "bg-emerald-400 text-slate-950"
                  : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {t.name.split(" ")[0]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search deals, cards, sellers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-400 focus:outline-none w-56 sm:w-64"
          />

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 focus:border-emerald-400 focus:outline-none"
          >
            <option value="profit">Sort: Highest Net Profit</option>
            <option value="roi">Sort: Highest ROI %</option>
            <option value="recent">Sort: Most Recent</option>
          </select>
        </div>
      </section>

      {/* Live Discovered Deals Grid */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-white">
              Discovered Opportunities & Steals ({sortedDeals.length})
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Filtered for positive ROI after all platform fees and shipping costs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRuns(!showRuns)}
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-400 hover:text-white"
          >
            {showRuns ? "Hide Run History" : "View Scanner Runs"}
          </button>
        </div>

        {sortedDeals.length === 0 ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <p className="text-base font-bold text-slate-300">
              No active candidates match your current filter.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Hit "Trigger Live Deal Hunter Run" above or switch to "All Deals" to see all available opportunities.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedDeals.map((deal) => {
              const profit = Number(deal.expected_net_profit || 0);
              const isHighProfit = profit >= 15;
              return (
                <article
                  key={deal.id}
                  className="flex flex-col justify-between rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg transition hover:border-slate-700 hover:bg-slate-900"
                >
                  <div>
                    {/* Badge Header */}
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider border ${dealLabelBadge(deal.deal_label)}`}>
                        {deal.deal_label || "PROSPECT TARGET"}
                      </span>
                      {deal.watched_person ? (
                        <span className="text-xs font-black text-amber-300 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/20">
                          {deal.watched_person}
                        </span>
                      ) : null}
                    </div>

                    {/* Card Title & Image */}
                    <div className="mt-4 flex gap-4">
                      {deal.image_url ? (
                        <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                          <Image
                            src={deal.image_url}
                            alt={deal.title}
                            fill
                            sizes="80px"
                            className="object-cover"
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-slate-600 text-xs font-black">
                          CARD
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-black text-white leading-snug line-clamp-2">
                          {deal.title}
                        </h3>
                        <p className="mt-1 text-xs text-slate-400 truncate">
                          Seller: {deal.seller_name || "eBay seller"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          Found {timeAgo(deal.created_at)}
                        </p>
                      </div>
                    </div>

                    {/* Financial Economics Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-xs">
                      <div>
                        <p className="text-[10px] uppercase font-black text-slate-500">Delivered Cost</p>
                        <p className="mt-0.5 font-black text-white">{money(deal.delivered_cost)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-black text-slate-500">Resale Comp</p>
                        <p className="mt-0.5 font-black text-slate-300">{money(deal.conservative_resale)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-black text-slate-500">Net Profit</p>
                        <p className={`mt-0.5 font-black ${isHighProfit ? "text-emerald-400" : "text-emerald-300"}`}>
                          {money(deal.expected_net_profit)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-black text-slate-500">Expected ROI</p>
                        <p className="mt-0.5 font-black text-emerald-400">{percent(deal.roi_percent)}</p>
                      </div>
                    </div>

                    {deal.evaluation?.reason ? (
                      <p className="mt-3 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {deal.evaluation.reason}
                      </p>
                    ) : null}
                  </div>

                  {/* Actions */}
                  <div className="mt-5 pt-3 border-t border-slate-800/80">
                    <a
                      href={deal.listing_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center rounded-xl bg-white px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-slate-200 transition"
                    >
                      VIEW & BUY ON EBAY →
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Collapsible Run History Table */}
      {showRuns ? (
        <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl">
          <div className="border-b border-slate-800 pb-3 mb-4">
            <h3 className="text-base font-black text-white">Recent Deal Hunter Daemon Runs</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-[10px] uppercase font-black text-slate-400">
                <tr>
                  <th className="px-4 py-2.5">Completed</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Discovered</th>
                  <th className="px-4 py-2.5">Evaluated</th>
                  <th className="px-4 py-2.5">Actionable</th>
                  <th className="px-4 py-2.5">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {runs.slice(0, 10).map((run) => (
                  <tr key={run.id} className="hover:bg-slate-950/40">
                    <td className="px-4 py-3 font-bold text-white">{timeAgo(run.completed_at)}</td>
                    <td className="px-4 py-3 font-black text-emerald-400">{run.status}</td>
                    <td className="px-4 py-3 text-slate-300">{run.discovery_count}</td>
                    <td className="px-4 py-3 text-slate-300">{run.evaluated_count}</td>
                    <td className="px-4 py-3 font-bold text-emerald-300">{run.actionable_count}</td>
                    <td className="px-4 py-3 text-slate-400">{run.failure_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
