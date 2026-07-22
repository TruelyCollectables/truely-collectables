"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

const PAGE_SIZE = 48;
const MAX_BATCH = 10;
const DEFAULT_CARD_SHIPPING = 6.99;

const SCAN_PHASES = [
  { at: 0, percent: 6, label: "Preparing card images" },
  { at: 2, percent: 20, label: "Reading card details" },
  { at: 7, percent: 40, label: "Checking AI identity and card features" },
  { at: 15, percent: 62, label: "Searching sold and active marketplace evidence" },
  { at: 28, percent: 80, label: "Validating card number, parallel, and print run" },
  { at: 45, percent: 91, label: "Checking TCOS sold-history evidence" },
  { at: 70, percent: 96, label: "Building active-market intelligence" },
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
  shippingCost?: number | null;
  shippingKnown?: boolean;
  shippingCostType?: string | null;
  landedPrice?: number | null;
  itemId?: string | null;
  matchLevel?: string | null;
};

type AttackCompetitor = {
  itemId?: string | null;
  legacyItemId?: string | null;
  title: string;
  price: number;
  shippingCost: number | null;
  shippingKnown: boolean;
  shippingCostType?: string | null;
  landedPrice: number | null;
  url: string;
  matchScore?: number;
  matchLevel?: "exact" | "strong" | "scouting";
  flags?: string[];
  queryUsed?: string | null;
};

type AttackSuggestion = {
  key: string;
  label: string;
  itemPrice: number;
  shipping: number;
  landedPrice: number;
  profitFloor: number | null;
  meetsProfitFloor: boolean | null;
};

type ActiveMarketAttack = {
  schema?: string;
  status?: "ready" | "scouting_only" | "no_candidates" | "ebay_unavailable";
  updatedAt?: string | null;
  rawCandidateCount?: number;
  exactActiveCount: number;
  strictExactCount?: number;
  strongMatchCount?: number;
  scoutingCount?: number;
  landedKnownCount: number;
  shippingUnknownCount: number;
  lowestCompetitor?: AttackCompetitor | null;
  lowestCompetitorLanded?: number | null;
  ourItemPrice: number;
  ourShipping: number;
  ourShippingLabel?: string | null;
  ourLanded: number;
  position: string;
  gapToLowest?: number | null;
  costBasis?: number | null;
  profitFloor?: number | null;
  suggestions?: AttackSuggestion[];
  competitors?: AttackCompetitor[];
  scoutingCandidates?: AttackCompetitor[];
  searchQueries?: string[];
  searchUrl?: string | null;
  taxIncluded?: boolean;
  taxNote?: string | null;
  marketLocation?: {
    country?: string;
    postalCode?: string;
    label?: string;
  };
};

type TrackingSnapshot = {
  updatedAt?: string | null;
  pricingEvidenceMode?: string | null;
  trustedForPricing?: boolean;
  reviewReasons?: string[];
  listingPrice?: number | null;
  marketPrice?: number | null;
  soldMedian?: number | null;
  marketCompCount?: number;
  soldCompCount?: number;
  sales7d?: number;
  sales30d?: number;
  deltaAmount?: number | null;
  deltaPercent?: number | null;
  topSoldComps?: TrackingComp[];
  topMarketComps?: TrackingComp[];
  activeMarketAttack?: ActiveMarketAttack | null;
};

type ActiveInventoryItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  sku: string | null;
  category: string;
  status: "active";
  quantity: number;
  price: number;
  ebayItemId: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  isCard: boolean;
  tracking: TrackingSnapshot | null;
};

type ActiveResponse = {
  success: boolean;
  total: number;
  hasMore: boolean;
  items: ActiveInventoryItem[];
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function charmBelow(maximum: number) {
  if (!Number.isFinite(maximum) || maximum <= 0.99) return 0.99;
  return Math.max(0.99, roundMoney(Math.floor(maximum - 0.99) + 0.99));
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
      "No exact marketplace matches passed the original pricing filters.",
    seller_title_fallback_used:
      "Pricing was recovered with an exact seller-title match.",
    tcos_sold_history_used:
      "Exact TCOS sold-inventory history was included as sold evidence.",
    single_active_comp_guidance_only:
      "Only one exact active listing was found, so treat it as guidance.",
    missing_back_image:
      "A back image would improve card-number, set, parallel, and serial verification.",
    pricing_spread_too_wide:
      "The exact matches have a wide price spread and need seller review.",
    active_market_no_verified_matches:
      "Attack Mode searched active listings but did not find a safe verified undercut target.",
    active_market_strong_matches_used:
      "Some active competitors omitted nonessential title details but had no conflicting card evidence.",
  };
  if (labels[reason]) return labels[reason];
  return reason.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function evidenceModeLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    exact_sold_and_market: "Exact sold + active market",
    seller_title_exact_market_fallback: "Seller-title exact market fallback",
    exact_market: "Exact active market",
    active_market_attack: "Active Market Attack Mode",
    active_market_scouting: "Active Market Scouting",
    active_market_no_results: "No active-market results",
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
    return "No sold-market baseline yet";
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

function attackPosition(value: string) {
  const labels: Record<string, string> = {
    best_deal: "YOU ARE THE BEST LANDED DEAL",
    within_striking_distance: "WITHIN $1 OF THE LEADER",
    over_market: "COMPETITORS ARE CHEAPER",
    shipping_unknown: "SHIPPING DATA IS INCOMPLETE",
    no_verified_matches: "NO SAFE UNDERCUT TARGET YET",
  };
  return labels[value] || titleCase(value);
}

function dynamicStrategies(attack: ActiveMarketAttack, shipping: number) {
  const lowest = Number(attack.lowestCompetitorLanded || 0);
  if (!lowest) return [] as AttackSuggestion[];
  const floor = attack.profitFloor ?? null;
  const definitions = [
    ["beat_by_cent", "Beat by $0.01", lowest - 0.01],
    ["beat_by_dollar", "Beat by $1", lowest - 1],
    ["undercut_5", "5% lower landed", lowest * 0.95],
    ["undercut_10", "10% lower landed — King Price", lowest * 0.9],
    ["undercut_15", "15% lower landed — Aggressive", lowest * 0.85],
  ] as const;
  return definitions.map(([key, label, target]) => {
    const itemPrice = charmBelow(Math.max(0.99, target - shipping));
    return {
      key,
      label,
      itemPrice,
      shipping,
      landedPrice: roundMoney(itemPrice + shipping),
      profitFloor: floor,
      meetsProfitFloor: floor === null ? null : itemPrice >= floor,
    };
  });
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
  const [shippingOverrides, setShippingOverrides] = useState<Record<string, string>>({});
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
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
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
    const startedAt = Date.now();
    setProgress((current) => ({
      ...current,
      [inventoryItemId]: {
        percent: 6,
        label: "Preparing card images",
        elapsed: 0,
        state: "running",
      },
    }));
    if (!quiet) {
      setMessage("InstaComp™ is checking exact sold and active market evidence...");
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
      const marketResponse = await fetch(
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
      const marketData = await marketResponse.json().catch(() => ({}));
      if (!marketResponse.ok || marketData?.success !== true) {
        throw new Error(marketData?.error || "InstaComp™ market check failed.");
      }

      let tracking = (marketData.tracking || {}) as TrackingSnapshot;
      let attackDiagnostics: Record<string, unknown> | null = null;
      if (Number(tracking.soldCompCount || 0) === 0) {
        setProgress((current) => ({
          ...current,
          [inventoryItemId]: {
            percent: 97,
            label: "Running expanded Active Market Attack search",
            elapsed: Math.max(1, Math.floor((Date.now() - startedAt) / 1000)),
            state: "running",
          },
        }));
        const attackResponse = await fetch(
          `/api/account/seller/inventory/${inventoryItemId}/active-market-attack`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: "{}",
          },
        );
        const attackData = await attackResponse.json().catch(() => ({}));
        if (!attackResponse.ok || attackData?.success !== true) {
          throw new Error(attackData?.error || "Active Market Attack Mode failed.");
        }
        tracking = (attackData.tracking || tracking) as TrackingSnapshot;
        attackDiagnostics = attackData.diagnostics || null;
      }

      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      setProgress((current) => ({
        ...current,
        [inventoryItemId]: {
          percent: 100,
          label: "Market intelligence saved",
          elapsed,
          state: "success",
        },
      }));
      setItems((current) =>
        current.map((item) =>
          item.inventoryItemId === inventoryItemId ? { ...item, tracking } : item,
        ),
      );

      if (!quiet) {
        const attack = tracking.activeMarketAttack;
        if (attack?.exactActiveCount) {
          setMessage(
            `Attack Mode ranked ${attack.exactActiveCount} verified active competitor(s); landed shipping was known for ${attack.landedKnownCount}.`,
          );
        } else if (attack?.scoutingCount) {
          setMessage(
            `Attack Mode checked ${attack.rawCandidateCount || 0} active listing(s). ${attack.scoutingCount} review candidate(s) are shown, but none were safe enough for automatic undercut math.`,
          );
        } else if (attack) {
          setMessage(
            `Attack Mode checked ${attack.rawCandidateCount || 0} active listing(s) across ${(attack.searchQueries || []).length} query pass(es) and found no safe match. The card now shows the search details instead of hiding them.`,
          );
        } else {
          setMessage(
            `InstaComp™ saved ${Number(marketData.evidence?.marketCompCount || 0)} exact market match(es) and ${Number(marketData.evidence?.soldCompCount || 0)} exact sold match(es).${attackDiagnostics ? ` Attack search checked ${Number(attackDiagnostics.rawCandidateCount || 0)} candidate(s).` : ""}`,
          );
        }
      }
      return true;
    } catch (nextError: any) {
      const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      setProgress((current) => ({
        ...current,
        [inventoryItemId]: {
          percent: Math.min(97, current[inventoryItemId]?.percent || 10),
          label: "Scan stopped — review the message above",
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

  async function copyPrice(value: number, label: string) {
    try {
      await navigator.clipboard.writeText(value.toFixed(2));
      setMessage(`${label}: ${currency(value)} copied. Open Edit Product to apply it.`);
    } catch {
      setMessage(`${label}: ${currency(value)}. Copy it into Edit Product.`);
    }
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
            Sold comps when they exist. Active Market Attack when they do not.
          </h1>
          <p className="mt-3 max-w-5xl font-semibold leading-7">
            Every no-sold-comp scan now ends with a visible attack plan, a scouting board, or a documented no-result search. Nothing disappears silently.
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
              {batchRunning
                ? "Refreshing..."
                : `Refresh Selected (${selectedCardIds.length})`}
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
              const reasons = Array.isArray(tracking?.reviewReasons)
                ? tracking.reviewReasons
                : [];
              const attack =
                Number(tracking?.soldCompCount || 0) === 0
                  ? tracking?.activeMarketAttack || null
                  : null;

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
                        label="Exact active"
                        value={String(tracking?.marketCompCount || 0)}
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
                      Your price vs. sold market: {deltaText(tracking)}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <Detail
                        label="Exact sold"
                        value={String(tracking?.soldCompCount || 0)}
                      />
                      <Detail
                        label="Exact active"
                        value={String(tracking?.marketCompCount || 0)}
                      />
                      <Detail
                        label="Sold in 7 days"
                        value={String(tracking?.sales7d || 0)}
                      />
                      <Detail
                        label="Sold in 30 days"
                        value={String(tracking?.sales30d || 0)}
                      />
                      <Detail
                        label="Evidence mode"
                        value={evidenceModeLabel(tracking?.pricingEvidenceMode)}
                      />
                      <Detail
                        label="Pricing confidence"
                        value={
                          tracking?.trustedForPricing
                            ? "Usable"
                            : tracking
                              ? "Review"
                              : "Not checked"
                        }
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
                          <span>
                            {itemProgress.percent}% · {itemProgress.elapsed}s
                          </span>
                        </div>
                        <div className="mt-2 h-4 overflow-hidden border-2 border-neutral-950 bg-white">
                          <div
                            className="h-full bg-violet-700 transition-[width] duration-500"
                            style={{ width: `${itemProgress.percent}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {attack ? (
                      <AttackBoard
                        item={item}
                        attack={attack}
                        shippingText={shippingOverrides[item.inventoryItemId]}
                        onShippingChange={(value) =>
                          setShippingOverrides((current) => ({
                            ...current,
                            [item.inventoryItemId]: value,
                          }))
                        }
                        onCopyPrice={copyPrice}
                      />
                    ) : tracking && Number(tracking.soldCompCount || 0) === 0 ? (
                      <div className="mt-4 border-4 border-neutral-950 bg-amber-100 p-4">
                        <p className="text-xs font-black uppercase tracking-[0.18em]">
                          Active Market Attack Mode
                        </p>
                        <p className="mt-2 text-sm font-bold">
                          This saved snapshot predates the expanded attack search. Click Refresh InstaComp™ to run it now.
                        </p>
                      </div>
                    ) : null}

                    {tracking ? (
                      <div className="mt-3 border border-neutral-300 bg-neutral-50 p-3 text-xs font-semibold">
                        <p className="font-black uppercase text-neutral-500">
                          Latest check
                        </p>
                        <p className="mt-1">
                          {shortDate(tracking.updatedAt)} · {evidenceModeLabel(tracking.pricingEvidenceMode)}
                        </p>
                      </div>
                    ) : null}

                    {reasons.length ? (
                      <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-black uppercase">Review notes</p>
                        <ul className="mt-2 space-y-1 font-semibold">
                          {reasons.slice(0, 6).map((reason) => (
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
                              <span className="line-clamp-2 font-semibold">
                                {comp.title}
                              </span>
                              <span className="whitespace-nowrap font-black">
                                {currency(comp.price)}
                              </span>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs font-semibold text-neutral-500">
                          No exact sold match is saved. Attack Mode handles active-market intelligence above.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={
                          !item.isCard ||
                          !item.imageUrl ||
                          running ||
                          batchRunning
                        }
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
                          href={`/seller/inventory?search=${encodeURIComponent(
                            item.sku || item.title,
                          )}`}
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

function AttackBoard({
  item,
  attack,
  shippingText,
  onShippingChange,
  onCopyPrice,
}: {
  item: ActiveInventoryItem;
  attack: ActiveMarketAttack;
  shippingText?: string;
  onShippingChange: (value: string) => void;
  onCopyPrice: (value: number, label: string) => Promise<void>;
}) {
  const defaultShipping =
    attack.ourShipping ?? (item.price > 149 ? 0 : DEFAULT_CARD_SHIPPING);
  const parsedShipping =
    shippingText === undefined ? defaultShipping : Number(shippingText);
  const ourShipping =
    Number.isFinite(parsedShipping) && parsedShipping >= 0
      ? parsedShipping
      : defaultShipping;
  const strategies = dynamicStrategies(attack, ourShipping);
  const ourLanded = roundMoney(item.price + ourShipping);
  const lowestLanded = Number(attack.lowestCompetitorLanded || 0);
  const dynamicGap = lowestLanded ? roundMoney(ourLanded - lowestLanded) : null;
  const dynamicPosition = !lowestLanded
    ? attack.exactActiveCount > 0
      ? "shipping_unknown"
      : "no_verified_matches"
    : ourLanded < lowestLanded
      ? "best_deal"
      : ourLanded <= lowestLanded + 1
        ? "within_striking_distance"
        : "over_market";

  return (
    <section className="mt-4 border-4 border-neutral-950 bg-amber-200 p-4 shadow-[4px_4px_0_#111318]">
      <p className="text-xs font-black uppercase tracking-[0.18em]">
        Active Market Attack Mode
      </p>

      {attack.exactActiveCount > 0 ? (
        <>
          <h3 className="mt-1 text-xl font-black">
            {attackPosition(dynamicPosition)}
          </h3>
          <p className="mt-2 text-xs font-semibold">
            No exact sold comp was available. Verified active competitors are ranked by item price plus estimated shipping, before tax.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Detail
              label="Verified competitors"
              value={String(attack.exactActiveCount)}
            />
            <Detail
              label="Strict / strong"
              value={`${attack.strictExactCount || 0} / ${attack.strongMatchCount || 0}`}
            />
            <Detail
              label="Shipping known"
              value={`${attack.landedKnownCount}/${attack.exactActiveCount}`}
            />
            <Detail
              label="Cheapest landed"
              value={lowestLanded ? currency(lowestLanded) : "Unknown"}
            />
            <Detail label="Your landed" value={currency(ourLanded)} />
            <Detail
              label="Gap to leader"
              value={
                dynamicGap === null
                  ? "Unknown"
                  : `${dynamicGap > 0 ? "+" : ""}${currency(dynamicGap)}`
              }
            />
          </div>

          <label className="mt-3 block text-xs font-black uppercase">
            Our shipping used for strategy
            <input
              type="number"
              min="0"
              step="0.01"
              value={shippingText ?? String(defaultShipping.toFixed(2))}
              onChange={(event) => onShippingChange(event.target.value)}
              className="mt-1 w-full border-2 border-neutral-950 bg-white px-3 py-2 text-base font-black"
            />
          </label>

          {strategies.length ? (
            <div className="mt-3 space-y-2">
              {strategies.map((strategy) => (
                <div
                  key={strategy.key}
                  className={`border-2 border-neutral-950 bg-white p-3 ${
                    strategy.key === "undercut_10"
                      ? "ring-4 ring-violet-500"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-black">{strategy.label}</p>
                      <p className="mt-1 text-xs font-semibold">
                        Item {currency(strategy.itemPrice)} + shipping{" "}
                        {currency(strategy.shipping)} = landed{" "}
                        {currency(strategy.landedPrice)}
                      </p>
                      {strategy.meetsProfitFloor === false ? (
                        <p className="mt-1 text-xs font-black text-rose-700">
                          Below recorded 20% cost floor of{" "}
                          {currency(strategy.profitFloor)}
                        </p>
                      ) : strategy.meetsProfitFloor === true ? (
                        <p className="mt-1 text-xs font-black text-emerald-700">
                          Clears recorded 20% cost floor
                        </p>
                      ) : (
                        <p className="mt-1 text-xs font-semibold text-amber-800">
                          No cost basis recorded—verify margin first
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        void onCopyPrice(strategy.itemPrice, strategy.label)
                      }
                      className="border-2 border-neutral-950 bg-violet-700 px-3 py-2 text-xs font-black text-white"
                    >
                      Copy {currency(strategy.itemPrice)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 border-2 border-neutral-950 bg-white p-3 text-xs font-bold">
              Competitors were verified, but shipping was not numeric. They are shown below without an undercut recommendation.
            </p>
          )}

          <div className="mt-4 space-y-2">
            <p className="text-xs font-black uppercase">
              Competitor landed-price board
            </p>
            {(attack.competitors || []).map((competitor, index) => (
              <CompetitorRow
                key={`${competitor.url}-${index}`}
                competitor={competitor}
                index={index}
                scouting={false}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <h3 className="mt-1 text-xl font-black">
            {attack.status === "ebay_unavailable"
              ? "EBAY ACTIVE SEARCH WAS UNAVAILABLE"
              : attack.scoutingCount
                ? "SCOUTING CANDIDATES FOUND — REVIEW BEFORE PRICING"
                : "NO VERIFIED ACTIVE COMPETITOR FOUND"}
          </h3>
          <p className="mt-2 text-xs font-semibold">
            Attack Mode did not disappear. It checked the active market and refused to invent an undercut price because no listing met the safety rules.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Detail
              label="Raw listings checked"
              value={String(attack.rawCandidateCount || 0)}
            />
            <Detail
              label="Query passes"
              value={String((attack.searchQueries || []).length)}
            />
            <Detail
              label="Verified targets"
              value={String(attack.exactActiveCount || 0)}
            />
            <Detail
              label="Scouting candidates"
              value={String(attack.scoutingCount || 0)}
            />
          </div>

          {(attack.scoutingCandidates || []).length ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-black uppercase">
                Review-only scouting board
              </p>
              {(attack.scoutingCandidates || []).map((competitor, index) => (
                <CompetitorRow
                  key={`${competitor.url}-${index}`}
                  competitor={competitor}
                  index={index}
                  scouting
                />
              ))}
            </div>
          ) : (
            <p className="mt-3 border-2 border-neutral-950 bg-white p-3 text-xs font-bold">
              No active listing had enough matching player, year, card number, print run, autograph/relic, grading, set, or parallel evidence.
            </p>
          )}

          {(attack.searchQueries || []).length ? (
            <details className="mt-3 border-2 border-neutral-950 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-black uppercase">
                Show search queries checked
              </summary>
              <ol className="mt-2 space-y-1 font-semibold">
                {(attack.searchQueries || []).map((query, index) => (
                  <li key={`${query}-${index}`}>
                    {index + 1}. {query}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          {attack.searchUrl ? (
            <a
              href={attack.searchUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block border-2 border-neutral-950 bg-neutral-950 px-4 py-3 text-center text-sm font-black text-white"
            >
              Open the eBay active search
            </a>
          ) : null}
        </>
      )}

      <p className="mt-3 text-xs font-semibold">
        {attack.taxNote ||
          "Sales tax is excluded because it varies by buyer location."}
      </p>
      <p className="mt-1 text-xs font-semibold">
        Shipping market: {attack.marketLocation?.label || "US estimate"}
      </p>
    </section>
  );
}

function CompetitorRow({
  competitor,
  index,
  scouting,
}: {
  competitor: AttackCompetitor;
  index: number;
  scouting: boolean;
}) {
  return (
    <a
      href={competitor.url}
      target="_blank"
      rel="noreferrer"
      className="block border-2 border-neutral-950 bg-white p-3 hover:bg-amber-50"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 text-xs font-bold">
          #{index + 1} {competitor.title}
        </span>
        <span className="whitespace-nowrap text-sm font-black">
          {competitor.landedPrice !== null
            ? currency(competitor.landedPrice)
            : "Shipping unknown"}
        </span>
      </div>
      <p className="mt-1 text-xs font-semibold text-neutral-600">
        Item {currency(competitor.price)} + shipping{" "}
        {competitor.shippingCost !== null
          ? currency(competitor.shippingCost)
          : "unknown"}
        {competitor.shippingCostType
          ? ` · ${competitor.shippingCostType}`
          : ""}
      </p>
      <p className="mt-1 text-[11px] font-black uppercase text-neutral-500">
        {scouting
          ? "Review only — not used for pricing"
          : competitor.matchLevel === "strong"
            ? "Strong verified match"
            : "Strict exact match"}
      </p>
    </a>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-300 bg-neutral-50 px-2 py-2">
      <p className="text-[10px] font-black uppercase text-neutral-500">
        {label}
      </p>
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
