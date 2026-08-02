"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type StagedListing = {
  itemId: string;
  title: string;
  itemWebUrl: string;
  imageUrl: string | null;
  imageUrls: string[];
  imageCount: number;
  price: number | null;
  shipping: number | null;
  currency: string;
  endDate: string | null;
  status: "photos_ready" | "photo_error";
  targetPlayers: string[];
  error: string | null;
};

type SweepResponse = {
  sweepId: string;
  seller: string;
  query: string;
  total: number;
  photosReady: number;
  failed: number;
  photoTotal: number;
  progress: number;
  status: string;
  listings: StagedListing[];
  persistenceWarning: string | null;
  nextStep: string;
};

type IdentifiedCard = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  confidence?: number | null;
  reviewRequired?: boolean;
  reviewReasons?: string[];
  identityProof?: {
    status?: string | null;
  } | null;
  verifiedCompletedSales?: unknown[];
};

type SnapshotListing = {
  id: string;
  itemId: string;
  title: string;
  itemWebUrl: string;
  imageUrl: string | null;
  imageUrls: string[];
  price: number | null;
  shipping: number | null;
  currency: string;
  endDate: string | null;
  status: string;
  targetPlayers: string[];
  identifiedCards: IdentifiedCard[];
  cardCount: number;
  retailValue: number | null;
  quickSaleValue: number | null;
  targetBid: number | null;
  hardMaxBid: number | null;
  expectedProfit: number | null;
  roiPercent: number | null;
  confidence: number | null;
  rank: number | null;
  error: string | null;
  updatedAt: string | null;
};

type SweepSnapshot = {
  ok: true;
  sweep: {
    id: string;
    seller: string;
    query: string;
    status: string;
    error: string | null;
    completedAt: string | null;
  };
  summary: {
    total: number;
    photosTotal: number;
    photosProcessed: number;
    cardsIdentified: number;
    ranked: number;
    review: number;
    failed: number;
    pending: number;
  };
  progress: number;
  listings: SnapshotListing[];
};

type WorkerResponse = {
  ok: boolean;
  processedThisRun: number;
  remaining: number;
  progress: number;
  status: string;
  cardsIdentified?: number;
  rankedCount?: number;
  reviewCount?: number;
  error?: string;
};

const MAX_WORKER_CALLS = 500;

function money(value: number | null | undefined, currency = "USD") {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : `${value.toFixed(1)}%`;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    photos: "Photos ready",
    identifying: "Identifying cards",
    comping: "Awaiting verified comps",
    ranking: "Calculating lot economics",
    ranked: "Ranked",
    review: "Manual review",
    failed: "Failed",
    completed: "Completed",
  };
  return labels[value] || value;
}

function statusClass(value: string) {
  if (value === "ranked" || value === "completed") return "bg-emerald-100 text-emerald-900";
  if (value === "review") return "bg-amber-100 text-amber-900";
  if (value === "failed") return "bg-red-100 text-red-900";
  return "bg-cyan-100 text-cyan-900";
}

function cardName(card: IdentifiedCard) {
  return [
    card.year,
    card.player,
    card.brand || card.setName,
    card.cardNumber ? `#${card.cardNumber}` : null,
    card.parallel,
    card.serialNumber,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data as T;
}

export default function SellerSweepClient() {
  const [sellerUrl, setSellerUrl] = useState("https://www.ebay.com/str/missmelscards");
  const [query, setQuery] = useState("WNBA lot");
  const [status, setStatus] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResponse | null>(null);
  const [snapshot, setSnapshot] = useState<SweepSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const activeSweepId = useRef<string | null>(null);
  const pollInFlight = useRef(false);

  useEffect(() => () => activeController.current?.abort(), []);

  async function refreshSweep(sweepId: string, signal: AbortSignal) {
    if (pollInFlight.current) return null;
    pollInFlight.current = true;
    try {
      const data = await requestJson<SweepSnapshot>(
        `/api/admin/instacomp/seller-sweep/status?sweepId=${encodeURIComponent(sweepId)}`,
        { signal },
      );
      if (activeSweepId.current !== sweepId) return data;
      setSnapshot(data);
      setProgress(data.progress);
      if (data.sweep.status === "completed") {
        setStatus(
          `Completed. ${data.summary.ranked} ranked, ${data.summary.review} review, ${data.summary.failed} failed.`,
        );
      } else if (data.sweep.status === "ranking") {
        setStatus(
          `Ranking lots: ${data.summary.ranked} ranked and ${data.summary.review} held for review.`,
        );
      } else if (data.sweep.status === "identifying") {
        setStatus(
          `Identifying cards: ${data.summary.cardsIdentified} candidates found, ${data.summary.pending} listings pending.`,
        );
      }
      return data;
    } finally {
      pollInFlight.current = false;
    }
  }

  async function runPipeline(sweepId: string, signal: AbortSignal) {
    let processCalls = 0;
    let remaining = Number.POSITIVE_INFINITY;
    while (remaining > 0) {
      if (processCalls >= MAX_WORKER_CALLS) {
        throw new Error("Seller Sweep stopped because candidate extraction exceeded its safe call limit.");
      }
      const output = await requestJson<WorkerResponse>(
        "/api/admin/instacomp/seller-sweep/process",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sweepId, batchSize: 1 }),
          signal,
        },
      );
      processCalls += 1;
      remaining = Math.max(0, Number(output.remaining) || 0);
      setProgress(output.progress || 80);
      setStatus(
        remaining > 0
          ? `Identifying cards. ${remaining} listing${remaining === 1 ? "" : "s"} remaining…`
          : "Candidate extraction complete. Applying verified valuation gates…",
      );
      await refreshSweep(sweepId, signal);
      if (remaining > 0 && output.processedThisRun < 1) {
        throw new Error("Seller Sweep candidate extraction made no progress and stopped safely.");
      }
    }

    let rankCalls = 0;
    remaining = Number.POSITIVE_INFINITY;
    while (remaining > 0) {
      if (rankCalls >= MAX_WORKER_CALLS) {
        throw new Error("Seller Sweep stopped because ranking exceeded its safe call limit.");
      }
      const output = await requestJson<WorkerResponse>(
        "/api/admin/instacomp/seller-sweep/rank",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sweepId, batchSize: 10 }),
          signal,
        },
      );
      rankCalls += 1;
      remaining = Math.max(0, Number(output.remaining) || 0);
      setProgress(output.progress || 90);
      setStatus(
        remaining > 0
          ? `Ranking lots. ${remaining} listing${remaining === 1 ? "" : "s"} remaining…`
          : "Seller Sweep complete. Loading the final ranking…",
      );
      await refreshSweep(sweepId, signal);
      if (remaining > 0 && output.processedThisRun < 1) {
        throw new Error("Seller Sweep ranking made no progress and stopped safely.");
      }
    }
    await refreshSweep(sweepId, signal);
  }

  async function startSweep(event: FormEvent) {
    event.preventDefault();
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    activeSweepId.current = null;
    setLoading(true);
    setError(null);
    setResult(null);
    setSnapshot(null);
    setProgress(10);
    setStatus("Collecting active eBay listings…");

    let pollTimer: number | null = null;
    try {
      const responsePromise = requestJson<SweepResponse>(
        "/api/admin/instacomp/seller-sweep",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sellerUrl, query }),
          signal: controller.signal,
        },
      );
      setProgress(25);
      setStatus("Collecting listings and retrieving full photo sets…");
      const data = await responsePromise;
      setResult(data);
      setProgress(data.progress || 55);
      activeSweepId.current = data.sweepId;
      setStatus(
        `Saved sweep ${data.sweepId.slice(0, 8)}. ${data.photosReady}/${data.total} listings and ${data.photoTotal} photos are staged.`,
      );

      if (data.persistenceWarning) return;

      await refreshSweep(data.sweepId, controller.signal);
      pollTimer = window.setInterval(() => {
        void refreshSweep(data.sweepId, controller.signal).catch(() => undefined);
      }, 3000);
      await runPipeline(data.sweepId, controller.signal);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Seller Sweep failed");
      setStatus("Stopped safely");
    } finally {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (activeController.current === controller) {
        activeController.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <form onSubmit={startSweep} className="grid gap-4 lg:grid-cols-[1.4fr_0.7fr_auto] lg:items-end">
          <label className="grid gap-2 text-sm font-black">
            eBay seller or store URL
            <input value={sellerUrl} onChange={(event) => setSellerUrl(event.target.value)} className="rounded-2xl border border-neutral-300 px-4 py-3 font-semibold" required />
          </label>
          <label className="grid gap-2 text-sm font-black">
            Search focus
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-2xl border border-neutral-300 px-4 py-3 font-semibold" />
          </label>
          <button type="submit" disabled={loading} className="rounded-2xl bg-neutral-950 px-6 py-3 font-black text-white disabled:opacity-50">
            {loading ? "Sweeping…" : "Start Seller Sweep"}
          </button>
        </form>

        <div className="mt-5">
          <div className="mb-2 flex justify-between gap-4 text-sm font-black"><span>{status}</span><span>{progress}%</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-neutral-200"><div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="mt-3 grid gap-2 text-xs font-bold text-neutral-600 sm:grid-cols-4">
            <span className={progress >= 20 ? "text-emerald-700" : ""}>1. Collect listings</span>
            <span className={progress >= 55 ? "text-emerald-700" : ""}>2. Download photos</span>
            <span className={progress >= 80 ? "text-emerald-700" : ""}>3. Identify + verify</span>
            <span className={progress >= 100 ? "text-emerald-700" : ""}>4. Rank ROI</span>
          </div>
        </div>
        <p className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-950">
          Analysis only: Seller Sweep never changes a listing, publishes an item, or applies a price automatically.
        </p>
        {error ? <p className="mt-4 rounded-2xl bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}
        {result?.persistenceWarning ? <p className="mt-4 rounded-2xl bg-amber-50 p-4 font-bold text-amber-900">{result.persistenceWarning}</p> : null}
      </section>

      {snapshot ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ["Listings", snapshot.summary.total],
            ["Cards found", snapshot.summary.cardsIdentified],
            ["Ranked", snapshot.summary.ranked],
            ["Review", snapshot.summary.review],
            ["Failed", snapshot.summary.failed],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-black uppercase tracking-wide text-neutral-500">{label}</p>
              <p className="mt-1 text-3xl font-black text-neutral-950">{value}</p>
            </div>
          ))}
        </section>
      ) : null}

      {snapshot ? (
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Seller @{snapshot.sweep.seller}</p>
            <h2 className="mt-1 text-2xl font-black">Seller Sweep results</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">Sweep ID: {snapshot.sweep.id}</p>
            <p className="mt-2 text-sm font-semibold text-neutral-600">
              Unverified cards and cards without two independently verified exact completed sales remain review-only at $0 projected value.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1500px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr><th className="p-4">Rank</th><th className="p-4">Listing</th><th className="p-4">Cards</th><th className="p-4">Targets</th><th className="p-4">Delivered</th><th className="p-4">Retail</th><th className="p-4">Quick sale</th><th className="p-4">Target bid</th><th className="p-4">Hard max</th><th className="p-4">Profit</th><th className="p-4">ROI</th><th className="p-4">Status</th></tr>
              </thead>
              <tbody>
                {snapshot.listings.map((listing) => (
                  <tr key={listing.id} className="border-t border-neutral-100 align-top">
                    <td className="p-4 text-xl font-black">{listing.rank ?? "—"}</td>
                    <td className="max-w-sm p-4"><a href={listing.itemWebUrl} target="_blank" rel="noreferrer" className="font-black text-blue-700 underline">{listing.title}</a><div className="mt-1 text-xs text-neutral-500">{listing.itemId}</div></td>
                    <td className="max-w-sm p-4">
                      <div className="font-black">{listing.cardCount}</div>
                      {listing.identifiedCards.length ? (
                        <details className="mt-2"><summary className="cursor-pointer text-xs font-black text-blue-700">View cards</summary><ul className="mt-2 grid gap-2 text-xs font-semibold text-neutral-700">{listing.identifiedCards.map((card, index) => <li key={`${listing.id}-${index}`}>{cardName(card) || `Card ${index + 1}`}{card.identityProof?.status === "verified_exact" ? " · REGISTRY VERIFIED" : card.reviewRequired ? " · REVIEW" : ""}{` · ${card.verifiedCompletedSales?.length || 0} verified sales`}</li>)}</ul></details>
                      ) : null}
                    </td>
                    <td className="p-4">{listing.targetPlayers.length ? <div className="flex flex-wrap gap-1">{listing.targetPlayers.map((player) => <span key={player} className="rounded-full bg-fuchsia-100 px-2 py-1 text-xs font-black text-fuchsia-900">{player}</span>)}</div> : "—"}</td>
                    <td className="p-4 font-black">{money((listing.price ?? 0) + (listing.shipping ?? 0), listing.currency)}</td>
                    <td className="p-4 font-black">{money(listing.retailValue, listing.currency)}</td>
                    <td className="p-4 font-black">{money(listing.quickSaleValue, listing.currency)}</td>
                    <td className="p-4 font-black text-emerald-800">{money(listing.targetBid, listing.currency)}</td>
                    <td className="p-4 font-black text-amber-800">{money(listing.hardMaxBid, listing.currency)}</td>
                    <td className="p-4 font-black">{money(listing.expectedProfit, listing.currency)}</td>
                    <td className="p-4 font-black">{percent(listing.roiPercent)}</td>
                    <td className="max-w-xs p-4"><span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(listing.status)}`}>{statusLabel(listing.status)}</span>{listing.error ? <p className="mt-2 text-xs font-semibold text-neutral-600">{listing.error}</p> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : result ? (
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Seller @{result.seller}</p>
            <h2 className="mt-1 text-2xl font-black">{result.total} listings · {result.photoTotal} photos · {result.failed} errors</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">Sweep ID: {result.sweepId}</p>
            <p className="mt-2 text-sm font-semibold text-neutral-600">{result.nextStep}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="p-4">Listing</th><th className="p-4">Price</th><th className="p-4">Shipping</th><th className="p-4">Photos</th><th className="p-4">Title flags</th><th className="p-4">Ends</th><th className="p-4">Status</th></tr></thead>
              <tbody>
                {result.listings.map((listing) => (
                  <tr key={listing.itemId} className="border-t border-neutral-100 align-top">
                    <td className="p-4"><a href={listing.itemWebUrl} target="_blank" rel="noreferrer" className="font-black text-blue-700 underline">{listing.title}</a><div className="mt-1 text-xs text-neutral-500">{listing.itemId}</div></td>
                    <td className="p-4 font-black">{money(listing.price, listing.currency)}</td>
                    <td className="p-4 font-bold">{money(listing.shipping, listing.currency)}</td>
                    <td className="p-4 font-black">{listing.imageCount}</td>
                    <td className="p-4">{listing.targetPlayers.length ? listing.targetPlayers.join(", ") : "Photo AI pending"}</td>
                    <td className="p-4 font-semibold">{listing.endDate ? new Date(listing.endDate).toLocaleString() : "—"}</td>
                    <td className="p-4">{statusLabel(listing.status === "photos_ready" ? "photos" : "failed")}</td>
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
