"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type PricingStatus =
  | "not_run"
  | "suggested_from_reliable_sold_comps"
  | "seller_price_required";

type CompEvidence = {
  title: string;
  price: number;
  currency: string;
  url: string | null;
  imageUrl: string | null;
  source: string | null;
  sourceLabel: string;
  sourceCategory: string | null;
  matchScore: number | null;
  flags: string[];
  soldAt: string | null;
  listedAt: string | null;
  observedAt: string | null;
};

type MarketStats = {
  count: number;
  usedCount: number;
  outliersRemoved: number;
  low: number | null;
  q1: number | null;
  median: number | null;
  average: number | null;
  q3: number | null;
  high: number | null;
};

type PricingModel = {
  strategy: string | null;
  confidence: string | null;
  marketValue: number | null;
  quickSalePrice: number | null;
  stretchPrice: number | null;
  activeInfluenceApplied: boolean;
  sold: MarketStats & { recencyWeightedMedian: number | null };
  active: MarketStats & {
    competitiveEntryPrice: number | null;
    competitiveTargetPrice: number | null;
  };
  rationale: string[];
};

type PendingItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  description: string | null;
  sku: string | null;
  status: string;
  quantity: number;
  price: number;
  imageUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  uniquePhysicalCopy: boolean;
  quantityRule: string;
  activationReadiness: {
    ready: boolean;
    blockers: string[];
  };
  sellerReview: {
    identityConfirmed: boolean;
    confirmedAt: string | null;
    confirmedBy: string | null;
  };
  instaComp: {
    source: string | null;
    scanId: string | null;
    humanVerified: boolean;
    serialNumber: string | null;
    hasBackImage: boolean;
    suggestedPrice: number | null;
    pricingStatus: PricingStatus;
    pricingReason: string;
    reliableSoldCompCount: number;
    pricingCheckedAt: string | null;
    pricingModel: PricingModel;
    listingPrice: number | null;
    listingPriceSource: string | null;
    soldCompEvidence: CompEvidence[];
    activeCompetition: CompEvidence[];
    rejectedCandidates: CompEvidence[];
    providerCoverage: Array<{
      source: string | null;
      label: string | null;
      status: string | null;
      resultCount: number;
      message: string | null;
      searchUrl: string | null;
    }>;
    sourceLinks: {
      ebaySoldUrl: string | null;
      ebayActiveUrl: string | null;
      broadCardMarketUrl: string | null;
    };
    gradingCompany: string | null;
    gradingGrade: string | null;
    gradingCertNumber: string | null;
    graderVerificationStatus: string;
    graderVerificationUrl: string | null;
  };
};

type DraftEdit = {
  title: string;
  description: string;
  quantity: string;
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function label(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value.replaceAll("_", " ");
}

function blockerLabel(value: string) {
  if (value === "missing_price") return "price required";
  if (value === "grader_verification_required") {
    return "grader verification required";
  }
  if (value === "grader_verification_conflict") {
    return "grader verification conflict";
  }
  return label(value);
}

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

function graderStatusLabel(status: string) {
  if (status === "verified") return "Official grader verified";
  if (status === "manual_verified") return "Human-verified slab scan";
  if (status === "conflict") return "Verification conflict";
  if (status === "failed") return "Official lookup unavailable";
  return label(status);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString() : value;
}

function scoreLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return `${Math.round(value * 100)}% normalized match`;
  return `${Math.round(value)} evidence points`;
}

function evidenceDate(comp: CompEvidence) {
  return dateLabel(comp.soldAt || comp.listedAt || comp.observedAt);
}

function isImageUrl(value: string | null) {
  return Boolean(value && /^https?:\/\//i.test(value));
}

async function scanPendingItem(item: PendingItem, accessToken: string) {
  const response = await fetch("/api/account/seller/inventory/instacomp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      inventoryItemId: item.inventoryItemId,
      aiCouncilTier: "adaptive",
    }),
  });
  const data = await response.json();
  if (!response.ok || data.success !== true) {
    throw new Error(data.error || "InstaComp pricing failed.");
  }
  return data as {
    suggestedPrice: number;
    pricingStatus: PricingStatus;
    pricingReason: string;
    reliableSoldCompCount: number;
  };
}

export default function InstaCompPendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [pricingItemId, setPricingItemId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [manualPrices, setManualPrices] = useState<Record<string, string>>({});
  const [draftEdits, setDraftEdits] = useState<Record<string, DraftEdit>>({});
  const [bulkQuantity, setBulkQuantity] = useState("");
  const [bulkPrice, setBulkPrice] = useState("");
  const [autoPricing, setAutoPricing] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsedSeconds, setScanElapsedSeconds] = useState(0);
  const [scanPercent, setScanPercent] = useState(0);
  const [scanSubject, setScanSubject] = useState("");
  const autoAttempted = useRef(new Set<string>());
  const autoRunning = useRef(false);

  useEffect(() => {
    if (scanStartedAt === null) return;
    const timer = window.setInterval(() => {
      setScanElapsedSeconds(Math.max(0, Math.floor((Date.now() - scanStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [scanStartedAt]);

  function beginVisibleScan(subject: string) {
    setScanSubject(subject);
    setScanPercent(5);
    setScanElapsedSeconds(0);
    setScanStartedAt(Date.now());
  }

  function finishVisibleScan() {
    setScanPercent(100);
    window.setTimeout(() => {
      setScanStartedAt(null);
      setScanPercent(0);
      setScanSubject("");
    }, 650);
  }

  const loadPending = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    setError("");
    setLoggedOut(false);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) {
        setItems([]);
        setLoggedOut(true);
        return;
      }

      const response = await fetch("/api/account/seller/instacomp-pending", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load InstaComp pending listings.");
      }

      const nextItems = Array.isArray(data.items)
        ? (data.items as PendingItem[])
        : [];
      const nextIds = new Set(nextItems.map((item) => item.inventoryItemId));
      setItems(nextItems);
      setSelectedIds((current) => current.filter((id) => nextIds.has(id)));
      setDraftEdits((current) => {
        const next: Record<string, DraftEdit> = {};
        for (const item of nextItems) {
          next[item.inventoryItemId] = current[item.inventoryItemId] || {
            title: item.title,
            description: item.description || "",
            quantity: String(item.quantity),
          };
        }
        return next;
      });
    } catch (nextError: unknown) {
      setItems([]);
      setError(
        errorMessage(nextError, "Could not load InstaComp pending listings."),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPending(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPending]);

  const sortedItems = useMemo(
    () =>
      [...items].sort((left, right) =>
        String(left.sku || left.title).localeCompare(
          String(right.sku || right.title),
        ),
      ),
    [items],
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedItems = useMemo(
    () => sortedItems.filter((item) => selectedSet.has(item.inventoryItemId)),
    [selectedSet, sortedItems],
  );
  const allSelected =
    sortedItems.length > 0 && selectedItems.length === sortedItems.length;

  const pricingSummary = useMemo(
    () =>
      sortedItems.reduce(
        (summary, item) => {
          if (
            item.instaComp.pricingStatus ===
            "suggested_from_reliable_sold_comps"
          ) {
            summary.suggested += 1;
          } else if (
            item.instaComp.pricingStatus === "seller_price_required"
          ) {
            summary.sellerRequired += 1;
          } else {
            summary.notRun += 1;
          }
          return summary;
        },
        { suggested: 0, sellerRequired: 0, notRun: 0 },
      ),
    [sortedItems],
  );

  async function runPricingBatch(targets: PendingItem[], mode: string) {
    if (!targets.length) {
      setError("Select one or more cards first.");
      return;
    }

    setError("");
    setNotice("");
    setBatchMode(mode);
    setBatchProgress({ current: 0, total: targets.length });
    beginVisibleScan(
      targets.length === 1
        ? targets[0].title
        : `InstaComp batch: ${targets.length} cards`,
    );

    let failures = 0;
    let reliable = 0;
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      setScanPercent(12);

      for (const [index, item] of targets.entries()) {
        setPricingItemId(item.inventoryItemId);
        setScanSubject(item.title);
        setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));
        try {
          const result = await scanPendingItem(item, session.access_token);
          if (result.suggestedPrice > 0) reliable += 1;
        } catch {
          failures += 1;
        }
        setBatchProgress({ current: index + 1, total: targets.length });
        setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
      }

      setNotice(
        `InstaComp finished ${targets.length - failures}/${targets.length} cards. ${reliable} received sold-comp suggestions; ${targets.length - failures - reliable} require seller pricing; ${failures} need a retry.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not run InstaComp pricing."));
    } finally {
      setPricingItemId(null);
      setBatchMode(null);
      finishVisibleScan();
    }
  }

  useEffect(() => {
    if (loading || autoRunning.current || !items.length) return;
    const targets = items.filter(
      (item) =>
        item.instaComp.pricingStatus === "not_run" &&
        !autoAttempted.current.has(item.inventoryItemId),
    );
    if (!targets.length) return;

    targets.forEach((item) => autoAttempted.current.add(item.inventoryItemId));
    autoRunning.current = true;
    setAutoPricing(true);
    beginVisibleScan(`Automatic InstaComp intake: ${targets.length} card${targets.length === 1 ? "" : "s"}`);

    void (async () => {
      let failures = 0;
      try {
        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        setScanPercent(12);
        for (const [index, item] of targets.entries()) {
          setPricingItemId(item.inventoryItemId);
          setScanSubject(item.title);
          setBatchProgress({ current: index, total: targets.length });
          setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));
          try {
            await scanPendingItem(item, session.access_token);
          } catch {
            failures += 1;
          }
          setBatchProgress({ current: index + 1, total: targets.length });
          setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
        }
        setNotice(
          failures
            ? `Automatic InstaComp intake finished with ${failures} card${failures === 1 ? "" : "s"} needing a retry.`
            : "Automatic InstaComp intake finished. Every new draft now has a pricing outcome.",
        );
        await loadPending(true);
      } finally {
        setPricingItemId(null);
        setAutoPricing(false);
        autoRunning.current = false;
        finishVisibleScan();
      }
    })();
  }, [items, loadPending, loading]);

  async function runOnePricing(item: PendingItem) {
    setError("");
    setNotice("");
    setPricingItemId(item.inventoryItemId);
    beginVisibleScan(item.title);
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      setScanPercent(25);
      const result = await scanPendingItem(item, session.access_token);
      setScanPercent(90);
      setNotice(
        result.suggestedPrice > 0
          ? `${item.title}: InstaComp suggests ${money(result.suggestedPrice)} from ${result.reliableSoldCompCount} reliable sold comp${result.reliableSoldCompCount === 1 ? "" : "s"}.`
          : `${item.title}: $0.00 means no reliable sold comps passed. Seller pricing is required.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "InstaComp pricing failed."));
    } finally {
      setPricingItemId(null);
      finishVisibleScan();
    }
  }

  async function savePrice(item: PendingItem, mode: "suggested" | "manual") {
    setError("");
    setNotice("");
    setSavingItemId(item.inventoryItemId);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to set the listing price.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/price",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventoryItemId: item.inventoryItemId,
            mode,
            price:
              mode === "manual"
                ? manualPrices[item.inventoryItemId] || ""
                : undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not set the listing price.");
      }
      setNotice(
        `${item.title}: listing price set to ${money(data.price)}. The card remains a private draft.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not set the listing price."));
    } finally {
      setSavingItemId(null);
    }
  }

  async function saveDetails(item: PendingItem) {
    const edit = draftEdits[item.inventoryItemId];
    if (!edit) return;
    setError("");
    setNotice("");
    setSavingItemId(item.inventoryItemId);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to edit this draft.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventoryItemId: item.inventoryItemId,
            title: edit.title,
            description: edit.description,
            quantity: Number(edit.quantity),
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || data.updated !== 1) {
        throw new Error(
          data.error || data.results?.[0]?.error || "Could not save draft edits.",
        );
      }
      setNotice(`${item.title}: title, description, and quantity saved.`);
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not save draft edits."));
    } finally {
      setSavingItemId(null);
    }
  }

  async function setSelectedQuantity() {
    if (!selectedItems.length) {
      setError("Select one or more cards first.");
      return;
    }
    const quantity = Number(bulkQuantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError("Enter a whole-number quantity of at least 1.");
      return;
    }

    setBatchMode("quantity");
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to edit quantity.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/update",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ itemIds: selectedIds, quantity }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not set quantity.");
      setNotice(
        `Quantity updated on ${data.updated} card${data.updated === 1 ? "" : "s"}; ${data.failed} unique serial/cert copies or other rows were not changed.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not set selected quantity."));
    } finally {
      setBatchMode(null);
    }
  }

  async function applySelectedSuggestions() {
    const targets = selectedItems.filter(
      (item) =>
        item.instaComp.pricingStatus ===
          "suggested_from_reliable_sold_comps" &&
        Number(item.instaComp.suggestedPrice || 0) > 0,
    );
    if (!targets.length) {
      setError("None of the selected cards has a reliable sold-comp suggestion.");
      return;
    }

    setBatchMode("suggestions");
    setBatchProgress({ current: 0, total: targets.length });
    setError("");
    let failures = 0;
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to apply prices.");
      for (const [index, item] of targets.entries()) {
        const response = await fetch(
          "/api/account/seller/instacomp-pending/price",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              inventoryItemId: item.inventoryItemId,
              mode: "suggested",
            }),
          },
        );
        if (!response.ok) failures += 1;
        setBatchProgress({ current: index + 1, total: targets.length });
      }
      setNotice(
        `Applied reliable suggestions to ${targets.length - failures}/${targets.length} selected cards.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not apply selected suggestions."));
    } finally {
      setBatchMode(null);
    }
  }

  async function setSelectedManualPrice() {
    const price = Number(bulkPrice);
    if (!selectedItems.length) {
      setError("Select one or more cards first.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a seller price greater than $0.00.");
      return;
    }

    setBatchMode("manual-price");
    setBatchProgress({ current: 0, total: selectedItems.length });
    setError("");
    let failures = 0;
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to set prices.");
      for (const [index, item] of selectedItems.entries()) {
        const response = await fetch(
          "/api/account/seller/instacomp-pending/price",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              inventoryItemId: item.inventoryItemId,
              mode: "manual",
              price,
            }),
          },
        );
        if (!response.ok) failures += 1;
        setBatchProgress({ current: index + 1, total: selectedItems.length });
      }
      setNotice(
        `Seller price ${money(price)} applied to ${selectedItems.length - failures}/${selectedItems.length} selected cards.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not set selected prices."));
    } finally {
      setBatchMode(null);
    }
  }

  async function publishItems(targets: PendingItem[]) {
    if (!targets.length) {
      setError("Select one or more cards first.");
      return;
    }
    const notReady = targets.filter((item) => !item.activationReadiness.ready);
    if (notReady.length) {
      setError(
        `${notReady.length} selected card${notReady.length === 1 ? " is" : "s are"} not publish-ready. Clear the listed blockers first.`,
      );
      return;
    }
    const confirmed = window.confirm(
      `Publish ${targets.length} card${targets.length === 1 ? "" : "s"}? You are confirming that the images, exact identity, condition, variation, serial, grade, cert, quantity, and price are correct.`,
    );
    if (!confirmed) return;

    setBatchMode("publish");
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to publish listings.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/publish",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            itemIds: targets.map((item) => item.inventoryItemId),
            confirmIdentity: true,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not publish listings.");
      setNotice(
        `Published ${data.published} card${data.published === 1 ? "" : "s"}; ${data.failed} failed and remain private drafts.`,
      );
      setSelectedIds([]);
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not publish selected listings."));
    } finally {
      setBatchMode(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  const controlsDisabled = Boolean(batchMode || autoPricing);

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b-4 border-sky-300 bg-gradient-to-r from-sky-950 via-slate-950 to-emerald-950 px-5 py-8 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-200">
            InstaComp™ / Selectable Review Queue
          </p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                Pending Listings
              </h1>
              <p className="mt-3 max-w-4xl text-sm font-semibold leading-6 text-slate-200">
                 New scanned drafts automatically receive a complete market outcome. Exact
                 sold comps establish proven value; exact active listings position the live
                 competitive sweet spot. TCOS shows quick-sale, market-value, Suggested Price,
                 and stretch positions before the seller edits or publishes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadPending(true)}
                disabled={refreshing || loading || controlsDisabled}
                className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
              >
                {refreshing ? "Reloading..." : "Reload Drafts"}
              </button>
              <Link
                href="/seller/inventory"
                className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black"
              >
                Active Inventory
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-7">
        <section className="grid gap-3 sm:grid-cols-5">
          {[
            ["Drafts", loading ? "…" : sortedItems.length],
            ["Selected", selectedItems.length],
            ["Market Suggestions", pricingSummary.suggested],
            ["Seller Pricing", pricingSummary.sellerRequired],
            ["Auto Pricing", autoPricing ? "Running" : pricingSummary.notRun],
          ].map(([title, value]) => (
            <div
              key={String(title)}
              className="rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]"
            >
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                {title}
              </p>
              <p className="mt-2 text-2xl font-black">{value}</p>
            </div>
          ))}
        </section>

        <section className="sticky top-0 z-20 rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[6px_6px_0_#111]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(sortedItems.map((item) => item.inventoryItemId))}
              disabled={allSelected || controlsDisabled || sortedItems.length === 0}
              className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              disabled={!selectedIds.length || controlsDisabled}
              className="rounded-full border-2 border-neutral-400 px-4 py-2 text-xs font-black disabled:opacity-40"
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={() => void runPricingBatch(selectedItems, "selected-pricing")}
              disabled={!selectedItems.length || controlsDisabled}
              className="rounded-full bg-sky-800 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
            >
              InstaComp Selected ({selectedItems.length})
            </button>
            <button
              type="button"
              onClick={() => void runPricingBatch(sortedItems, "all-pricing")}
              disabled={!sortedItems.length || controlsDisabled}
              className="rounded-full bg-emerald-700 px-4 py-2 text-xs font-black text-white disabled:opacity-40"
            >
              InstaComp All ({sortedItems.length})
            </button>
            <button
              type="button"
              onClick={() => void applySelectedSuggestions()}
              disabled={!selectedItems.length || controlsDisabled}
              className="rounded-full bg-emerald-200 px-4 py-2 text-xs font-black text-emerald-950 disabled:opacity-40"
            >
              Use Selected Suggestions
            </button>
            <button
              type="button"
              onClick={() => void publishItems(selectedItems)}
              disabled={!selectedItems.length || controlsDisabled}
              className="rounded-full bg-amber-300 px-4 py-2 text-xs font-black text-neutral-950 disabled:opacity-40"
            >
              Publish Verified Selected
            </button>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                step="1"
                value={bulkQuantity}
                onChange={(event) => setBulkQuantity(event.target.value)}
                placeholder="Selected quantity"
                className="min-w-0 flex-1 rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold"
              />
              <button
                type="button"
                onClick={() => void setSelectedQuantity()}
                disabled={!selectedItems.length || controlsDisabled}
                className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
              >
                Set Quantity
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={bulkPrice}
                onChange={(event) => setBulkPrice(event.target.value)}
                placeholder="Selected seller price"
                className="min-w-0 flex-1 rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold"
              />
              <button
                type="button"
                onClick={() => void setSelectedManualPrice()}
                disabled={!selectedItems.length || controlsDisabled}
                className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:opacity-40"
              >
                Set Price
              </button>
            </div>
          </div>

          {scanStartedAt !== null ? (
            <div
              className="mt-4 rounded-xl border-2 border-sky-700 bg-sky-50 p-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black text-sky-950">
                <span className="min-w-0 truncate">InstaComping: {scanSubject || "card evidence"}</span>
                <span>{Math.max(0, Math.min(100, scanPercent))}% · {scanElapsedSeconds}s</span>
              </div>
              <div className="relative mt-2 h-4 overflow-hidden rounded-full border border-sky-900 bg-white">
                <div
                  className="h-full bg-sky-600 transition-[width] duration-500"
                  style={{ width: `${Math.max(4, Math.min(100, scanPercent))}%` }}
                />
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              </div>
              <p className="mt-2 text-[11px] font-bold text-sky-900">
                Images → exact identity → sold market → active competition → sweet-spot pricing → save result
                {batchProgress.total > 1
                  ? ` · ${batchProgress.current}/${batchProgress.total} cards complete`
                  : " · elapsed time updates while the server is working"}
              </p>
            </div>
          ) : null}
        </section>

        {loggedOut ? (
          <section className="rounded-2xl border-2 border-amber-700 bg-amber-50 p-5 font-semibold text-amber-950">
            Your local seller session is not available.{" "}
            <Link href="/account/login" className="font-black underline">
              Log in to TCOS
            </Link>
            , then return to this page.
          </section>
        ) : null}

        {notice ? (
          <section className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-5 font-semibold text-emerald-950">
            {notice}
          </section>
        ) : null}

        {error ? (
          <section className="rounded-2xl border-2 border-rose-700 bg-rose-50 p-5 font-semibold text-rose-950">
            {error}
          </section>
        ) : null}

        {!loading && !loggedOut && !error && sortedItems.length === 0 ? (
          <section className="rounded-2xl border-2 border-neutral-900 bg-white p-6 shadow-[6px_6px_0_#111]">
            <h2 className="text-2xl font-black">No InstaComp drafts are waiting</h2>
          </section>
        ) : null}

        <section className="space-y-6">
          {sortedItems.map((item) => {
            const suggestion = item.instaComp.suggestedPrice;
            const reliableSuggestion =
              item.instaComp.pricingStatus ===
                "suggested_from_reliable_sold_comps" &&
              typeof suggestion === "number" &&
              suggestion > 0;
            const priceBusy = savingItemId === item.inventoryItemId;
            const scanBusy = pricingItemId === item.inventoryItemId;
            const edit = draftEdits[item.inventoryItemId] || {
              title: item.title,
              description: item.description || "",
              quantity: String(item.quantity),
            };
            const selected = selectedSet.has(item.inventoryItemId);

            return (
              <article
                key={item.inventoryItemId}
                className={`overflow-hidden rounded-2xl border-2 bg-white shadow-[7px_7px_0_#111] ${
                  selected ? "border-sky-700 ring-4 ring-sky-200" : "border-neutral-900"
                }`}
              >
                <div className="border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <label className="flex cursor-pointer items-center gap-3 text-sm font-black">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(item.inventoryItemId)}
                      className="h-5 w-5"
                    />
                    Select this card for bulk actions
                  </label>
                </div>

                <div className="grid gap-0 lg:grid-cols-[230px_minmax(0,1fr)]">
                  <div className="relative min-h-80 border-b-2 border-neutral-900 bg-neutral-100 lg:border-b-0 lg:border-r-2">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={`${item.title} front scan`}
                        fill
                        sizes="(max-width: 1024px) 100vw, 230px"
                        className="object-contain p-3"
                      />
                    ) : (
                      <div className="flex h-full min-h-80 items-center justify-center p-5 text-center text-sm font-bold text-neutral-500">
                        Front scan unavailable
                      </div>
                    )}
                  </div>

                  <div className="p-5">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black">
                        PRIVATE DRAFT
                      </span>
                      <span className="rounded-full bg-sky-200 px-3 py-1 text-xs font-black">
                        INSTACOMP
                      </span>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${
                          item.activationReadiness.ready
                            ? "bg-emerald-200"
                            : "bg-rose-200"
                        }`}
                      >
                        {item.activationReadiness.ready ? "READY" : "NEEDS WORK"}
                      </span>
                      {item.uniquePhysicalCopy ? (
                        <span className="rounded-full bg-violet-200 px-3 py-1 text-xs font-black">
                          UNIQUE PHYSICAL COPY
                        </span>
                      ) : null}
                    </div>

                    <h2 className="mt-4 text-2xl font-black leading-tight">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-xs font-bold text-neutral-500">
                      SKU {item.sku || "Not recorded"}
                    </p>

                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Listing price
                        </dt>
                        <dd className="mt-1 font-bold">{money(item.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          InstaComp suggestion
                        </dt>
                        <dd className="mt-1 font-bold">
                          {suggestion === null ? "Not run" : money(suggestion)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Reliable sold comps
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.reliableSoldCompCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Quantity
                        </dt>
                        <dd className="mt-1 font-bold">{item.quantity}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Serial
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.serialNumber || "Not numbered"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Back scan
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.hasBackImage ? "Stored" : "Missing"}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 rounded-xl border-2 border-sky-300 bg-sky-50 p-3">
                      <p className="text-xs font-black uppercase text-sky-900">
                        InstaComp pricing outcome
                      </p>
                       <p className="mt-1 text-sm font-semibold text-sky-950">
                         {item.instaComp.pricingReason}
                       </p>
                       {item.instaComp.pricingModel.strategy ? (
                         <div className="mt-3 rounded-lg border border-sky-300 bg-white p-3">
                           <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Quick sale</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.quickSalePrice)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Sold market value</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.marketValue)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Suggested Price</p><p className="text-xl font-black text-emerald-800">{money(item.instaComp.suggestedPrice)}</p></div>
                             <div><p className="text-[11px] font-black uppercase text-neutral-500">Stretch price</p><p className="text-xl font-black">{money(item.instaComp.pricingModel.stretchPrice)}</p></div>
                           </div>
                           <p className="mt-3 text-xs font-black uppercase text-sky-900">
                             {label(item.instaComp.pricingModel.strategy)} · {label(item.instaComp.pricingModel.confidence)} confidence
                           </p>
                           <p className="mt-1 text-xs font-semibold text-neutral-700">
                             Sold used {item.instaComp.pricingModel.sold.usedCount}/{item.instaComp.pricingModel.sold.count} · Active used {item.instaComp.pricingModel.active.usedCount}/{item.instaComp.pricingModel.active.count}
                             {item.instaComp.pricingModel.sold.outliersRemoved ? ` · ${item.instaComp.pricingModel.sold.outliersRemoved} sold outlier${item.instaComp.pricingModel.sold.outliersRemoved === 1 ? "" : "s"} removed` : ""}
                             {item.instaComp.pricingModel.active.outliersRemoved ? ` · ${item.instaComp.pricingModel.active.outliersRemoved} active outlier${item.instaComp.pricingModel.active.outliersRemoved === 1 ? "" : "s"} removed` : ""}
                           </p>
                           {item.instaComp.pricingModel.rationale.length ? (
                             <ul className="mt-2 space-y-1 text-xs font-semibold text-neutral-700">
                               {item.instaComp.pricingModel.rationale.map((reason, reasonIndex) => <li key={reasonIndex}>• {reason}</li>)}
                             </ul>
                           ) : null}
                         </div>
                       ) : null}
                       <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void runOnePricing(item)}
                          disabled={scanBusy || controlsDisabled}
                          className="rounded-full bg-sky-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                        >
                          {scanBusy ? "Running InstaComp..." : "Run / Re-run InstaComp"}
                        </button>
                        {reliableSuggestion ? (
                          <button
                            type="button"
                            onClick={() => void savePrice(item, "suggested")}
                            disabled={priceBusy || controlsDisabled}
                            className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                          >
                            {priceBusy
                              ? "Saving..."
                              : `Use ${money(suggestion)} Suggestion`}
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={manualPrices[item.inventoryItemId] || ""}
                          onChange={(event) =>
                            setManualPrices((current) => ({
                              ...current,
                              [item.inventoryItemId]: event.target.value,
                            }))
                          }
                          placeholder="Seller price"
                          className="min-w-0 flex-1 rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => void savePrice(item, "manual")}
                          disabled={priceBusy || controlsDisabled}
                          className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                        >
                          Save Seller Price
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 xl:grid-cols-2">
                      <details className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-3" open>
                        <summary className="cursor-pointer font-black text-emerald-950">
                          Exact sold comps establishing market value ({item.instaComp.soldCompEvidence.length})
                        </summary>
                        <p className="mt-2 text-xs font-semibold text-emerald-900">
                          Click every source to verify the same player, card number, parallel,
                          serial, grade, cert, variation, and condition.
                        </p>
                        <div className="mt-3 space-y-2">
                          {item.instaComp.soldCompEvidence.length ? (
                            item.instaComp.soldCompEvidence.map((comp, index) => (
                              <a
                                key={`${comp.url}-${index}`}
                                href={comp.url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex gap-3 rounded-lg border border-emerald-300 bg-white p-2 hover:border-emerald-700"
                              >
                                {isImageUrl(comp.imageUrl) ? (
                                  <Image
                                    src={comp.imageUrl!}
                                    alt="Sold comp"
                                    width={48}
                                    height={64}
                                    unoptimized
                                    className="h-16 w-12 object-contain"
                                  />
                                ) : null}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-black text-neutral-950">
                                    {comp.title}
                                  </span>
                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {evidenceDate(comp) ? ` · ${evidenceDate(comp)}` : ""}
                                    {scoreLabel(comp.matchScore)
                                      ? ` · ${scoreLabel(comp.matchScore)}`
                                      : ""}
                                  </span>
                                  {comp.flags.length ? (
                                    <span className="mt-1 block text-[11px] font-semibold text-neutral-500">
                                      {comp.flags.join(" · ")}
                                    </span>
                                  ) : null}
                                </span>
                              </a>
                            ))
                          ) : (
                            <p className="rounded-lg bg-white p-3 text-sm font-bold text-neutral-700">
                              No direct sold listing passed the exact-card pricing filter.
                            </p>
                          )}
                        </div>
                        {item.instaComp.sourceLinks.ebaySoldUrl ? (
                          <a
                            href={item.instaComp.sourceLinks.ebaySoldUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-block text-sm font-black text-emerald-900 underline"
                          >
                            Open full sold-search verification
                          </a>
                        ) : null}
                      </details>

                      <details className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3" open>
                        <summary className="cursor-pointer font-black text-amber-950">
                          Current active competition ({item.instaComp.activeCompetition.length})
                        </summary>
                        <p className="mt-2 text-xs font-semibold text-amber-900">
                           These exact current listings position the competitive sweet spot.
                           Sold history still anchors value so TCOS never blindly copies asking prices.
                        </p>
                        <div className="mt-3 space-y-2">
                          {item.instaComp.activeCompetition.length ? (
                            item.instaComp.activeCompetition.map((comp, index) => (
                              <a
                                key={`${comp.url}-${index}`}
                                href={comp.url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex gap-3 rounded-lg border border-amber-300 bg-white p-2 hover:border-amber-700"
                              >
                                {isImageUrl(comp.imageUrl) ? (
                                  <Image
                                    src={comp.imageUrl!}
                                    alt="Active competitor"
                                    width={48}
                                    height={64}
                                    unoptimized
                                    className="h-16 w-12 object-contain"
                                  />
                                ) : null}
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-black text-neutral-950">
                                    {comp.title}
                                  </span>
                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {scoreLabel(comp.matchScore)
                                      ? ` · ${scoreLabel(comp.matchScore)}`
                                      : ""}
                                  </span>
                                  {comp.flags.length ? (
                                    <span className="mt-1 block text-[11px] font-semibold text-amber-800">
                                      {comp.flags.join(" · ")}
                                    </span>
                                  ) : null}
                                </span>
                              </a>
                            ))
                          ) : (
                            <p className="rounded-lg bg-white p-3 text-sm font-bold text-neutral-700">
                              No current exact competition listing was ingested.
                            </p>
                          )}
                        </div>
                        {item.instaComp.rejectedCandidates.length ? (
                          <details className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3">
                            <summary className="cursor-pointer text-sm font-black text-rose-950">
                              Rejected near matches ({item.instaComp.rejectedCandidates.length})
                            </summary>
                            <p className="mt-2 text-xs font-semibold text-rose-900">
                              These listings were found but failed exact identity. They are never competition and never affect price.
                            </p>
                            <div className="mt-2 space-y-2">
                              {item.instaComp.rejectedCandidates.map((comp, index) => (
                                <a
                                  key={`rejected-${comp.url}-${index}`}
                                  href={comp.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block rounded-md border border-rose-200 bg-white p-2"
                                >
                                  <span className="block text-sm font-black text-neutral-950">{comp.title}</span>
                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {scoreLabel(comp.matchScore) ? ` · ${scoreLabel(comp.matchScore)}` : ""}
                                  </span>
                                  <span className="mt-1 block text-[11px] font-semibold text-rose-800">
                                    {comp.flags.filter((flag) => /parallel mismatch|not exact parallel|guidance comp|not used for pricing/i.test(flag)).join(" · ") || "Rejected by exact-card identity filter"}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        {item.instaComp.sourceLinks.ebayActiveUrl ? (
                          <a
                            href={item.instaComp.sourceLinks.ebayActiveUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-block text-sm font-black text-amber-900 underline"
                          >
                            Open full active-listing search
                          </a>
                        ) : null}
                      </details>
                    </div>

                    {item.instaComp.gradingCompany ? (
                      <div className="mt-4 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm">
                        <p className="text-xs font-black uppercase text-neutral-500">
                          Grader verification
                        </p>
                        <p className="mt-1 font-bold">
                          {item.instaComp.gradingCompany}{" "}
                          {item.instaComp.gradingGrade || ""} · Cert{" "}
                          {item.instaComp.gradingCertNumber || "Not recorded"}
                        </p>
                        <p className="mt-1 font-semibold text-neutral-700">
                          {graderStatusLabel(
                            item.instaComp.graderVerificationStatus,
                          )}
                        </p>
                        {item.instaComp.graderVerificationUrl ? (
                          <a
                            href={item.instaComp.graderVerificationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block font-black text-sky-800 underline"
                          >
                            Open official grader record
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    <details className="mt-4 rounded-xl border-2 border-neutral-300 bg-neutral-50 p-3">
                      <summary className="cursor-pointer font-black">
                        Edit listing identity, description, and quantity
                      </summary>
                      <div className="mt-3 space-y-3">
                        <label className="block text-xs font-black uppercase text-neutral-600">
                          Title
                          <input
                            value={edit.title}
                            onChange={(event) =>
                              setDraftEdits((current) => ({
                                ...current,
                                [item.inventoryItemId]: {
                                  ...edit,
                                  title: event.target.value,
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold normal-case"
                          />
                        </label>
                        <label className="block text-xs font-black uppercase text-neutral-600">
                          Description
                          <textarea
                            value={edit.description}
                            onChange={(event) =>
                              setDraftEdits((current) => ({
                                ...current,
                                [item.inventoryItemId]: {
                                  ...edit,
                                  description: event.target.value,
                                },
                              }))
                            }
                            rows={5}
                            className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-semibold normal-case"
                          />
                        </label>
                        <label className="block text-xs font-black uppercase text-neutral-600">
                          Quantity
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={edit.quantity}
                            disabled={item.uniquePhysicalCopy}
                            onChange={(event) =>
                              setDraftEdits((current) => ({
                                ...current,
                                [item.inventoryItemId]: {
                                  ...edit,
                                  quantity: event.target.value,
                                },
                              }))
                            }
                            className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold normal-case disabled:bg-neutral-200"
                          />
                        </label>
                        <p className="text-xs font-semibold text-neutral-600">
                          {item.quantityRule}
                        </p>
                        <button
                          type="button"
                          onClick={() => void saveDetails(item)}
                          disabled={priceBusy || controlsDisabled}
                          className="rounded-full bg-neutral-950 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
                        >
                          Save Draft Edits
                        </button>
                      </div>
                    </details>

                    {item.activationReadiness.blockers.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3">
                        <p className="text-xs font-black uppercase text-rose-800">
                          Listing blockers
                        </p>
                        <p className="mt-1 text-sm font-semibold text-rose-950">
                          {item.activationReadiness.blockers
                            .map(blockerLabel)
                            .join(" · ")}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-neutral-900 bg-neutral-100 p-3">
                      <button
                        type="button"
                        onClick={() => void publishItems([item])}
                        disabled={!item.activationReadiness.ready || controlsDisabled}
                        className="rounded-full bg-amber-300 px-4 py-2 text-sm font-black text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Publish as Seller-Verified
                      </button>
                      <p className="text-xs font-semibold text-neutral-700">
                        Publishing requires your final confirmation and never happens
                        automatically.
                      </p>
                    </div>

                    <details className="mt-4 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                      <summary className="cursor-pointer text-sm font-black">
                        Provider coverage and record IDs
                      </summary>
                      <div className="mt-3 space-y-2 text-xs">
                        {item.instaComp.providerCoverage.map((provider, index) => (
                          <p key={`${provider.source}-${index}`}>
                            <strong>{provider.label || provider.source || "Provider"}</strong>: {provider.status || "unknown"} · {provider.resultCount} results
                            {provider.message ? ` · ${provider.message}` : ""}
                          </p>
                        ))}
                        <p className="break-all text-neutral-500">
                          Inventory: {item.inventoryItemId}
                          <br />
                          Scan: {item.instaComp.scanId || "Not recorded"}
                        </p>
                      </div>
                    </details>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
