"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFreshAccountSession } from "../../account/account-session";

type CardIdentity = {
  sport?: string | null;
  league?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  product?: string | null;
  setName?: string | null;
  subset?: string | null;
  player?: string | null;
  team?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  variation?: string | null;
  notes?: string | null;
  serialNumber?: string | null;
  isRookie?: boolean;
  isAuto?: boolean;
  isRelic?: boolean;
  inscription?: boolean;
  inscriptionText?: string | null;
  memorabiliaType?: string | null;
};

type CompEvidence = {
  title?: string | null;
  price?: number | null;
  url?: string | null;
  sourceLabel?: string | null;
  soldAt?: string | null;
  listedAt?: string | null;
};

type PendingCard = {
  inventoryItemId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  sku: string | null;
  price?: number | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  storedImageCount: number;
  activationReadiness?: { ready?: boolean; blockers?: string[] } | null;
  instaComp: {
    cardUuid?: string | null;
    pricingGroupKey?: string | null;
    duplicateGroup?: {
      totalRows: number;
      totalQuantity: number;
      pendingRows: number;
      activeRows: number;
      listedProductIds: number[];
    } | null;
    pricingStatus: string;
    serialNumber?: string | null;
    identitySummary?: string | null;
    identityReadout?: string | null;
    suggestedPrice?: number | null;
    listingPrice?: number | null;
    reliableSoldCompCount?: number;
    imageOrientation?: {
      verified: boolean;
      status?: string | null;
      source?: string | null;
      frontRotation?: number;
      backRotation?: number;
      reason?: string | null;
    } | null;
    soldCompEvidence?: CompEvidence[];
    activeCompetition?: CompEvidence[];
    identity?: CardIdentity | null;
  };
};

type JobStatus = {
  status: string;
  stage: string | null;
  error: string | null;
  errorCode: string | null;
  identityComplete: boolean;
  manualIdentityLocked: boolean;
  selectedParallel: string | null;
  candidateParallels: string[];
  visualColor: string | null;
  visualPattern: string | null;
  visualSerial: string | null;
  visualConfidence: number;
  parallelEvidence: string | null;
};

type EditState = {
  title: string;
  description: string;
  category: string;
  condition: string;
  sport: string;
  league: string;
  year: string;
  manufacturer: string;
  brand: string;
  setName: string;
  subset: string;
  player: string;
  team: string;
  cardNumber: string;
  parallel: string;
  variation: string;
  printRun: string;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  inscription: boolean;
  inscriptionText: string;
  memorabiliaType: string;
};

type LocalStage = "waiting" | "scanning" | "complete" | "review" | "failed" | "locked";
type PendingQueue = "listings" | "verification";

function queueFromLocation(): PendingQueue {
  if (typeof window === "undefined") return "listings";
  const queue = new URLSearchParams(window.location.search).get("queue");
  return queue === "verification" ? "verification" : "listings";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
}

function displayPattern(value: string | null) {
  return value ? value.replace(/_/g, " ") : "—";
}

function parallelLabel(card: PendingCard, job?: JobStatus) {
  const explicit =
    job?.selectedParallel ||
    card.instaComp.identity?.parallel ||
    null;
  return explicit?.trim() || "Parallel review required";
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

const COMP_ADJUSTMENTS = [-25, -20, -15, -10, -5, 0, 5, 10, 15, 20, 25] as const;

const GENERIC_PLAYER_PHRASES = new Set([
  "all american",
  "all-american",
  "crunch time",
  "crunch-time",
  "base",
  "chrome",
  "donruss",
  "heritage",
  "league leaders",
  "prizm",
  "prizms",
  "score",
  "select",
  "topps",
  "upper deck",
  "bowman",
  "rookie",
]);

function normalizeSubsetLabel(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "all american" || normalized === "all-american") return "All American";
  if (normalized === "crunch time" || normalized === "crunch-time") return "Crunch Time";
  if (normalized === "future watch") return "Future Watch";
  if (normalized === "young guns") return "Young Guns";
  if (normalized === "spectrum fx") return "Spectrum FX";
  return value.trim();
}

function compAdjustedPrice(value: unknown, adjustmentPercent: number) {
  const suggested = Number(value);
  return Number.isFinite(suggested) && suggested > 0
    ? Math.max(0.01, Math.round(suggested * (1 + adjustmentPercent / 100) * 100) / 100)
    : null;
}

function serialRunLabel(value: string) {
  const match = String(value || "").match(/\/(\d{1,6})$/);
  return match ? `/${Number(match[1])}` : "";
}

function identityReadout(card: PendingCard) {
  const identity = card.instaComp.identity || {};
  const clean = (value?: string | null) => {
    const text = value?.trim() || "";
    if (!text) return "";
    const normalized = text.toLowerCase();
    if (
      normalized === "identity review required" ||
      normalized === "review required" ||
      normalized === "untitled item" ||
      normalized === "permanent uuid missing"
      || normalized.includes("identity review required")
      || normalized.includes("review required")
      || normalized.includes("credits")
    ) {
      return "";
    }
    if (/^no\.?\s*/i.test(text) && text.split(/\s+/).length <= 3) return "";
    return text;
  };
  const blockedPlayerValues = new Set(
    [identity.setName, identity.subset, identity.product, identity.brand, identity.manufacturer]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .map((value) => value.trim().toLowerCase()),
  );
  const year = clean(identity.year);
  const manufacturer = clean(identity.manufacturer || identity.brand);
  const setName = clean(identity.setName || identity.subset);
  const subset = identity.subset ? normalizeSubsetLabel(identity.subset) : "";
  const cardNumber = clean(identity.cardNumber);
  const playerCandidate = (identity.player || "").trim().toLowerCase();
  const player = blockedPlayerValues.has(playerCandidate) || GENERIC_PLAYER_PHRASES.has(playerCandidate)
    ? ""
    : clean(identity.player);
  const team = clean(identity.team);
  const parallel = clean(identity.parallel || identity.variation);
  const pieces = [
    year,
    manufacturer,
    setName,
    subset,
    cardNumber ? `#${cardNumber.replace(/^#/, "")}` : "",
    player,
    team ? `(${team})` : "",
    parallel,
  ].filter(Boolean);
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function standardizedTitle(edit: EditState) {
  const setName = /^base$/i.test(edit.setName.trim()) ? "" : edit.setName.trim();
  const parallel = /^base$/i.test(edit.parallel.trim()) ? "" : edit.parallel.trim();
  const product = edit.brand.trim() || edit.manufacturer.trim();
  return [
    edit.year.trim(),
    product,
    setName,
    edit.cardNumber.trim() ? `#${edit.cardNumber.trim().replace(/^#/, "")}` : "",
    edit.player.trim(),
    parallel,
    serialRunLabel(edit.printRun),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\bBase\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initialEdit(card: PendingCard): EditState {
  const identity = card.instaComp.identity || {};
  return {
    title: card.title,
    description: card.description || "",
    category: card.category || "Trading Card Singles",
    condition: card.condition || "Ungraded",
    sport: identity.sport || "",
    league: identity.league || "",
    year: identity.year || "",
    manufacturer: identity.manufacturer || "",
    brand: identity.brand || identity.manufacturer || "",
    setName: identity.setName || "",
    subset: identity.subset || "",
    player: identity.player || "",
    team: identity.team || "",
    cardNumber: identity.cardNumber || "",
    parallel: identity.parallel || "",
    variation: identity.variation || "",
    printRun: identity.serialNumber || card.instaComp.serialNumber || "",
    isRookie: identity.isRookie === true,
    isAuto: identity.isAuto === true,
    isRelic: identity.isRelic === true,
    inscription: identity.inscription === true,
    inscriptionText: identity.inscriptionText || "",
    memorabiliaType: identity.memorabiliaType || "",
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border-2 border-neutral-300 bg-white p-2 text-neutral-950 focus:border-neutral-950 focus:outline-none"
      />
    </label>
  );
}

export default function KingmakerPendingPage({
  initialQueue,
  initialCards = [],
  initialQueueCounts = { listings: 0, verification: 0 },
}: {
  initialQueue: PendingQueue;
  initialCards?: PendingCard[];
  initialQueueCounts?: { listings: number; verification: number };
}) {
  const [cards, setCards] = useState<PendingCard[]>(initialCards);
  const [queueCounts, setQueueCounts] = useState(initialQueueCounts);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [localStage, setLocalStage] = useState<Record<string, LocalStage>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const router = useRouter();
  const [queue, setQueue] = useState<PendingQueue>(initialQueue);

  useEffect(() => {
    setQueue(queueFromLocation());
  }, []);

  const load = useCallback(async (activeQueue: PendingQueue) => {
    setLoading(true);
    setPageError("");
    if (typeof window !== "undefined") {
      (window as any).__kingmakerPendingDebug = {
        queue: activeQueue,
        stage: "starting",
        itemCount: null,
        queueCounts: null,
      };
    }
    try {
      let accessToken: string | null = null;
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem("tcos_account_session");
          if (raw) {
            const session = JSON.parse(raw) as { access_token?: string | null };
            accessToken = typeof session.access_token === "string" && session.access_token.trim()
              ? session.access_token.trim()
              : null;
          }
        } catch {
          accessToken = null;
        }
      }
      if (!accessToken) {
        const session = await getFreshAccountSession(5 * 60, false);
        accessToken = session?.access_token?.trim() || null;
      }
      if (!accessToken) throw new Error("Seller login is required.");
      const headers = { Authorization: `Bearer ${accessToken}` };
      if (typeof window !== "undefined") {
        (window as any).__kingmakerPendingDebug = {
          queue: activeQueue,
          stage: "fetching",
          itemCount: null,
          queueCounts: null,
        };
      }
      const [cardsResult, statusResult] = await Promise.allSettled([
        fetch(`/api/account/seller/instacomp-pending?queue=${activeQueue}`, { headers, cache: "no-store" }),
        fetch("/api/account/seller/inventory/instacomp-job-status", { headers, cache: "no-store" }),
      ]);
      const cardsResponse = cardsResult.status === "fulfilled" ? cardsResult.value : null;
      const statusResponse = statusResult.status === "fulfilled" ? statusResult.value : null;
      const cardsData = cardsResponse ? await cardsResponse.json().catch(() => ({})) : {};
      const statusData = statusResponse ? await statusResponse.json().catch(() => ({})) : {};
      if (!cardsResponse) throw new Error("Could not load pending cards.");
      if (!cardsResponse.ok) throw new Error(cardsData.error || "Could not load pending cards.");
      if (statusResponse && !statusResponse.ok) {
        setJobs({});
      } else {
        setJobs(statusData.statuses && typeof statusData.statuses === "object" ? statusData.statuses : {});
      }
      setCards(Array.isArray(cardsData.items) ? cardsData.items : []);
      setQueueCounts({
        listings: Math.max(0, Number(cardsData.queueCounts?.listings || 0)),
        verification: Math.max(0, Number(cardsData.queueCounts?.verification || 0)),
      });
      if (typeof window !== "undefined") {
        (window as any).__kingmakerPendingDebug = {
          queue: activeQueue,
          stage: "loaded",
          itemCount: Array.isArray(cardsData.items) ? cardsData.items.length : -1,
          queueCounts: {
            listings: Math.max(0, Number(cardsData.queueCounts?.listings || 0)),
            verification: Math.max(0, Number(cardsData.queueCounts?.verification || 0)),
          },
        };
      }
      setSelectedIds((current) => {
        const available = new Set((Array.isArray(cardsData.items) ? cardsData.items : []).map((card: PendingCard) => card.inventoryItemId));
        return new Set([...current].filter((id) => available.has(id)));
      });
    } catch (error) {
      if (typeof window !== "undefined") {
        (window as any).__kingmakerPendingDebug = {
          queue: activeQueue,
          stage: "error",
          error: message(error),
          itemCount: null,
          queueCounts: null,
        };
      }
      setPageError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(queue);
  }, [load, queue]);

  function setEditValue<K extends keyof EditState>(id: string, key: K, value: EditState[K]) {
    setEdits((current) => ({
      ...current,
      [id]: { ...(current[id] || initialEdit(cards.find((card) => card.inventoryItemId === id)!)), [key]: value },
    }));
  }

  function beginEdit(card: PendingCard) {
    setEditingId(card.inventoryItemId);
    setEdits((current) => ({ ...current, [card.inventoryItemId]: initialEdit(card) }));
  }

  async function saveEdit(card: PendingCard) {
    const edit = edits[card.inventoryItemId];
    if (!edit) return;
    if (!edit.parallel.trim()) {
      setPageError("Blank no longer means Base. Enter Base or the exact checklist parallel.");
      return;
    }
    const finalTitle = standardizedTitle(edit) || edit.title.trim();
    if (!finalTitle) {
      setPageError("The corrected card needs enough identity fields to build a listing title.");
      return;
    }
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp-card-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          ...edit,
          title: finalTitle,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not save the card correction.");
      setEditingId(null);
      setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "locked" }));
      setNotice(
        data.learningStatus === "stored"
          ? `${finalTitle}: correction locked and trusted InstaComp lesson stored.`
          : `${finalTitle}: correction locked. Learning receipt: ${data.learningStatus || "pending"}.`,
      );
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function savePrice(card: PendingCard, price: number, source: string) {
    setBusyId(card.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-scan/price", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inventoryItemId: card.inventoryItemId, price, source, applyGroup: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save listing price.");
      setNotice(
        `${money(price)} saved${Number(data.updatedCount || 1) > 1 ? ` across ${data.updatedCount} exact-card matches` : ""}.`,
      );
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulkEdits() {
    const selected = cards.filter((card) => selectedIds.has(card.inventoryItemId));
    if (!selected.length) return;
    if (!bulkCategory.trim() && !bulkCondition.trim()) {
      setPageError("Choose a category or condition to apply to the selected cards.");
      return;
    }
    setBusyId("bulk");
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp-bulk-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          inventoryItemIds: selected.map((card) => card.inventoryItemId),
          category: bulkCategory.trim() || undefined,
          condition: bulkCondition.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Bulk edit failed.");
      setNotice(`${data.updatedCount} selected card${data.updatedCount === 1 ? "" : "s"} updated and saved.`);
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function applyBulkPricing(adjustmentPercent: number) {
    const selected = cards.filter((card) => selectedIds.has(card.inventoryItemId));
    const seenGroups = new Set<string>();
    const priceable = selected.filter((card) => {
      if (Number(card.instaComp.suggestedPrice || 0) <= 0) return false;
      const key = card.instaComp.pricingGroupKey || card.inventoryItemId;
      if (seenGroups.has(key)) return false;
      seenGroups.add(key);
      return true;
    });
    if (!priceable.length) {
      setPageError("None of the selected cards has an accepted InstaComp comp price yet.");
      return;
    }
    setBusyId("bulk");
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      await Promise.all(priceable.map(async (card) => {
        const price = compAdjustedPrice(card.instaComp.suggestedPrice, adjustmentPercent);
        if (!price) throw new Error(`${card.title}: InstaComp price is unavailable.`);
        const response = await fetch("/api/account/seller/instacomp-scan/price", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            inventoryItemId: card.inventoryItemId,
            price,
            source: `bulk_instacomp_${adjustmentPercent >= 0 ? "plus" : "minus"}_${Math.abs(adjustmentPercent)}`,
            applyGroup: true,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`${card.title}: ${data.error || "bulk price failed"}`);
      }));
      setNotice(`Comp-based prices saved for ${priceable.length} selected exact-card group${priceable.length === 1 ? "" : "s"}.`);
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSelectedCards() {
    const selected = cards.filter((card) => selectedIds.has(card.inventoryItemId));
    if (!selected.length) {
      setPageError("Select at least one draft to delete.");
      return;
    }
    const confirmDelete = window.confirm(
      `Delete ${selected.length} pending draft${selected.length === 1 ? "" : "s"}? This will remove them from the queue but keep learning history intact.`,
    );
    if (!confirmDelete) return;

    setBusyId("bulk");
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/admin/card-listing-queue", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemIds: selected.map((card) => card.inventoryItemId),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Delete failed.");
      }
      setSelectedIds(new Set());
      setNotice(data.message || `${selected.length} selected draft${selected.length === 1 ? "" : "s"} deleted.`);
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function runExactIdentity(card: PendingCard) {
    if (!hasValidPair(card)) {
      setLocalError((current) => ({ ...current, [card.inventoryItemId]: "A distinct stored front and back are required." }));
      return;
    }
    setBusyId(card.inventoryItemId);
    setNotice("");
    setPageError("");
    setLocalError((current) => ({ ...current, [card.inventoryItemId]: "" }));
    setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "scanning" }));
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-pending-identity", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
        }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error([data.error || "Card reading failed.", data.code, data.stage].filter(Boolean).join(" · "));
      }
      setLocalStage((current) => ({
        ...current,
        [card.inventoryItemId]: data.identityComplete === true ? "complete" : "review",
      }));
      setNotice(
        data.identity?.notes ||
          `${data.identityComplete === true ? "Identity read" : "Best-effort identity read"} for ${data.title || card.title}.`,
      );
      if (data.identityComplete !== true) {
        setLocalError((current) => ({ ...current, [card.inventoryItemId]: "" }));
      }
      await load(queue || queueFromLocation());
    } catch (error) {
      setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "failed" }));
      setLocalError((current) => ({ ...current, [card.inventoryItemId]: message(error) }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">KINGMAKER / Master Listings</p>
            <h1 className="mt-1 text-3xl font-black">
              {queue === "verification" ? "Pending verification" : "Master listing workspace"}
            </h1>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
              {queue === "verification"
                ? "Legacy and held cards stay here with every image and inventory link intact until you are ready to verify, price, or return them to listings."
                : "Uploaded fronts and backs are normalized automatically, then InstaComp verifies identity and gathers exact comps. Edit one card or select many for bulk listing updates. Nothing publishes automatically."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(queue || queueFromLocation())}
            disabled={loading || Boolean(busyId)}
            className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Master listing queues">
          {([
            ["listings", "Pending Listings", queueCounts.listings],
            ["verification", "Pending Verification", queueCounts.verification],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setEditingId(null);
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.set("queue", value);
                router.replace(`${nextUrl.pathname}${nextUrl.search}`);
                setQueue(value);
              }}
              aria-pressed={queue === value}
              className={`rounded-xl border-2 px-4 py-3 font-black ${
                queue === value
                  ? "border-neutral-950 bg-neutral-950 text-white"
                  : "border-neutral-400 bg-white text-neutral-950"
              }`}
            >
              {label} · {count}
            </button>
          ))}
        </nav>

        {pageError ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{pageError}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        {!loading && !cards.length ? (
          <div className="mt-6 rounded-2xl border border-neutral-300 bg-white p-8 text-center">
            <p className="text-xl font-black">
              {queue === "verification" ? "No cards pending verification" : "No master listing drafts"}
            </p>
            <p className="mt-2 text-neutral-600">
              {queue === "verification"
                ? "Held cards will remain available here without crowding the new-listing queue."
                : "Drop the next front/back pair on the KINGMAKER home page."}
            </p>
          </div>
        ) : null}

        {cards.length ? (
          <section className="mt-6 rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]" aria-label="Bulk listing tools">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Bulk edit</h2>
                <p className="text-sm font-semibold text-neutral-600">{selectedIds.size} of {cards.length} selected</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedIds(new Set(cards.map((card) => card.inventoryItemId)))} className="rounded-lg border-2 border-neutral-900 px-3 py-2 text-sm font-black">Select all</button>
                <button type="button" onClick={() => setSelectedIds(new Set())} className="rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-black">Clear</button>
                <button
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void deleteSelectedCards()}
                  className="rounded-lg border-2 border-red-700 bg-red-600 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  Delete selected
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
              <Field label="Category (optional)" value={bulkCategory} onChange={setBulkCategory} placeholder="Trading Card Singles" />
              <Field label="Condition (optional)" value={bulkCondition} onChange={setBulkCondition} placeholder="Ungraded" />
              <button type="button" disabled={!selectedIds.size || Boolean(busyId)} onClick={() => void applyBulkEdits()} className="self-end rounded-xl bg-amber-600 px-5 py-3 font-black text-white disabled:opacity-40">Apply fields</button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-300 pt-3">
              <span className="mr-2 text-sm font-black">Bulk comp pricing:</span>
              {COMP_ADJUSTMENTS.map((adjustment) => (
                <button
                  key={adjustment}
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void applyBulkPricing(adjustment)}
                  className={`rounded-lg px-3 py-2 text-sm font-black text-white disabled:opacity-40 ${adjustment < 0 ? "bg-sky-700" : adjustment > 0 ? "bg-emerald-700" : "bg-neutral-950"}`}
                >
                  {adjustment === 0 ? "InstaComp" : `${adjustment > 0 ? "+" : ""}${adjustment}%`}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const job = jobs[card.inventoryItemId];
            const pairReady = hasValidPair(card);
            const isBusy = busyId === card.inventoryItemId;
            const edit = edits[card.inventoryItemId];
            const storedStage: LocalStage = job?.manualIdentityLocked
              ? "locked"
              : job?.identityComplete
                ? "complete"
                : job?.status === "failed"
                  ? "failed"
                  : job?.status === "review_required"
                    ? "review"
                    : "waiting";
            const stage = localStage[card.inventoryItemId] || storedStage;
            const error = localError[card.inventoryItemId] || (stage === "failed" ? job?.error || "" : "");
            const soldCompEvidence = card.instaComp.soldCompEvidence || [];
            const activeCompetition = card.instaComp.activeCompetition || [];
            const suggested = Number(card.instaComp.suggestedPrice || 0);
            const priceChoices = suggested > 0
              ? COMP_ADJUSTMENTS.map((adjustment) => ({
                  label: adjustment === 0 ? "InstaComp" : `${adjustment > 0 ? "+" : ""}${adjustment}%`,
                  value: compAdjustedPrice(suggested, adjustment) as number,
                  source: `instacomp_${adjustment >= 0 ? "plus" : "minus"}_${Math.abs(adjustment)}`,
                }))
              : [];

            return (
              <article key={card.inventoryItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div className="flex min-w-0 items-start gap-3">
                    <input type="checkbox" aria-label={`Select ${card.title}`} checked={selectedIds.has(card.inventoryItemId)} onChange={() => toggleSelected(card.inventoryItemId)} className="mt-1 h-5 w-5 accent-emerald-400" />
                    <div className="min-w-0">
                    <h2 className="font-black">{card.title}</h2>
                    {card.instaComp.identityReadout || card.instaComp.identitySummary || identityReadout(card) ? (
                      <p className="mt-1 text-xs font-semibold text-emerald-200">
                        {card.instaComp.identityReadout || card.instaComp.identitySummary || identityReadout(card)}
                      </p>
                    ) : null}
                    <p className="mt-1 break-all text-xs font-mono text-emerald-300">
                      {card.instaComp.cardUuid ? `UUID ${card.instaComp.cardUuid}` : "Permanent UUID missing — review required"}
                    </p>
                    {card.instaComp.identity?.notes ? (
                      <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                        {card.instaComp.identity.notes}
                      </p>
                    ) : null}
                    {card.instaComp.duplicateGroup && card.instaComp.duplicateGroup.totalRows > 1 ? (
                      <p className="mt-1 text-xs font-black text-amber-300">
                        EXACT-CARD GROUP · {card.instaComp.duplicateGroup.totalQuantity} copies · {card.instaComp.duplicateGroup.activeRows} active · priced together
                      </p>
                    ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {queue === "verification" ? (
                      <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                        PENDING VERIFICATION
                      </span>
                    ) : null}
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>
                      {pairReady ? "FRONT + BACK READY" : "SIDE MISSING"}
                    </span>
                  </div>
                </div>

                <div className="border-b-2 border-neutral-900 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                    <span>
                      {stage === "scanning"
                        ? "Reading exact identity"
                        : stage === "complete"
                          ? "Exact identity complete"
                          : stage === "locked"
                            ? "Operator-confirmed identity locked"
                            : stage === "review"
                              ? "Review required"
                              : stage === "failed"
                                ? "InstaComp stopped safely"
                                : "Pending review"}
                    </span>
                    <span>{stage === "complete" || stage === "locked" ? "100%" : ""}</span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className={`h-full ${stage === "complete" || stage === "locked" ? "w-full bg-emerald-600" : stage === "review" ? "w-2/3 bg-amber-500" : stage === "failed" ? "w-1/3 bg-red-700" : stage === "scanning" ? "w-2/3 animate-pulse bg-sky-700" : "w-1/2 bg-neutral-400"}`}
                    />
                  </div>
                  {error ? <div className="mt-3 rounded-lg border-2 border-red-700 bg-red-50 p-3 font-bold text-red-900">{error}{job?.errorCode ? ` · ${job.errorCode}` : ""}</div> : null}

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Parallel</span><p>{parallelLabel(card, job)}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Visible pattern</span><p>{displayPattern(job?.visualPattern || null)}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Serial</span><p>{job?.visualSerial || card.instaComp.serialNumber || "None seen"}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Exact sold comps</span><p>{card.instaComp.reliableSoldCompCount || 0}</p></div>
                  </div>
                </div>

                {(soldCompEvidence.length || activeCompetition.length) ? (
                  <div className="grid gap-4 border-b-2 border-neutral-900 bg-neutral-50 p-4 lg:grid-cols-2">
                    <MarketEvidencePanel
                      title="Exact sold evidence"
                      subtitle="Sold transactions used to establish market value"
                      rows={soldCompEvidence}
                      dateKey="soldAt"
                    />
                    <MarketEvidencePanel
                      title="Active competition"
                      subtitle="Current asking prices shown separately from sold value"
                      rows={activeCompetition}
                      dateKey="listedAt"
                    />
                  </div>
                ) : null}

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {([ ["front", card.frontImageUrl], ["back", card.backImageUrl] ] as const).map(([side, url]) => {
                    const orientationVerified = card.instaComp.imageOrientation?.verified === true;
                    return (
                      <figure key={side} className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                        <figcaption className={`mb-2 text-xs font-black uppercase tracking-wider ${orientationVerified ? "text-emerald-800" : "text-red-800"}`}>
                          Card {side} · {orientationVerified ? "orientation verified from Mac archive" : "orientation review required"}
                        </figcaption>
                        <div className="mx-auto flex h-80 w-full max-w-80 items-center justify-center overflow-hidden rounded-lg bg-white">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={`${card.title} ${side}`} className="max-h-full max-w-full object-contain" />
                          ) : (
                            <div className="font-black text-red-800">{side.toUpperCase()} MISSING</div>
                          )}
                        </div>
                      </figure>
                    );
                  })}
                </div>

                {priceChoices.length ? (
                  <div className="border-t-2 border-neutral-900 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black">Exact-comp pricing</p>
                        <p className="text-sm font-semibold text-neutral-600">Current draft price: {money(card.price || card.instaComp.listingPrice)}</p>
                      </div>
                      <div className="grid min-w-[300px] flex-1 gap-2 sm:grid-cols-4 lg:max-w-4xl">
                        {priceChoices.map(({ label, value, source }) => (
                          <button
                            key={source}
                            type="button"
                            disabled={isBusy}
                            onClick={() => void savePrice(card, value, source)}
                            className="rounded-xl border-2 border-emerald-700 bg-white p-3 text-left disabled:opacity-40"
                          >
                            <span className="block text-xs font-bold text-neutral-500">{label}</span>
                            <span className="text-lg font-black">{money(value)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {editingId === card.inventoryItemId && edit ? (
                  <div className="border-t-2 border-neutral-900 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black">Correct any field</h3>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">Saving locks this identity as operator-confirmed truth. Structural Base is always removed from the displayed title.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditValue(card.inventoryItemId, "title", standardizedTitle(edit))}
                        className="rounded-xl border-2 border-neutral-900 bg-white px-4 py-2 text-sm font-black"
                      >
                        Rebuild Standard Title
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <div className="md:col-span-2 lg:col-span-4">
                        <Field label="Listing title" value={edit.title} onChange={(value) => setEditValue(card.inventoryItemId, "title", value)} />
                      </div>
                      <Field label="Year" value={edit.year} onChange={(value) => setEditValue(card.inventoryItemId, "year", value)} />
                      <Field label="Manufacturer" value={edit.manufacturer} onChange={(value) => setEditValue(card.inventoryItemId, "manufacturer", value)} />
                      <Field label="Product / Brand" value={edit.brand} onChange={(value) => setEditValue(card.inventoryItemId, "brand", value)} />
                      <Field label="Set / Insert / Level" value={edit.setName} onChange={(value) => setEditValue(card.inventoryItemId, "setName", value)} />
                      <Field label="Subset" value={edit.subset} onChange={(value) => setEditValue(card.inventoryItemId, "subset", value)} />
                      <Field label="Player" value={edit.player} onChange={(value) => setEditValue(card.inventoryItemId, "player", value)} />
                      <Field label="Team" value={edit.team} onChange={(value) => setEditValue(card.inventoryItemId, "team", value)} />
                      <Field label="Sport" value={edit.sport} onChange={(value) => setEditValue(card.inventoryItemId, "sport", value)} />
                      <Field label="League" value={edit.league} onChange={(value) => setEditValue(card.inventoryItemId, "league", value)} />
                      <Field label="Card number" value={edit.cardNumber} onChange={(value) => setEditValue(card.inventoryItemId, "cardNumber", value)} />
                      <Field label="Exact parallel" value={edit.parallel} placeholder="Base or White Seismic Prizm" onChange={(value) => setEditValue(card.inventoryItemId, "parallel", value)} />
                      <Field label="Variation" value={edit.variation} onChange={(value) => setEditValue(card.inventoryItemId, "variation", value)} />
                      <Field label="Physical serial / print run" value={edit.printRun} placeholder="06/75 or /75" onChange={(value) => setEditValue(card.inventoryItemId, "printRun", value)} />
                      <Field label="Memorabilia type" value={edit.memorabiliaType} placeholder="Patch, jersey, relic…" onChange={(value) => setEditValue(card.inventoryItemId, "memorabiliaType", value)} />
                      <Field label="Inscription text" value={edit.inscriptionText} onChange={(value) => setEditValue(card.inventoryItemId, "inscriptionText", value)} />
                      <Field label="Category" value={edit.category} onChange={(value) => setEditValue(card.inventoryItemId, "category", value)} />
                      <Field label="Condition" value={edit.condition} onChange={(value) => setEditValue(card.inventoryItemId, "condition", value)} />
                    </div>

                    <label className="mt-3 block text-sm font-bold">
                      Description
                      <textarea
                        value={edit.description}
                        onChange={(event) => setEditValue(card.inventoryItemId, "description", event.target.value)}
                        rows={5}
                        className="mt-1 w-full rounded-lg border-2 border-neutral-300 bg-white p-3 text-neutral-950 focus:border-neutral-950 focus:outline-none"
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-neutral-300 bg-white p-3">
                      {([
                        ["isRookie", "Rookie"],
                        ["isAuto", "Autograph"],
                        ["isRelic", "Memorabilia / Relic"],
                        ["inscription", "Inscription"],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 font-bold">
                          <input
                            type="checkbox"
                            checked={edit[key]}
                            onChange={(event) => setEditValue(card.inventoryItemId, key, event.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(card)}
                        disabled={isBusy}
                        className="rounded-xl bg-amber-600 px-5 py-3 font-black text-white disabled:opacity-50"
                      >
                        Save, Lock & Teach InstaComp
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-xl bg-neutral-700 px-5 py-3 font-black text-white">Cancel</button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">Stored image rows: {card.storedImageCount || 0} · quantity 1 physical card · never auto-published</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(card)}
                      disabled={Boolean(busyId)}
                      className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      Edit All Fields
                    </button>
                    {stage === "failed" ? (
                      <button
                        type="button"
                        onClick={() => void runExactIdentity(card)}
                        disabled={!pairReady || Boolean(busyId)}
                        className="rounded-xl bg-red-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                      >
                        Retry This Card
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title={job?.manualIdentityLocked ? "Re-scan and Replace Locked Identity" : "Read Card"}
                      onClick={() => void runExactIdentity(card)}
                      disabled={!pairReady || Boolean(busyId)}
                      className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      {isBusy
                        ? "Working…"
                        : job?.manualIdentityLocked
                          ? "Replace Manual Identity with AI"
                          : "Read Card"}
                    </button>
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

function MarketEvidencePanel({
  title,
  subtitle,
  rows,
  dateKey,
}: {
  title: string;
  subtitle: string;
  rows: CompEvidence[];
  dateKey: "soldAt" | "listedAt";
}) {
  return (
    <div className="rounded-xl border border-neutral-300 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{title}</h3>
          <p className="mt-1 text-xs font-semibold text-neutral-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-xs font-black text-white">
          {rows.length}
        </span>
      </div>
      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.slice(0, 5).map((row, index) => (
            <div key={`${row.url || row.title || title}-${index}`} className="rounded-lg bg-neutral-100 p-3 text-sm">
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline decoration-neutral-400 underline-offset-2"
                >
                  {row.title || "Market listing"}
                </a>
              ) : (
                <p className="font-bold">{row.title || "Market listing"}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-neutral-600">
                <span>{money(row.price)}</span>
                {row.sourceLabel ? <span>{row.sourceLabel}</span> : null}
                {row[dateKey] ? <span>{row[dateKey]}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-neutral-500">None accepted yet.</p>
      )}
    </div>
  );
}
