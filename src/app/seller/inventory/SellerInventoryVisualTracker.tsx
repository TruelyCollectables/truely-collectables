"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

const PAGE_SIZE = 48;
const MAX_BATCH_REFRESH = 10;

type TrackingComp = {
  title: string;
  price: number;
  url: string;
  source?: string | null;
  sourceLabel?: string | null;
  soldAt?: string | null;
  observedAt?: string | null;
};

type TrackingSnapshot = {
  updatedAt?: string | null;
  scanId?: string | null;
  searchQuery?: string | null;
  scanTier?: string | null;
  aiJudgments?: number | null;
  hasBackImage?: boolean;
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
  };
};

type VisualInventoryItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  ownershipScope: "seller" | "store";
  title: string;
  sku: string | null;
  category: string;
  condition: string;
  status: string;
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
  quickList: {
    createdWithInstaComp: boolean;
    originalScanId: string | null;
  };
  ownSales: {
    unitsSold: number;
    revenue: number;
    lastSoldAt: string | null;
  };
};

type VisualResponse = {
  success: boolean;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  items: VisualInventoryItem[];
};

function currency(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function titleCase(value: string | null | undefined) {
  return String(value || "not set")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function deltaLabel(tracking: TrackingSnapshot | null) {
  if (!tracking || tracking.deltaAmount === null || tracking.deltaAmount === undefined) {
    return "No market baseline";
  }

  const sign = tracking.deltaAmount > 0 ? "+" : "";
  const percentSign = Number(tracking.deltaPercent || 0) > 0 ? "+" : "";
  return `${sign}${currency(tracking.deltaAmount)} (${percentSign}${Number(
    tracking.deltaPercent || 0,
  ).toFixed(1)}%)`;
}

function deltaTone(tracking: TrackingSnapshot | null) {
  if (!tracking || tracking.deltaPercent === null || tracking.deltaPercent === undefined) {
    return "border-neutral-300 bg-neutral-100 text-neutral-700";
  }
  if (tracking.deltaPercent > 5) {
    return "border-rose-300 bg-rose-100 text-rose-900";
  }
  if (tracking.deltaPercent < -5) {
    return "border-amber-300 bg-amber-100 text-amber-900";
  }
  return "border-emerald-300 bg-emerald-100 text-emerald-900";
}

function statusTone(status: string) {
  if (status === "active") return "border-emerald-300 bg-emerald-100 text-emerald-900";
  if (status === "draft") return "border-amber-300 bg-amber-100 text-amber-900";
  if (status === "archived") return "border-neutral-300 bg-neutral-100 text-neutral-700";
  return "border-blue-300 bg-blue-100 text-blue-900";
}

export default function SellerInventoryVisualTracker() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<VisualInventoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
  const [batchRefreshing, setBatchRefreshing] = useState(false);
  const [deepScan, setDeepScan] = useState(false);

  const loadInventory = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status,
      });
      if (search) params.set("search", search);
      const response = await fetch(
        `/api/account/seller/inventory/visual-tracker?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        },
      );
      const data = (await response.json().catch(() => ({}))) as Partial<VisualResponse> & {
        error?: string;
      };
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not load visual inventory.");
      }

      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(Number(data.total || 0));
      setHasMore(data.hasMore === true);
      setSelected(new Set());
    } catch (nextError: any) {
      setError(nextError?.message || "Could not load visual inventory.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [offset, search, status, token]);

  useEffect(() => {
    void (async () => {
      const session = await getFreshAccountSession(5 * 60, true);
      setToken(session?.access_token || null);
      if (!session?.access_token) {
        setLoading(false);
        setError("Log in with the owner seller account to load inventory.");
      }
    })();
  }, []);

  useEffect(() => {
    if (!token) return;
    const inventoryLoadId = window.setTimeout(() => {
      void loadInventory();
    }, 0);
    return () => window.clearTimeout(inventoryLoadId);
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
    setRefreshing((current) => new Set(current).add(inventoryItemId));
    if (!quiet) {
      setMessage("Running InstaComp™ against current market and sold evidence...");
      setError("");
    }

    try {
      const response = await fetch(
        `/api/account/seller/inventory/${inventoryItemId}/instacomp-tracking`,
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
        throw new Error(data?.error || "InstaComp™ refresh failed.");
      }

      setItems((current) =>
        current.map((item) =>
          item.inventoryItemId === inventoryItemId
            ? { ...item, tracking: data.tracking as TrackingSnapshot }
            : item,
        ),
      );
      if (!quiet) {
        setMessage("InstaComp™ market tracking was saved to this inventory item.");
      }
      return true;
    } catch (nextError: any) {
      if (!quiet) setError(nextError?.message || "InstaComp™ refresh failed.");
      return false;
    } finally {
      setRefreshing((current) => {
        const next = new Set(current);
        next.delete(inventoryItemId);
        return next;
      });
    }
  }

  async function refreshSelected() {
    const ids = selectedCardIds.slice(0, MAX_BATCH_REFRESH);
    if (!ids.length) return;

    setBatchRefreshing(true);
    setError("");
    setMessage(`Refreshing ${ids.length} selected card(s) one at a time...`);
    let succeeded = 0;
    const failed: string[] = [];

    for (const id of ids) {
      const ok = await refreshOne(id, true);
      if (ok) succeeded += 1;
      else failed.push(id);
    }

    setBatchRefreshing(false);
    setMessage(
      `${succeeded} selected card(s) refreshed.${
        failed.length ? ` ${failed.length} failed and remain selected.` : ""
      }`,
    );
    if (!failed.length) setSelected(new Set());
  }

  const pageStart = total ? offset + 1 : 0;
  const pageEnd = Math.min(offset + items.length, total);

  return (
    <section className="border-b-4 border-neutral-950 bg-[#efe9db] px-4 py-8 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="border-4 border-neutral-950 bg-cyan-300 p-5 shadow-[7px_7px_0_#111318]">
          <p className="text-xs font-black uppercase tracking-[0.2em]">
            Visual Inventory + InstaComp™ Market Tracker
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
            Pictures first. Pricing evidence on every card.
          </h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7">
            This panel adds the missing inventory photos and persistent market tracking to
            cards that were already listed before the AI drag-and-drop workflow existed.
            The advanced inventory editor remains directly below this panel.
          </p>
        </header>

        <div className="grid gap-3 border-2 border-neutral-950 bg-white p-4 shadow-[4px_4px_0_#111318] lg:grid-cols-[1fr_170px_auto]">
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
              placeholder="Search player, year, set, card number..."
              className="min-w-0 flex-1 border-2 border-neutral-950 px-3 py-2 font-bold"
            />
            <button
              type="submit"
              className="border-2 border-neutral-950 bg-neutral-950 px-4 py-2 font-black text-white"
            >
              Search
            </button>
          </form>

          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setOffset(0);
            }}
            className="border-2 border-neutral-950 px-3 py-2 font-black"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
            <option value="sold">Sold</option>
          </select>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={
                batchRefreshing ||
                selectedCardIds.length === 0 ||
                selectedCardIds.length > MAX_BATCH_REFRESH
              }
              onClick={() => void refreshSelected()}
              className="border-2 border-neutral-950 bg-violet-600 px-4 py-2 font-black text-white disabled:opacity-40"
            >
              {batchRefreshing
                ? "Refreshing..."
                : `Refresh Selected (${selectedCardIds.length})`}
            </button>
            <button
              type="button"
              onClick={() => void loadInventory()}
              className="border-2 border-neutral-950 bg-white px-4 py-2 font-black"
            >
              Reload
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold">
          <p>
            Showing {pageStart}-{pageEnd} of {total} inventory items.
          </p>
          <label className="flex items-center gap-2 border-2 border-neutral-950 bg-white px-3 py-2">
            <input
              type="checkbox"
              checked={deepScan}
              onChange={(event) => setDeepScan(event.target.checked)}
            />
            Deep AI council scan
          </label>
          <p className="text-neutral-600">
            Select up to {MAX_BATCH_REFRESH} cards per refresh batch.
          </p>
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
            Loading pictures and pricing records...
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => {
              const tracking = item.tracking;
              const refreshingThis = refreshing.has(item.inventoryItemId);
              const soldComps = Array.isArray(tracking?.topSoldComps)
                ? tracking.topSoldComps
                : [];
              const marketComps = Array.isArray(tracking?.topMarketComps)
                ? tracking.topMarketComps
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
                        No image found for this inventory row
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
                    <span
                      className={`absolute right-3 top-3 border px-2 py-1 text-xs font-black uppercase ${statusTone(
                        item.status,
                      )}`}
                    >
                      {item.status}
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

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <Metric label="Listed" value={currency(item.price)} />
                      <Metric
                        label="Market"
                        value={tracking?.marketPrice ? currency(tracking.marketPrice) : "—"}
                      />
                      <Metric
                        label="Sold median"
                        value={tracking?.soldMedian ? currency(tracking.soldMedian) : "—"}
                      />
                    </div>

                    <div
                      className={`mt-3 border-2 px-3 py-2 text-sm font-black ${deltaTone(
                        tracking,
                      )}`}
                    >
                      Price vs. market: {deltaLabel(tracking)}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <Detail label="Market comps" value={String(tracking?.marketCompCount || 0)} />
                      <Detail label="Sold comps" value={String(tracking?.soldCompCount || 0)} />
                      <Detail label="Sold in 7 days" value={String(tracking?.sales7d || 0)} />
                      <Detail label="Sold in 30 days" value={String(tracking?.sales30d || 0)} />
                      <Detail label="Our units sold" value={String(item.ownSales.unitsSold)} />
                      <Detail label="Our revenue" value={currency(item.ownSales.revenue)} />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase">
                      <span
                        className={`border px-2 py-1 ${
                          tracking?.trustedForPricing
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : "border-amber-300 bg-amber-100 text-amber-900"
                        }`}
                      >
                        {tracking
                          ? tracking.trustedForPricing
                            ? "Pricing evidence trusted"
                            : "Review pricing evidence"
                          : "Not tracked yet"}
                      </span>
                      {item.quickList.createdWithInstaComp ? (
                        <span className="border border-sky-300 bg-sky-100 px-2 py-1 text-sky-900">
                          AI-listed
                        </span>
                      ) : (
                        <span className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-neutral-700">
                          Existing inventory
                        </span>
                      )}
                    </div>

                    {tracking?.identity ? (
                      <p className="mt-3 text-xs font-semibold text-neutral-600">
                        Identified: {[
                          tracking.identity.year,
                          tracking.identity.brand,
                          tracking.identity.setName,
                          tracking.identity.player,
                          tracking.identity.parallel,
                          tracking.identity.cardNumber
                            ? `#${tracking.identity.cardNumber}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Identity needs review"}
                      </p>
                    ) : null}

                    <div className="mt-3 border-t border-neutral-200 pt-3">
                      <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                        Latest sold evidence
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
                              <span className="whitespace-nowrap font-black">
                                {currency(comp.price)}
                              </span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-neutral-500">
                          Refresh InstaComp™ to search current sold evidence.
                        </p>
                      )}
                    </div>

                    {!soldComps.length && marketComps.length ? (
                      <p className="mt-2 text-xs font-semibold text-amber-800">
                        Active market guidance exists, but no exact sold evidence was found.
                      </p>
                    ) : null}

                    {tracking?.reviewReasons?.length ? (
                      <p className="mt-3 line-clamp-3 text-xs font-semibold text-amber-900">
                        Review: {tracking.reviewReasons.join(" · ")}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={!item.isCard || refreshingThis || batchRefreshing}
                        onClick={() => void refreshOne(item.inventoryItemId)}
                        className="border-2 border-neutral-950 bg-violet-600 px-3 py-3 text-sm font-black text-white disabled:opacity-35"
                      >
                        {refreshingThis
                          ? "Scanning..."
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
                          href={`/seller/inventory?search=${encodeURIComponent(
                            item.sku || item.title,
                          )}`}
                          className="border-2 border-neutral-950 bg-white px-3 py-3 text-center text-sm font-black"
                        >
                          Open Editor
                        </a>
                      )}
                    </div>

                    <p className="mt-3 text-[11px] font-semibold text-neutral-500">
                      Last market check: {shortDate(tracking?.updatedAt)} · Updated inventory:
                      {" "}{shortDate(item.updatedAt)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {!loading && !items.length ? (
          <div className="border-2 border-dashed border-neutral-500 bg-white p-8 text-center font-bold text-neutral-600">
            No inventory items match these filters.
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
          <p className="text-sm font-black">
            Page {Math.floor(offset / PAGE_SIZE) + 1}
          </p>
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
