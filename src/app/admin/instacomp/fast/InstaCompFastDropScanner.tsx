"use client";

import { useMemo, useRef, useState } from "react";

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
  seller?: string | null;
  sellerName?: string | null;
  sellerFeedbackPercent?: number | string | null;
  sellerFeedbackScore?: number | null;
};

type ScanPayload = {
  ok?: boolean;
  error?: string;
  scanId?: string | null;
  ai?: {
    player?: string | null;
    year?: string | null;
    brand?: string | null;
    setName?: string | null;
    cardNumber?: string | null;
    parallel?: string | null;
    serialNumber?: string | null;
    team?: string | null;
    sport?: string | null;
    confidence?: number | null;
    isRookie?: boolean | null;
    isAuto?: boolean | null;
    isRelic?: boolean | null;
  } | null;
  soldComps?: CompRow[];
  activeComps?: CompRow[];
  note?: string | null;
  stats?: {
    suggestedPrice?: number | null;
  } | null;
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

type QueueCard = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status:
    | "queued"
    | "identifying"
    | "identified"
    | "exact_market"
    | "ready"
    | "error";
  fastResult: ScanPayload | null;
  exactResult: ScanPayload | null;
  error: string | null;
  identityMs: number | null;
  totalMs: number | null;
};

const MAX_SCAN_EDGE = 2400;
const IDENTITY_CONCURRENCY = 2;

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "—";
  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
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
  if (/(?:^|[-_ .])(front|obverse|obv)(?:$|[-_ .])/.test(lower)) return "front";
  if (/(?:^|[-_ .])(back|reverse|rev)(?:$|[-_ .])/.test(lower)) return "back";
  return null;
}

function pairFiles(files: File[]) {
  const byKey = new Map<string, { front?: File; back?: File; loose: File[] }>();
  const unlabeled: File[] = [];

  for (const file of files) {
    const side = sideFromName(file.name);
    if (!side) {
      unlabeled.push(file);
      continue;
    }
    const key = pairKey(file.name) || file.name;
    const row = byKey.get(key) || { loose: [] };
    row[side] = file;
    byKey.set(key, row);
  }

  const pairs: Array<{ front: File; back: File | null }> = [];
  for (const row of byKey.values()) {
    if (row.front) pairs.push({ front: row.front, back: row.back || null });
    else if (row.back) unlabeled.push(row.back);
  }

  for (let index = 0; index < unlabeled.length; index += 2) {
    pairs.push({
      front: unlabeled[index],
      back: unlabeled[index + 1] || null,
    });
  }

  return pairs;
}

async function bitmapFromFile(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return await createImageBitmap(file);
    }
  }

  throw new Error("This browser does not support fast image normalization.");
}

async function normalizedCardImage(file: File, label: string) {
  const bitmap = await bitmapFromFile(file);
  const scale = Math.min(1, MAX_SCAN_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    throw new Error("The browser could not prepare the card image.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Image conversion failed."))),
      "image/jpeg",
      0.9,
    );
  });

  return new File([blob], `${label}.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

async function rotateCardImage(file: File, degrees: 90 | 180 | 270, label: string) {
  const bitmap = await bitmapFromFile(file);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? bitmap.height : bitmap.width;
  canvas.height = swap ? bitmap.width : bitmap.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    throw new Error("The browser could not rotate the card image.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Image rotation failed."))),
      "image/jpeg",
      0.9,
    );
  });
  return new File([blob], `${label}.jpg`, { type: "image/jpeg" });
}

function identityTitle(result: ScanPayload | null) {
  const ai = result?.ai;
  if (!ai) return "Identifying card…";
  return [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.parallel,
    ai.cardNumber ? `#${ai.cardNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function statusLabel(card: QueueCard) {
  if (card.status === "identifying") return "IDENTIFYING";
  if (card.status === "identified") return "IDENTIFIED";
  if (card.status === "exact_market") return "EXACT COMPS RUNNING";
  if (card.status === "ready") return "READY";
  if (card.status === "error") return "ERROR";
  return "QUEUED";
}

export default function InstaCompFastDropScanner() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const summary = useMemo(() => {
    return {
      total: cards.length,
      ready: cards.filter((card) => card.status === "ready").length,
      errors: cards.filter((card) => card.status === "error").length,
      fast: cards.filter(
        (card) => card.identityMs !== null && card.identityMs <= 10_000,
      ).length,
    };
  }, [cards]);

  function patchCard(id: string, patch: Partial<QueueCard>) {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, ...patch } : card)),
    );
  }

  async function exactMarket(card: QueueCard, startedAt: number) {
    if (!card.back) {
      patchCard(card.id, { status: "ready", totalMs: Date.now() - startedAt });
      return;
    }

    patchCard(card.id, { status: "exact_market" });
    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      form.append("backImage", card.back, card.back.name);
      form.append("aiCouncilTier", "adaptive");
      const response = await fetch("/api/instacomp/live-scan", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ScanPayload;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Exact-market scan failed.");
      }
      patchCard(card.id, {
        exactResult: data,
        status: "ready",
        totalMs: Date.now() - startedAt,
      });
    } catch (error) {
      patchCard(card.id, {
        status: "ready",
        totalMs: Date.now() - startedAt,
        error:
          error instanceof Error
            ? `Identity succeeded; exact comps failed: ${error.message}`
            : "Identity succeeded; exact comps failed.",
      });
    }
  }

  async function identify(card: QueueCard) {
    const startedAt = Date.now();
    patchCard(card.id, { status: "identifying", error: null });
    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      if (card.back) form.append("backImage", card.back, card.back.name);
      form.append("aiCouncilTier", "adaptive");
      const response = await fetch("/api/instacomp/scan-fast", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ScanPayload;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "InstaComp could not identify this card.");
      }
      const identityMs = Date.now() - startedAt;
      patchCard(card.id, {
        fastResult: data,
        identityMs,
        status: "identified",
      });
      void exactMarket(card, startedAt);
    } catch (error) {
      patchCard(card.id, {
        status: "error",
        identityMs: Date.now() - startedAt,
        totalMs: Date.now() - startedAt,
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
        const [front, back] = await Promise.all([
          normalizedCardImage(pair.front, `instacomp-${Date.now()}-${index + 1}-front`),
          pair.back
            ? normalizedCardImage(pair.back, `instacomp-${Date.now()}-${index + 1}-back`)
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
          error: back ? null : "Back image missing: identity can run, but exact-card pricing is limited.",
          identityMs: null,
          totalMs: null,
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
      identityMs: null,
      totalMs: null,
      error: null,
    });
  }

  function rescan(card: QueueCard) {
    const next = {
      ...card,
      status: "queued" as const,
      fastResult: null,
      exactResult: null,
      identityMs: null,
      totalMs: null,
      error: null,
    };
    setCards((current) => current.map((row) => (row.id === card.id ? next : row)));
    void identify(next);
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-950 text-white shadow-xl">
        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
              Fast card intake
            </p>
            <h2 className="mt-1 text-2xl font-black">Drag in card fronts + backs</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-neutral-300">
              Drop images in front/back order. Files named FRONT/BACK are paired automatically.
              Browser/EXIF orientation is normalized immediately, giant scans are resized to a
              2400px long edge, and identification starts automatically. Exact comps continue in
              the background after the identity appears.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <SummaryMetric label="Cards" value={summary.total} />
            <SummaryMetric label="Ready" value={summary.ready} />
            <SummaryMetric label="≤10 sec" value={summary.fast} />
            <SummaryMetric label="Errors" value={summary.errors} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
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
            void acceptFiles(event.dataTransfer.files);
          }}
          className={`m-5 mt-0 flex min-h-48 w-[calc(100%-2.5rem)] flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging
              ? "border-cyan-300 bg-cyan-300/15"
              : "border-white/25 bg-white/5 hover:border-cyan-300/70 hover:bg-white/10"
          }`}
        >
          <span className="text-4xl" aria-hidden="true">⬇️</span>
          <span className="mt-3 text-xl font-black">
            {preparing ? "Preparing images…" : "DROP CARD IMAGES HERE"}
          </span>
          <span className="mt-2 text-sm font-semibold text-neutral-300">
            Or click to choose multiple images · front, back, front, back…
          </span>
        </button>
        <input
          ref={inputRef}
          className="hidden"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            if (event.target.files) void acceptFiles(event.target.files);
          }}
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
              onRemove={() =>
                setCards((current) => current.filter((row) => row.id !== card.id))
              }
            />
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <p className="font-black text-neutral-700">No cards queued yet.</p>
          <p className="mt-1 text-sm font-semibold text-neutral-500">
            Drop one front/back pair above and the scan starts automatically.
          </p>
        </section>
      )}
    </div>
  );
}

function CardResult({
  card,
  onRotate,
  onRescan,
  onRemove,
}: {
  card: QueueCard;
  onRotate: (side: "front" | "back") => void;
  onRescan: () => void;
  onRemove: () => void;
}) {
  const result = card.exactResult || card.fastResult;
  const ai = result?.ai;
  const exact = card.exactResult?.exactMarket;
  const sold = exact?.sold || card.exactResult?.soldComps || card.fastResult?.soldComps || [];
  const active = exact?.active || card.exactResult?.activeComps || card.fastResult?.activeComps || [];
  const suggested =
    exact?.trustedSuggestedPrice ??
    card.exactResult?.stats?.suggestedPrice ??
    card.fastResult?.stats?.suggestedPrice ??
    null;
  const identityFast = card.identityMs !== null && card.identityMs <= 10_000;

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-[11px] font-black text-white">
              {statusLabel(card)}
            </span>
            {card.identityMs !== null ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                  identityFast
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                ID {elapsed(card.identityMs)}
              </span>
            ) : null}
            {card.totalMs !== null ? (
              <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-black text-neutral-700">
                FULL {elapsed(card.totalMs)}
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 break-words text-lg font-black text-neutral-950">
            {identityTitle(result)}
          </h3>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-black text-neutral-500 hover:bg-neutral-50"
        >
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-neutral-100 p-3">
        <ImagePanel label="FRONT" src={card.frontPreview} onRotate={() => onRotate("front")} />
        <ImagePanel label="BACK" src={card.backPreview} onRotate={() => onRotate("back")} />
      </div>

      {ai ? (
        <div className="grid grid-cols-2 gap-px bg-neutral-200 sm:grid-cols-4">
          <Metric label="Confidence" value={confidenceLabel(ai.confidence)} />
          <Metric label="Serial" value={ai.serialNumber || "—"} />
          <Metric label="Auto" value={ai.isAuto ? "YES" : "NO"} />
          <Metric label="Relic" value={ai.isRelic ? "YES" : "NO"} />
        </div>
      ) : null}

      <div className="space-y-3 p-4">
        {card.error ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">
            {card.error}
          </p>
        ) : null}

        {card.fastResult && !card.exactResult && card.back ? (
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm font-bold text-cyan-900">
            Identity is available now. Exact sold comps + teacher-learning evidence are still running in the background.
          </div>
        ) : null}

        {card.exactResult ? (
          <div className="grid gap-2 sm:grid-cols-4">
            <MetricCard label="Trusted price" value={money(suggested)} />
            <MetricCard label="Sold comps" value={String(exact?.soldCount ?? sold.length)} />
            <MetricCard label="Active" value={String(exact?.activeCount ?? active.length)} />
            <MetricCard
              label="Student lesson"
              value={
                exact?.teacherLearning?.studentTrainingEligible
                  ? "ELIGIBLE"
                  : exact?.teacherLearning?.status || "—"
              }
            />
          </div>
        ) : null}

        {sold.length ? (
          <CompList title="Exact sold evidence" rows={sold.slice(0, 5)} />
        ) : null}
        {active.length ? (
          <CompList title="Active evidence" rows={active.slice(0, 5)} />
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRescan}
            disabled={card.status === "identifying" || card.status === "exact_market"}
            className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            Rescan
          </button>
          {card.exactResult?.scanId ? (
            <span className="self-center break-all text-xs font-semibold text-neutral-500">
              Scan {card.exactResult.scanId}
            </span>
          ) : card.fastResult?.scanId ? (
            <span className="self-center break-all text-xs font-semibold text-neutral-500">
              Scan {card.fastResult.scanId}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ImagePanel({
  label,
  src,
  onRotate,
}: {
  label: string;
  src: string | null;
  onRotate: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-[11px] font-black tracking-widest text-neutral-500">{label}</span>
        {src ? (
          <button
            type="button"
            onClick={onRotate}
            className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-black text-neutral-700 hover:bg-neutral-50"
            title="Manual fallback if automatic image orientation is wrong"
          >
            ↻ 90°
          </button>
        ) : null}
      </div>
      {src ? (
        <img
          src={src}
          alt={`${label.toLowerCase()} card preview`}
          className="h-64 w-full object-contain [image-orientation:from-image]"
        />
      ) : (
        <div className="flex h-64 items-center justify-center p-4 text-center text-sm font-bold text-neutral-400">
          No back image
        </div>
      )}
    </div>
  );
}

function CompList({ title, rows }: { title: string; rows: CompRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-neutral-600">
        {title}
      </div>
      <div className="divide-y divide-neutral-100">
        {rows.map((row, index) => {
          const seller = row.sellerName || row.seller || null;
          const delivered =
            Number(row.itemPrice) > 0
              ? Number(row.itemPrice) + Math.max(0, Number(row.shippingPrice) || 0)
              : Number(row.price) || null;
          return (
            <div key={`${row.url || row.title || index}-${index}`} className="p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-black text-neutral-900">{row.title || "Comp"}</p>
                  <p className="mt-1 text-xs font-semibold text-neutral-500">
                    {row.sourceLabel || row.source || "Market source"}
                    {seller ? ` · Seller: ${seller}` : ""}
                    {row.sellerFeedbackPercent !== null && row.sellerFeedbackPercent !== undefined
                      ? ` · ${row.sellerFeedbackPercent}% feedback`
                      : ""}
                    {row.soldAt ? ` · Sold ${new Date(row.soldAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-black">{money(delivered)}</p>
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-black text-blue-700 underline"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-400">{label}</p>
      <p className="mt-1 text-xl font-black">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-neutral-900">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 break-words text-base font-black text-neutral-900">{value}</p>
    </div>
  );
}
