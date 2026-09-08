"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
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

type PhysicalInventoryMember = {
  inventoryItemId: string;
  scanId?: string | null;
  cardUuid?: string | null;
  identity?: CardIdentity | null;
  frontImageUrl?: string | null;
  backImageUrl?: string | null;
  inventoryLifecycle?: {
    state?: string | null;
    disposition?: string | null;
    receivedAt?: string | null;
    scanId?: string | null;
  } | null;
};

type PendingCard = {
  inventoryItemId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  sku: string | null;
  price?: number | null;
  quantity?: number;
  commercialGroup?: {
    mergeable: boolean;
    memberInventoryItemIds: string[];
    members?: PhysicalInventoryMember[];
    pendingRows: number;
    pendingQuantity: number;
    activeRows: number;
    totalQuantity: number;
  } | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  storedImageCount: number;
  activationReadiness?: { ready?: boolean; blockers?: string[] } | null;
  inventoryLifecycle?: {
    state?: string | null;
    disposition?: string | null;
    receivedAt?: string | null;
    scanId?: string | null;
  } | null;
  instaComp: {
    scanId?: string | null;
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
    listingPriceSource?: string | null;
    channelPricing?: {
      ebayPrice: number;
      ebayEstimatedFees: number;
      ebayEstimatedNet: number;
      websitePrice: number;
      websiteEstimatedFees: number;
      websiteEstimatedNet: number;
      customerSavings: number;
      customerSavingsPercent: number;
      netDifference: number;
      websiteStatus?: string | null;
      ebayStatus?: string | null;
      calculatedFrom?: string | null;
    } | null;
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

type PurchaseMatchRecord = {
  acquisitionItemId: number;
  purchaseId: string;
  source: string;
  purchaseDate?: string | null;
  title?: string | null;
  seller?: string | null;
  orderNumber?: string | null;
  sourceLot?: string | null;
  listingUrl?: string | null;
  allocatedCost: number;
  serialFamily?: string | null;
  parallel?: string | null;
  status?: string | null;
};

type PurchaseMatchState = {
  status: "no_match" | "scan_required" | "possible_match" | "pending_purchase" | "received" | "linked_existing" | string;
  inventoryItemId?: string | null;
  scanId?: string | null;
  inventoryState?: string | null;
  disposition?: string | null;
  receiptMode?: string | null;
  linkedAt?: string | null;
  confidence?: number | null;
  reason?: string | null;
  match?: PurchaseMatchRecord | null;
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
  product: string;
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
type ListingFolder = "receipt" | "pending" | "website" | "ebay" | "both" | "investment";
type CountedListingFolder = Exclude<ListingFolder, "receipt">;
type ChannelAction = "publish-website" | "publish-ebay" | "publish-both";

function queueFromLocation(): PendingQueue | null {
  if (typeof window === "undefined") return "listings";
  const queue = new URLSearchParams(window.location.search).get("queue");
  if (queue === "verification" || queue === "listings") return queue;
  return null;
}

function folderFromLocation(): ListingFolder {
  if (typeof window === "undefined") return "pending";
  const folder = new URLSearchParams(window.location.search).get("folder");
  return folder === "receipt" || folder === "website" || folder === "ebay" || folder === "both" || folder === "investment"
    ? folder
    : "pending";
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
}

function physicalMembersForCard(card: PendingCard): PhysicalInventoryMember[] {
  if (card.commercialGroup?.members?.length) return card.commercialGroup.members;
  return [{
    inventoryItemId: card.inventoryItemId,
    scanId: card.instaComp.scanId || null,
    cardUuid: card.instaComp.cardUuid || null,
    identity: card.instaComp.identity || null,
    frontImageUrl: card.frontImageUrl,
    backImageUrl: card.backImageUrl,
    inventoryLifecycle: card.inventoryLifecycle || null,
  }];
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
  const normalized = String(value || "")
    .replace(/[|｜]/g, "/")
    .replace(/[–—−]/g, "-")
    .replace(/\bno\.?\s*(\d{1,5})\b/gi, "$1")
    .replace(/\b#\s*(\d{1,5})\b/gi, "$1")
    .replace(/\bnumber\s*(\d{1,5})\b/gi, "$1")
    .replace(/\b(\d{1,6})\s*[- ]?of[- ]?(\d{1,6})\b/gi, "$1/$2")
    .replace(/\s+/g, "");
  const match = normalized.match(/\/(\d{1,6})$/) || normalized.match(/^(\d{1,6})$/);
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

function serialTitleLabel(value: string) {
  const compact = String(value || "").replace(/[|｜]/g, "/").replace(/\s+/g, "");
  const exact = compact.match(/^(\d{1,6})\/(\d{1,6})$/);
  if (exact) return `${Number(exact[1])}/${Number(exact[2])}`;
  return serialRunLabel(compact);
}

function canonicalSetTitle(value: string) {
  const clean = value.trim();
  if (/^base(?: set)?$/i.test(clean)) return "";
  return clean.replace(/^base set\s*[-–—:]\s*/i, "").trim();
}

function standardizedTitle(edit: EditState) {
  const setName = canonicalSetTitle(edit.setName);
  const parallel = /^base$/i.test(edit.parallel.trim()) ? "" : edit.parallel.trim();
  const product = edit.product.trim() || edit.brand.trim() || edit.manufacturer.trim();
  const team = edit.team.trim() ? `(${edit.team.trim()})` : "";
  return [edit.year.trim(), product, setName, edit.cardNumber.trim() ? `#${edit.cardNumber.trim().replace(/^#/, "")}` : "", edit.player.trim(), parallel, serialTitleLabel(edit.printRun), team]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
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
    product: identity.product || "",
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
  initialFolder = "pending",
  initialCards = [],
  initialQueueCounts = { listings: 0, verification: 0 },
  initialFolderCounts = { pending: 0, website: 0, ebay: 0, both: 0, investment: 0 },
}: {
  initialQueue: PendingQueue;
  initialFolder?: ListingFolder;
  initialCards?: PendingCard[];
  initialQueueCounts?: { listings: number; verification: number };
  initialFolderCounts?: Record<CountedListingFolder, number>;
}) {
  const [cards, setCards] = useState<PendingCard[]>(initialCards);
  const [queueCounts, setQueueCounts] = useState(initialQueueCounts);
  const [folderCounts, setFolderCounts] = useState(initialFolderCounts);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [localStage, setLocalStage] = useState<Record<string, LocalStage>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCondition, setBulkCondition] = useState("");
  const [manualPrices, setManualPrices] = useState<Record<string, string>>({});
  const [channelPriceEdits, setChannelPriceEdits] = useState<Record<string, { website: string; ebay: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const [purchaseMatches, setPurchaseMatches] = useState<Record<string, PurchaseMatchState>>({});
  const router = useRouter();
  const [queue, setQueue] = useState<PendingQueue>(initialQueue);
  const [folder, setFolder] = useState<ListingFolder>(initialFolder);

  useEffect(() => {
    const queueFromUrl = queueFromLocation();
    if (queueFromUrl) setQueue(queueFromUrl);
    setFolder(folderFromLocation());
  }, []);

  const load = useCallback(async (activeQueue: PendingQueue, activeFolder: ListingFolder = folderFromLocation()) => {
    const requestedFolder = activeQueue === "verification" || activeFolder === "receipt" ? "pending" : activeFolder;
    setLoading(true);
    setPageError("");
    let accessTokenHint: string | null = null;
    if (typeof window !== "undefined") {
      (window as any).__kingmakerPendingDebug = {
        queue: activeQueue,
          folder: requestedFolder,
          stage: "starting",
          itemCount: null,
          queueCounts: null,
          accessTokenHint: null,
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
      accessTokenHint = accessToken.slice(-8);
      const headers = { Authorization: `Bearer ${accessToken}` };
      if (typeof window !== "undefined") {
        (window as any).__kingmakerPendingDebug = {
          queue: activeQueue,
          folder: requestedFolder,
          stage: "fetching",
          itemCount: null,
          queueCounts: null,
          accessTokenHint,
        };
      }
      const [cardsResult, statusResult] = await Promise.allSettled([
        fetch(`/api/account/seller/instacomp-pending?queue=${activeQueue}&folder=${requestedFolder}${typeof window !== "undefined" ? (() => { const batch = new URLSearchParams(window.location.search).get("batch"); return batch ? `&batch=${encodeURIComponent(batch)}` : ""; })() : ""}`, { headers, cache: "no-store" }),
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
      setFolderCounts({
        pending: Math.max(0, Number(cardsData.folderCounts?.pending || 0)),
        website: Math.max(0, Number(cardsData.folderCounts?.website || 0)),
        ebay: Math.max(0, Number(cardsData.folderCounts?.ebay || 0)),
        both: Math.max(0, Number(cardsData.folderCounts?.both || 0)),
        investment: Math.max(0, Number(cardsData.folderCounts?.investment || 0)),
      });
      if (typeof window !== "undefined") {
        (window as any).__kingmakerPendingDebug = {
          queue: activeQueue,
          folder: requestedFolder,
          stage: "loaded",
          itemCount: Array.isArray(cardsData.items) ? cardsData.items.length : -1,
          queueCounts: {
            listings: Math.max(0, Number(cardsData.queueCounts?.listings || 0)),
            verification: Math.max(0, Number(cardsData.queueCounts?.verification || 0)),
          },
          accessTokenHint,
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
          folder: requestedFolder,
          stage: "error",
          error: message(error),
          itemCount: null,
          queueCounts: null,
          accessTokenHint,
        };
      }
      setPageError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(queue, folder);
  }, [load, queue, folder]);

  useEffect(() => {
    let cancelled = false;
    const eligible = cards
      .flatMap((card) => physicalMembersForCard(card))
      .filter((member) =>
        Boolean(
          member.inventoryItemId &&
          member.scanId &&
          member.identity?.player &&
          member.identity?.cardNumber,
        ),
      );
    if (!eligible.length) {
      setPurchaseMatches({});
      return () => { cancelled = true; };
    }
    void (async () => {
      try {
        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        const response = await fetch("/api/account/seller/instacomp-purchase-match", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            items: eligible.map((member) => ({
              cardUuid: member.cardUuid || "",
              inventoryItemId: member.inventoryItemId,
              scanId: member.scanId,
              identity: member.identity,
            })),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.ok !== true || !Array.isArray(data.results)) return;
        const next: Record<string, PurchaseMatchState> = {};
        for (const row of data.results) {
          if (row?.inventoryItemId) next[String(row.inventoryItemId)] = row as PurchaseMatchState;
        }
        if (cancelled) return;
        setPurchaseMatches(next);
        const pending = data.results.filter((row: any) => row?.status === "pending_purchase");
        if (pending.length) {
          setNotice(`PURCHASE MATCH FOUND — ${pending.length} scanned physical card${pending.length === 1 ? "" : "s"} waiting to be received.`);
        }
      } catch {
        // Acquisition matching is additive and must never block normal KINGMAKER work.
      }
    })();
    return () => { cancelled = true; };
  }, [cards]);

  async function receivePurchase(
    card: PendingCard,
    member: PhysicalInventoryMember,
    disposition: "resale" | "investment_stash",
  ) {
    const purchase = purchaseMatches[member.inventoryItemId] || null;
    const acquisitionItemId = Number(purchase?.match?.acquisitionItemId || 0);
    if (!member.scanId || acquisitionItemId <= 0) {
      setPageError("RECEIVE BLOCKED: this physical copy does not have a verified scan + purchase reservation.");
      return;
    }
    setBusyId(member.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-purchase-receive", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          cardUuid: member.cardUuid || card.instaComp.cardUuid || "",
          inventoryItemId: member.inventoryItemId,
          scanId: member.scanId,
          acquisitionItemId,
          disposition,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || data.status !== "received") {
        throw new Error(data.error || data.detail || "Could not receive the matched purchase.");
      }
      setPurchaseMatches((current) => ({
        ...current,
        [member.inventoryItemId]: {
          ...purchase!,
          status: "received",
          disposition,
          inventoryState: data.inventoryState,
          match: data.match || purchase?.match,
        },
      }));
      setNotice(
        `${card.title}: RECEIVED · ${data.match?.source || purchase?.match?.source || "Purchase"} · ${money(data.match?.allocatedCost || purchase?.match?.allocatedCost)} cost · ${disposition === "investment_stash" ? "INVESTMENT STASH" : "RESALE INVENTORY"}.`,
      );
      await load(queue, folderFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function linkExistingPurchase(
    card: PendingCard,
    member: PhysicalInventoryMember,
  ) {
    const purchase = purchaseMatches[member.inventoryItemId] || null;
    const acquisitionItemId = Number(purchase?.match?.acquisitionItemId || 0);
    if (!member.scanId || acquisitionItemId <= 0) {
      setPageError("LINK BLOCKED: this physical copy does not have a verified scan + purchase reservation.");
      return;
    }
    setBusyId(member.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-purchase-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          cardUuid: member.cardUuid || card.instaComp.cardUuid || "",
          inventoryItemId: member.inventoryItemId,
          scanId: member.scanId,
          acquisitionItemId,
          disposition: "resale",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true || data.status !== "linked_existing") {
        throw new Error(data.error || data.detail || "Could not link the purchase to existing inventory.");
      }
      setPurchaseMatches((current) => ({
        ...current,
        [member.inventoryItemId]: {
          ...purchase!,
          status: "linked_existing",
          disposition: data.disposition || "resale",
          inventoryState: data.inventoryState || "resale_ready",
          receiptMode: "linked_existing",
          linkedAt: data.linkedAt || null,
          match: data.match || purchase?.match,
        },
      }));
      setNotice(
        `${card.title}: PURCHASE LINKED TO EXISTING INVENTORY · quantity unchanged · ${money(data.match?.allocatedCost || purchase?.match?.allocatedCost)} cost basis attached.`,
      );
      await load(queue, folderFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function moveInventoryDisposition(
    card: PendingCard,
    member: PhysicalInventoryMember,
    disposition: "resale" | "investment_stash",
  ) {
    setBusyId(member.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-inventory-disposition", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inventoryItemId: member.inventoryItemId, disposition }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not move inventory.");
      setNotice(`${card.title}: moved to ${disposition === "investment_stash" ? "Investment Stash" : "Resale Pending"}.`);
      await load(queue, folderFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

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
    const finalTitle = edit.title.trim() || standardizedTitle(edit);
    if (!finalTitle) {
      setPageError("The corrected card needs enough identity fields to build a listing title.");
      return;
    }
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice(`Running InstaComp on ${card.title}…`);
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

  async function saveManualPrice(card: PendingCard) {
    const raw = String(manualPrices[card.inventoryItemId] || "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
      setPageError("Manual price must be a positive dollar amount with no more than 2 decimal places.");
      return;
    }
    const selectedPrice = Number(raw);
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) {
      setPageError("Manual price must be greater than $0.00.");
      return;
    }
    await savePrice(card, selectedPrice, "kingmaker_manual");
  }

  async function saveChannelPrices(card: PendingCard) {
    const current = channelPriceEdits[card.inventoryItemId];
    const websiteRaw = String(current?.website ?? card.instaComp.channelPricing?.websitePrice ?? "").trim();
    const ebayRaw = String(current?.ebay ?? card.instaComp.channelPricing?.ebayPrice ?? "").trim();
    const websitePrice = Number(websiteRaw);
    const ebayPrice = Number(ebayRaw);
    if (!Number.isFinite(websitePrice) || websitePrice <= 0 || !Number.isFinite(ebayPrice) || ebayPrice <= 0) {
      setPageError("Enter a positive Website price and eBay price. These are the exact seller prices that will publish.");
      return;
    }
    setBusyId(card.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-pending/channel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "save",
          inventoryItemId: card.inventoryItemId,
          websitePrice,
          ebayPrice,
          manualChannelPrices: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || data.errors?.join("; ") || "Could not save channel prices.");
      setChannelPriceEdits((state) => ({
        ...state,
        [card.inventoryItemId]: { website: String(data.websitePrice || websitePrice), ebay: String(data.ebayPrice || ebayPrice) },
      }));
      setNotice(`${card.title}: seller channel prices locked · Website ${money(data.websitePrice || websitePrice)} · eBay ${money(data.ebayPrice || ebayPrice)}.`);
      await load(queue, folderFromLocation());
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

  async function runInstaComp(card: PendingCard) {
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          aiCouncilTier: "adaptive",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "InstaComp pricing failed.");
      }
      setNotice(
        Number(data.suggestedPrice || 0) > 0
          ? `${card.title}: InstaComp ${money(data.suggestedPrice)} from ${Number(data.reliableSoldCompCount || 0)} exact sold comp${Number(data.reliableSoldCompCount || 0) === 1 ? "" : "s"}.`
          : `${card.title}: no exact sold comps passed. ${Array.isArray(data.providerProblems) && data.providerProblems.length ? `Provider issue: ${data.providerProblems.slice(0, 2).map((row: any) => `${row.label}: ${row.message || row.status}`).join(" · ")}` : "Seller pricing is required."}`,
      );
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function runSelectedInstaComp() {
    const selected = cards.filter((card) => selectedIds.has(card.inventoryItemId));
    if (!selected.length) {
      setPageError("Select one or more exact-card groups first.");
      return;
    }
    setBusyId("bulk");
    setPageError("");
    setNotice(`Running InstaComp on ${selected.length} selected group${selected.length === 1 ? "" : "s"}…`);
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      let priced = 0;
      let noMarket = 0;
      const failures: string[] = [];
      for (const card of selected) {
        const response = await fetch("/api/account/seller/inventory/instacomp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ inventoryItemId: card.inventoryItemId, aiCouncilTier: "adaptive" }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true) failures.push(`${card.title}: ${data.error || "failed"}`);
        else if (Number(data.suggestedPrice || 0) > 0) priced += 1;
        else noMarket += 1;
      }
      setNotice(`InstaComp finished: ${priced} priced, ${noMarket} no-exact-sold-market, ${failures.length} failed.`);
      if (failures.length) setPageError(failures.slice(0, 3).join(" · "));
      await load(queue || queueFromLocation());
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function publishChannels(targets: PendingCard[], action: ChannelAction) {
    if (!targets.length) {
      setPageError("Select one or more exact-card groups first.");
      return;
    }
    const pendingPurchaseTargets = targets.filter((card) =>
      physicalMembersForCard(card).some(
        (member) => purchaseMatches[member.inventoryItemId]?.status === "pending_purchase",
      ),
    );
    if (pendingPurchaseTargets.length) {
      setPageError(
        `LISTING BLOCKED: link the purchase to existing inventory or receive the new physical purchase${pendingPurchaseTargets.length === 1 ? "" : "s"} into Resale Inventory first.`,
      );
      return;
    }
    const investmentTargets = targets.filter((card) =>
      physicalMembersForCard(card).some((member) => {
        const match = purchaseMatches[member.inventoryItemId];
        return (
          match?.disposition === "investment_stash" ||
          member.inventoryLifecycle?.disposition === "investment_stash"
        );
      }),
    );
    if (investmentTargets.length) {
      setPageError(
        `LISTING BLOCKED: move ${investmentTargets.length} investment-stash group${investmentTargets.length === 1 ? "" : "s"} to Resale Inventory first.`,
      );
      return;
    }
    const label =
      action === "publish-website"
        ? "website"
        : action === "publish-ebay"
          ? "eBay"
          : "website + eBay";
    if (!window.confirm(`List ${targets.length} exact-card group${targets.length === 1 ? "" : "s"} to ${label}? Group quantities and the channel prices shown on screen will be used.`)) return;

    setBusyId(targets.length === 1 ? targets[0].inventoryItemId : "bulk");
    setPageError("");
    setNotice(`Publishing ${targets.length} group${targets.length === 1 ? "" : "s"} to ${label}…`);
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      let completed = 0;
      const failures: string[] = [];
      for (const card of targets) {
        const channel = card.instaComp.channelPricing;
        const edited = channelPriceEdits[card.inventoryItemId];
        const websitePrice = Number(edited?.website || channel?.websitePrice || 0);
        const ebayPrice = Number(edited?.ebay || channel?.ebayPrice || 0);
        const response = await fetch("/api/account/seller/instacomp-pending/channel", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            action,
            inventoryItemId: card.inventoryItemId,
            ebayPrice: ebayPrice || undefined,
            websitePrice: websitePrice || undefined,
            manualChannelPrices: Boolean(edited),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success !== true) {
          failures.push(`${card.title}: ${data.error || data.errors?.join("; ") || "publish failed"}`);
        } else {
          completed += 1;
        }
      }
      const failureSummary = failures.length ? ` ${failures[0]}` : "";
      setNotice(`Published ${completed}/${targets.length} exact-card group${targets.length === 1 ? "" : "s"} to ${label}.${failureSummary}`);
      if (failures.length) setPageError(failures.slice(0, 3).join(" · "));
      setSelectedIds(new Set());
      await load(queue || queueFromLocation() || "listings", folderFromLocation());
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
          inventoryItemIds: Array.from(new Set(selected.flatMap((card) =>
            card.commercialGroup?.memberInventoryItemIds?.length
              ? card.commercialGroup.memberInventoryItemIds
              : [card.inventoryItemId],
          ))),
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

  const pendingReceiptCount = Object.values(purchaseMatches).filter((purchase) => purchase?.status === "pending_purchase").length;
  const visibleCards = folder === "receipt"
    ? cards.filter((card) =>
        physicalMembersForCard(card).some(
          (member) => purchaseMatches[member.inventoryItemId]?.status === "pending_purchase",
        ),
      )
    : cards;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">KINGMAKER / Master Listings</p>
            <h1 className="mt-1 text-3xl font-black">
              {queue === "verification"
                ? "Pending verification"
                : folder === "receipt"
                  ? "Pending receipt — matched purchases"
                  : folder === "pending"
                    ? "Resale inventory — pending listing"
                  : folder === "website"
                    ? "Listed on website only"
                    : folder === "ebay"
                      ? "Listed on eBay only"
                      : folder === "both"
                        ? "Listed on website + eBay"
                        : "Investment stash"}
            </h1>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
              {queue === "verification"
                ? "Legacy and held cards stay here with every image and inventory link intact until you are ready to verify them."
                : folder === "receipt"
                  ? "Only scanned physical cards with a real Mac-local pending purchase reservation appear here. Receive each one into Resale Inventory or Investment Stash."
                  : folder === "investment"
                    ? "Received physical cards held for investment. Every card keeps its scan, purchase date, source, and cost basis until you move it back to resale."
                    : folder === "pending"
                    ? "Scanned and received resale inventory stays here until it is listed. InstaComp is a market recommendation; you control the actual website and eBay prices."
                    : "Listed inventory is separated by live channel so cards no longer clutter the pending workspace."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load(queue || queueFromLocation() || "listings", folderFromLocation())}
            disabled={loading || Boolean(busyId)}
            className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        <nav className="mt-5 flex flex-wrap gap-2" aria-label="Inventory lifecycle folders">
          {([
            ["receipt", "Pending Receipt", pendingReceiptCount],
            ["pending", "Resale Pending", folderCounts.pending],
            ["website", "Website Only", folderCounts.website],
            ["ebay", "eBay Only", folderCounts.ebay],
            ["both", "Listed Both", folderCounts.both],
            ["investment", "Investment Stash", folderCounts.investment],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setSelectedIds(new Set());
                setEditingId(null);
                const nextUrl = new URL(window.location.href);
                nextUrl.searchParams.set("queue", "listings");
                nextUrl.searchParams.set("folder", value);
                router.replace(`${nextUrl.pathname}${nextUrl.search}`);
                setQueue("listings");
                setFolder(value);
              }}
              aria-pressed={queue === "listings" && folder === value}
              className={`rounded-xl border-2 px-4 py-3 font-black ${
                queue === "listings" && folder === value
                  ? "border-neutral-950 bg-neutral-950 text-white"
                  : "border-neutral-400 bg-white text-neutral-950"
              }`}
            >
              {label} · {count}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set());
              setEditingId(null);
              const nextUrl = new URL(window.location.href);
              nextUrl.searchParams.set("queue", "verification");
              router.replace(`${nextUrl.pathname}${nextUrl.search}`);
              setQueue("verification");
            }}
            aria-pressed={queue === "verification"}
            className={`rounded-xl border-2 px-4 py-3 font-black ${
              queue === "verification"
                ? "border-amber-700 bg-amber-600 text-white"
                : "border-neutral-400 bg-white text-neutral-950"
            }`}
          >
            Pending Verification · {queueCounts.verification}
          </button>
        </nav>

        {pageError ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{pageError}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        {!loading && !cards.length ? (
          <div className="mt-6 rounded-2xl border border-neutral-300 bg-white p-8 text-center">
            <p className="text-xl font-black">
              {queue === "verification"
                ? "No cards pending verification"
                : folder === "pending"
                  ? "No resale cards waiting to be listed"
                  : folder === "website"
                    ? "No website-only listings"
                    : folder === "ebay"
                      ? "No eBay-only listings"
                      : folder === "both"
                        ? "No cards listed on both channels"
                        : "Investment stash is empty"}
            </p>
            <p className="mt-2 text-neutral-600">
              {queue === "verification"
                ? "Held cards will remain available here without crowding inventory."
                : folder === "investment"
                  ? "Receive a scanned purchase into Investment Stash to hold it here."
                  : "Cards move between these folders automatically as their channel status changes."}
            </p>
          </div>
        ) : null}

        {cards.length ? (
          <section className="mt-6 rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]" aria-label="Bulk listing tools">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Bulk edit</h2>
                <p className="text-sm font-semibold text-neutral-600">{selectedIds.size} of {visibleCards.length} selected</p>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedIds(new Set(visibleCards.map((card) => card.inventoryItemId)))} className="rounded-lg border-2 border-neutral-900 px-3 py-2 text-sm font-black">Select all</button>
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
            {queue === "listings" ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-300 pt-3">
                <span className="mr-2 text-sm font-black">Selected group actions:</span>
                <button
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void runSelectedInstaComp()}
                  className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  Run InstaComp Selected
                </button>
                <button
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void publishChannels(cards.filter((card) => selectedIds.has(card.inventoryItemId)), "publish-website")}
                  className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  List Selected → Website
                </button>
                <button
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void publishChannels(cards.filter((card) => selectedIds.has(card.inventoryItemId)), "publish-ebay")}
                  className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  List/Update Selected → eBay
                </button>
                <button
                  type="button"
                  disabled={!selectedIds.size || Boolean(busyId)}
                  onClick={() => void publishChannels(cards.filter((card) => selectedIds.has(card.inventoryItemId)), "publish-both")}
                  className="rounded-lg bg-neutral-950 px-3 py-2 text-sm font-black text-white disabled:opacity-40"
                >
                  List Selected → Both
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {folder === "receipt" && !loading && visibleCards.length === 0 ? (
          <div className="mt-6 rounded-2xl border-2 border-neutral-900 bg-white p-6 font-black shadow-[6px_6px_0_#111]">
            No scanned purchases are waiting to be received right now.
          </div>
        ) : null}

        <section className="mt-6 space-y-6">
          {visibleCards.map((card) => {
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
            const channelPricing = card.instaComp.channelPricing || null;
            const channelEdit = channelPriceEdits[card.inventoryItemId];
            const websitePriceInput = channelEdit?.website ?? (Number(channelPricing?.websitePrice || 0) > 0 ? String(channelPricing?.websitePrice) : "");
            const ebayPriceInput = channelEdit?.ebay ?? (Number(channelPricing?.ebayPrice || 0) > 0 ? String(channelPricing?.ebayPrice) : "");
            const publishWebsitePrice = Number(websitePriceInput || 0);
            const publishEbayPrice = Number(ebayPriceInput || 0);
            const physicalMembers = physicalMembersForCard(card);
            const purchaseMembers = physicalMembers
              .map((member) => ({ member, purchase: purchaseMatches[member.inventoryItemId] || null }))
              .filter((entry) => Boolean(entry.purchase));
            const pendingPurchase = purchaseMembers.some((entry) => entry.purchase?.status === "pending_purchase");
            const linkedExistingPurchase = purchaseMembers.some((entry) => entry.purchase?.status === "linked_existing");
            const receivedPurchase = purchaseMembers.some((entry) => entry.purchase?.status === "received");
            const accountedPurchase = linkedExistingPurchase || receivedPurchase;
            const possiblePurchase = purchaseMembers.some((entry) => entry.purchase?.status === "possible_match");
            const scanRequired = physicalMembers.some((member) => !member.scanId);
            const listingPriceSource = String(card.instaComp.listingPriceSource || "").toLowerCase();
            const sellerManualPrice = listingPriceSource === "kingmaker_manual";
            const websiteListed = String(channelPricing?.websiteStatus || "").toLowerCase() === "active";
            const ebayStatus = String(channelPricing?.ebayStatus || "").toLowerCase();
            const ebayListed = ebayStatus === "active" || ebayStatus === "linked";
            const groupQuantity = Math.max(
              1,
              Number(card.commercialGroup?.totalQuantity || card.quantity || 1),
            );
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
                    <p className="mt-1 text-xs font-semibold text-emerald-200">
                      Canonical listing title · exact identity fields shown below
                    </p>
                    <p className="mt-1 break-all text-xs font-mono text-emerald-300">
                      {card.instaComp.cardUuid ? `UUID ${card.instaComp.cardUuid}` : "Permanent UUID missing — review required"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        href={`/seller/admin/inventory/${encodeURIComponent(card.inventoryItemId)}`}
                        className="rounded-full border border-emerald-500 px-3 py-1 text-xs font-black text-emerald-200 hover:bg-emerald-500 hover:text-slate-950"
                      >
                        Open exact master listing
                      </Link>
                      <span className="rounded-full border border-slate-600 px-3 py-1 text-xs font-black text-slate-300">
                        ID {card.inventoryItemId.slice(0, 8)}
                      </span>
                    </div>
                    {card.instaComp.identity?.notes ? (
                      <p className="mt-2 text-xs leading-relaxed text-neutral-300">
                        {card.instaComp.identity.notes}
                      </p>
                    ) : null}
                    {groupQuantity > 1 ? (
                      <div className="mt-2 space-y-1 rounded-lg border border-amber-400/60 bg-amber-950/40 px-3 py-2 text-xs font-black text-amber-200">
                        <p>
                          ONE COMMERCIAL LISTING · QTY {groupQuantity} · {card.commercialGroup?.pendingRows || 1} pending physical row{Number(card.commercialGroup?.pendingRows || 1) === 1 ? "" : "s"} · {card.commercialGroup?.activeRows || 0} already active
                        </p>
                        <p className="text-amber-100">Exact raw duplicates are priced and published together; scan history stays attached underneath.</p>
                      </div>
                    ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {pendingPurchase ? (
                      <span className="rounded-full bg-orange-400 px-3 py-1 text-xs font-black text-orange-950">
                        PENDING PURCHASE · MATCH FOUND
                      </span>
                    ) : linkedExistingPurchase ? (
                      <span className="rounded-full bg-cyan-200 px-3 py-1 text-xs font-black text-cyan-950">
                        PURCHASE LINKED · EXISTING INVENTORY
                      </span>
                    ) : receivedPurchase ? (
                      <span className="rounded-full bg-emerald-300 px-3 py-1 text-xs font-black text-emerald-950">
                        RECEIVED INVENTORY
                      </span>
                    ) : possiblePurchase ? (
                      <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">
                        POSSIBLE PURCHASE MATCH
                      </span>
                    ) : null}
                    {queue === "verification" ? (
                      <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                        PENDING VERIFICATION
                      </span>
                    ) : null}
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>
                      {pairReady ? "FRONT + BACK READY" : "SIDE MISSING"}
                    </span>
                    <span className={`rounded-full border-2 px-3 py-1 text-xs font-black ${websiteListed ? "border-emerald-300 bg-emerald-300 text-emerald-950" : "border-neutral-500 bg-neutral-800 text-neutral-300"}`}>
                      {websiteListed ? "✓ WEBSITE LISTED" : "WEBSITE NOT LISTED"}
                    </span>
                    <span className={`rounded-full border-2 px-3 py-1 text-xs font-black ${ebayListed ? "border-blue-300 bg-blue-300 text-blue-950" : "border-neutral-500 bg-neutral-800 text-neutral-300"}`}>
                      {ebayListed ? "✓ EBAY LISTED" : "EBAY NOT LISTED"}
                    </span>
                    {websiteListed && ebayListed ? (
                      <span className="rounded-full border-2 border-amber-200 bg-amber-300 px-3 py-1 text-xs font-black text-amber-950">
                        ✓ LISTED BOTH
                      </span>
                    ) : null}
                  </div>
                </div>

                {(pendingPurchase || accountedPurchase || possiblePurchase || scanRequired) ? (
                  <div className={`border-b-2 border-neutral-900 p-4 ${pendingPurchase ? "bg-orange-100" : accountedPurchase ? "bg-emerald-100" : "bg-amber-50"}`}>
                    <div>
                      <p className={`text-xl font-black ${pendingPurchase ? "text-orange-950" : accountedPurchase ? "text-emerald-950" : "text-amber-950"}`}>
                        {pendingPurchase
                          ? "PURCHASE MATCH FOUND — IS THIS ALREADY IN KINGMAKER OR A NEW ARRIVAL?"
                          : linkedExistingPurchase
                            ? "EXISTING INVENTORY — PURCHASE HISTORY LINKED"
                            : receivedPurchase
                              ? "NEW PHYSICAL INVENTORY RECEIVED — COST BASIS ATTACHED"
                              : scanRequired
                                ? "RECEIVE BLOCKED — PHYSICAL SCAN REQUIRED"
                                : "POSSIBLE PURCHASE MATCH — REVIEW"}
                      </p>
                      <p className="mt-1 text-sm font-bold text-neutral-700">
                        If this physical card was already scanned into KINGMAKER, link the purchase only. Use Receive only when you are actually receiving a newly arrived card.
                      </p>
                    </div>

                    <div className="mt-4 space-y-3">
                      {physicalMembers.map((member, index) => {
                        const purchase = purchaseMatches[member.inventoryItemId] || null;
                        const purchaseRecord = purchase?.match || null;
                        const memberPending = purchase?.status === "pending_purchase";
                        const memberLinkedExisting = purchase?.status === "linked_existing";
                        const memberReceived = purchase?.status === "received";
                        const memberAccounted = memberLinkedExisting || memberReceived;
                        const memberPossible = purchase?.status === "possible_match";
                        const memberDisposition = purchase?.disposition || member.inventoryLifecycle?.disposition || null;
                        return (
                          <div key={member.inventoryItemId} className="rounded-xl border-2 border-neutral-900 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-black">Physical copy {index + 1} · ID {member.inventoryItemId.slice(0, 8)}</p>
                                <p className="mt-1 break-all text-xs font-mono text-neutral-500">
                                  {member.scanId ? `SCAN ${member.scanId}` : "NO VERIFIED SCAN ID"}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {memberPending ? <span className="rounded-full bg-orange-200 px-3 py-1 text-xs font-black text-orange-950">PENDING PURCHASE</span> : null}
                                {memberLinkedExisting ? <span className="rounded-full bg-cyan-200 px-3 py-1 text-xs font-black text-cyan-950">EXISTING INVENTORY · PURCHASE LINKED</span> : null}
                                {memberReceived ? <span className="rounded-full bg-emerald-200 px-3 py-1 text-xs font-black text-emerald-950">RECEIVED NEW · {memberDisposition === "investment_stash" ? "INVESTMENT STASH" : "RESALE"}</span> : null}
                                {memberPossible ? <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black text-amber-950">POSSIBLE MATCH</span> : null}
                                {!member.scanId ? <span className="rounded-full bg-red-200 px-3 py-1 text-xs font-black text-red-950">SCAN REQUIRED</span> : null}
                              </div>
                            </div>

                            {purchaseRecord ? (
                              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                                <div><p className="text-xs font-black uppercase text-neutral-500">Source</p><p className="font-black">{purchaseRecord.source || "Misc"}</p></div>
                                <div><p className="text-xs font-black uppercase text-neutral-500">What we paid</p><p className="font-black">{money(purchaseRecord.allocatedCost)}</p></div>
                                <div><p className="text-xs font-black uppercase text-neutral-500">Purchased</p><p className="font-black">{purchaseRecord.purchaseDate || "Date unavailable"}</p></div>
                                <div><p className="text-xs font-black uppercase text-neutral-500">Order / Purchase ID</p><p className="break-all font-black">{purchaseRecord.orderNumber || purchaseRecord.purchaseId}</p></div>
                                <div><p className="text-xs font-black uppercase text-neutral-500">Seller</p><p className="font-bold">{purchaseRecord.seller || "Not captured"}</p></div>
                                <div className="sm:col-span-2"><p className="text-xs font-black uppercase text-neutral-500">Purchase listing / lot</p><p className="font-bold">{purchaseRecord.sourceLot || purchaseRecord.title || "Not captured"}</p></div>
                                <div><p className="text-xs font-black uppercase text-neutral-500">Match confidence</p><p className="font-black">{purchase?.confidence ? `${Math.round(Number(purchase.confidence) * 100)}%` : "Stored match"}</p></div>
                              </div>
                            ) : null}

                            {memberPending ? (
                              <div className="mt-3 border-t border-neutral-200 pt-3">
                                <p className="mb-2 text-xs font-black uppercase tracking-wide text-neutral-600">Already scanned before today?</p>
                                <button
                                  type="button"
                                  disabled={Boolean(busyId)}
                                  onClick={() => void linkExistingPurchase(card, member)}
                                  className="rounded-xl border-2 border-neutral-950 bg-cyan-200 px-4 py-2 font-black text-cyan-950 disabled:opacity-40"
                                >
                                  Already in KINGMAKER → Link Purchase Only
                                </button>
                                <p className="mt-3 mb-2 text-xs font-black uppercase tracking-wide text-neutral-600">Actually receiving this card now?</p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={() => void receivePurchase(card, member, "resale")}
                                    className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-40"
                                  >
                                    New Arrival → Receive to Resale
                                  </button>
                                  <button
                                    type="button"
                                    disabled={Boolean(busyId)}
                                    onClick={() => void receivePurchase(card, member, "investment_stash")}
                                    className="rounded-xl bg-amber-700 px-4 py-2 font-black text-white disabled:opacity-40"
                                  >
                                    New Arrival → Receive to Investment Stash
                                  </button>
                                </div>
                              </div>
                            ) : memberAccounted ? (
                              <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-200 pt-3">
                                {memberDisposition === "investment_stash" ? (
                                  <button type="button" disabled={Boolean(busyId)} onClick={() => void moveInventoryDisposition(card, member, "resale")} className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white disabled:opacity-40">Move → Resale Pending</button>
                                ) : (
                                  <button type="button" disabled={Boolean(busyId)} onClick={() => void moveInventoryDisposition(card, member, "investment_stash")} className="rounded-xl bg-amber-700 px-4 py-2 font-black text-white disabled:opacity-40">Move → Investment Stash</button>
                                )}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

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

                {queue === "listings" ? (
                  <div className="border-t-2 border-neutral-900 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <p className="font-black">Manual seller price</p>
                        <p className="text-sm font-semibold text-neutral-600">
                          Set any price you want. This overrides the listing price only; it does not rewrite InstaComp market truth.
                        </p>
                        <p className="mt-1 text-xs font-bold text-neutral-500">
                          Current draft price: {money(card.price || card.instaComp.listingPrice)}{sellerManualPrice ? " · SELLER MANUAL" : ""}
                        </p>
                      </div>
                      <div className="flex min-w-[280px] flex-wrap items-end gap-2">
                        <label className="min-w-[160px] flex-1 text-sm font-black">
                          Manual price
                          <div className="mt-1 flex items-center rounded-xl border-2 border-amber-700 bg-white px-3">
                            <span className="font-black text-neutral-500">$</span>
                            <input
                              type="number"
                              aria-label={`Manual price for ${card.title}`}
                              inputMode="decimal"
                              min="0.01"
                              step="0.01"
                              value={manualPrices[card.inventoryItemId] || ""}
                              onChange={(event) => setManualPrices((current) => ({ ...current, [card.inventoryItemId]: event.target.value }))}
                              placeholder={String(card.price || card.instaComp.listingPrice || card.instaComp.suggestedPrice || "")}
                              className="w-full bg-transparent p-2 font-black text-neutral-950 outline-none"
                            />
                          </div>
                        </label>
                        <button
                          type="button"
                          disabled={isBusy || !String(manualPrices[card.inventoryItemId] || "").trim()}
                          onClick={() => void saveManualPrice(card)}
                          className="rounded-xl bg-amber-700 px-4 py-3 font-black text-white disabled:opacity-40"
                        >
                          Save Manual Price
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {priceChoices.length ? (
                  <div className="border-t-2 border-neutral-900 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black">Exact-comp pricing presets</p>
                        <p className="text-sm font-semibold text-neutral-600">Use these only when you want InstaComp-based pricing.</p>
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

                {queue === "listings" && folder !== "investment" ? (
                  <div className="border-t-2 border-neutral-900 bg-sky-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-black">Seller-controlled channel prices · QTY {groupQuantity}</p>
                        <p className="mt-1 text-sm font-semibold text-neutral-700">
                          InstaComp is the market recommendation only. The exact Website and eBay prices you enter below are the prices KINGMAKER will publish.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-black">
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">Website: {channelPricing?.websiteStatus || "draft"}</span>
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">eBay: {channelPricing?.ebayStatus || "draft"}</span>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1fr_1fr_auto]">
                      <div className="rounded-xl border-2 border-violet-700 bg-white p-3">
                        <p className="text-xs font-black uppercase text-violet-700">InstaComp recommendation</p>
                        <p className="text-2xl font-black">{money(card.instaComp.suggestedPrice)}</p>
                        <p className="mt-1 text-xs font-bold text-neutral-500">Reference only — does not overwrite seller channel prices.</p>
                      </div>
                      <label className="rounded-xl border-2 border-emerald-700 bg-white p-3 text-sm font-black">
                        Exact Website price
                        <div className="mt-2 flex items-center rounded-lg border-2 border-neutral-300 px-3">
                          <span className="font-black text-neutral-500">$</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={websitePriceInput}
                            onChange={(event) => setChannelPriceEdits((current) => ({
                              ...current,
                              [card.inventoryItemId]: {
                                website: event.target.value,
                                ebay: current[card.inventoryItemId]?.ebay ?? ebayPriceInput,
                              },
                            }))}
                            className="w-full bg-transparent p-2 text-lg font-black outline-none"
                          />
                        </div>
                        {channelPricing ? <p className="mt-2 text-xs text-neutral-600">Estimated fees {money(channelPricing.websiteEstimatedFees)} · net {money(channelPricing.websiteEstimatedNet)}</p> : null}
                      </label>
                      <label className="rounded-xl border-2 border-blue-700 bg-white p-3 text-sm font-black">
                        Exact eBay price
                        <div className="mt-2 flex items-center rounded-lg border-2 border-neutral-300 px-3">
                          <span className="font-black text-neutral-500">$</span>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            inputMode="decimal"
                            value={ebayPriceInput}
                            onChange={(event) => setChannelPriceEdits((current) => ({
                              ...current,
                              [card.inventoryItemId]: {
                                website: current[card.inventoryItemId]?.website ?? websitePriceInput,
                                ebay: event.target.value,
                              },
                            }))}
                            className="w-full bg-transparent p-2 text-lg font-black outline-none"
                          />
                        </div>
                        {channelPricing ? <p className="mt-2 text-xs text-neutral-600">Estimated fees {money(channelPricing.ebayEstimatedFees)} · net {money(channelPricing.ebayEstimatedNet)}</p> : null}
                      </label>
                      <button
                        type="button"
                        disabled={Boolean(busyId) || publishWebsitePrice <= 0 || publishEbayPrice <= 0}
                        onClick={() => void saveChannelPrices(card)}
                        className="self-stretch rounded-xl bg-sky-800 px-5 py-3 font-black text-white disabled:opacity-40"
                      >
                        Save Exact Channel Prices
                      </button>
                    </div>
                    {channelPricing ? (
                      <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-neutral-600">
                        <span>Buyer difference: {money(channelPricing.customerSavings)}</span>
                        <span>Website net edge: {money(channelPricing.netDifference)}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {editingId === card.inventoryItemId && edit ? (
                  <div className="border-t-2 border-neutral-900 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black">Correct any field</h3>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">Saving makes your values operator-confirmed truth. Your typed Listing Title is saved exactly; use Rebuild Standard Title only when you want KINGMAKER to rewrite it.</p>
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
                      <Field label="Brand" value={edit.brand} onChange={(value) => setEditValue(card.inventoryItemId, "brand", value)} />
                      <Field label="Product" value={edit.product} placeholder="Prizm, Select, Donruss…" onChange={(value) => setEditValue(card.inventoryItemId, "product", value)} />
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
                  <p className="text-sm font-bold">Stored image rows: {card.storedImageCount || 0} · commercial listing quantity {groupQuantity}{groupQuantity > 1 ? " from exact raw duplicate scans" : ""} · nothing auto-publishes</p>
                  <div className="flex flex-wrap gap-2">
                    {queue === "listings" && folder !== "investment" ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void runInstaComp(card)}
                          disabled={!pairReady || Boolean(busyId)}
                          className="rounded-xl bg-violet-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                        >
                          {busyId === card.inventoryItemId ? "Running InstaComp…" : "Run InstaComp"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void publishChannels([card], "publish-website")}
                          disabled={publishWebsitePrice <= 0 || Boolean(busyId)}
                          className="rounded-xl bg-emerald-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                        >
                          List Website · {money(publishWebsitePrice)}
                        </button>
                        <button
                          type="button"
                          onClick={() => void publishChannels([card], "publish-ebay")}
                          disabled={publishEbayPrice <= 0 || Boolean(busyId)}
                          className="rounded-xl bg-blue-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                        >
                          {ebayListed ? "Update eBay" : "List eBay"} · {money(publishEbayPrice)}
                        </button>
                        <button
                          type="button"
                          onClick={() => void publishChannels([card], "publish-both")}
                          disabled={publishWebsitePrice <= 0 || publishEbayPrice <= 0 || Boolean(busyId)}
                          className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                        >
                          {websiteListed || ebayListed ? "Update / List Both" : "List Both"}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => beginEdit(card)}
                      disabled={isBusy}
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
