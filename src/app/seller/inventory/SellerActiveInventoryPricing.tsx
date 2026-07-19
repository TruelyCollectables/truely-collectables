"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

const PAGE_SIZE = 48;
const MAX_BATCH = 10;

const SCAN_PHASES = [
  { at: 0, percent: 6, label: "Preparing card images" },
  { at: 2, percent: 20, label: "Reading card details" },
  { at: 7, percent: 40, label: "Checking AI identity and card features" },
  { at: 15, percent: 62, label: "Searching active and sold marketplace evidence" },
  { at: 28, percent: 80, label: "Validating exact title, card number, and print run" },
  { at: 45, percent: 92, label: "Checking TCOS sold-history evidence" },
  { at: 70, percent: 96, label: "Saving the market snapshot" },
] as const;

type TrackingComp = {
  title: string;
  price: number;
  url: string;
  source?: string | null;
  sourceLabel?: string | null;
  soldAt?: string | null;
  observedAt?: string | null;
  flags?: string[];
};

type TrackingSnapshot = {
  updatedAt?: string | null;
  scanId?: string | null;
  pricingEvidenceMode?: string | null;
  fallbackUsed?: boolean;
  internalSoldCompCount?: number;
  trustedForPricing?: boolean;
  trustedForIdentity?: boolean;
  reviewReasons?: string[];
  listingPrice?: number | null;
  marketPrice?: number | null;
  marketMedian?: number | null;
  marketLow?: number | null;
  marketHigh?: number | null;
  soldMedian?: number | null;
  soldLow?: number | null;
  soldHigh?: number | null;
  marketCompCount?: number;
  soldCompCount?: number;
  latestSoldAt?: string | null;
  sales7d?: number;
  sales30d?: number;
  deltaAmount?: number | null;
  deltaPercent?: number | null;
  pricingPosition?: string | null;
  topSoldComps?: TrackingComp[];
  topMarketComps?: TrackingComp[];
  identity?: {
    player?: string | null;
    year?: string | null;
    brand?: string | null;
    setName?: string | null;
    cardNumber?: string | null;
    parallel?: string | null;
    serialNumber?: string | null;
    confidence?: number | null;
    isAuto?: boolean;
    isRelic?: boolean;
  };
};

type ActiveInventoryItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  ownershipScope: "seller" | "store";
  title: string;
  sku: string | null;
  category: string;
  condition: string;
  status: "active";
  quantity: number;
  price: number;
  updatedAt: string | null;
  createdAt: string | null;
  ebayItemId: string | null;
  player: string | null;
  sport: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  isCard: boolean;
  tracking: TrackingSnapshot | null;
};

type ActiveResponse = {
  success: boolean;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: ActiveInventoryItem[];
  soldInventoryVisible: boolean;
  soldInventoryRetainedForCompEvidence: boolean;
};

type ProgressState = {
  percent: number;
  label: string;
  elapsed: number;
  state: "running" | "success" | "error";
};

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not checked";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not checked";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function titleCase(value: string | null | undefined) {
  return String(value || "not set")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function reasonLabel(reason: string) {
  const labels: Record<string, string> = {
    low_identification_confidence:
      "Card identity confidence is below the automatic-pricing threshold.",
    multi_scanner_consensus_needs_review:
      "The AI scanners did not fully agree on the exact card identity.",
    multi_scanner_setName_disagreement:
      "The AI scanners disagree on the set name.",
    multi_scanner_parallel_disagreement:
      "The AI scanners disagree on the exact parallel.",
    multi_scanner_cardNumber_disagreement:
      "The AI scanners disagree on the card number.",
    missing_usable_comps:
      "No exact marketplace matches passed the pricing filters.",
    seller_title_fallback_used:
      "Pricing was recovered with an exact seller-title match after the image readers disagreed.",
    tcos_sold_history_used:
      "Exact TCOS sold-inventory history was included as sold evidence.",
    single_active_comp_guidance_only:
      "Only one exact active listing was found, so treat this as guidance rather than a confirmed market.",
    missing_back_image:
      "A back image would improve card-number, set, parallel, and serial verification.",
    pricing_spread_too_wide:
      "The exact matches have a wide price spread and need seller review.",
  };
  if (labels[reason]) return labels[reason];
  return reason
    .replace(/^multi_scanner_/, "AI scanners: ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function evidenceModeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    exact_sold_and_market: "Exact sold + active market",
    seller_title_exact_market_fallback: "Seller-title exact market fallback",
    exact_market: "Exact active market",
    no_exact_market: "No exact market evidence",
  };
  return labels[String(value || "")] || "Not checked";
}

function deltaTone(tracking: TrackingSnapshot | null) {
  const delta = tracking?.deltaPercent;
  if (delta === null || delta === undefined) {
    return "border-neutral-300 bg-neutral-100 text-neutral-700";
  }
  if (delta > 5) return "border-rose-300 bg-rose-100 text-rose-900";
  if (delta < -5) return "border-amber-300 bg-amber-100 text-amber-900";
  return "border-emerald-300 bg-emerald-100 text-emerald-900";
}

function deltaText(tracking: TrackingSnapshot | null) {
  if (tracking?.deltaAmount === null || tracking?.deltaAmount === undefined) {
    return "No exact market baseline yet";
  }
  const amountSign = Number(tracking.deltaAmount) > 0 ? "+" : "";
  const percentSign = Number(tracking.deltaPercent || 0) > 0 ? "+" : "";
  return `${amountSign}${currency(tracking.deltaAmount)} (${percentSign}${Number(
    tracking.deltaPercent || 0,
  ).toFixed(1)}%)`;
}

function phaseForElapsed(elapsed: number) {
  return [...SCAN_PHASES].reverse().find((phase) => elapsed >= phase.at) || SCAN_PHASES[0];
}

export default function SellerActiveInventoryPricing() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<ActiveInventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, ProgressState>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [deepScan, setDeepScan] = useState(false);

  const loadInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search) params.set("search", search);
      const response = await fetch(
        `/api/account/seller/inventory/active-pricing?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => ({}))) as Partial<ActiveResponse> & {
        error?: string;
      };
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not load active inventory.");
      }
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      setHasMore(data.hasMore === true);
      setSelected(new Set());
    } catch (nextError: any) {
      setItems([]);
      setError(nextError?.message || "Could not load active inventory.");
    } finally {
      setLoading(false);
    }
  }, [offset, search, token]);

  useEffect(() => {
    void (async () => {
      const session = await getFreshAccountSession(5 * 60, true);
      setToken(session?.access_token || null);
      if (!session?.access_token) {
        setLoading(false);
        setError("Log in with the owner seller account to load active inventory.");
      }
    })();
  }, []);

  useEffect(() => {
    if (token) void loadInventory();
  }, [loadInventory, token]);

  const selectedCardIds = useMemo(
    () =>
      items
        .filter((item) => selected.has(item.inventoryItemId) && item.isCard)
        .map((item) => item.inventoryItemId),
    [items, selected],
  );

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function refreshOne(inventoryItemId: string, quiet = false) {
    if (!token) return false;
    const startedAt = Date.now();
    setProgress((current) => ({
      ...current,
      [inventoryItemId]: {
        percent: SCAN_PHASES[0].percent,
        label: SCAN_PHASES[0].label,
        elapsed: 0,
        state: "running",
      },
    }));
    if (!quiet) {
      setMessage("InstaComp™ is checking this active card against exact market evidence...");
      setError("");
    }

    const interval = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const phase = phaseForElapsed(elapsed);
      setProgress((current) => ({
        ...current,
        [inventoryItemId]: {
          percent: phase.percent,
          label: phase.label,
          elapsed,
          state: "running",
        },
      }));
    }, 500);

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}/market-check`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deepScan }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.success !== true) {
        throw new Error(data?.error || "InstaComp™ market check failed.");
      }
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      setProgress((current) => ({
        ...current,
        [inventoryItemId]: {
          percent: 100,
          label: "Market snapshot saved",
          elapsed,
          state: "success",
        },
      }));
      setItems((current) =>
        current.map((item) =>
          item.inventoryItemId === inventoryItemId
            ? { ...item, tracking: data.tracking as TrackingSnapshot }
            : item,
        ),
      );
      if (!quiet) {
        const evidence = data.evidence || {};
        setMessage(
          `InstaComp™ saved ${Number(evidence.marketCompCount || 0)} exact market match(es) and ${Number(
            evidence.soldCompCount || 0,
          )} exact sold match(es).`,
        );
      }
      return true;
    } catch (nextError: any) {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      setProgress((current) => ({
        ...current,
        [inventoryItemId]: {
          percent: Math.min(96, current[inventoryItemId]?.percent || 10),
          label: "Scan stopped — review the message below",
          elapsed,
          state: "error",
        },
      }));
      if (!quiet) setError(nextError?.message || "InstaComp™ market check failed.");
      return false;
    } finally {
      window.clearInterval(interval);
    }
  }

  async function refreshSelected() {
    const ids = selectedCardIds.slice(0, MAX_BATCH);
    if (!ids.length) return;
    setBatchRunning(true);
    setMessage(`Refreshing ${ids.length} active card(s) one at a time...`);
    setError("");
    let succeeded = 0;
    for (const id of ids) {
      if (await refreshOne(id, true)) succeeded += 1;
    }
    setBatchRunning(false);
    setMessage(`${succeeded} of ${ids.length} selected active card(s) refreshed.`);
    if (succeeded === ids.length) setSelected(new Set());
  }

  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(offset + items.length, total);

  return (
    <section className="border-b-4 border-neutral-950 bg-[#efe9db] px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="border-4 border-neutral-950 bg-emerald-300 p-5 shadow-[7px_7px_0_#111318]">
          <p className="text-xs font-black uppercase tracking-[0.2em]">
            Active Inventory + InstaComp™ Pricing Control
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Only cards you currently have in stock.
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7">
            Sold inventory is hidden from this workspace but remains in the database as
            internal sold-comp evidence. InstaComp™ compares each active listing price with
            exact sold matches and exact active competitor listings so pricing can stay
            competitive without giving away margin.
          </p>
        </header>

        <div className="grid gap-3 border-2 border-neutral-950 bg-white p-4 shadow-[4px_4px_0_#111318] lg:grid-cols-[1fr_auto]">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setSearch(searchInput.trim());
            }}
          >
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search active player, set, card number, parallel..."
              className="min-w-0 flex-1 border-2 border-neutral-950 px-3 py-2 font-bold"
            />
            <button
              type="submit"
              className="border-2 border-neutral-950 bg-neutral-950 px-4 py-2 font-black text-white"
            >
              Search
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                batchRunning ||
                selectedCardIds.length === 0 ||
                selectedCardIds.length > MAX_BATCH
              }
              onClick={() => void refreshSelected()}
              className="border-2 border-neutral-950 bg-violet-700 px-4 py-2 font-black text-white disabled:opacity-40"
            >
              {batchRunning ? "Refreshing..." : `Refresh Selected (${selectedCardIds.length})`}
            </button>
            <button
              type="button"
              onClick={() => void loadInventory()}
              className="border-2 border-neutral-950 bg-white px-4 py-2 font-black"
            >
              Reload Active Inventory
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold">
          <p>
            Showing {pageStart}-{pageEnd} of {total} active in-stock item(s). Sold rows are hidden.
          </p>
          <label className="flex items-center gap-2 border-2 border-neutral-950 bg-white px-3 py-2">
            <input
              type="checkbox"
              checked={deepScan}
              onChange={(event) => setDeepScan(event.target.checked)}
            />
            Deep AI council scan
          </label>
          <p className="text-neutral-600">Select up to {MAX_BATCH} cards per batch.</p>
        </div>

        {message ? (
          <p className="border-2 border-neutral-950 bg-yellow-100 px-4 py-3 font-bold">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="border-2 border-rose-700 bg-rose-100 px-4 py-3 font-bold text-rose-900">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="border-2 border-neutral-950 bg-white p-8 text-center font-black">
            Loading active inventory and saved market checks...
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const tracking = item.tracking;
              const itemProgress = progress[item.inventoryItemId];
              const running = itemProgress?.state === "running";
              const soldComps = Array.isArray(tracking?.topSoldComps)
                ? tracking.topSoldComps
                : [];
              const marketComps = Array.isArray(tracking?.topMarketComps)
                ? tracking.topMarketComps
                : [];
              const reasons = Array.isArray(tracking?.reviewReasons)
                ? tracking.reviewReasons
                : [];

              return (
                <article
                  key={item.inventoryItemId}
                  className="overflow-hidden border-2 border-neutral-950 bg-white shadow-[4px_4px_0_#111318]"
                >
                  <div className="relative bg-neutral-100">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="aspect-[4/3] w-full object-contain p-3"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-[4/3] items-center justify-center p-6 text-center font-black text-neutral-500">
                        No image is available for this active inventory row
                      </div>
                    )}
                    <label className="absolute left-3 top-3 flex items-center gap-2 border-2 border-neutral-950 bg-white px-2 py-1 text-xs font-black">
                      <input
                        type="checkbox"
                        checked={selected.has(item.inventoryItemId)}
                        onChange={() => toggleSelected(item.inventoryItemId)}
                      />
                      Select
                    </label>
                    <span className="absolute right-3 top-3 border border-emerald-400 bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-950">
                      ACTIVE
                    </span>
                    {item.imageUrls.length > 1 ? (
                      <span className="absolute bottom-3 right-3 border-2 border-neutral-950 bg-white px-2 py-1 text-xs font-black">
                        {item.imageUrls.length} photos
                      </span>
                    ) : null}
                  </div>

                  <div className="p-4">
                    <h2 className="line-clamp-3 text-lg font-black">{item.title}</h2>
                    <p className="mt-1 text-xs font-semibold text-neutral-500">
                      SKU {item.sku || "Not set"}
                      {item.ebayItemId ? ` · eBay ${item.ebayItemId}` : ""}
                    </p>
                    <p className="mt-2 text-xs font-black uppercase text-neutral-500">
                      {titleCase(item.category)} · QTY {item.quantity}
                    </p>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <Metric label="Your price" value={currency(item.price)} />
                      <Metric
                        label="Exact market"
                        value={tracking?.marketPrice ? currency(tracking.marketPrice) : "—"}
                      />
                      <Metric
                        label="Sold median"
                        value={tracking?.soldMedian ? currency(tracking.soldMedian) : "—"}
                      />
                    </div>

                    <div className={`mt-3 border-2 px-3 py-2 text-sm font-black ${deltaTone(tracking)}`}>
                      Your price vs. exact market: {deltaText(tracking)}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <Detail label="Exact market comps" value={String(tracking?.marketCompCount || 0)} />
                      <Detail label="Exact sold comps" value={String(tracking?.soldCompCount || 0)} />
                      <Detail label="Sold in 7 days" value={String(tracking?.sales7d || 0)} />
                      <Detail label="Sold in 30 days" value={String(tracking?.sales30d || 0)} />
                      <Detail label="Evidence mode" value={evidenceModeLabel(tracking?.pricingEvidenceMode)} />
                      <Detail
                        label="Pricing confidence"
                        value={tracking?.trustedForPricing ? "Usable" : tracking ? "Review" : "Not checked"}
                      />
                    </div>

                    {itemProgress ? (
                      <div
                        className={`mt-4 border-2 p-3 ${
                          itemProgress.state === "success"
                            ? "border-emerald-500 bg-emerald-50"
                            : itemProgress.state === "error"
                              ? "border-rose-600 bg-rose-50"
                              : "border-violet-500 bg-violet-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-xs font-black uppercase">
                          <span>{itemProgress.label}</span>
                          <span>{itemProgress.percent}% · {itemProgress.elapsed}s</span>
                        </div>
                        <div className="mt-2 h-4 overflow-hidden border-2 border-neutral-950 bg-white">
                          <div
                            className="h-full bg-violet-700 transition-[width] duration-500"
                            style={{ width: `${itemProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {tracking ? (
                      <div className="mt-3 border border-neutral-300 bg-neutral-50 p-3 text-xs font-semibold">
                        <p className="font-black uppercase text-neutral-500">Latest check</p>
                        <p className="mt-1">
                          {shortDate(tracking.updatedAt)} · {evidenceModeLabel(tracking.pricingEvidenceMode)}
                        </p>
                        {!tracking.marketCompCount ? (
                          <p className="mt-2 font-bold text-amber-900">
                            No exact market matches passed the filters. InstaComp™ did not invent a price.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {reasons.length ? (
                      <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-black uppercase">Review notes</p>
                        <ul className="mt-2 space-y-1 font-semibold">
                          {reasons.slice(0, 5).map((reason) => (
                            <li key={reason}>• {reasonLabel(reason)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="mt-3 border-t border-neutral-200 pt-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                        Exact sold evidence
                      </p>
                      {soldComps.length ? (
                        <div className="mt-2 space-y-2">
                          {soldComps.slice(0, 3).map((comp, index) => (
                            <a
                              key={`${comp.url}-${index}`}
                              href={comp.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start justify-between gap-3 border border-neutral-200 bg-neutral-50 px-2 py-2 text-xs hover:border-neutral-950"
                            >
                              <span className="line-clamp-2 font-semibold">{comp.title}</span>
                              <span className="whitespace-nowrap font-black">{currency(comp.price)}</span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-neutral-500">
                          No exact sold match is saved yet. Active exact matches can still establish competitive pricing guidance.
                        </p>
                      )}
                    </div>

                    {!soldComps.length && marketComps.length ? (
                      <div className="mt-3 border-t border-neutral-200 pt-3">
                        <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                          Exact active competitors
                        </p>
                        <div className="mt-2 space-y-2">
                          {marketComps.slice(0, 3).map((comp, index) => (
                            <a
                              key={`${comp.url}-${index}`}
                              href={comp.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-start justify-between gap-3 border border-neutral-200 bg-neutral-50 px-2 py-2 text-xs hover:border-neutral-950"
                            >
                              <span className="line-clamp-2 font-semibold">{comp.title}</span>
                              <span className="whitespace-nowrap font-black">{currency(comp.price)}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!item.isCard || !item.imageUrl || running || batchRunning}
                        onClick={() => void refreshOne(item.inventoryItemId)}
                        className="border-2 border-neutral-950 bg-violet-700 px-3 py-3 text-sm font-black text-white disabled:opacity-35"
                      >
                        {running
                          ? "InstaComp™ Running..."
                          : tracking
                            ? "Refresh InstaComp™"
                            : "Start InstaComp™"}
                      </button>
                      {item.legacyProductId ? (
                        <a
                          href={`/admin/products/${item.legacyProductId}`}
                          className="border-2 border-neutral-950 bg-white px-3 py-3 text-center text-sm font-black"
                        >
                          Edit Product
                        </a>
                      ) : (
                        <a
                          href={`/seller/inventory?search=${encodeURIComponent(item.sku || item.title)}`}
                          className="border-2 border-neutral-950 bg-white px-3 py-3 text-center text-sm font-black"
                        >
                          Open Editor
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && !items.length ? (
          <div className="border-2 border-dashed border-neutral-500 bg-white p-8 text-center font-bold text-neutral-600">
            No active in-stock inventory matches this search.
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={offset <= 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            className="border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-35"
          >
            Previous
          </button>
          <p className="text-sm font-black">Page {Math.floor(offset / PAGE_SIZE) + 1}</p>
          <button
            type="button"
            disabled={!hasMore || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
            className="border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-35"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-300 bg-neutral-50 px-2 py-2">
      <p className="text-[10px] font-black uppercase text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-200 bg-neutral-50 px-2 py-2">
      <p className="font-black text-neutral-500">{label}</p>
      <p className="mt-1 text-sm font-black text-neutral-950">{value}</p>
    </div>
  );
}
