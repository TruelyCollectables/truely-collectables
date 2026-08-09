"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type CompRow = {
  title?: string | null;
  price?: number | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  currency?: string | null;
  url?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  sourceCategory?: string | null;
  soldAt?: string | null;
  itemId?: string | null;
  seller?: string | null;
  sellerName?: string | null;
  sellerFeedbackPercent?: number | string | null;
  sellerFeedbackScore?: number | null;
};

type EditableIdentity = {
  player: string;
  year: string;
  brand: string;
  setName: string;
  cardNumber: string;
  parallel: string;
  serialNumber: string;
  team: string;
  sport: string;
  conditionGuess: string;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
};

type ScanPayload = {
  ok?: boolean;
  error?: string;
  scanId?: string | null;
  ai?: Partial<EditableIdentity> & { confidence?: number | null };
  imageOrientation?: {
    frontRotation?: number | null;
    backRotation?: number | null;
    frontConfidence?: number | null;
    backConfidence?: number | null;
    status?: string | null;
  } | null;
  soldComps?: CompRow[];
  activeComps?: CompRow[];
  remainingCards?: CompRow[];
  note?: string | null;
  stats?: { suggestedPrice?: number | null } | null;
  exactMarket?: {
    status?: string | null;
    soldCount?: number | null;
    activeCount?: number | null;
    trustedSuggestedPrice?: number | null;
    sold?: CompRow[];
    active?: CompRow[];
    teacherLearning?: {
      status?: string | null;
      studentTrainingEligible?: boolean | null;
      trustedMarketTruth?: boolean | null;
      receiptId?: string | null;
    } | null;
    teacherConsensus?: {
      configuredTeachers?: string[];
      requiredVotes?: number | null;
      attempts?: Array<{
        teacher?: string | null;
        provider?: string | null;
        status?: string | null;
        message?: string | null;
      }>;
    } | null;
  } | null;
};

type QueueStatus =
  | "queued"
  | "identifying"
  | "identified"
  | "exact_market"
  | "saving_correction"
  | "ready"
  | "error";

type QueueCard = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: QueueStatus;
  fastResult: ScanPayload | null;
  exactResult: ScanPayload | null;
  operatorIdentity: EditableIdentity | null;
  error: string | null;
  message: string | null;
  identityMs: number | null;
  totalMs: number | null;
  progressPercent: number;
  progressStage: string;
};

const MAX_SCAN_EDGE = 2400;
const IDENTITY_CONCURRENCY = 2;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function confidenceLabel(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number <= 1 ? number * 100 : number)}%`;
}

function elapsed(ms: number | null) {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)}s`;
}

function emptyIdentity(): EditableIdentity {
  return {
    player: "",
    year: "",
    brand: "",
    setName: "",
    cardNumber: "",
    parallel: "",
    serialNumber: "",
    team: "",
    sport: "",
    conditionGuess: "",
    isRookie: false,
    isAuto: false,
    isRelic: false,
  };
}

function identityFromPayload(payload: ScanPayload | null): EditableIdentity {
  const ai = payload?.ai || {};
  return {
    player: clean(ai.player),
    year: clean(ai.year),
    brand: clean(ai.brand),
    setName: clean(ai.setName),
    cardNumber: clean(ai.cardNumber),
    parallel: clean(ai.parallel),
    serialNumber: clean(ai.serialNumber),
    team: clean(ai.team),
    sport: clean(ai.sport),
    conditionGuess: clean(ai.conditionGuess),
    isRookie: ai.isRookie === true,
    isAuto: ai.isAuto === true,
    isRelic: ai.isRelic === true,
  };
}

function effectiveIdentity(card: QueueCard) {
  return card.operatorIdentity || identityFromPayload(card.exactResult || card.fastResult);
}

function identityTitle(identity: EditableIdentity) {
  return [
    identity.year,
    identity.brand,
    identity.setName,
    identity.player,
    identity.parallel,
    identity.cardNumber ? `#${identity.cardNumber}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function pairKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/(?:^|[-_ .])(front|obverse|obv|back|reverse|rev)(?:$|[-_ .])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sideFromName(name: string) {
  const lower = name.toLowerCase();
  if (/(?:^|[-_ .])(front|obverse|obv)(?:$|[-_ .])/.test(lower)) return "front" as const;
  if (/(?:^|[-_ .])(back|reverse|rev)(?:$|[-_ .])/.test(lower)) return "back" as const;
  return null;
}

function pairFiles(files: File[]) {
  const byKey = new Map<string, { front?: File; back?: File }>();
  const loose: File[] = [];

  for (const file of files) {
    const side = sideFromName(file.name);
    if (!side) {
      loose.push(file);
      continue;
    }
    const key = pairKey(file.name) || file.name;
    const row = byKey.get(key) || {};
    row[side] = file;
    byKey.set(key, row);
  }

  const pairs: Array<{ front: File; back: File | null }> = [];
  for (const row of byKey.values()) {
    if (row.front) pairs.push({ front: row.front, back: row.back || null });
    else if (row.back) loose.push(row.back);
  }
  for (let index = 0; index < loose.length; index += 2) {
    pairs.push({ front: loose[index], back: loose[index + 1] || null });
  }
  return pairs;
}

async function bitmapFromFile(file: File) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser does not support fast card-image normalization.");
  }
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function canvasFile(
  file: File,
  label: string,
  rotation: 0 | 90 | 180 | 270 = 0,
) {
  const bitmap = await bitmapFromFile(file);
  const scale = Math.min(1, MAX_SCAN_EDGE / Math.max(bitmap.width, bitmap.height));
  const sourceWidth = Math.max(1, Math.round(bitmap.width * scale));
  const sourceHeight = Math.max(1, Math.round(bitmap.height * scale));
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? sourceHeight : sourceWidth;
  canvas.height = swap ? sourceWidth : sourceHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    throw new Error("The browser could not prepare this card image.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    bitmap,
    -sourceWidth / 2,
    -sourceHeight / 2,
    sourceWidth,
    sourceHeight,
  );
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Image conversion failed."))),
      "image/jpeg",
      0.9,
    );
  });
  return new File([blob], `${label}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

async function normalizedCardImage(file: File, label: string) {
  return canvasFile(file, label, 0);
}

async function rotateCardImage(file: File, degrees: 90 | 180 | 270, label: string) {
  return canvasFile(file, label, degrees);
}

function normalizedRotation(value: unknown): 0 | 90 | 180 | 270 {
  const number = Number(value);
  return number === 90 || number === 180 || number === 270 ? number : 0;
}

function statusLabel(status: QueueStatus) {
  if (status === "identifying") return "IDENTIFYING";
  if (status === "identified") return "IDENTIFIED";
  if (status === "exact_market") return "EXACT COMPS";
  if (status === "saving_correction") return "SAVING EDIT";
  if (status === "ready") return "READY";
  if (status === "error") return "ERROR";
  return "QUEUED";
}

export default function InstaCompFastWorkbench() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    const total = cards.length;
    return {
      total,
      ready: cards.filter((card) => card.status === "ready").length,
      errors: cards.filter((card) => card.status === "error").length,
      fast: cards.filter((card) => card.identityMs !== null && card.identityMs <= 10_000).length,
      progress: total
        ? Math.round(cards.reduce((sum, card) => sum + card.progressPercent, 0) / total)
        : 0,
    };
  }, [cards]);

  function patchCard(id: string, patch: Partial<QueueCard>) {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }

  function startProgressTicker(
    id: string,
    start: number,
    cap: number,
    stages: Array<{ at: number; label: string }>,
  ) {
    let value = start;
    const stageFor = (percent: number) => {
      let selected = stages[0]?.label || "Working";
      for (const stage of stages) if (percent >= stage.at) selected = stage.label;
      return selected;
    };
    patchCard(id, { progressPercent: value, progressStage: stageFor(value) });
    const timer = window.setInterval(() => {
      value = Math.min(cap, value + 1);
      patchCard(id, { progressPercent: value, progressStage: stageFor(value) });
    }, 650);
    return () => window.clearInterval(timer);
  }

  async function exactMarket(card: QueueCard, startedAt: number) {
    if (!card.back) {
      patchCard(card.id, {
        status: "ready",
        totalMs: Date.now() - startedAt,
        progressPercent: 100,
        progressStage: "Identity complete — back image required for exact comps",
      });
      return;
    }

    patchCard(card.id, { status: "exact_market", error: null });
    const stopTicker = startProgressTicker(card.id, 60, 96, [
      { at: 60, label: "Checking exact sold comps" },
      { at: 73, label: "Gemini + Groq teacher consensus" },
      { at: 86, label: "Verifying exact-card evidence" },
      { at: 93, label: "Saving teacher lesson" },
    ]);

    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      form.append("backImage", card.back, card.back.name);
      form.append("aiCouncilTier", "basic");
      const correction = card.operatorIdentity;
      if (correction) {
        form.append("listingTitleHint", identityTitle(correction));
        form.append("operatorIdentityOverride", JSON.stringify(correction));
        form.append("operatorSerialNumberOverride", correction.serialNumber || "none");
      }

      const response = await fetch("/api/instacomp/live-scan", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as ScanPayload;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Exact-market scan failed.");
      }
      stopTicker();
      patchCard(card.id, {
        exactResult: data,
        status: "ready",
        totalMs: Date.now() - startedAt,
        progressPercent: 100,
        progressStage: "Complete",
      });
    } catch (error) {
      stopTicker();
      patchCard(card.id, {
        status: "ready",
        totalMs: Date.now() - startedAt,
        progressPercent: 100,
        progressStage: "Identity complete — exact comps need attention",
        error:
          error instanceof Error
            ? `Identity succeeded; exact comps failed: ${error.message}`
            : "Identity succeeded; exact comps failed.",
      });
    }
  }

  async function applySemanticOrientation(card: QueueCard, data: ScanPayload) {
    const frontRotation = normalizedRotation(data.imageOrientation?.frontRotation);
    const backRotation = normalizedRotation(data.imageOrientation?.backRotation);
    if (!frontRotation && !backRotation) return card;

    patchCard(card.id, { progressPercent: 52, progressStage: "Auto-rotating card upright" });
    const [front, back] = await Promise.all([
      frontRotation
        ? rotateCardImage(card.front, frontRotation || 90, `instacomp-${card.id}-front-upright`)
        : Promise.resolve(card.front),
      card.back && backRotation
        ? rotateCardImage(card.back, backRotation || 90, `instacomp-${card.id}-back-upright`)
        : Promise.resolve(card.back),
    ]);
    const next = {
      ...card,
      front,
      back,
      frontPreview: front === card.front ? card.frontPreview : URL.createObjectURL(front),
      backPreview:
        back && back !== card.back ? URL.createObjectURL(back) : card.backPreview,
    };
    patchCard(card.id, {
      front: next.front,
      back: next.back,
      frontPreview: next.frontPreview,
      backPreview: next.backPreview,
    });
    return next;
  }

  async function identify(card: QueueCard) {
    const startedAt = Date.now();
    patchCard(card.id, { status: "identifying", error: null, message: null });
    const stopTicker = startProgressTicker(card.id, 20, 50, [
      { at: 20, label: "Reading card identity" },
      { at: 32, label: "Checking printed front/back evidence" },
      { at: 43, label: "Checking Registry identity" },
    ]);

    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      if (card.back) form.append("backImage", card.back, card.back.name);
      form.append("aiCouncilTier", "basic");
      const response = await fetch("/api/instacomp/scan-fast", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as ScanPayload;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "InstaComp could not identify this card.");
      }
      stopTicker();
      const orientedCard = await applySemanticOrientation(card, data);
      const identityMs = Date.now() - startedAt;
      const next = { ...orientedCard, fastResult: data, identityMs, status: "identified" as const };
      patchCard(card.id, {
        fastResult: data,
        identityMs,
        status: "identified",
        progressPercent: 57,
        progressStage: "Identity ready",
      });
      void exactMarket(next, startedAt);
    } catch (error) {
      stopTicker();
      patchCard(card.id, {
        status: "error",
        identityMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
        progressPercent: 100,
        progressStage: "Stopped — identification error",
        error: error instanceof Error ? error.message : "Card identification failed.",
      });
    }
  }

  async function runQueue(items: QueueCard[]) {
    for (let index = 0; index < items.length; index += IDENTITY_CONCURRENCY) {
      await Promise.all(items.slice(index, index + IDENTITY_CONCURRENCY).map(identify));
    }
  }

  async function acceptFiles(fileList: FileList | File[]) {
    const originals = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!originals.length) return;
    setPreparing(true);
    try {
      const pairs = pairFiles(originals);
      const prepared: QueueCard[] = [];
      for (let index = 0; index < pairs.length; index += 1) {
        const pair = pairs[index];
        const stamp = `${Date.now()}-${index + 1}`;
        const [front, back] = await Promise.all([
          normalizedCardImage(pair.front, `instacomp-${stamp}-front`),
          pair.back
            ? normalizedCardImage(pair.back, `instacomp-${stamp}-back`)
            : Promise.resolve(null),
        ]);
        prepared.push({
          id: crypto.randomUUID(),
          front,
          back,
          frontPreview: URL.createObjectURL(front),
          backPreview: back ? URL.createObjectURL(back) : null,
          status: "queued",
          fastResult: null,
          exactResult: null,
          operatorIdentity: null,
          error: back ? null : "Back image missing: identity can run, but exact-card pricing is limited.",
          message: null,
          identityMs: null,
          totalMs: null,
          progressPercent: 15,
          progressStage: "Images prepared",
        });
      }
      setCards((current) => [...prepared, ...current]);
      void runQueue(prepared);
    } finally {
      setPreparing(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function rotateSide(card: QueueCard, side: "front" | "back") {
    const source = side === "front" ? card.front : card.back;
    if (!source) return;
    const rotated = await rotateCardImage(source, 90, `instacomp-${card.id}-${side}`);
    const preview = URL.createObjectURL(rotated);
    patchCard(card.id, {
      ...(side === "front"
        ? { front: rotated, frontPreview: preview }
        : { back: rotated, backPreview: preview }),
      status: "queued",
      fastResult: null,
      exactResult: null,
      operatorIdentity: null,
      identityMs: null,
      totalMs: null,
      progressPercent: 15,
      progressStage: "Manual rotation applied — ready to rescan",
      error: null,
      message: null,
    });
  }

  function rescan(card: QueueCard) {
    const next: QueueCard = {
      ...card,
      status: "queued",
      fastResult: null,
      exactResult: null,
      operatorIdentity: null,
      identityMs: null,
      totalMs: null,
      progressPercent: 15,
      progressStage: "Queued for rescan",
      error: null,
      message: null,
    };
    setCards((current) => current.map((row) => (row.id === card.id ? next : row)));
    void identify(next);
  }

  async function saveCorrection(card: QueueCard, correction: EditableIdentity) {
    const scanId = card.exactResult?.scanId || card.fastResult?.scanId;
    if (!scanId) {
      patchCard(card.id, { error: "This card has no saved scan ID yet. Rescan it before saving a correction." });
      return;
    }

    patchCard(card.id, {
      status: "saving_correction",
      progressPercent: 58,
      progressStage: "Saving operator correction",
      error: null,
      message: null,
    });
    try {
      const response = await fetch("/api/instacomp/knowledge/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          status: "operator_confirmed",
          corrections: correction,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Could not save the InstaComp correction.");
      }

      const next: QueueCard = {
        ...card,
        operatorIdentity: correction,
        exactResult: null,
        status: "identified",
        message: "Correction saved. Exact comps are being rerun from the corrected identity.",
        error: null,
        progressPercent: 59,
        progressStage: "Correction saved",
      };
      patchCard(card.id, {
        operatorIdentity: correction,
        exactResult: null,
        status: "identified",
        message: next.message,
        progressPercent: 59,
        progressStage: "Correction saved",
      });
      void exactMarket(next, Date.now());
    } catch (error) {
      patchCard(card.id, {
        status: "ready",
        progressPercent: 100,
        progressStage: "Correction save failed",
        error: error instanceof Error ? error.message : "Could not save the correction.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-white shadow-xl">
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">Fast card intake</p>
            <h2 className="mt-1 text-2xl font-black">Drag in card fronts + backs</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-neutral-300">
              Front/back files pair automatically. Camera orientation is normalized before upload,
              InstaComp can rotate each side again from printed-text evidence, identity returns on the
              fast lane, and exact comps + teacher learning continue afterward.
            </p>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center">
            <SummaryMetric label="Cards" value={summary.total} />
            <SummaryMetric label="Ready" value={summary.ready} />
            <SummaryMetric label="≤10 sec" value={summary.fast} />
            <SummaryMetric label="Errors" value={summary.errors} />
            <SummaryMetric label="Overall" value={`${summary.progress}%`} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={(event) => { event.preventDefault(); void acceptFiles(event.dataTransfer.files); }}
          className={`m-5 mt-0 flex min-h-48 w-[calc(100%-2.5rem)] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging
              ? "border-cyan-300 bg-cyan-300/15"
              : "border-white/25 bg-white/5 hover:border-cyan-300/70 hover:bg-white/10"
          }`}
        >
          <span className="text-4xl" aria-hidden="true">⬇️</span>
          <span className="mt-3 text-xl font-black">{preparing ? "Preparing images…" : "DROP CARD IMAGES HERE"}</span>
          <span className="mt-2 text-sm font-semibold text-neutral-300">Or click to choose multiple images · front, back, front, back…</span>
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => { if (event.target.files) void acceptFiles(event.target.files); }}
        />
      </section>

      {cards.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {cards.map((card) => (
            <CardResult
              key={card.id}
              card={card}
              onRotate={(side) => void rotateSide(card, side)}
              onRescan={() => rescan(card)}
              onSaveCorrection={(correction) => void saveCorrection(card, correction)}
              onRemove={() => setCards((current) => current.filter((row) => row.id !== card.id))}
            />
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <p className="font-black text-neutral-700">No cards queued yet.</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">Drop one front/back pair above and the scan starts automatically.</p>
        </section>
      )}
    </div>
  );
}

function CardResult({
  card,
  onRotate,
  onRescan,
  onSaveCorrection,
  onRemove,
}: {
  card: QueueCard;
  onRotate: (side: "front" | "back") => void;
  onRescan: () => void;
  onSaveCorrection: (correction: EditableIdentity) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const identity = effectiveIdentity(card);
  const [draft, setDraft] = useState<EditableIdentity>(identity || emptyIdentity());
  useEffect(() => {
    if (!editing) setDraft(effectiveIdentity(card));
  }, [card.fastResult, card.exactResult, card.operatorIdentity, editing]);

  const exact = card.exactResult?.exactMarket;
  const sold = exact?.sold || card.exactResult?.soldComps || card.fastResult?.soldComps || [];
  const active = exact?.active || card.exactResult?.activeComps || card.fastResult?.activeComps || card.exactResult?.remainingCards || [];
  const suggested =
    exact?.trustedSuggestedPrice ?? card.exactResult?.stats?.suggestedPrice ?? card.fastResult?.stats?.suggestedPrice ?? null;
  const confidence = card.exactResult?.ai?.confidence ?? card.fastResult?.ai?.confidence;
  const identityFast = card.identityMs !== null && card.identityMs <= 10_000;

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="border-b border-neutral-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[11px] font-black text-white">{statusLabel(card.status)}</span>
              {card.identityMs !== null ? (
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${identityFast ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  ID {elapsed(card.identityMs)}
                </span>
              ) : null}
              {card.totalMs !== null ? <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-black text-neutral-700">FULL {elapsed(card.totalMs)}</span> : null}
            </div>
            <h3 className="mt-2 break-words text-lg font-black text-neutral-950">{identityTitle(identity) || "Identifying card…"}</h3>
          </div>
          <button type="button" onClick={onRemove} className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-black text-neutral-500 hover:bg-neutral-50">Remove</button>
        </div>

        <div className="mt-4" aria-label="Job progress">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs font-black">
            <span className="text-neutral-600">{card.progressStage}</span>
            <span className="tabular-nums text-neutral-950">{card.progressPercent}%</span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-neutral-200"
            role="progressbar"
            aria-label="Job progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={card.progressPercent}
          >
            <div className="h-full rounded-full bg-cyan-600 transition-[width] duration-500" style={{ width: `${card.progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-neutral-100 p-3">
        <ImagePanel label="FRONT" src={card.frontPreview} onRotate={() => onRotate("front")} />
        <ImagePanel label="BACK" src={card.backPreview} onRotate={() => onRotate("back")} />
      </div>

      <div className="grid grid-cols-2 gap-px bg-neutral-200 sm:grid-cols-4">
        <Metric label="Confidence" value={confidenceLabel(confidence)} />
        <Metric label="Serial" value={identity.serialNumber || "—"} />
        <Metric label="Auto" value={identity.isAuto ? "YES" : "NO"} />
        <Metric label="Relic" value={identity.isRelic ? "YES" : "NO"} />
      </div>

      <div className="space-y-3 p-4">
        {card.error ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{card.error}</p> : null}
        {card.message ? <p className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm font-bold text-cyan-900">{card.message}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setDraft(identity); setEditing((value) => !value); }} className="rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-2 text-sm font-black text-cyan-900">
            {editing ? "Close editor" : "Edit card"}
          </button>
          <button type="button" onClick={onRescan} disabled={card.status === "identifying" || card.status === "exact_market" || card.status === "saving_correction"} className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Rescan</button>
        </div>

        {editing ? (
          <IdentityEditor
            value={draft}
            onChange={setDraft}
            disabled={card.status === "saving_correction"}
            onSave={() => { onSaveCorrection(draft); setEditing(false); }}
          />
        ) : null}

        {card.fastResult && !card.exactResult && card.back && card.status !== "saving_correction" ? (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm font-bold text-cyan-900">Identity is available now. Exact sold comps + teacher-learning evidence are still running.</div>
        ) : null}

        {card.exactResult ? (
          <div className="grid gap-2 sm:grid-cols-4">
            <MetricCard label="Trusted price" value={money(suggested)} />
            <MetricCard label="Sold comps" value={String(exact?.soldCount ?? sold.length)} />
            <MetricCard label="Active" value={String(exact?.activeCount ?? active.length)} />
            <MetricCard label="Student lesson" value={exact?.teacherLearning?.studentTrainingEligible ? "ELIGIBLE" : exact?.teacherLearning?.status || "—"} />
          </div>
        ) : null}

        {sold.length ? <CompList title="Exact sold evidence" rows={sold.slice(0, 5)} /> : null}
        {active.length ? <CompList title="Active evidence" rows={active.slice(0, 5)} /> : null}

        {(card.exactResult?.scanId || card.fastResult?.scanId) ? (
          <p className="break-all text-xs font-semibold text-neutral-500">Scan {card.exactResult?.scanId || card.fastResult?.scanId}</p>
        ) : null}
      </div>
    </article>
  );
}

function IdentityEditor({
  value,
  onChange,
  onSave,
  disabled,
}: {
  value: EditableIdentity;
  onChange: (value: EditableIdentity) => void;
  onSave: () => void;
  disabled: boolean;
}) {
  const textFields: Array<[keyof EditableIdentity, string]> = [
    ["player", "Player"],
    ["year", "Year / season"],
    ["brand", "Brand / manufacturer"],
    ["setName", "Set / insert"],
    ["cardNumber", "Card number"],
    ["parallel", "Parallel / variation"],
    ["serialNumber", "Serial number"],
    ["team", "Team"],
    ["sport", "Sport"],
    ["conditionGuess", "Condition"],
  ];
  return (
    <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50 p-4">
      <div className="mb-3">
        <p className="text-xs font-black uppercase tracking-wider text-cyan-800">Operator correction</p>
        <p className="mt-1 text-sm font-semibold text-cyan-950">Edit the exact card identity. Saving teaches InstaComp the correction and reruns exact comps.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {textFields.map(([field, label]) => (
          <label key={field} className="text-xs font-black text-neutral-700">
            {label}
            <input
              value={String(value[field] ?? "")}
              disabled={disabled}
              onChange={(event) => onChange({ ...value, [field]: event.target.value })}
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-950"
            />
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-black text-neutral-800">
        {(["isRookie", "isAuto", "isRelic"] as const).map((field) => (
          <label key={field} className="flex items-center gap-2">
            <input type="checkbox" checked={value[field]} disabled={disabled} onChange={(event) => onChange({ ...value, [field]: event.target.checked })} />
            {field === "isRookie" ? "Rookie" : field === "isAuto" ? "Autograph" : "Relic / memorabilia"}
          </label>
        ))}
      </div>
      <button type="button" onClick={onSave} disabled={disabled} className="mt-4 rounded-xl bg-cyan-950 px-5 py-2.5 text-sm font-black text-white disabled:opacity-50">{disabled ? "Saving…" : "Save correction"}</button>
    </div>
  );
}

function ImagePanel({ label, src, onRotate }: { label: string; src: string | null; onRotate: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-[11px] font-black tracking-widest text-neutral-500">{label}</span>
        {src ? <button type="button" onClick={onRotate} className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-black text-neutral-700 hover:bg-neutral-50" title="Manual fallback if automatic orientation is wrong">↻ 90°</button> : null}
      </div>
      {src ? <img src={src} alt={`${label.toLowerCase()} card preview`} className="h-64 w-full object-contain [image-orientation:from-image]" /> : <div className="flex h-64 items-center justify-center p-4 text-center text-sm font-bold text-neutral-400">No back image</div>}
    </div>
  );
}

function CompList({ title, rows }: { title: string; rows: CompRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-neutral-600">{title}</div>
      <div className="divide-y divide-neutral-100">
        {rows.map((row, index) => {
          const seller = row.sellerName || row.seller || null;
          const delivered = Number(row.itemPrice) > 0 ? Number(row.itemPrice) + Math.max(0, Number(row.shippingPrice) || 0) : Number(row.price) || null;
          return (
            <div key={`${row.url || row.title || index}-${index}`} className="p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-neutral-900">{row.title || "Comp"}</p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    {row.sourceLabel || row.source || "Market source"}
                    {seller ? ` · Seller: ${seller}` : ""}
                    {row.sellerFeedbackPercent !== null && row.sellerFeedbackPercent !== undefined ? ` · ${row.sellerFeedbackPercent}% feedback` : ""}
                    {row.itemId ? ` · Item #${row.itemId}` : ""}
                    {row.soldAt ? ` · Sold ${new Date(row.soldAt).toLocaleDateString()}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    Item {money(row.itemPrice ?? row.price)} · Shipping {row.shippingPrice === null || row.shippingPrice === undefined ? "UNKNOWN" : money(row.shippingPrice)} · Delivered {money(delivered)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{money(delivered)}</p>
                  {row.url ? <a href={row.url} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline">Open listing</a> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{label}</p><p className="mt-1 text-xl font-black">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-white p-3"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p><p className="mt-1 break-words text-sm font-black text-neutral-900">{value}</p></div>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3"><p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p><p className="mt-1 break-words text-base font-black text-neutral-900">{value}</p></div>;
}
