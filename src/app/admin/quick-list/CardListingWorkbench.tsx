"use client";

import { useMemo, useRef, useState, type DragEvent } from "react";
import { normalizeInstaCompListingSerial } from "../../../lib/instacomp-listing-serial";
import { recommendedEbayPrice } from "../../../lib/listing-channels";

type AiIdentity = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
};

type ScanResponse = {
  ok: boolean;
  scanId: string | null;
  ai: AiIdentity;
  stats?: { suggestedPrice?: number | null; median?: number | null };
  soldStats?: { suggestedPrice?: number | null; median?: number | null };
  review?: {
    trustedForPricing?: boolean;
    reviewReasons?: string[];
  } | null;
  consensus?: {
    trustedForIdentity?: boolean;
    reviewReasons?: string[];
  } | null;
  catalogEvidence?: { catalogConfirmed?: boolean } | null;
};

type OrientationRotation = 0 | 90 | 180 | 270;
type OrientationResponse = {
  ok: boolean;
  orientation?: {
    status: "completed" | "not_configured" | "error";
    frontRotation: OrientationRotation;
    backRotation: OrientationRotation;
    frontConfidence: number;
    backConfidence: number;
    reason: string;
  };
  reviewReasons?: string[];
  error?: string;
};

type PairingMethod = "filename" | "upload_order" | "front_only" | "manual_swap";
type RowStatus =
  | "queued"
  | "scanning"
  | "ready"
  | "creating"
  | "created"
  | "created_needs_channel_repair"
  | "error";

type ListingRow = {
  id: string;
  clientRequestId: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  pairingMethod: PairingMethod;
  pairingConfirmed: boolean;
  orientationChecked: boolean;
  orientationReviewReasons: string[];
  orientationSummary: string | null;
  status: RowStatus;
  passA: ScanResponse | null;
  passB: ScanResponse | null;
  reviewReasons: string[];
  title: string;
  sitePrice: string;
  ebayPrice: string;
  quantity: string;
  listOnSite: boolean;
  prepareForEbay: boolean;
  ebayDescriptionOverride: string;
  manualApproval: boolean;
  error: string | null;
  legacyProductId: number | null;
  editUrl: string | null;
};

type ImageCandidate = {
  file: File;
  side: "front" | "back" | "unknown";
  key: string;
  index: number;
};

type ImagePair = {
  front: File;
  back: File | null;
  method: PairingMethod;
};

const MAX_ROWS = 100;
const SCAN_CONCURRENCY = 4;
const CREATE_CONCURRENCY = 3;
const PRICE_DISAGREEMENT_RATIO = 0.2;

function cleanBase(name: string) {
  return name.replace(/\.[^.]+$/, "").trim();
}

function newClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function classify(file: File, index: number): ImageCandidate {
  const base = cleanBase(file.name);
  const front = base.match(/^(.*?)(?:[-_.\s]+)(front|obverse|f)$/i);
  const back = base.match(/^(.*?)(?:[-_.\s]+)(back|reverse|b)$/i);
  if (front) {
    return {
      file,
      side: "front",
      key: front[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }
  if (back) {
    return {
      file,
      side: "back",
      key: back[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }
  return { file, side: "unknown", key: `unknown-${index}`, index };
}

function pairFiles(files: File[]) {
  const candidates = files.map(classify);
  const named = new Map<string, { fronts: ImageCandidate[]; backs: ImageCandidate[] }>();
  const unknown: ImageCandidate[] = [];
  let skippedBackOnly = 0;

  for (const candidate of candidates) {
    if (candidate.side === "unknown") {
      unknown.push(candidate);
      continue;
    }
    const group = named.get(candidate.key) || { fronts: [], backs: [] };
    group[candidate.side === "front" ? "fronts" : "backs"].push(candidate);
    named.set(candidate.key, group);
  }

  const pairs: Array<ImagePair & { index: number }> = [];
  for (const group of named.values()) {
    group.fronts.sort((a, b) => a.index - b.index);
    group.backs.sort((a, b) => a.index - b.index);
    group.fronts.forEach((front, i) => {
      const back = group.backs[i] || null;
      pairs.push({
        front: front.file,
        back: back?.file || null,
        method: back ? "filename" : "front_only",
        index: Math.min(front.index, back?.index ?? front.index),
      });
    });
    skippedBackOnly += Math.max(0, group.backs.length - group.fronts.length);
  }

  unknown.sort((a, b) => a.index - b.index);
  for (let i = 0; i < unknown.length; i += 2) {
    const front = unknown[i];
    const back = unknown[i + 1] || null;
    pairs.push({
      front: front.file,
      back: back?.file || null,
      method: back ? "upload_order" : "front_only",
      index: front.index,
    });
  }

  return {
    pairs: pairs
      .sort((a, b) => a.index - b.index)
      .map(({ index: _index, ...pair }) => pair),
    skippedBackOnly,
  };
}

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function criticalDisagreements(a: ScanResponse, b: ScanResponse) {
  const fields: Array<[string, unknown, unknown]> = [
    ["player", a.ai.player, b.ai.player],
    ["year", a.ai.year, b.ai.year],
    ["brand", a.ai.brand, b.ai.brand],
    ["set", a.ai.setName, b.ai.setName],
    ["card number", a.ai.cardNumber, b.ai.cardNumber],
    ["parallel", a.ai.parallel, b.ai.parallel],
    ["serial", a.ai.serialNumber, b.ai.serialNumber],
    ["sport", a.ai.sport, b.ai.sport],
    ["rookie", a.ai.isRookie, b.ai.isRookie],
    ["autograph", a.ai.isAuto, b.ai.isAuto],
    ["relic", a.ai.isRelic, b.ai.isRelic],
  ];
  return fields.flatMap(([label, left, right]) =>
    normalized(left) === normalized(right)
      ? []
      : [`${label}: “${String(left ?? "unknown")}” vs “${String(right ?? "unknown")}”`],
  );
}

function scanPrice(scan: ScanResponse) {
  const values = [
    scan.soldStats?.suggestedPrice,
    scan.stats?.suggestedPrice,
    scan.soldStats?.median,
    scan.stats?.median,
  ];
  return (
    values.find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    ) || null
  );
}

function pricingReviewReasons(a: ScanResponse, b: ScanResponse) {
  const left = scanPrice(a);
  const right = scanPrice(b);
  const reasons: string[] = [];

  if (!left || !right) {
    reasons.push("Both pricing councils must produce a usable exact-card price before auto-listing.");
    return reasons;
  }

  const ratio = Math.abs(left - right) / Math.max(0.01, Math.min(left, right));
  if (ratio > PRICE_DISAGREEMENT_RATIO) {
    reasons.push(
      `Pricing councils differ by ${Math.round(ratio * 100)}% (${money(left)} vs ${money(right)}); review the price.`,
    );
  }
  return reasons;
}

function combinedPrice(a: ScanResponse, b: ScanResponse) {
  const left = scanPrice(a);
  const right = scanPrice(b);
  if (left && right) return Math.round(((left + right) / 2) * 100) / 100;
  return left || right || null;
}

function preferredScan(a: ScanResponse, b: ScanResponse) {
  const score = (scan: ScanResponse) =>
    Number(scan.ai.confidence || 0) +
    (scan.consensus?.trustedForIdentity ? 1 : 0) +
    (scan.review?.trustedForPricing ? 0.5 : 0) +
    (scan.catalogEvidence?.catalogConfirmed ? 0.25 : 0);
  return score(b) > score(a) ? b : a;
}

function titleFor(scan: ScanResponse, fallback: string) {
  const ai = scan.ai;
  const serial = normalizeInstaCompListingSerial(ai.serialNumber);
  const pieces = [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "Rookie Card" : null,
    ai.parallel && !/^base$/i.test(ai.parallel) ? ai.parallel : null,
    ai.isAuto ? "Autograph" : null,
    ai.isRelic ? "Relic" : null,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    serial,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(pieces)).join(" ") || cleanBase(fallback) || "Sports Card";
}

async function scanPass(row: ListingRow, label: string) {
  const formData = new FormData();
  formData.append("frontImage", row.front);
  if (row.back) formData.append("backImage", row.back);
  formData.append("aiCouncilTier", "courtroom");
  formData.append("accuracyPassLabel", label);
  const response = await fetch("/api/instacomp/scan-fast", {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || data?.message || `${label} failed.`);
  }
  return data as ScanResponse;
}

async function rotateImageFile(file: File, rotation: OrientationRotation) {
  if (rotation === 0) return file;

  const bitmap = await createImageBitmap(file);
  const swapDimensions = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapDimensions ? bitmap.height : bitmap.width;
  canvas.height = swapDimensions ? bitmap.width : bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("The browser could not prepare card image orientation.");
  }

  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("The browser could not encode the upright card image.")),
      file.type || "image/jpeg",
      0.95,
    );
  });

  return new File([blob], file.name, {
    type: blob.type || file.type,
    lastModified: Date.now(),
  });
}

function money(value: number | string | null | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return "—";
  return parsed.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default function CardListingWorkbench() {
  const [rows, setRows] = useState<ListingRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const previewUrls = useRef<Set<string>>(new Set());

  const counts = useMemo(
    () => ({
      total: rows.length,
      needsPairReview: rows.filter((row) => row.back && !row.pairingConfirmed).length,
      ready: rows.filter(
        (row) =>
          row.status === "ready" || row.status === "created_needs_channel_repair",
      ).length,
      created: rows.filter((row) => row.status === "created").length,
      ebayPrepared: rows.filter((row) => row.prepareForEbay).length,
    }),
    [rows],
  );

  function patchRow(id: string, patch: Partial<ListingRow>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  function replacePreview(oldUrl: string | null, file: File | null) {
    if (oldUrl) {
      URL.revokeObjectURL(oldUrl);
      previewUrls.current.delete(oldUrl);
    }
    if (!file) return null;
    const next = URL.createObjectURL(file);
    previewUrls.current.add(next);
    return next;
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase()),
    );
    if (!files.length) {
      setGlobalError("Drop JPEG, PNG, or WebP card images only.");
      return;
    }

    const { pairs, skippedBackOnly } = pairFiles(files);
    const accepted = pairs.slice(0, Math.max(0, MAX_ROWS - rows.length));
    if (!accepted.length) {
      setGlobalError(`This batch is limited to ${MAX_ROWS} cards.`);
      return;
    }

    const now = Date.now();
    const next = accepted.map<ListingRow>((pair, index) => {
      const frontPreview = URL.createObjectURL(pair.front);
      const backPreview = pair.back ? URL.createObjectURL(pair.back) : null;
      previewUrls.current.add(frontPreview);
      if (backPreview) previewUrls.current.add(backPreview);
      return {
        id: `${now}-${index}-${pair.front.name}-${pair.front.size}`,
        clientRequestId: newClientRequestId(),
        front: pair.front,
        back: pair.back,
        frontPreview,
        backPreview,
        pairingMethod: pair.method,
        pairingConfirmed: pair.method === "filename",
        orientationChecked: false,
        orientationReviewReasons: [],
        orientationSummary: null,
        status: "queued",
        passA: null,
        passB: null,
        reviewReasons: [],
        title: "",
        sitePrice: "",
        ebayPrice: "",
        quantity: "1",
        listOnSite: true,
        prepareForEbay: true,
        ebayDescriptionOverride: "",
        manualApproval: false,
        error: null,
        legacyProductId: null,
        editUrl: null,
      };
    });
    setRows((current) => [...current, ...next]);
    setGlobalError(null);
    setNotice(
      `Added ${next.length} card${next.length === 1 ? "" : "s"}. Both TruelyCollectables and eBay are ON by default. Filename-matched pairs are confirmed automatically; upload-order pairs must be visually confirmed before orientation and InstaComp.${skippedBackOnly ? ` Skipped ${skippedBackOnly} back-only image${skippedBackOnly === 1 ? "" : "s"}.` : ""}`,
    );
  }

  function swapSides(row: ListingRow) {
    if (!row.back || !row.backPreview || row.legacyProductId) return;
    patchRow(row.id, {
      front: row.back,
      back: row.front,
      frontPreview: row.backPreview,
      backPreview: row.frontPreview,
      pairingMethod: "manual_swap",
      pairingConfirmed: true,
      orientationChecked: false,
      orientationReviewReasons: [],
      orientationSummary: null,
      status: "queued",
      passA: null,
      passB: null,
      reviewReasons: [],
      title: "",
      sitePrice: "",
      ebayPrice: "",
      manualApproval: false,
      error: null,
    });
  }

  function confirmPair(row: ListingRow) {
    patchRow(row.id, {
      pairingConfirmed: true,
      error: null,
    });
  }

  async function normalizeRowOrientation(row: ListingRow): Promise<ListingRow> {
    if (row.orientationChecked) return row;

    const formData = new FormData();
    formData.append("frontImage", row.front);
    if (row.back) formData.append("backImage", row.back);
    const response = await fetch("/api/instacomp/orient", {
      method: "POST",
      body: formData,
    });
    const data = (await response.json().catch(() => ({}))) as OrientationResponse;
    if (!response.ok || !data.ok || !data.orientation) {
      throw new Error(data.error || "Automatic card orientation failed.");
    }

    const orientation = data.orientation;
    let front = row.front;
    let back = row.back;
    let frontPreview = row.frontPreview;
    let backPreview = row.backPreview;

    if (orientation.status === "completed") {
      const nextFront = await rotateImageFile(row.front, orientation.frontRotation);
      if (nextFront !== row.front) {
        front = nextFront;
        frontPreview = replacePreview(row.frontPreview, nextFront) || row.frontPreview;
      }

      if (row.back) {
        const nextBack = await rotateImageFile(row.back, orientation.backRotation);
        if (nextBack !== row.back) {
          back = nextBack;
          backPreview = replacePreview(row.backPreview, nextBack);
        }
      }
    }

    const orientationSummary =
      orientation.status === "completed"
        ? `Text orientation: front ${orientation.frontRotation}° (${Math.round(
            orientation.frontConfidence * 100,
          )}%)${row.back ? ` · back ${orientation.backRotation}° (${Math.round(orientation.backConfidence * 100)}%)` : ""}`
        : `Text orientation needs review: ${orientation.reason}`;
    const orientationReviewReasons = data.reviewReasons || [];

    patchRow(row.id, {
      front,
      back,
      frontPreview,
      backPreview,
      orientationChecked: true,
      orientationReviewReasons,
      orientationSummary,
    });

    return {
      ...row,
      front,
      back,
      frontPreview,
      backPreview,
      orientationChecked: true,
      orientationReviewReasons,
      orientationSummary,
      status: "scanning",
    };
  }

  async function scanOne(row: ListingRow) {
    if (row.legacyProductId) return;
    if (!row.back) {
      patchRow(row.id, { status: "error", error: "Add a back image before InstaComp." });
      return;
    }
    if (!row.pairingConfirmed) {
      patchRow(row.id, {
        status: "error",
        error: "Confirm or swap this upload-order front/back pair before InstaComp.",
      });
      return;
    }

    patchRow(row.id, {
      status: "scanning",
      error: null,
      passA: null,
      passB: null,
      reviewReasons: [],
      manualApproval: false,
    });

    try {
      const scanRow = await normalizeRowOrientation(row);
      const [passA, passB] = await Promise.all([
        scanPass(scanRow, "Listing council A"),
        scanPass(scanRow, "Listing council B"),
      ]);
      const disagreements = criticalDisagreements(passA, passB);
      const reasons = [
        ...scanRow.orientationReviewReasons,
        ...disagreements,
        ...pricingReviewReasons(passA, passB),
        ...(passA.consensus?.trustedForIdentity === false
          ? ["Council A did not trust the exact-card identity."]
          : []),
        ...(passB.consensus?.trustedForIdentity === false
          ? ["Council B did not trust the exact-card identity."]
          : []),
        ...(passA.review?.trustedForPricing === false
          ? ["Council A did not trust the pricing match."]
          : []),
        ...(passB.review?.trustedForPricing === false
          ? ["Council B did not trust the pricing match."]
          : []),
        ...(passA.catalogEvidence?.catalogConfirmed === false
          ? ["Council A could not confirm the exact checklist/catalog match."]
          : []),
        ...(passB.catalogEvidence?.catalogConfirmed === false
          ? ["Council B could not confirm the exact checklist/catalog match."]
          : []),
        ...(Number(passA.ai.confidence || 0) < 0.7
          ? ["Council A exact-card confidence is below 70%."]
          : []),
        ...(Number(passB.ai.confidence || 0) < 0.7
          ? ["Council B exact-card confidence is below 70%."]
          : []),
      ];
      const uniqueReasons = Array.from(new Set(reasons));
      const preferred = preferredScan(passA, passB);
      const suggested = combinedPrice(passA, passB);
      const sitePrice = suggested ? suggested.toFixed(2) : "";
      patchRow(row.id, {
        status: "ready",
        passA,
        passB,
        reviewReasons: uniqueReasons,
        title: titleFor(preferred, scanRow.front.name),
        sitePrice,
        ebayPrice: suggested ? recommendedEbayPrice(suggested).toFixed(2) : "",
        error: null,
      });
    } catch (error) {
      patchRow(row.id, {
        status: "error",
        error: error instanceof Error ? error.message : "InstaComp failed.",
      });
    }
  }

  async function scanConfirmedRows() {
    if (scanning || creating) return;
    const targets = rows.filter(
      (row) =>
        !row.legacyProductId &&
        row.back &&
        row.pairingConfirmed &&
        (row.status === "queued" || row.status === "error"),
    );
    if (!targets.length) {
      setGlobalError("No confirmed front/back pairs are waiting for InstaComp.");
      return;
    }
    setScanning(true);
    setGlobalError(null);
    setNotice(
      `Orienting and running two independent InstaComp councils on ${targets.length} confirmed card${targets.length === 1 ? "" : "s"}.`,
    );
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor++];
        await scanOne(row);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(SCAN_CONCURRENCY, targets.length) }, () => worker()),
    );
    setScanning(false);
    setNotice(
      "Orientation + InstaComp finished. Clean rows are ready; amber rows are blocked until you review them.",
    );
  }

  function buildQuickListFormData(row: ListingRow, sitePrice: number, quantity: number) {
    if (!row.passA || !row.passB) {
      throw new Error("Two InstaComp passes are required before inventory creation.");
    }
    const preferred = preferredScan(row.passA, row.passB);
    const formData = new FormData();
    formData.append("clientRequestId", row.clientRequestId);
    formData.append("frontImage", row.front);
    if (row.back) formData.append("backImage", row.back);
    formData.append("title", row.title.trim());
    formData.append("player", preferred.ai.player || "");
    formData.append("sport", preferred.ai.sport || "Sports Cards");
    formData.append("condition", preferred.ai.conditionGuess || "Near Mint or Better");
    formData.append(
      "serialNumber",
      normalizeInstaCompListingSerial(preferred.ai.serialNumber) || "",
    );
    formData.append("price", sitePrice.toFixed(2));
    formData.append("quantity", String(quantity));
    formData.append("scanId", preferred.scanId || "");
    formData.append(
      "scanMetadata",
      JSON.stringify({
        schema: "truely.cardListingWorkbench.v2",
        clientRequestId: row.clientRequestId,
        pairingMethod: row.pairingMethod,
        pairingConfirmed: row.pairingConfirmed,
        orientationChecked: row.orientationChecked,
        orientationSummary: row.orientationSummary,
        orientationReviewReasons: row.orientationReviewReasons,
        reviewReasons: row.reviewReasons,
        manualApproval: row.manualApproval,
        passA: {
          scanId: row.passA.scanId,
          ai: row.passA.ai,
          stats: row.passA.stats,
          soldStats: row.passA.soldStats,
          review: row.passA.review,
          consensus: row.passA.consensus,
          catalogEvidence: row.passA.catalogEvidence,
        },
        passB: {
          scanId: row.passB.scanId,
          ai: row.passB.ai,
          stats: row.passB.stats,
          soldStats: row.passB.soldStats,
          review: row.passB.review,
          consensus: row.passB.consensus,
          catalogEvidence: row.passB.catalogEvidence,
        },
      }),
    );
    return formData;
  }

  async function createOrRecoverDraft(row: ListingRow, sitePrice: number, quantity: number) {
    let lastError = "Could not create inventory draft.";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("/api/admin/quick-list", {
        method: "POST",
        body: buildQuickListFormData(row, sitePrice, quantity),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.success) return data;
      lastError = data?.error || lastError;
      if (attempt === 0 && response.status >= 500) continue;
      break;
    }
    throw new Error(lastError);
  }

  async function createOne(row: ListingRow) {
    if (
      !row.passA ||
      !row.passB ||
      (row.status !== "ready" && row.status !== "created_needs_channel_repair")
    ) {
      return false;
    }
    if (row.reviewReasons.length > 0 && !row.manualApproval) {
      patchRow(row.id, {
        error:
          "This row has identity, orientation, or pricing concerns. Review it and approve the row before creating inventory.",
      });
      return false;
    }

    const sitePrice = Number(row.sitePrice);
    const ebayPrice = Number(row.ebayPrice);
    const quantity = Number(row.quantity);
    if (!(sitePrice > 0) || !Number.isInteger(quantity) || quantity < 1) {
      patchRow(row.id, { error: "Enter a valid site price and whole-number quantity." });
      return false;
    }
    if (row.prepareForEbay && row.listOnSite && !(ebayPrice > sitePrice)) {
      patchRow(row.id, {
        error:
          "For a card prepared for both channels, the eBay price must be higher than the TruelyCollectables price.",
      });
      return false;
    }

    let legacyProductId = row.legacyProductId;
    let editUrl = row.editUrl;
    patchRow(row.id, { status: "creating", error: null });

    try {
      if (!legacyProductId) {
        const data = await createOrRecoverDraft(row, sitePrice, quantity);
        const returnedProductId = Number(data?.draft?.legacyProductId);
        if (!Number.isInteger(returnedProductId) || returnedProductId <= 0) {
          throw new Error("Quick List returned an invalid product ID.");
        }
        legacyProductId = returnedProductId;
        editUrl = String(
          data?.draft?.editUrl || `/admin/products/${returnedProductId}`,
        );

        // Persist the product ID immediately. Every failure after this point is a
        // channel repair, never permission to call Quick List and create again.
        patchRow(row.id, {
          legacyProductId,
          editUrl,
          status: "creating",
          error: null,
        });
      }

      const saveResponse = await fetch("/api/admin/ebay/inventory-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_settings",
          legacyProductId,
          preparedForEbay: row.prepareForEbay,
          sitePrice,
          ebayPrice: ebayPrice > 0 ? ebayPrice : recommendedEbayPrice(sitePrice),
          ebayTitle: row.title.slice(0, 80),
          ebayDescriptionOverride: row.ebayDescriptionOverride,
          format: "FIXED_PRICE",
        }),
      });
      const saveData = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !saveData?.ok) {
        throw new Error(
          saveData?.error || "Inventory exists but channel settings could not be saved.",
        );
      }

      if (row.listOnSite) {
        const siteResponse = await fetch("/api/admin/ebay/inventory-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "set_site_active",
            legacyProductId,
          }),
        });
        const siteData = await siteResponse.json().catch(() => ({}));
        if (!siteResponse.ok || !siteData?.ok) {
          throw new Error(
            siteData?.error || "Inventory exists but could not be made live on the site.",
          );
        }
      }

      patchRow(row.id, {
        status: "created",
        legacyProductId,
        editUrl: editUrl || `/admin/products/${legacyProductId}`,
        error: null,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Inventory creation failed.";
      if (legacyProductId) {
        patchRow(row.id, {
          status: "created_needs_channel_repair",
          legacyProductId,
          editUrl: editUrl || `/admin/products/${legacyProductId}`,
          error: `Inventory #${legacyProductId} already exists. Retry repairs this same card only; it will not create a duplicate. ${message}`,
        });
      } else {
        patchRow(row.id, {
          status: "ready",
          error: message,
        });
      }
      return false;
    }
  }

  async function createReadyRows() {
    if (creating || scanning) return;
    const targets = rows.filter(
      (row) =>
        (row.status === "ready" || row.status === "created_needs_channel_repair") &&
        row.passA &&
        row.passB &&
        (row.reviewReasons.length === 0 || row.manualApproval),
    );
    if (!targets.length) {
      setGlobalError("No reviewed, priced rows are ready to create or repair.");
      return;
    }
    setCreating(true);
    setGlobalError(null);
    let cursor = 0;
    let completedCount = 0;
    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor++];
        if (await createOne(row)) completedCount += 1;
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CREATE_CONCURRENCY, targets.length) }, () => worker()),
    );
    setCreating(false);
    setNotice(
      `${completedCount}/${targets.length} reviewed card${targets.length === 1 ? "" : "s"} created/repaired. eBay-prepared cards are waiting in the channel manager; nothing was sent live to eBay automatically.`,
    );
  }

  function removeRow(row: ListingRow) {
    URL.revokeObjectURL(row.frontPreview);
    previewUrls.current.delete(row.frontPreview);
    if (row.backPreview) {
      URL.revokeObjectURL(row.backPreview);
      previewUrls.current.delete(row.backPreview);
    }
    setRows((current) => current.filter((value) => value.id !== row.id));
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Cards" value={counts.total} />
        <Metric label="Pair review" value={counts.needsPairReview} tone="amber" />
        <Metric label="Ready / repair" value={counts.ready} tone="violet" />
        <Metric label="Inventory created" value={counts.created} tone="green" />
        <Metric label="eBay prepared" value={counts.ebayPrepared} tone="blue" />
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={`rounded-3xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging
              ? "border-violet-600 bg-violet-50"
              : "border-neutral-300 bg-neutral-50"
          }`}
        >
          <p className="text-2xl font-black">Drop multiple front + back card images</p>
          <p className="mx-auto mt-2 max-w-4xl text-sm font-semibold leading-6 text-neutral-600">
            Safest filenames are card-001-front.jpg and card-001-back.jpg. Unnamed files are blocked until you confirm front/back. Before InstaComp, the text-orientation referee checks 0°/90°/180°/270° and the browser permanently rotates the files upright. Both TruelyCollectables and eBay are selected by default; eBay still requires a separate live-publish confirmation.
          </p>
          <label className="mt-5 inline-flex cursor-pointer rounded-xl bg-neutral-950 px-6 py-3 text-sm font-black text-white hover:bg-neutral-800">
            Choose card images
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={scanning || creating || !rows.length}
            onClick={() => void scanConfirmedRows()}
            className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {scanning ? "Orientation + InstaComp running…" : "Orient + InstaComp confirmed cards"}
          </button>
          <button
            type="button"
            disabled={scanning || creating || !rows.length}
            onClick={() => void createReadyRows()}
            className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:opacity-40"
          >
            {creating ? "Creating / repairing inventory…" : "Create reviewed listings"}
          </button>
          <a
            href="/admin/ebay/publish"
            className="rounded-xl border border-neutral-300 bg-white px-5 py-3 text-sm font-black"
          >
            eBay channel manager
          </a>
        </div>
        {notice ? (
          <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {notice}
          </p>
        ) : null}
        {globalError ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
            {globalError}
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        {rows.map((row, index) => {
          const suggested =
            row.passA && row.passB ? combinedPrice(row.passA, row.passB) : null;
          const needsReview = row.reviewReasons.length > 0;
          const busy = row.status === "scanning" || row.status === "creating";
          const locked = Boolean(row.legacyProductId);
          const sitePrice = Number(row.sitePrice);
          const ebayPrice = Number(row.ebayPrice);
          const directAdvantage =
            row.prepareForEbay && row.listOnSite && sitePrice > 0 && ebayPrice > sitePrice;
          const canCreate =
            row.status === "ready" || row.status === "created_needs_channel_repair";

          return (
            <article
              key={row.id}
              className={`rounded-3xl border bg-white p-5 shadow-sm ${
                !row.pairingConfirmed && row.back
                  ? "border-amber-300"
                  : needsReview || row.status === "created_needs_channel_repair"
                    ? "border-amber-300"
                    : row.status === "created"
                      ? "border-emerald-300"
                      : "border-neutral-200"
              }`}
            >
              <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)_340px]">
                <div>
                  <div className="grid grid-cols-2 gap-2">
                    <ImagePreview src={row.frontPreview} label="Front" />
                    {row.backPreview ? (
                      <ImagePreview src={row.backPreview} label="Back" />
                    ) : (
                      <div className="flex aspect-[5/7] items-center justify-center rounded-xl border border-dashed border-red-300 bg-red-50 p-3 text-center text-xs font-black text-red-900">
                        Back image required
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-center text-xs font-bold text-neutral-500">
                    Row {index + 1} · {row.pairingMethod.replaceAll("_", " ")}
                  </p>
                  {row.orientationSummary ? (
                    <p className="mt-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-center text-[11px] font-bold text-neutral-700">
                      {row.orientationSummary}
                    </p>
                  ) : null}
                  {row.back ? (
                    <div className="mt-3 grid gap-2">
                      <button
                        type="button"
                        disabled={busy || locked}
                        onClick={() => swapSides(row)}
                        className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-xs font-black text-violet-950 disabled:opacity-40"
                      >
                        Swap Front ↔ Back
                      </button>
                      {!row.pairingConfirmed ? (
                        <button
                          type="button"
                          disabled={busy || locked}
                          onClick={() => confirmPair(row)}
                          className="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-neutral-950 disabled:opacity-40"
                        >
                          Confirm this front/back pair
                        </button>
                      ) : (
                        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-black text-emerald-950">
                          Pair confirmed
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={row.status} />
                    {needsReview ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-950">
                        Human review required
                      </span>
                    ) : row.passA && row.passB ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-950">
                        Two passes agree
                      </span>
                    ) : null}
                  </div>

                  <label className="mt-3 block text-xs font-black uppercase tracking-wide text-neutral-500">
                    Listing title
                    <input
                      value={row.title}
                      disabled={!row.passA || locked}
                      onChange={(event) => patchRow(row.id, { title: event.target.value })}
                      placeholder="InstaComp title appears after both passes"
                      className="mt-1 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-black normal-case tracking-normal disabled:bg-neutral-100"
                    />
                  </label>

                  {row.passA && row.passB ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <Fact label="Player" value={preferredScan(row.passA, row.passB).ai.player} />
                      <Fact label="Set" value={preferredScan(row.passA, row.passB).ai.setName} />
                      <Fact label="Card #" value={preferredScan(row.passA, row.passB).ai.cardNumber} />
                      <Fact label="InstaComp" value={money(suggested)} />
                    </div>
                  ) : null}

                  {needsReview ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
                      <p className="font-black">Review before listing</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {row.reviewReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      <label className="mt-3 flex items-start gap-2 text-xs font-black">
                        <input
                          type="checkbox"
                          checked={row.manualApproval}
                          disabled={locked}
                          onChange={(event) =>
                            patchRow(row.id, { manualApproval: event.target.checked })
                          }
                        />
                        I checked the physical card, image orientation, identity, and price and approve this row despite the warning.
                      </label>
                    </div>
                  ) : null}

                  <details className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                    <summary className="cursor-pointer text-sm font-black">
                      Optional eBay-only description
                    </summary>
                    <p className="mt-2 text-xs font-semibold text-neutral-600">
                      Leave blank and eBay will use the TruelyCollectables description. Add text only when this card needs different eBay wording.
                    </p>
                    <textarea
                      rows={6}
                      value={row.ebayDescriptionOverride}
                      disabled={locked}
                      onChange={(event) =>
                        patchRow(row.id, {
                          ebayDescriptionOverride: event.target.value,
                        })
                      }
                      className="mt-3 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-sm font-semibold disabled:bg-neutral-100"
                    />
                  </details>

                  {row.error ? (
                    <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
                      {row.error}
                    </p>
                  ) : null}

                  {row.legacyProductId ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <a
                        href={row.editUrl || `/admin/products/${row.legacyProductId}`}
                        className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-black"
                      >
                        Edit inventory
                      </a>
                      {row.prepareForEbay ? (
                        <a
                          href={`/admin/ebay/publish?product=${row.legacyProductId}`}
                          className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white"
                        >
                          Review / publish on eBay
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
                    Where should this card sell?
                  </p>
                  <label className="mt-3 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-black text-sky-950">
                    <input
                      type="checkbox"
                      checked={row.listOnSite}
                      disabled={locked}
                      onChange={(event) => patchRow(row.id, { listOnSite: event.target.checked })}
                    />
                    List on TruelyCollectables
                  </label>
                  <label className="mt-2 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs font-black text-violet-950">
                    <input
                      type="checkbox"
                      checked={row.prepareForEbay}
                      disabled={locked}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        const currentSite = Number(row.sitePrice);
                        patchRow(row.id, {
                          prepareForEbay: checked,
                          ebayPrice:
                            checked && currentSite > 0 && !Number(row.ebayPrice)
                              ? recommendedEbayPrice(currentSite).toFixed(2)
                              : row.ebayPrice,
                        });
                      }}
                    />
                    Prepare for eBay too — live publish still requires confirmation
                  </label>

                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <label className="text-xs font-black text-neutral-600">
                      Site price
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.sitePrice}
                        disabled={!row.passA || locked}
                        onChange={(event) => {
                          const value = event.target.value;
                          const parsed = Number(value);
                          patchRow(row.id, {
                            sitePrice: value,
                            ebayPrice:
                              row.prepareForEbay && parsed > 0
                                ? recommendedEbayPrice(parsed).toFixed(2)
                                : row.ebayPrice,
                          });
                        }}
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-lg font-black disabled:bg-neutral-100"
                      />
                    </label>
                    <label className="text-xs font-black text-neutral-600">
                      eBay price
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.ebayPrice}
                        disabled={!row.prepareForEbay || locked}
                        onChange={(event) => patchRow(row.id, { ebayPrice: event.target.value })}
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 text-lg font-black disabled:bg-neutral-100"
                      />
                    </label>
                  </div>
                  {row.prepareForEbay && row.listOnSite ? (
                    <p
                      className={`mt-3 rounded-xl border px-3 py-2 text-xs font-black ${
                        directAdvantage
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-red-200 bg-red-50 text-red-950"
                      }`}
                    >
                      {directAdvantage
                        ? `Direct customers save ${money(ebayPrice - sitePrice)} versus eBay.`
                        : "eBay must be priced above the site before this both-channel row can be created."}
                    </p>
                  ) : null}

                  <label className="mt-3 block text-xs font-black text-neutral-600">
                    Quantity
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={row.quantity}
                      disabled={locked}
                      onChange={(event) => patchRow(row.id, { quantity: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-black disabled:bg-neutral-100"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={busy || locked || !row.back || !row.pairingConfirmed}
                    onClick={() => void scanOne(row)}
                    className="mt-4 w-full rounded-xl border border-violet-300 bg-violet-50 px-4 py-3 text-sm font-black text-violet-950 disabled:opacity-40"
                  >
                    {row.status === "scanning"
                      ? "Orientation + InstaComp running…"
                      : "Run orientation + InstaComp again"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !canCreate || (needsReview && !row.manualApproval)}
                    onClick={() => void createOne(row)}
                    className="mt-2 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
                  >
                    {row.status === "creating"
                      ? "Creating / repairing…"
                      : row.status === "created_needs_channel_repair"
                        ? "Repair this listing — no duplicate"
                        : "Create this listing"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeRow(row)}
                    className="mt-2 w-full rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-black text-red-800 disabled:opacity-40"
                  >
                    Remove row
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function ImagePreview({ src, label }: { src: string; label: string }) {
  return (
    <div className="relative aspect-[5/7] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
      {/* Local object URLs are intentionally displayed without Next image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="h-full w-full object-contain" />
      <span className="absolute bottom-1 left-1 rounded bg-black/75 px-2 py-1 text-[10px] font-black uppercase text-white">
        {label}
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "amber" | "violet" | "green" | "blue";
}) {
  const tones = {
    neutral: "border-neutral-200 bg-white",
    amber: "border-amber-200 bg-amber-50",
    violet: "border-violet-200 bg-violet-50",
    green: "border-emerald-200 bg-emerald-50",
    blue: "border-blue-200 bg-blue-50",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const label: Record<RowStatus, string> = {
    queued: "Waiting for orientation + InstaComp",
    scanning: "Orienting + two passes scanning",
    ready: "Review ready",
    creating: "Creating / repairing inventory",
    created: "Created",
    created_needs_channel_repair: "Created · channel repair needed",
    error: "Needs attention",
  };
  return (
    <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-black text-neutral-800">
      {label[status]}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 truncate text-sm font-black">{value || "—"}</p>
    </div>
  );
}
