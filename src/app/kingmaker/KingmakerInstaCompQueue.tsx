"use client";

import Link from "next/link";
import OBBFBOperatorForm from "./OBBFBOperatorForm";
import { useEffect, useMemo, useRef, useState } from "react";
import { getKingmakerLocalSession as getFreshAccountSession } from "./kingmaker-session";
import {
  instaCompDropFileSignature,
  pairInstaCompDropFiles,
  runInstaCompBatchQueue,
} from "../../lib/instacomp-batch-drop";

type IntakeResult = {
  success?: boolean;
  code?: string;
  photosArchived?: boolean;
  scanId?: string;
  error?: string;
  stage?: string;
  identityComplete?: boolean;
  cardUuid?: string | null;
  inventoryItemId?: string | null;
  title?: string | null;
  description?: string | null;
  intakeEngine?: string;
  verifiedLocked?: boolean;
  reviewHref?: string | null;
  resumedExisting?: boolean;
  ai?: Record<string, unknown> | null;
  checklistDecision?: Record<string, unknown> | null;
  parallelDecision?: Record<string, unknown> | null;
  pricingSucceeded?: boolean;
  scan?: {
    scan_id?: string | null;
    card_uuid?: string | null;
    trusted_identity?: Record<string, unknown> | null;
  } | null;
  pricing?: Record<string, any> | null;
  normalizedImages?: {
    frontImageUrl?: string | null;
    backImageUrl?: string | null;
  } | null;
  duplicate?: {
    inventoryItemId?: string | null;
    title?: string | null;
    status?: string | null;
  } | null;
  exactMatch?: {
    found?: boolean;
    existingInventoryItemId?: string;
    existingTitle?: string;
    existingQuantity?: number;
    existingPrice?: number;
    status?: string;
    folder?: string;
    isLive?: boolean;
    newInventoryItemId?: string;
    matchType?: string;
    channels?: {
      website?: boolean;
      ebay?: boolean;
      mercari?: boolean;
    };
  } | null;
};

type QueueStatus = "queued" | "working" | "pending" | "review" | "error";

type QueueCard = {
  id: string;
  front: File | null;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: QueueStatus;
  processingStage?: string;
  result: IntakeResult | null;
  error: string | null;
  durationMs: number | null;
  savingPrice: boolean;
  operatorLocked?: boolean;
  dismissedMatch?: boolean;
  merged?: boolean;
  mergeMessage?: string;
  merging?: boolean;
};


const CONCURRENCY = 1;

function numberFrom(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function suggestedPrice(result: IntakeResult | null) {
  const pricing = result?.pricing || {};
  const candidates = [
    pricing.suggestedPrice,
    pricing.payload?.suggestedPrice,
    pricing.data?.suggestedPrice,
    pricing.result?.suggestedPrice,
  ];
  for (const value of candidates) {
    const parsed = numberFrom(value);
    if (parsed) return parsed;
  }
  return null;
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function isBase(value: unknown) {
  return typeof value === "string" && /^base$/i.test(value.trim());
}

function identityRows(result: IntakeResult | null) {
  const identity = result?.ai || result?.scan?.trusted_identity || {};
  const parallel =
    identity.checklistParallel || identity.parallelName || identity.parallel;
  const setName = identity.brandSet || identity.setName || identity.set_name;
  const displaySetName = isBase(setName) && parallel && !isBase(parallel)
    ? null
    : setName;
  return [
    ["Year", identity.year],
    ["Product", identity.manufacturer || identity.brand],
    ["Set", displaySetName],
    ["Insert", identity.subset],
    ["Player", identity.player || identity.playerName],
    ["Card #", identity.cardNumber || identity.card_number],
    ["Parallel", parallel],
    ["Serial", identity.serialNumber || identity.serial_number || identity.printRun],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function statusText(card: QueueCard) {
  if (card.status === "queued") return "Queued";
  if (card.status === "working") return card.processingStage || "Processing card";
  if (card.status === "pending" && card.result?.intakeEngine === "obbfb_direct_vision_v1") {
    if (card.result.pricing?.status === "comped") {
      return card.result.pricing.suggestedPrice === 0
        ? "Exact sold comps found · ready for bulk pricing"
        : "Direct vision + 365-day comps — seller verification needed";
    }
    return "0 Comps — Seller Price Required";
  }
  if (card.status === "pending") return suggestedPrice(card.result) ? "Identified & comped — ready to price" : "Identity saved — pricing queued";
  if (card.result?.photosArchived) return "Photos archived · inventory save held";
  if (card.result?.code === "DUPLICATE_RECOVERABLE") return "Existing draft · saved-photo retry available";
  if (card.status === "review" && card.result?.resumedExisting)
    return "Existing scan resumed — saved for review";
  if (card.status === "review" && card.result?.code?.startsWith("DUPLICATE"))
    return "Already in inventory — no duplicate created";
  if (card.status === "review") return "Saved to Pending — review required";
  return "Stopped safely";
}

export default function KingmakerInstaCompQueue() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const acceptedSignatures = useRef<Set<string>>(new Set());
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      for (const url of previewUrls) {
        URL.revokeObjectURL(url);
      }
      previewUrls.clear();
    };
  }, []);

  // Serialize every drop/selection through one component-wide queue. Individual
  // batches already use concurrency=1, but two overlapping drops used to create
  // two independent queues and therefore two simultaneous Mac scans.
  const queueTailRef = useRef<Promise<void>>(Promise.resolve());
  const compTailRef = useRef<Promise<void>>(Promise.resolve());
  const archiveTailRef = useRef<Promise<void>>(Promise.resolve());

  const totals = useMemo(
    () => ({
      total: cards.length,
      working: cards.filter((card) => card.status === "working").length,
      pending: cards.filter((card) => card.status === "pending").length,
      review: cards.filter((card) => card.status === "review").length,
      errors: cards.filter((card) => card.status === "error").length,
    }),
    [cards],
  );

  function patch(id: string, values: Partial<QueueCard>) {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, ...values } : card)),
    );
  }

  async function submitIntake(card: QueueCard, scanId: string | null | undefined, phase: "archive" | "identify" | "comps") {
    const session = await getFreshAccountSession(5 * 60, false);
    const body = new FormData();
    if (!scanId) {
      if (!card.front || !card.back) throw new Error("Both the front and back are required.");
      body.append("front", card.front, card.front.name);
      body.append("back", card.back, card.back.name);
      body.append("phase", phase);
    }
    const response = await fetch("/api/kingmaker/instacomp-scan-intake-v2", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, ...(scanId ? { "Content-Type": "application/json" } : {}) },
      body: scanId ? JSON.stringify({ scanId, phase }) : body,
      signal: AbortSignal.timeout(phase === "comps" ? 190_000 : 115_000),
    });
    return { response, result: await response.json().catch(() => ({})) as IntakeResult };
  }

  async function archiveCard(card: QueueCard): Promise<QueueCard> {
    if (!card.front || !card.back || card.result?.scanId) return card;
    patch(card.id, { status: "working", processingStage: "Saving photos", error: null });
    try {
      const { result } = await submitIntake(card, null, "archive");
      if (result.stage === "archived") {
        patch(card.id, { status: "queued", result });
        return { ...card, status: "queued", result };
      }
      if (result.code?.startsWith("DUPLICATE")) {
        patch(card.id, { status: "review", result, error: result.error || null });
      } else {
        patch(card.id, { status: "error", error: result.error || "Photos could not be saved. Retry this pair from the loaded images." });
      }
      return { ...card, result, status: "error" };
    } catch (error) {
      patch(card.id, { status: "error", error: error instanceof Error ? error.message : "Photos could not be saved." });
      return { ...card, status: "error" };
    }
  }

  async function processCard(card: QueueCard) {
    if (!card.front || !card.back) {
      patch(card.id, {
        status: "error",
        error: `${card.front ? "Back" : "Front"} image missing. Both sides are required.`,
      });
      return;
    }
    const startedAt = Date.now();
    patch(card.id, { status: "working", processingStage: "Identifying", error: null });
    function finish(response: Response, result: IntakeResult) {
      if (!response.ok && !result.error) {
        result.error = `InstaComp returned HTTP ${response.status}. Retry from the saved photos.`;
      }
      const hasDraft = Boolean(result.inventoryItemId);
      if (!response.ok && !hasDraft && !result.photosArchived) {
        if (result.duplicate?.inventoryItemId) {
          patch(card.id, {
            status: "review",
            result,
            durationMs: Date.now() - startedAt,
            error: `Duplicate image pair already exists: ${result.duplicate.title || result.duplicate.inventoryItemId}`,
          });
          return;
        }
        throw new Error(result.error || (result.code
          ? `InstaComp stopped (${result.code}, HTTP ${response.status}).`
          : `InstaComp returned HTTP ${response.status} before confirming the result. Retry this card from its loaded photos.`));
      }

      const nextFrontPreview =
        result.normalizedImages?.frontImageUrl || card.frontPreview;
      const nextBackPreview =
        result.normalizedImages?.backImageUrl || card.backPreview;
      for (const [previous, next] of [
        [card.frontPreview, nextFrontPreview],
        [card.backPreview, nextBackPreview],
      ] as const) {
        if (previous?.startsWith("blob:") && previous !== next) {
          URL.revokeObjectURL(previous);
          previewUrlsRef.current.delete(previous);
        }
      }
      patch(card.id, {
        status:
          response.ok && hasDraft && result.success === true && result.identityComplete === true
            ? "pending"
            : "review",
        result,
        durationMs: Date.now() - startedAt,
        frontPreview: nextFrontPreview,
        backPreview: nextBackPreview,
        error: result.error || null,
      });
    }

    function fail(error: unknown) {
      patch(card.id, {
        status: "error",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "InstaComp intake failed.",
      });
    }

    try {
      const archived = card.result?.scanId ? card : await archiveCard(card);
      const scanId = archived.result?.scanId;
      if (!scanId || (!card.result?.scanId && archived.status === "error")) return;
      const { response, result } = await submitIntake(archived, scanId, "identify");
      if (result.stage !== "identified") {
        finish(response, { ...archived.result, ...result });
        return;
      }
      const checkpoint = { ...archived.result, ...result };
      patch(card.id, { status: "working", processingStage: "Waiting for sold comps", result: checkpoint });
      compTailRef.current = compTailRef.current.then(async () => {
        patch(card.id, { processingStage: "Finding sold comps" });
        const comps = await submitIntake(archived, scanId, "comps");
        finish(comps.response, { ...checkpoint, ...comps.result });
      }).catch(fail);
    } catch (error) {
      fail(error);
    }
  }

  function enqueueQueue(queue: QueueCard[]) {
    const archived = archiveTailRef.current.then(() =>
      runInstaCompBatchQueue({ items: queue, concurrency: CONCURRENCY, worker: archiveCard }));
    archiveTailRef.current = archived.then(() => undefined, () => undefined);
    const next = queueTailRef.current.catch(() => undefined).then(async () => {
      for (const outcome of await archived) {
        if (outcome.status === "fulfilled" && outcome.value.status !== "error") await processCard(outcome.value);
      }
    });
    queueTailRef.current = next;
    return next;
  }

  async function acceptFiles(value: FileList | File[]) {
    const files = Array.from(value).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    setPreparing(true);
    setPageError("");
    setPageNotice("");
    try {
      const pairing = pairInstaCompDropFiles(files, acceptedSignatures.current);
      files.forEach((file) => acceptedSignatures.current.add(instaCompDropFileSignature(file)));
      if (!pairing.pairs.length) {
        setPageError("No new card images were added. Choose JPEG, PNG, or WebP fronts and backs.");
        return;
      }
      const prepared = pairing.pairs.map((pair) => {
        const frontPreview = pair.front ? URL.createObjectURL(pair.front) : "";
        const backPreview = pair.back ? URL.createObjectURL(pair.back) : null;
        if (frontPreview) previewUrlsRef.current.add(frontPreview);
        if (backPreview) previewUrlsRef.current.add(backPreview);
        return {
          id: crypto.randomUUID(),
          front: pair.front,
          back: pair.back,
          frontPreview,
          backPreview,
          status: "queued" as const,
          result: null,
          error: !pair.front
            ? "Front image missing."
            : pair.back
              ? null
              : "Back image missing.",
          durationMs: null,
          savingPrice: false,
        };
      });
      setCards((current) => [...prepared, ...current]);
      setPageNotice(
        `${prepared.length} card${prepared.length === 1 ? "" : "s"} queued from ${files.length - pairing.duplicateCount} image${files.length - pairing.duplicateCount === 1 ? "" : "s"}.${pairing.duplicateCount ? ` ${pairing.duplicateCount} duplicate file${pairing.duplicateCount === 1 ? " was" : "s were"} ignored.` : ""}`,
      );
      void enqueueQueue(prepared);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not prepare dropped images.");
    } finally {
      setPreparing(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function choosePrice(card: QueueCard, price: number, source: string) {
    const inventoryItemId = card.result?.inventoryItemId;
    if (!inventoryItemId) return;
    if (card.result?.intakeEngine === "obbfb_direct_vision_v1") {
      patch(card.id, { error: "Use the OBBFB seller verification form below to lock price and identity together." });
      return;
    }
    patch(card.id, { savingPrice: true, error: null });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required before saving price.");
      const response = await fetch("/api/account/seller/instacomp-scan/price", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inventoryItemId, price, source }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save listing price.");
      patch(card.id, { savingPrice: false });
    } catch (error) {
      patch(card.id, {
        savingPrice: false,
        error: error instanceof Error ? error.message : "Could not save listing price.",
      });
    }
  }

  async function handleMergeExactMatch(card: QueueCard) {
    if (card.result?.intakeEngine === "obbfb_direct_vision_v1") {
      patch(card.id, { error: "OBBFB duplicate requires seller review under NEED TO MERGE. No quantity changed." });
      return;
    }
    const existingId = card.result?.exactMatch?.existingInventoryItemId;
    const newId = card.result?.inventoryItemId || card.result?.exactMatch?.newInventoryItemId;
    if (!existingId || !newId) return;
    patch(card.id, { merging: true, error: null });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login required.");
      const response = await fetch("/api/kingmaker/merge-intake-card", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          newInventoryItemId: newId,
          existingInventoryItemId: existingId,
          ebayStrategy: "increase_existing",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not merge exact match.");
      }
      patch(card.id, {
        merging: false,
        merged: true,
        mergeMessage:
          data.message ||
          `Merged +1 copy into existing listing. Total Quantity: ${data.totalQuantity}.`,
      });
    } catch (err) {
      patch(card.id, {
        merging: false,
        error: err instanceof Error ? err.message : "Merge failed.",
      });
    }
  }

  function handleKeepSeparate(card: QueueCard) {
    patch(card.id, { dismissedMatch: true });
  }

  return (
    <section aria-labelledby="kingmaker-instacomp-heading" className="mt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">
            InstaComp intake
          </p>
          <h2 id="kingmaker-instacomp-heading" className="mt-1 text-3xl font-black">
            Drop card fronts + backs here
          </h2>
          <p className="mt-2 max-w-4xl leading-7 text-slate-300">
            OBBFB reads both sides directly, searches genuine 365-day sold comps, and uses +25% with .99 pricing. No Checklist Registry or Ollama batch. Nothing publishes automatically.
          </p>
        </div>
        <Link
          href="/kingmaker/listings"
          className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:border-emerald-400"
        >
          Open Master Listings
        </Link>
      </div>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (event.currentTarget === event.target) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void acceptFiles(event.dataTransfer.files);
        }}
        className={`mt-5 rounded-3xl border-2 border-dashed p-8 text-center transition ${
          dragging
            ? "border-emerald-300 bg-emerald-950/50"
            : "border-slate-600 bg-slate-900/70 hover:border-slate-400"
        }`}
      >
        <div className="mx-auto max-w-2xl">
          <div className="text-5xl" aria-hidden="true">📷</div>
          <p className="mt-3 text-xl font-black">
            {dragging ? "Drop the card images" : "Drag + drop front/back image pairs"}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Drop 2 images for one card, 4 for two cards, and so on. Files named Front/Back are paired automatically;
            otherwise they are paired in order. Both sides are required.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={preparing}
            className="mt-5 rounded-xl bg-emerald-400 px-6 py-3 font-black text-slate-950 disabled:opacity-50"
          >
            {preparing ? "Preparing…" : "Choose Card Images"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(event) => event.target.files && void acceptFiles(event.target.files)}
          />
        </div>
      </div>

      {pageError ? (
        <div className="mt-4 rounded-xl border border-red-700 bg-red-950/60 p-4 font-bold text-red-200">
          {pageError}
        </div>
      ) : null}

      {pageNotice ? (
        <div className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950/40 p-4 font-bold text-emerald-100" role="status">
          {pageNotice}
        </div>
      ) : null}

      {cards.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Cards" value={totals.total} />
          <Metric label="Working" value={totals.working} />
          <Metric label="Pending" value={totals.pending} />
          <Metric label="Needs review" value={totals.review} />
          <Metric label="Stopped" value={totals.errors} />
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {cards.map((card) => {
          const basePrice = suggestedPrice(card.result);
          const normalizedFront = card.result?.normalizedImages?.frontImageUrl || null;
          const normalizedBack = card.result?.normalizedImages?.backImageUrl || null;
          const showNormalizedImages = Boolean(normalizedFront && normalizedBack);
          const displayImages = showNormalizedImages
            ? [normalizedFront, normalizedBack]
            : [card.frontPreview || null, card.backPreview || null];
          const choices = basePrice && card.result?.intakeEngine !== "obbfb_direct_vision_v1"
            ? [
                ["InstaComp", basePrice, "instacomp"],
                ["+5%", Math.round(basePrice * 1.05 * 100) / 100, "instacomp_plus_5"],
                ["+10%", Math.round(basePrice * 1.1 * 100) / 100, "instacomp_plus_10"],
              ] as const
            : [];
          return (
            <article key={card.id} className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-4 py-3">
                <div>
                  <p className="font-black">{card.result?.title || card.front?.name || card.back?.name || "Unpaired card images"}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{statusText(card)}</p>
                </div>
                <div className="text-right text-xs font-bold text-slate-400">
                  {card.durationMs !== null ? `${(card.durationMs / 1000).toFixed(1)}s` : ""}
                </div>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
                <div className="grid grid-cols-2 gap-2">
                  {displayImages.map((url, index) => (
                    <div key={index} className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-slate-950 p-2">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={index === 0 ? "Card front" : "Card back"} className="max-h-52 max-w-full object-contain" />
                      ) : (
                        <span className="px-3 text-center text-xs font-black uppercase tracking-wide text-amber-200">
                          {card.status === "error"
                            ? "Orientation not saved"
                            : index === 0
                              ? "Front orienting"
                              : "Back orienting"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="min-w-0">
                  {card.result?.exactMatch?.found && card.result?.intakeEngine === "obbfb_direct_vision_v1" ? (
                    <div className="mb-4 rounded-xl border border-amber-500 bg-amber-950/50 p-4">
                      <p className="font-black text-amber-200">NEED TO MERGE — existing active card may already match</p>
                      <p className="mt-2 text-xs text-slate-200">No quantity or marketplace listing has been changed. Verify the separate physical copy before merging.</p>
                      <Link href="/kingmaker/need-to-merge" className="mt-3 inline-block rounded-lg bg-amber-300 px-4 py-2 font-black text-slate-950">Open Need to Merge</Link>
                    </div>
                  ) : card.result?.exactMatch?.found ? (
                    card.merged ? (
                      <div className="mb-4 rounded-2xl border border-emerald-500 bg-emerald-950/70 p-4 text-emerald-200">
                        <div className="flex items-center gap-2 font-black text-emerald-300">
                          <span className="text-lg">✓</span>
                          <span>MERGED INTO EXISTING LISTING</span>
                        </div>
                        <p className="mt-1 text-xs text-emerald-300">{card.mergeMessage}</p>
                      </div>
                    ) : !card.dismissedMatch ? (
                      <div className="mb-4 rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-950/90 via-slate-900 to-slate-950 p-4 text-white shadow-xl shadow-amber-950/40">
                        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-300">
                          <span className="animate-pulse text-base">⚡</span>
                          <span>Exact Match Found in Inventory</span>
                        </div>
                        <h4 className="mt-1.5 text-base font-black text-amber-100">
                          DO YOU WANT TO MERGE THIS CARD WITH THE SAME MATCH?
                        </h4>
                        <div className="mt-2.5 rounded-xl border border-amber-500/30 bg-black/50 p-3 text-xs leading-5">
                          <p className="font-bold text-slate-200">
                            Match: <span className="text-white">{card.result.exactMatch.existingTitle}</span>
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-300">
                            <span>
                              Quantity: <strong className="text-white">{card.result.exactMatch.existingQuantity ?? 1}</strong>
                              {" → "}
                              <strong className="text-emerald-400">{(card.result.exactMatch.existingQuantity ?? 1) + 1}</strong>
                            </span>
                            <span>
                              Price: <strong className="text-white">{card.result.exactMatch.existingPrice ? money(card.result.exactMatch.existingPrice) : "—"}</strong>
                            </span>
                            <span>
                              Folder: <strong className="uppercase text-amber-200">{card.result.exactMatch.folder || "pending"}</strong>
                            </span>
                            {card.result.exactMatch.channels ? (
                              <span className="flex items-center gap-1">
                                Channels:
                                {card.result.exactMatch.channels.website ? (
                                  <span className="rounded bg-sky-900/60 px-1.5 py-0.5 text-[10px] font-bold text-sky-200">Website</span>
                                ) : null}
                                {card.result.exactMatch.channels.ebay ? (
                                  <span className="rounded bg-blue-900/60 px-1.5 py-0.5 text-[10px] font-bold text-blue-200">eBay</span>
                                ) : null}
                                {card.result.exactMatch.channels.mercari ? (
                                  <span className="rounded bg-rose-900/60 px-1.5 py-0.5 text-[10px] font-bold text-rose-200">Mercari (qty: 1)</span>
                                ) : null}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-3.5 flex flex-wrap gap-2.5">
                          <button
                            type="button"
                            disabled={card.merging}
                            onClick={() => void handleMergeExactMatch(card)}
                            className="rounded-xl bg-gradient-to-r from-amber-400 via-emerald-400 to-emerald-300 px-4 py-2.5 text-xs font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
                          >
                            {card.merging ? "Merging…" : "➕ Yes, Merge with Existing Match (+1 Qty)"}
                          </button>
                          <button
                            type="button"
                            disabled={card.merging}
                            onClick={() => handleKeepSeparate(card)}
                            className="rounded-xl border border-slate-600 bg-slate-800/80 px-3.5 py-2.5 text-xs font-bold text-slate-300 transition hover:border-slate-400 hover:text-white"
                          >
                            Keep as Separate Listing
                          </button>
                        </div>
                      </div>
                    ) : null
                  ) : null}
                  {card.result?.cardUuid ? (
                    <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-300">Permanent card UUID</p>
                      <p className="mt-1 break-all font-mono text-sm text-emerald-100">{card.result.cardUuid}</p>
                    </div>
                  ) : null}
                  {identityRows(card.result).length ? (
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      {identityRows(card.result).map(([label, value]) => (
                        <div key={String(label)} className="rounded-lg bg-slate-950 p-3">
                          <dt className="text-xs font-bold text-slate-500">{String(label)}</dt>
                          <dd className="mt-1 font-bold text-slate-100">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {card.result?.intakeEngine === "obbfb_direct_vision_v1"
                    && card.result.inventoryItemId
                    && !card.result.code?.startsWith("DUPLICATE")
                    && !card.result.exactMatch?.found ? (
                      <OBBFBOperatorForm
                        key={card.result.inventoryItemId}
                        inventoryItemId={card.result.inventoryItemId}
                        identity={card.result.ai || {}}
                        originalTitle={card.result.title || ""}
                        originalDescription={card.result.description || ""}
                        suggestedPrice={basePrice}
                        pricingStatus={String(card.result.pricing?.status || "")}
                        marketEvidence={card.result.pricing || undefined}
                      />
                    ) : null}
                  {choices.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {choices.map(([label, value, source]) => (
                        <button
                          key={source}
                          type="button"
                          disabled={card.savingPrice}
                          onClick={() => void choosePrice(card, value, source)}
                          className="rounded-xl border border-emerald-800 bg-slate-950 p-3 text-left transition hover:border-emerald-400 disabled:opacity-50"
                        >
                          <span className="block text-xs font-bold text-slate-500">{label}</span>
                          <span className="mt-1 block text-lg font-black text-white">{money(value)}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {card.status === "review" && card.result?.photosArchived && typeof card.result.ai?.notes === "string" ? (
                    <p className="mt-3 text-sm text-slate-300">{card.result.ai.notes}</p>
                  ) : null}
                  {(card.status === "error" || (card.status === "review" && card.result?.photosArchived)) && card.front && card.back ? (
                    <button type="button" onClick={() => void processCard(card)}
                      className="mt-3 rounded-lg border border-sky-500 px-4 py-2 text-sm font-bold text-sky-100">
                      Retry identification and comps
                    </button>
                  ) : null}
                  {card.error ? (
                    <div className="mt-3 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm font-bold text-red-200">
                      {card.error}
                    </div>
                  ) : null}
                  {card.result?.inventoryItemId ? (
                    <Link
                      href={
                        card.result.reviewHref ||
                        `/kingmaker/listings?focus=${encodeURIComponent(card.result.inventoryItemId)}`
                      }
                      className="mt-3 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950"
                    >
                      {card.result.code === "DUPLICATE_RECOVERABLE" ? "Recover Saved Scans →" : "Review in Master Listings →"}
                    </Link>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
    </div>
  );
}
