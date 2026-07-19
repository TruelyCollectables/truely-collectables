"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { normalizeInstaCompListingSerial } from "../../../lib/instacomp-listing-serial";

type QuickAiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  certificationNumber?: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

type QuickScanResponse = {
  ok: boolean;
  scanId: string | null;
  ai: QuickAiResult;
  searchQuery: string;
  stats: {
    low: number | null;
    median: number | null;
    average: number | null;
    high: number | null;
    suggestedPrice: number | null;
  };
  soldStats: {
    low: number | null;
    median: number | null;
    average: number | null;
    high: number | null;
    suggestedPrice: number | null;
  };
  review?: {
    status: "trusted_for_pricing" | "review_required";
    trustedForPricing: boolean;
    reviewReasons: string[];
    identityReviewReasons: string[];
    pricingReviewReasons: string[];
  };
  consensus?: {
    status: "consensus_confirmed" | "review_required";
    trustedForIdentity: boolean;
    reviewReasons: string[];
  };
  ocrDiagnostics?: {
    speedLane?: "fast_lane" | "escalated_multi_ai" | null;
    extractedSerialNumber?: string | null;
  };
};

type RowStatus =
  | "queued"
  | "scanning"
  | "ready"
  | "drafting"
  | "created"
  | "error";

type QuickListRow = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  pairingMethod: "filename" | "upload_order" | "front_only";
  status: RowStatus;
  result: QuickScanResponse | null;
  title: string;
  rawSerial: string | null;
  listingSerial: string | null;
  suggestedPrice: number | null;
  price: string;
  quantity: string;
  error: string | null;
  legacyProductId: number | null;
  editUrl: string | null;
  elapsedMs: number | null;
};

type ImageSide = "front" | "back" | "unknown";

type ImageCandidate = {
  file: File;
  side: ImageSide;
  key: string;
  index: number;
};

type ImagePair = {
  front: File;
  back: File | null;
  pairingMethod: QuickListRow["pairingMethod"];
};

const MAX_QUICK_LIST_ROWS = 100;
const SCAN_CONCURRENCY = 4;
const DRAFT_CONCURRENCY = 3;
const CONFIDENCE_REVIEW_THRESHOLD = 0.85;

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
}

function cleanFileBase(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function classifyImage(file: File, index: number): ImageCandidate {
  const base = cleanFileBase(file.name);
  const frontMatch = base.match(/^(.*?)(?:[-_.\s]+)(front|obverse|f)$/i);
  const backMatch = base.match(/^(.*?)(?:[-_.\s]+)(back|reverse|b)$/i);

  if (frontMatch) {
    return {
      file,
      side: "front",
      key: frontMatch[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }

  if (backMatch) {
    return {
      file,
      side: "back",
      key: backMatch[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }

  return {
    file,
    side: "unknown",
    key: `unknown-${index}`,
    index,
  };
}

function pairImages(files: File[]): {
  pairs: ImagePair[];
  skippedBackOnly: number;
  pairedByOrder: number;
} {
  const candidates = files.map(classifyImage);
  const namedGroups = new Map<
    string,
    { fronts: ImageCandidate[]; backs: ImageCandidate[] }
  >();
  const unknown: ImageCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.side === "unknown") {
      unknown.push(candidate);
      continue;
    }

    const group = namedGroups.get(candidate.key) || { fronts: [], backs: [] };
    group[candidate.side === "front" ? "fronts" : "backs"].push(candidate);
    namedGroups.set(candidate.key, group);
  }

  const pairs: Array<ImagePair & { index: number }> = [];
  let skippedBackOnly = 0;

  for (const group of namedGroups.values()) {
    group.fronts.sort((left, right) => left.index - right.index);
    group.backs.sort((left, right) => left.index - right.index);

    group.fronts.forEach((front, index) => {
      const back = group.backs[index] || null;
      pairs.push({
        front: front.file,
        back: back?.file || null,
        pairingMethod: back ? "filename" : "front_only",
        index: Math.min(front.index, back?.index ?? front.index),
      });
    });

    skippedBackOnly += Math.max(0, group.backs.length - group.fronts.length);
  }

  unknown.sort((left, right) => left.index - right.index);
  let pairedByOrder = 0;

  for (let index = 0; index < unknown.length; index += 2) {
    const front = unknown[index];
    const back = unknown[index + 1] || null;
    if (back) pairedByOrder += 1;

    pairs.push({
      front: front.file,
      back: back?.file || null,
      pairingMethod: back ? "upload_order" : "front_only",
      index: front.index,
    });
  }

  return {
    pairs: pairs
      .sort((left, right) => left.index - right.index)
      .map(({ index: _index, ...pair }) => pair),
    skippedBackOnly,
    pairedByOrder,
  };
}

function stripExactSerial(value: string | null | undefined) {
  return String(value || "")
    .replace(/(?:#\s*)?\d+\s*(?:\/|\bof\b)\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function quickListingTitle(result: QuickScanResponse, fallbackName: string) {
  const ai = result.ai;
  const listingSerial = normalizeInstaCompListingSerial(ai.serialNumber);
  const parallel = stripExactSerial(ai.parallel);
  const parts = uniqueParts([
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "Rookie Card" : null,
    parallel && !/^base$/i.test(parallel) ? parallel : null,
    ai.isAuto ? "Autograph" : null,
    ai.isRelic ? "Relic" : null,
    ai.gradingCompany && ai.gradeValue
      ? `${ai.gradingCompany} ${ai.gradeValue}`
      : ai.gradingCompany,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    listingSerial,
  ]);

  return parts.join(" ") || cleanFileBase(fallbackName) || "Unidentified Sports Card";
}

function suggestedPrice(result: QuickScanResponse) {
  const candidates = [
    result.stats?.suggestedPrice,
    result.soldStats?.suggestedPrice,
    result.stats?.median,
    result.soldStats?.median,
  ];

  return (
    candidates.find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    ) || null
  );
}

function needsReview(row: QuickListRow) {
  return Boolean(
    row.result &&
      (row.result.review?.trustedForPricing === false ||
        row.result.consensus?.trustedForIdentity === false ||
        Number(row.result.ai.confidence || 0) < CONFIDENCE_REVIEW_THRESHOLD ||
        !row.back),
  );
}

function priceWithMultiplier(value: number | null, multiplier: number) {
  if (!value) return "";
  return (Math.round(value * multiplier * 100) / 100).toFixed(2);
}

export default function QuickListWorkbench() {
  const [rows, setRows] = useState<QuickListRow[]>([]);
  const [autoScan, setAutoScan] = useState(true);
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const draftingRef = useRef(false);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const counts = useMemo(
    () => ({
      total: rows.length,
      queued: rows.filter((row) => row.status === "queued").length,
      scanning: rows.filter((row) => row.status === "scanning").length,
      ready: rows.filter((row) => row.status === "ready").length,
      review: rows.filter(needsReview).length,
      created: rows.filter((row) => row.status === "created").length,
      errors: rows.filter((row) => row.status === "error").length,
    }),
    [rows],
  );

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (!autoScan || running || drafting || !rows.some((row) => row.status === "queued")) {
      return;
    }

    const timer = window.setTimeout(() => void scanQueuedRows(), 120);
    return () => window.clearTimeout(timer);
  }, [autoScan, drafting, rows, running]);

  function updateRow(
    rowId: string,
    updater: (row: QuickListRow) => QuickListRow,
  ) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? updater(row) : row)),
    );
  }

  function addFiles(fileList: FileList | File[]) {
    const imageFiles = Array.from(fileList).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );

    if (!imageFiles.length) {
      setGlobalError("Drop JPEG, PNG, or WebP card images only.");
      return;
    }

    const { pairs, skippedBackOnly, pairedByOrder } = pairImages(imageFiles);
    const acceptedPairs = pairs.slice(0, Math.max(0, MAX_QUICK_LIST_ROWS - rows.length));

    if (!acceptedPairs.length) {
      setGlobalError(`Quick List holds up to ${MAX_QUICK_LIST_ROWS} cards at once.`);
      return;
    }

    const now = Date.now();
    const nextRows = acceptedPairs.map<QuickListRow>((pair, index) => {
      const frontPreview = URL.createObjectURL(pair.front);
      const backPreview = pair.back ? URL.createObjectURL(pair.back) : null;
      previewUrlsRef.current.add(frontPreview);
      if (backPreview) previewUrlsRef.current.add(backPreview);

      return {
        id: `${now}-${index}-${pair.front.name}-${pair.front.size}`,
        front: pair.front,
        back: pair.back,
        frontPreview,
        backPreview,
        pairingMethod: pair.pairingMethod,
        status: "queued",
        result: null,
        title: "",
        rawSerial: null,
        listingSerial: null,
        suggestedPrice: null,
        price: "",
        quantity: "1",
        error: null,
        legacyProductId: null,
        editUrl: null,
        elapsedMs: null,
      };
    });

    setRows((current) => [...current, ...nextRows]);
    setGlobalError(null);
    setNotice(
      [
        `Added ${nextRows.length} card${nextRows.length === 1 ? "" : "s"}.`,
        pairedByOrder
          ? `Paired ${pairedByOrder} by upload order; use front then back.`
          : null,
        skippedBackOnly
          ? `Skipped ${skippedBackOnly} back-only image${skippedBackOnly === 1 ? "" : "s"}.`
          : null,
        autoScan ? "AI identification and InstaComp™ will start automatically." : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  async function scanRow(row: QuickListRow) {
    const startedAt = performance.now();
    updateRow(row.id, (current) => ({
      ...current,
      status: "scanning",
      error: null,
      elapsedMs: null,
    }));

    try {
      const formData = new FormData();
      formData.append("frontImage", row.front);
      if (row.back) formData.append("backImage", row.back);
      formData.append("aiCouncilTier", "adaptive");

      const response = await fetch("/api/instacomp/scan", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => ({}))) as
        | QuickScanResponse
        | { error?: string; message?: string };

      if (!response.ok || !(data as QuickScanResponse).ok) {
        throw new Error(
          (data as { error?: string; message?: string }).error ||
            (data as { error?: string; message?: string }).message ||
            "InstaComp™ could not identify this card.",
        );
      }

      const result = data as QuickScanResponse;
      const marketPrice = suggestedPrice(result);
      const rawSerial = result.ai.serialNumber || null;
      const listingSerial = normalizeInstaCompListingSerial(rawSerial);

      updateRow(row.id, (current) => ({
        ...current,
        status: "ready",
        result: {
          ...result,
          ai: {
            ...result.ai,
            serialNumber: listingSerial,
          },
        },
        title: quickListingTitle(result, row.front.name),
        rawSerial,
        listingSerial,
        suggestedPrice: marketPrice,
        price: marketPrice ? marketPrice.toFixed(2) : current.price,
        error: null,
        elapsedMs: Math.round(performance.now() - startedAt),
      }));
    } catch (error: any) {
      updateRow(row.id, (current) => ({
        ...current,
        status: "error",
        error: error?.message || "InstaComp™ scan failed.",
        elapsedMs: Math.round(performance.now() - startedAt),
      }));
    }
  }

  async function scanQueuedRows(rowIds?: Set<string>) {
    if (runningRef.current || draftingRef.current) return;

    const targets = rows.filter(
      (row) =>
        (row.status === "queued" || row.status === "error") &&
        (!rowIds || rowIds.has(row.id)),
    );

    if (!targets.length) {
      setGlobalError("No queued or failed card rows are waiting to scan.");
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setGlobalError(null);
    setNotice(
      `Scanning ${targets.length} card${targets.length === 1 ? "" : "s"} with ${Math.min(
        SCAN_CONCURRENCY,
        targets.length,
      )} parallel InstaComp™ workers...`,
    );
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
        await scanRow(target);
      }
    }

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(SCAN_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      setNotice("AI identification and InstaComp™ pricing finished. Review the rows, adjust price if needed, then create drafts.");
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function createDraft(row: QuickListRow) {
    const price = Number(row.price);

    if (!row.result || row.status !== "ready") return;
    if (!Number.isFinite(price) || price <= 0) {
      updateRow(row.id, (current) => ({
        ...current,
        error: "Enter a price greater than zero before creating the draft.",
      }));
      return;
    }

    updateRow(row.id, (current) => ({
      ...current,
      status: "drafting",
      error: null,
    }));

    try {
      const formData = new FormData();
      formData.append("frontImage", row.front);
      if (row.back) formData.append("backImage", row.back);
      formData.append("title", row.title.trim());
      formData.append("player", row.result.ai.player || "");
      formData.append("sport", row.result.ai.sport || "Sports Cards");
      formData.append("condition", row.result.ai.conditionGuess || "Near Mint or Better");
      formData.append("serialNumber", row.listingSerial || "");
      formData.append("price", price.toFixed(2));
      formData.append("quantity", row.quantity || "1");
      formData.append("scanId", row.result.scanId || "");
      formData.append(
        "scanMetadata",
        JSON.stringify({
          schema: "truely.quickListScan.v1",
          ai: {
            ...row.result.ai,
            serialNumber: row.listingSerial,
          },
          rawSerialNumber: row.rawSerial,
          normalizedSerialNumber: row.listingSerial,
          stats: row.result.stats,
          soldStats: row.result.soldStats,
          review: row.result.review || null,
          consensusStatus: row.result.consensus?.status || null,
          searchQuery: row.result.searchQuery,
          elapsedMs: row.elapsedMs,
          pairingMethod: row.pairingMethod,
        }),
      );

      const response = await fetch("/api/admin/quick-list", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Quick List could not create this draft.");
      }

      updateRow(row.id, (current) => ({
        ...current,
        status: "created",
        error: null,
        legacyProductId: Number(data.draft.legacyProductId),
        editUrl: String(data.draft.editUrl || ""),
      }));
    } catch (error: any) {
      updateRow(row.id, (current) => ({
        ...current,
        status: "ready",
        error: error?.message || "Quick List draft creation failed.",
      }));
    }
  }

  async function createReadyDrafts() {
    if (runningRef.current || draftingRef.current) return;

    const targets = rows.filter(
      (row) =>
        row.status === "ready" &&
        row.result &&
        row.title.trim() &&
        Number.isFinite(Number(row.price)) &&
        Number(row.price) > 0,
    );

    if (!targets.length) {
      setGlobalError("No scanned rows with a positive price are ready to draft.");
      return;
    }

    draftingRef.current = true;
    setDrafting(true);
    setGlobalError(null);
    setNotice(`Creating ${targets.length} private inventory draft${targets.length === 1 ? "" : "s"}...`);
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const target = targets[cursor];
        cursor += 1;
        await createDraft(target);
      }
    }

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(DRAFT_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      setNotice("Quick List draft creation finished. Created rows are safely held as drafts for final review.");
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }

  function removeRow(rowId: string) {
    setRows((current) =>
      current.filter((row) => {
        if (row.id !== rowId) return true;
        URL.revokeObjectURL(row.frontPreview);
        previewUrlsRef.current.delete(row.frontPreview);
        if (row.backPreview) {
          URL.revokeObjectURL(row.backPreview);
          previewUrlsRef.current.delete(row.backPreview);
        }
        return false;
      }),
    );
  }

  function clearCompleted() {
    setRows((current) =>
      current.filter((row) => {
        if (row.status !== "created") return true;
        URL.revokeObjectURL(row.frontPreview);
        previewUrlsRef.current.delete(row.frontPreview);
        if (row.backPreview) {
          URL.revokeObjectURL(row.backPreview);
          previewUrlsRef.current.delete(row.backPreview);
        }
        return false;
      }),
    );
  }

  function applyPrice(rowId: string, multiplier: number) {
    updateRow(rowId, (row) => ({
      ...row,
      price: priceWithMultiplier(row.suggestedPrice, multiplier),
      error: null,
    }));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  return (
    <div className="space-y-6">
      <section
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={handleDrop}
        className={`rounded-3xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? "border-yellow-400 bg-yellow-50"
            : "border-neutral-300 bg-white hover:border-neutral-500"
        }`}
      >
        <p className="text-xs font-black uppercase tracking-[0.2em] text-neutral-500">
          Truely Quick List
        </p>
        <h2 className="mt-2 text-3xl font-black">Drop card fronts and backs here</h2>
        <p className="mx-auto mt-3 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
          Name files like <strong>card-001-front.jpg</strong> and <strong>card-001-back.jpg</strong> for perfect pairing. Files without front/back names are paired in upload order. AI identification and InstaComp™ begin automatically.
        </p>
        <label className="mt-6 inline-flex cursor-pointer rounded-xl bg-neutral-950 px-6 py-3 font-black text-white hover:bg-neutral-800">
          Choose Card Images
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-sm font-bold text-neutral-600">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={(event) => setAutoScan(event.target.checked)}
              className="h-4 w-4"
            />
            Auto-scan after drop
          </label>
          <span>Up to {MAX_QUICK_LIST_ROWS} cards</span>
          <span>{SCAN_CONCURRENCY} parallel scans</span>
          <span>Front + back strongly recommended</span>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          ["Total", counts.total],
          ["Queued", counts.queued],
          ["Scanning", counts.scanning],
          ["Ready", counts.ready],
          ["Review", counts.review],
          ["Drafted", counts.created],
          ["Errors", counts.errors],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-black">{value}</p>
            <p className="mt-1 text-xs font-black uppercase tracking-wide text-neutral-500">{label}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => void scanQueuedRows()}
          disabled={running || drafting || !rows.length}
          className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Scanning Cards..." : "Scan All Queued"}
        </button>
        <button
          type="button"
          onClick={() => void createReadyDrafts()}
          disabled={running || drafting || counts.ready === 0}
          className="rounded-lg bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {drafting ? "Creating Drafts..." : "Create All Priced Drafts"}
        </button>
        <button
          type="button"
          onClick={clearCompleted}
          disabled={!counts.created || running || drafting}
          className="rounded-lg border border-neutral-300 px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear Drafted Rows
        </button>
        <Link
          href="/admin/instacomp"
          className="rounded-lg border border-neutral-300 px-5 py-3 text-sm font-black"
        >
          Open Full Scan Lab
        </Link>
      </section>

      {notice ? (
        <p className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
          {notice}
        </p>
      ) : null}
      {globalError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">
          {globalError}
        </p>
      ) : null}

      <section className="space-y-4">
        {rows.map((row, index) => {
          const review = needsReview(row);
          const confidence = row.result
            ? Math.round(Number(row.result.ai.confidence || 0) * 100)
            : null;

          return (
            <article
              key={row.id}
              className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm"
            >
              <div className="grid gap-5 p-5 lg:grid-cols-[220px_1fr_280px]">
                <div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-neutral-100">
                      {/* Blob URLs are local operator previews and cannot use Next image optimization. */}
                      <img src={row.frontPreview} alt={`Card ${index + 1} front`} className="h-full w-full object-cover" />
                      <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[10px] font-black uppercase text-white">Front</span>
                    </div>
                    <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-neutral-100">
                      {row.backPreview ? (
                        <img src={row.backPreview} alt={`Card ${index + 1} back`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-3 text-center text-xs font-bold text-neutral-500">No back image</div>
                      )}
                      <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-[10px] font-black uppercase text-white">Back</span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-bold text-neutral-500">
                    Paired by {row.pairingMethod.replaceAll("_", " ")}
                  </p>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-black uppercase text-white">#{index + 1}</span>
                    <StatusBadge status={row.status} />
                    {review ? (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-900">Review</span>
                    ) : row.status === "ready" || row.status === "created" ? (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-900">Identity clean</span>
                    ) : null}
                    {confidence != null ? (
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black text-blue-800">{confidence}% confidence</span>
                    ) : null}
                    {row.elapsedMs != null ? (
                      <span className="text-xs font-bold text-neutral-500">{(row.elapsedMs / 1000).toFixed(1)}s</span>
                    ) : null}
                  </div>

                  <label className="mt-4 block text-xs font-black uppercase tracking-wide text-neutral-500">
                    Listing title
                    <input
                      value={row.title}
                      onChange={(event) =>
                        updateRow(row.id, (current) => ({
                          ...current,
                          title: event.target.value,
                          error: null,
                        }))
                      }
                      disabled={!row.result || row.status === "drafting" || row.status === "created"}
                      placeholder={row.status === "scanning" ? "AI is identifying the card..." : "Waiting for scan"}
                      className="mt-2 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-black normal-case tracking-normal disabled:bg-neutral-100"
                    />
                  </label>

                  {row.result ? (
                    <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <Fact label="Player" value={row.result.ai.player} />
                      <Fact label="Set" value={[row.result.ai.year, row.result.ai.brand, row.result.ai.setName].filter(Boolean).join(" ")} />
                      <Fact label="Card #" value={row.result.ai.cardNumber ? `#${String(row.result.ai.cardNumber).replace(/^#/, "")}` : null} />
                      <Fact label="Parallel" value={stripExactSerial(row.result.ai.parallel)} />
                      <Fact label="Team" value={row.result.ai.team} />
                      <Fact label="Sport" value={row.result.ai.sport} />
                      <Fact label="Condition" value={row.result.ai.conditionGuess} />
                      <Fact label="InstaComp™" value={money(row.suggestedPrice)} />
                    </div>
                  ) : null}

                  {row.rawSerial ? (
                    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-950">
                      Serial read: <span className="line-through opacity-60">{row.rawSerial}</span>{" "}
                      → listing format <span className="text-lg font-black">{row.listingSerial || "Review"}</span>
                    </div>
                  ) : null}

                  {row.error ? (
                    <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-950">{row.error}</p>
                  ) : null}
                  {review && row.result?.review?.reviewReasons?.length ? (
                    <p className="mt-3 text-xs font-bold leading-5 text-amber-800">
                      Review: {row.result.review.reviewReasons.join(" • ")}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">Price and draft</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[1, 1.05, 1.1, 0.95].map((multiplier) => (
                      <button
                        key={multiplier}
                        type="button"
                        disabled={!row.suggestedPrice || row.status === "created" || row.status === "drafting"}
                        onClick={() => applyPrice(row.id, multiplier)}
                        className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-35"
                      >
                        {multiplier === 1
                          ? "Comp"
                          : multiplier > 1
                            ? `+${Math.round((multiplier - 1) * 100)}%`
                            : `-${Math.round((1 - multiplier) * 100)}%`}
                      </button>
                    ))}
                  </div>
                  <label className="mt-4 block text-xs font-black uppercase tracking-wide text-neutral-500">
                    Listing price
                    <div className="mt-2 flex items-center rounded-xl border border-neutral-300 bg-white px-3">
                      <span className="font-black">$</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.price}
                        onChange={(event) =>
                          updateRow(row.id, (current) => ({
                            ...current,
                            price: event.target.value,
                            error: null,
                          }))
                        }
                        disabled={!row.result || row.status === "drafting" || row.status === "created"}
                        className="w-full bg-transparent px-2 py-3 text-xl font-black outline-none disabled:text-neutral-400"
                        placeholder="0.00"
                      />
                    </div>
                  </label>
                  <label className="mt-3 block text-xs font-black uppercase tracking-wide text-neutral-500">
                    Quantity
                    <input
                      type="number"
                      min="1"
                      max="999"
                      step="1"
                      value={row.quantity}
                      onChange={(event) =>
                        updateRow(row.id, (current) => ({
                          ...current,
                          quantity: event.target.value,
                          error: null,
                        }))
                      }
                      disabled={!row.result || row.status === "drafting" || row.status === "created"}
                      className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-3 font-black disabled:text-neutral-400"
                    />
                  </label>

                  {row.status === "created" && row.editUrl ? (
                    <Link
                      href={row.editUrl}
                      className="mt-4 block rounded-xl bg-emerald-700 px-4 py-3 text-center text-sm font-black text-white"
                    >
                      Open Draft
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void createDraft(row)}
                      disabled={
                        row.status !== "ready" ||
                        !row.title.trim() ||
                        !Number.isFinite(Number(row.price)) ||
                        Number(row.price) <= 0
                      }
                      className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {row.status === "drafting" ? "Creating Draft..." : "Create Inventory Draft"}
                    </button>
                  )}

                  {row.status === "error" ? (
                    <button
                      type="button"
                      onClick={() => void scanQueuedRows(new Set([row.id]))}
                      className="mt-2 w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-black text-white"
                    >
                      Retry Scan
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    disabled={row.status === "scanning" || row.status === "drafting"}
                    className="mt-2 w-full rounded-xl border border-neutral-300 px-4 py-2 text-xs font-black text-neutral-600 disabled:opacity-35"
                  >
                    Remove Row
                  </button>
                </div>
              </div>
            </article>
          );
        })}

        {!rows.length ? (
          <div className="rounded-3xl border border-dashed border-neutral-300 bg-white p-12 text-center text-neutral-500">
            <p className="text-lg font-black text-neutral-800">No cards in Quick List yet.</p>
            <p className="mt-2 text-sm font-semibold">Drop front/back photos above to start the fastest intake workflow.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const styles: Record<RowStatus, string> = {
    queued: "bg-neutral-100 text-neutral-800",
    scanning: "bg-blue-100 text-blue-900",
    ready: "bg-emerald-100 text-emerald-900",
    drafting: "bg-violet-100 text-violet-900",
    created: "bg-green-700 text-white",
    error: "bg-red-100 text-red-900",
  };

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${styles[status]}`}>
      {status}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-lg bg-neutral-50 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 truncate font-bold text-neutral-900">{value || "—"}</p>
    </div>
  );
}
