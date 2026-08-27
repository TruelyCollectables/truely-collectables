"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "@/src/app/account/account-session";
import {
  instaCompDropFileSignature,
  pairInstaCompDropFiles,
  runInstaCompBatchQueue,
} from "@/src/lib/instacomp-batch-drop";

type AiResult = {
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

type ExactComp = {
  title: string;
  price: number;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  priceIncludesShipping?: boolean;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  soldAt?: string | null;
  listedAt?: string | null;
  matchScore: number;
  flags: string[];
};

type ProviderMessage = {
  label: string;
  status: string;
  results: number;
  message: string | null;
};

type ExactMarket = {
  status: "ready" | "no_exact_sold" | "provider_error" | "identity_incomplete";
  query: string;
  missingIdentityFields?: string[];
  soldCount: number;
  activeCount: number;
  trustedSuggestedPrice: number | null;
  pricing?: {
    soldLow: number | null;
    soldMedian: number | null;
    soldAverage: number | null;
    soldHigh: number | null;
    activeLow: number | null;
    activeMedian: number | null;
    activeAverage: number | null;
    activeHigh: number | null;
    strategy: string;
    explanation: string;
  };
  sold?: ExactComp[];
  active?: ExactComp[];
  providerMessages?: ProviderMessage[];
};

type PipelineDiagnostics = {
  mode: string;
  simulated: boolean;
  runtimeConfiguration?: {
    openAi: boolean;
    serpApi: boolean;
    ebay: boolean;
    supabase: boolean;
  };
  request?: {
    frontReceived: boolean;
    backReceived: boolean;
  };
  identity?: {
    status: string;
    confidence?: number;
    missingFields?: string[];
    message?: string;
  };
  exactMarket?: {
    status: string;
    soldCount?: number;
    activeCount?: number;
    message?: string;
    serpApi?: {
      soldStatus: string;
      activeStatus: string;
    };
    openAiWeb?: {
      soldStatus: string;
      activeStatus: string;
      model: string | null;
      cached: boolean;
    };
  };
  persistence?: {
    status: string;
    message: string;
  };
  durationMs?: number;
};

type LiveScanResponse = {
  ok: boolean;
  error?: string;
  details?: string;
  scanId?: string | null;
  ai?: AiResult;
  searchQuery?: string;
  note?: string;
  exactMarket?: ExactMarket;
  pipelineDiagnostics?: PipelineDiagnostics;
  imageOrientation?: {
    status: string;
    model: string | null;
    frontRotation: 0 | 90 | 180 | 270;
    backRotation: 0 | 90 | 180 | 270;
    frontConfidence: number;
    backConfidence: number;
    reason: string;
  } | null;
};

type BatchStatus = "incomplete" | "queued" | "scanning" | "done" | "error";

type BatchCard = {
  id: string;
  front: File | null;
  back: File | null;
  frontPreview: string | null;
  backPreview: string | null;
  pairing: "filename" | "drop_order";
  pairKey: string;
  status: BatchStatus;
  result: LiveScanResponse | null;
  error: string | null;
};

class LiveScanRequestError extends Error {
  readonly response: LiveScanResponse | null;

  constructor(message: string, response: LiveScanResponse | null = null) {
    super(message);
    this.name = "LiveScanRequestError";
    this.response = response;
  }
}

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_CARDS = 100;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidence(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Date not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US");
}

function statusTone(status: string | null | undefined) {
  if (["ready", "live", "complete", "saved", "done"].includes(String(status))) {
    return { background: "#e8f7ee", borderColor: "#9dd8b1", color: "#145c2e" };
  }
  if (["queued", "scanning"].includes(String(status))) {
    return { background: "#edf3ff", borderColor: "#9eb8ee", color: "#234f9b" };
  }
  if (
    ["no_exact_sold", "no_matches", "review", "skipped", "blocked", "incomplete"].includes(
      String(status),
    )
  ) {
    return { background: "#fff7df", borderColor: "#e6ca72", color: "#765700" };
  }
  return { background: "#fff0f0", borderColor: "#e1a3a3", color: "#8a1c1c" };
}

function StatusBox({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div
      style={{
        ...statusTone(status),
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        flex: "1 1 160px",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontWeight: 800, marginTop: 4 }}>{status.replaceAll("_", " ")}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function CompTable({
  title,
  comps,
  lane,
}: {
  title: string;
  comps: ExactComp[];
  lane: "sold" | "active";
}) {
  return (
    <section style={sectionStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>{title}</h3>
      <p style={{ marginTop: 0, color: "#555" }}>
        {lane === "sold"
          ? "Only strict exact-card sold evidence belongs in the trusted value."
          : "Active listings are competition, not sold comps and not proof of value."}
      </p>
      {!comps.length ? (
        <div style={{ padding: 16, border: "1px dashed #bbb", borderRadius: 10 }}>
          No strict exact {lane} listings passed verification.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={th}>Image</th>
                <th style={th}>Exact listing</th>
                <th style={th}>Delivered</th>
                <th style={th}>{lane === "sold" ? "Sold" : "Listed"}</th>
                <th style={th}>Verification</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((comp, index) => (
                <tr key={`${comp.url}-${index}`} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={td}>
                    {comp.imageUrl ? (
                      <img
                        src={comp.imageUrl}
                        alt="Exact listing"
                        style={{ width: 62, height: 82, objectFit: "contain", borderRadius: 6 }}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={td}>
                    <a
                      href={comp.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontWeight: 700 }}
                    >
                      {comp.title}
                    </a>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 5 }}>
                      {comp.sourceLabel}
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 800 }}>
                    {money(comp.price)}
                    {comp.itemPrice !== undefined && comp.itemPrice !== null ? (
                      <div style={{ fontSize: 11, color: "#666", fontWeight: 400 }}>
                        {money(comp.itemPrice)} + {money(comp.shippingPrice || 0)} shipping
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>{dateLabel(lane === "sold" ? comp.soldAt : comp.listedAt)}</td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>Score {comp.matchScore}</div>
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                      {(comp.flags || []).slice(0, 4).join(" · ") || "Strict exact filter"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function cardIdentityTitle(card: BatchCard) {
  const ai = card.result?.ai;
  if (!ai) {
    return [card.front?.name || "Missing front", card.back?.name || "Missing back"].join(" / ");
  }

  return [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "RC" : null,
    ai.parallel,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    ai.serialNumber,
    ai.gradingCompany,
    ai.gradeValue,
  ]
    .filter(Boolean)
    .join(" ");
}

function newCardId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `instacomp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function InstaCompBatchLiveScanner() {
  const [accountSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [cards, setCards] = useState<BatchCard[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [copiedCardId, setCopiedCardId] = useState<string | null>(null);
  const previewUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  useEffect(() => {
    if (!cards.length) {
      if (activeCardId !== null) setActiveCardId(null);
      return;
    }
    if (!activeCardId || !cards.some((card) => card.id === activeCardId)) {
      setActiveCardId(cards[0].id);
    }
  }, [cards, activeCardId]);

  const activeCard = useMemo(
    () => cards.find((card) => card.id === activeCardId) || null,
    [cards, activeCardId],
  );
  const result = activeCard?.result || null;
  const exactMarket = result?.exactMarket;
  const diagnostics = result?.pipelineDiagnostics;
  const sold = exactMarket?.sold || [];
  const active = exactMarket?.active || [];
  const runtime = diagnostics?.runtimeConfiguration;
  const readyCount = cards.filter((card) => card.front && card.back).length;
  const completeCount = cards.filter((card) => card.status === "done").length;
  const errorCount = cards.filter((card) => card.status === "error").length;
  const scanningCount = cards.filter((card) => card.status === "scanning").length;

  function createPreview(file: File | null) {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    return url;
  }

  function revokePreview(url: string | null) {
    if (!url) return;
    URL.revokeObjectURL(url);
    previewUrlsRef.current.delete(url);
  }

  function validateFile(file: File) {
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
      return `${file.name}: use a JPEG, PNG, or WebP image.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `${file.name}: each image must be 12 MB or smaller.`;
    }
    return null;
  }

  function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;

    setGlobalError(null);
    setMessage(null);
    setCopiedCardId(null);

    const valid: File[] = [];
    const fileErrors: string[] = [];
    incoming.forEach((file) => {
      const fileError = validateFile(file);
      if (fileError) fileErrors.push(fileError);
      else valid.push(file);
    });

    const existingSignatures = cards.flatMap((card) =>
      [card.front, card.back]
        .filter((file): file is File => Boolean(file))
        .map(instaCompDropFileSignature),
    );
    const pairing = pairInstaCompDropFiles(valid, existingSignatures);
    const availableSlots = Math.max(0, MAX_BATCH_CARDS - cards.length);
    const acceptedPairs = pairing.pairs.slice(0, availableSlots);
    const newCards = acceptedPairs.map((pair) => ({
      id: newCardId(),
      front: pair.front,
      back: pair.back,
      frontPreview: createPreview(pair.front),
      backPreview: createPreview(pair.back),
      pairing: pair.pairing,
      pairKey: pair.pairKey,
      status: pair.front && pair.back ? ("queued" as const) : ("incomplete" as const),
      result: null,
      error: null,
    }));

    if (newCards.length) {
      setCards((current) => [...current, ...newCards]);
      setActiveCardId((current) => current || newCards[0].id);
    }

    const messages: string[] = [];
    if (newCards.length) {
      messages.push(
        `Added ${newCards.length} card${newCards.length === 1 ? "" : "s"} from ${valid.length} image${valid.length === 1 ? "" : "s"}.`,
      );
    }
    if (pairing.duplicateCount) {
      messages.push(`Skipped ${pairing.duplicateCount} duplicate image${pairing.duplicateCount === 1 ? "" : "s"}.`);
    }
    if (pairing.pairs.length > acceptedPairs.length) {
      messages.push(`The queue is limited to ${MAX_BATCH_CARDS} cards.`);
    }
    if (fileErrors.length) {
      setGlobalError(fileErrors.join(" "));
    }
    setMessage(messages.join(" ") || null);
  }

  function patchCard(cardId: string, updater: (card: BatchCard) => BatchCard) {
    setCards((current) => current.map((card) => (card.id === cardId ? updater(card) : card)));
  }

  function replaceSide(cardId: string, side: "front" | "back", file: File | null) {
    if (file) {
      const fileError = validateFile(file);
      if (fileError) {
        setGlobalError(fileError);
        return;
      }
    }

    const currentCard = cards.find((card) => card.id === cardId);
    if (!currentCard) return;
    const oldPreview = side === "front" ? currentCard.frontPreview : currentCard.backPreview;
    const nextPreview = createPreview(file);
    revokePreview(oldPreview);

    setGlobalError(null);
    setCopiedCardId(null);
    patchCard(cardId, (card) => {
      const nextCard = {
        ...card,
        [side]: file,
        [`${side}Preview`]: nextPreview,
        result: null,
        error: null,
      } as BatchCard;
      return {
        ...nextCard,
        status: nextCard.front && nextCard.back ? "queued" : "incomplete",
      };
    });
  }

  function swapSides(cardId: string) {
    patchCard(cardId, (card) => ({
      ...card,
      front: card.back,
      back: card.front,
      frontPreview: card.backPreview,
      backPreview: card.frontPreview,
      status: card.front && card.back ? "queued" : "incomplete",
      result: null,
      error: null,
    }));
  }

  function removeCard(cardId: string) {
    const removed = cards.find((card) => card.id === cardId);
    if (removed) {
      revokePreview(removed.frontPreview);
      revokePreview(removed.backPreview);
    }
    setCards((current) => current.filter((card) => card.id !== cardId));
  }

  function clearAll() {
    cards.forEach((card) => {
      revokePreview(card.frontPreview);
      revokePreview(card.backPreview);
    });
    setCards([]);
    setActiveCardId(null);
    setMessage(null);
    setGlobalError(null);
    setCopiedCardId(null);
  }

  async function executeLiveScan(card: BatchCard) {
    if (!card.front || !card.back) {
      throw new LiveScanRequestError("Both front and back are required.");
    }
    if (card.front.size + card.back.size > MAX_TOTAL_BYTES) {
      throw new LiveScanRequestError("The combined front and back images must be 20 MB or smaller.");
    }

    const formData = new FormData();
    formData.append("frontImage", card.front);
    formData.append("backImage", card.back);
    const headers: HeadersInit = {};
    if (accountSession?.access_token) {
      headers.Authorization = `Bearer ${accountSession.access_token}`;
    }

    const response = await fetch("/api/instacomp/live-scan", {
      method: "POST",
      headers,
      body: formData,
      cache: "no-store",
      credentials: "same-origin",
    });

    const raw = await response.text();
    let data: LiveScanResponse;
    try {
      data = JSON.parse(raw) as LiveScanResponse;
    } catch {
      throw new LiveScanRequestError(
        `Live scan returned ${response.status} without valid JSON. ${raw.slice(0, 300)}`,
      );
    }

    if (!response.ok || !data.ok) {
      throw new LiveScanRequestError(
        [data.error, data.details].filter(Boolean).join(" — ") || `Live scan failed (${response.status}).`,
        data,
      );
    }

    return data;
  }

  async function scanOne(cardId: string) {
    const card = cards.find((candidate) => candidate.id === cardId);
    if (!card || batchRunning) return;
    if (!card.front || !card.back) {
      patchCard(cardId, (current) => ({
        ...current,
        status: "incomplete",
        error: "Add both front and back before scanning.",
      }));
      return;
    }

    setActiveCardId(cardId);
    setGlobalError(null);
    setMessage(null);
    patchCard(cardId, (current) => ({
      ...current,
      status: "scanning",
      result: null,
      error: null,
    }));

    try {
      const response = await executeLiveScan(card);
      patchCard(cardId, (current) => ({
        ...current,
        status: "done",
        result: response,
        error: null,
      }));
    } catch (error) {
      const response = error instanceof LiveScanRequestError ? error.response : null;
      patchCard(cardId, (current) => ({
        ...current,
        status: "error",
        result: response,
        error: error instanceof Error ? error.message : "Live scan failed.",
      }));
    }
  }

  async function scanAllReady() {
    if (batchRunning) return;
    const targets = cards.filter((card) => card.front && card.back && card.status !== "scanning");
    if (!targets.length) {
      setGlobalError("Add at least one complete front/back card pair.");
      return;
    }

    setBatchRunning(true);
    setGlobalError(null);
    setMessage(`Scanning ${targets.length} card${targets.length === 1 ? "" : "s"}.`);
    setActiveCardId(targets[0].id);

    targets.forEach((target) => {
      patchCard(target.id, (card) => ({
        ...card,
        status: "queued",
        result: null,
        error: null,
      }));
    });

    const outcomes = await runInstaCompBatchQueue({
      items: targets,
      concurrency,
      worker: async (card) => {
        patchCard(card.id, (current) => ({
          ...current,
          status: "scanning",
          result: null,
          error: null,
        }));
        return executeLiveScan(card);
      },
      onOutcome: (outcome) => {
        if (outcome.status === "fulfilled") {
          patchCard(outcome.item.id, (current) => ({
            ...current,
            status: "done",
            result: outcome.value,
            error: null,
          }));
          return;
        }

        const response =
          outcome.reason instanceof LiveScanRequestError ? outcome.reason.response : null;
        patchCard(outcome.item.id, (current) => ({
          ...current,
          status: "error",
          result: response,
          error:
            outcome.reason instanceof Error ? outcome.reason.message : "Live scan failed.",
        }));
      },
    });

    const failures = outcomes.filter((outcome) => outcome.status === "rejected").length;
    setMessage(
      `Batch finished: ${outcomes.length - failures} completed, ${failures} failed. Open each row for its exact diagnostics.`,
    );
    setBatchRunning(false);
  }

  async function copyDiagnostics(card: BatchCard) {
    if (!card.result) return;
    await navigator.clipboard.writeText(JSON.stringify(card.result, null, 2));
    setCopiedCardId(card.id);
  }

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <section style={sectionStyle}>
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: "1px solid #9dd8b1",
            background: "#e8f7ee",
            color: "#145c2e",
            fontWeight: 800,
            marginBottom: 18,
          }}
        >
          LIVE BATCH MODE — drag in many real front/back images, scan every complete pair,
          and show the actual result or actual failure for each card. No fixture cards and no
          simulated accuracy score.
        </div>

        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) setDragActive(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            addFiles(event.dataTransfer.files);
          }}
          style={{
            ...dropZoneStyle,
            borderColor: dragActive ? "#1d4ed8" : "#777",
            background: dragActive ? "#edf3ff" : "#fafafa",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 900 }}>Drop all card images here</div>
          <div style={{ color: "#555", maxWidth: 760 }}>
            Drop 2, 4, 6, or more images. Files named <strong>front/back</strong> are paired by
            name. Unnamed images are paired in drop order: front, back, front, back. You can
            swap or replace either side before scanning.
          </div>
          <label style={chooseButtonStyle}>
            Choose multiple images
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            onClick={() => void scanAllReady()}
            disabled={batchRunning || readyCount === 0}
            style={{
              ...primaryButton,
              opacity: batchRunning || readyCount === 0 ? 0.55 : 1,
              cursor: batchRunning || readyCount === 0 ? "not-allowed" : "pointer",
            }}
          >
            {batchRunning
              ? `Scanning ${scanningCount || "batch"}…`
              : `Scan all complete cards (${readyCount})`}
          </button>
          <label style={inlineControlStyle}>
            Parallel requests
            <select
              value={concurrency}
              disabled={batchRunning}
              onChange={(event) => setConcurrency(Math.max(1, Math.min(3, Number(event.target.value))))}
              style={{ marginLeft: 8, padding: 6 }}
            >
              <option value={1}>1 — safest</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <button type="button" onClick={clearAll} disabled={batchRunning || !cards.length} style={secondaryButton}>
            Clear queue
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
          <StatusBox label="Queue" status={cards.length ? "queued" : "incomplete"} detail={`${cards.length}/${MAX_BATCH_CARDS} cards`} />
          <StatusBox label="Complete pairs" status={readyCount ? "complete" : "incomplete"} detail={`${readyCount} ready to scan`} />
          <StatusBox label="Finished" status={completeCount ? "done" : "queued"} detail={`${completeCount} completed`} />
          <StatusBox label="Failures" status={errorCount ? "error" : "complete"} detail={`${errorCount} failed`} />
        </div>

        {message ? (
          <div style={{ marginTop: 14, padding: 12, background: "#edf3ff", borderRadius: 9 }}>
            {message}
          </div>
        ) : null}
        {globalError ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              background: "#fff0f0",
              border: "1px solid #e1a3a3",
              borderRadius: 9,
              color: "#8a1c1c",
              fontWeight: 700,
            }}
          >
            {globalError}
          </div>
        ) : null}
      </section>

      {cards.length ? (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Card queue</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {cards.map((card, index) => {
              const selected = card.id === activeCardId;
              return (
                <article
                  key={card.id}
                  style={{
                    border: selected ? "2px solid #1d4ed8" : "1px solid #ddd",
                    borderRadius: 12,
                    padding: 12,
                    background: selected ? "#f7faff" : "white",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(70px, 90px) minmax(70px, 90px) minmax(220px, 1fr)",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      {card.frontPreview ? (
                        <img src={card.frontPreview} alt={`Card ${index + 1} front`} style={{ ...queuePreviewStyle, transform: `rotate(${card.result?.imageOrientation?.frontRotation || 0}deg)` }} />
                      ) : (
                        <div style={missingPreviewStyle}>Missing front</div>
                      )}
                      <label style={tinyButtonStyle}>
                        Replace front
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={batchRunning}
                          onChange={(event) => {
                            replaceSide(card.id, "front", event.target.files?.[0] || null);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div>
                      {card.backPreview ? (
                        <img src={card.backPreview} alt={`Card ${index + 1} back`} style={{ ...queuePreviewStyle, transform: `rotate(${card.result?.imageOrientation?.backRotation || 0}deg)` }} />
                      ) : (
                        <div style={missingPreviewStyle}>Missing back</div>
                      )}
                      <label style={tinyButtonStyle}>
                        Replace back
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={batchRunning}
                          onChange={(event) => {
                            replaceSide(card.id, "back", event.target.files?.[0] || null);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <strong>Card {index + 1}</strong>
                        <span
                          style={{
                            ...statusTone(card.status),
                            border: "1px solid",
                            borderRadius: 999,
                            padding: "4px 8px",
                            fontSize: 12,
                            fontWeight: 800,
                            textTransform: "uppercase",
                          }}
                        >
                          {card.status}
                        </span>
                        <span style={{ fontSize: 12, color: "#666" }}>
                          {card.pairing === "filename" ? "paired by filename" : "paired by drop order"}
                        </span>
                      </div>
                      <div style={{ marginTop: 7, fontWeight: 800 }}>{cardIdentityTitle(card)}</div>
                      {card.error ? (
                        <div style={{ marginTop: 7, color: "#8a1c1c", fontWeight: 700 }}>
                          {card.error}
                        </div>
                      ) : null}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                        <button type="button" onClick={() => setActiveCardId(card.id)} style={tinyButtonStyle}>
                          {selected ? "Viewing" : "View result"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void scanOne(card.id)}
                          disabled={batchRunning || card.status === "scanning" || !card.front || !card.back}
                          style={tinyButtonStyle}
                        >
                          {card.status === "scanning" ? "Scanning…" : card.result ? "Rescan" : "Scan card"}
                        </button>
                        <button type="button" onClick={() => swapSides(card.id)} disabled={batchRunning} style={tinyButtonStyle}>
                          Swap front/back
                        </button>
                        <button type="button" onClick={() => removeCard(card.id)} disabled={batchRunning} style={tinyButtonStyle}>
                          Remove
                        </button>
                        {card.result ? (
                          <button type="button" onClick={() => void copyDiagnostics(card)} style={tinyButtonStyle}>
                            {copiedCardId === card.id ? "Copied diagnostics" : "Copy diagnostics"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeCard && !activeCard.result ? (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Selected card result</h2>
          <p style={{ marginBottom: 0, color: "#555" }}>
            {activeCard.status === "scanning"
              ? "This card is running through the real identity and exact-market pipeline."
              : activeCard.error || "Scan this card to see its exact identity, sold comps, active competition, and provider diagnostics."}
          </p>
        </section>
      ) : null}

      {result?.ai && exactMarket ? (
        <>
          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Verified scan result</h2>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{cardIdentityTitle(activeCard!) || "Identity incomplete"}</div>
            <div style={{ color: "#555", marginTop: 6 }}>Exact query: {exactMarket.query}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
              <StatusBox
                label="Images"
                status={diagnostics?.request?.frontReceived && diagnostics?.request?.backReceived ? "complete" : "error"}
                detail={`Front ${diagnostics?.request?.frontReceived ? "received" : "missing"}; back ${diagnostics?.request?.backReceived ? "received" : "missing"}`}
              />
              <StatusBox
                label="Orientation"
                status={result.imageOrientation?.status || "review"}
                detail={`Front ${result.imageOrientation?.frontRotation || 0}°; back ${result.imageOrientation?.backRotation || 0}°`}
              />
              <StatusBox
                label="Identity"
                status={diagnostics?.identity?.status || "review"}
                detail={`Confidence ${confidence(result.ai.confidence)}`}
              />
              <StatusBox
                label="Exact sold"
                status={exactMarket.soldCount ? "ready" : exactMarket.status}
                detail={`${exactMarket.soldCount} strict exact sold comp${exactMarket.soldCount === 1 ? "" : "s"}`}
              />
              <StatusBox
                label="Exact active"
                status={exactMarket.activeCount ? "ready" : exactMarket.status}
                detail={`${exactMarket.activeCount} exact active listing${exactMarket.activeCount === 1 ? "" : "s"}`}
              />
              <StatusBox
                label="Database"
                status={diagnostics?.persistence?.status || "skipped"}
                detail={diagnostics?.persistence?.message || "No save status returned."}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 16 }}>
              {[
                ["Player", result.ai.player],
                ["Year", result.ai.year],
                ["Manufacturer", result.ai.brand],
                ["Set", result.ai.setName],
                ["Card number", result.ai.cardNumber],
                ["Parallel", result.ai.parallel],
                ["Serial", result.ai.serialNumber],
                ["Team", result.ai.team],
                ["Sport", result.ai.sport],
                ["Rookie", result.ai.isRookie ? "Yes" : "No"],
                ["Autograph", result.ai.isAuto ? "Yes" : "No"],
                ["Relic", result.ai.isRelic ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#666", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontWeight: 700, marginTop: 3 }}>{value || "—"}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>InstaComp value</h2>
            {exactMarket.trustedSuggestedPrice !== null && exactMarket.soldCount > 0 ? (
              <div>
                <div style={{ fontSize: 42, fontWeight: 950 }}>
                  {money(exactMarket.trustedSuggestedPrice)}
                </div>
                <div style={{ fontWeight: 800, color: "#145c2e" }}>
                  SOLD-BACKED — {exactMarket.soldCount} strict exact sold comp{exactMarket.soldCount === 1 ? "" : "s"}
                </div>
                <div style={{ marginTop: 10, color: "#555" }}>
                  Sold range {money(exactMarket.pricing?.soldLow)}–{money(exactMarket.pricing?.soldHigh)};
                  sold median {money(exactMarket.pricing?.soldMedian)}. Active competition range {money(exactMarket.pricing?.activeLow)}–{money(exactMarket.pricing?.activeHigh)}.
                </div>
              </div>
            ) : (
              <div style={{ padding: 18, border: "2px solid #e6ca72", borderRadius: 10, background: "#fff7df" }}>
                <div style={{ fontSize: 24, fontWeight: 950 }}>PRICING PENDING</div>
                <div style={{ marginTop: 5, fontWeight: 700 }}>
                  Zero strict exact sold comps means InstaComp does not invent a value. Active listings remain visible only as competition.
                </div>
              </div>
            )}
            <p style={{ marginBottom: 0, color: "#555" }}>{result.note}</p>
          </section>

          <CompTable title={`Exact sold comps (${sold.length})`} comps={sold} lane="sold" />
          <CompTable title={`Exact active competition (${active.length})`} comps={active} lane="active" />

          <section style={sectionStyle}>
            <h3 style={{ marginTop: 0 }}>Runtime and provider diagnostics</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <StatusBox label="OpenAI key" status={runtime?.openAi ? "complete" : "error"} detail={runtime?.openAi ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="SerpApi key" status={runtime?.serpApi ? "complete" : "error"} detail={runtime?.serpApi ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="eBay keys" status={runtime?.ebay ? "complete" : "error"} detail={runtime?.ebay ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="Supabase" status={runtime?.supabase ? "complete" : "error"} detail={runtime?.supabase ? "Visible to this runtime" : "Missing from this runtime"} />
            </div>

            {exactMarket.providerMessages?.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                {exactMarket.providerMessages.map((provider, index) => (
                  <div key={`${provider.label}-${index}`} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
                    <strong>{provider.label}</strong> — {provider.status} — {provider.results} result{provider.results === 1 ? "" : "s"}
                    {provider.message ? <div style={{ marginTop: 4, color: "#555" }}>{provider.message}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
              Pipeline mode: {diagnostics?.mode || "unknown"}; simulated: {String(diagnostics?.simulated)}; duration: {diagnostics?.durationMs ? `${(diagnostics.durationMs / 1000).toFixed(1)} seconds` : "not reported"}; scan ID: {result.scanId || "not saved"}.
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #d8d8d8",
  borderRadius: 14,
  padding: 20,
  background: "white",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.04)",
};

const dropZoneStyle: React.CSSProperties = {
  border: "2px dashed",
  borderRadius: 14,
  padding: 28,
  minHeight: 210,
  display: "grid",
  placeItems: "center",
  alignContent: "center",
  gap: 12,
  textAlign: "center",
  transition: "background 120ms ease, border-color 120ms ease",
};

const chooseButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #111",
  borderRadius: 9,
  background: "#111",
  color: "white",
  fontWeight: 850,
  padding: "11px 16px",
  cursor: "pointer",
};

const queuePreviewStyle: React.CSSProperties = {
  width: "100%",
  height: 112,
  objectFit: "contain",
  borderRadius: 8,
  background: "#f4f4f4",
};

const missingPreviewStyle: React.CSSProperties = {
  width: "100%",
  height: 112,
  display: "grid",
  placeItems: "center",
  border: "1px dashed #c18a22",
  borderRadius: 8,
  background: "#fff7df",
  color: "#765700",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "center",
};

const primaryButton: React.CSSProperties = {
  border: "1px solid #111",
  borderRadius: 9,
  background: "#111",
  color: "white",
  fontWeight: 850,
  padding: "12px 18px",
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid #999",
  borderRadius: 9,
  background: "white",
  color: "#222",
  fontWeight: 750,
  padding: "12px 16px",
  cursor: "pointer",
};

const tinyButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #aaa",
  borderRadius: 7,
  background: "white",
  color: "#222",
  fontSize: 12,
  fontWeight: 750,
  padding: "6px 9px",
  cursor: "pointer",
  marginTop: 5,
};

const inlineControlStyle: React.CSSProperties = {
  border: "1px solid #bbb",
  borderRadius: 9,
  padding: "6px 10px",
  background: "white",
  fontWeight: 750,
};

const th: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 12,
  color: "#555",
};

const td: React.CSSProperties = {
  padding: "12px 8px",
  verticalAlign: "top",
};
