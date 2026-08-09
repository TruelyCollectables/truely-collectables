"use client";

import { useMemo, useRef, useState } from "react";

type Rotation = 0 | 90 | 180 | 270;

type Orientation = {
  status?: string | null;
  frontRotation?: number | null;
  backRotation?: number | null;
  frontConfidence?: number | null;
  backConfidence?: number | null;
};

type CompRow = {
  title?: string | null;
  price?: number | null;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  url?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
  sourceCategory?: string | null;
  soldAt?: string | null;
  seller?: string | null;
  sellerName?: string | null;
  sellerFeedbackPercent?: number | string | null;
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
    confidence?: number | null;
    isAuto?: boolean | null;
    isRelic?: boolean | null;
  } | null;
  imageOrientation?: Orientation | null;
  ocrDiagnostics?: { imageOrientation?: Orientation | null } | null;
  soldComps?: CompRow[];
  activeComps?: CompRow[];
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
    } | null;
    teacherConsensus?: {
      configuredTeachers?: string[];
      requiredVotes?: number | null;
    } | null;
  } | null;
};

type QueueCard = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: "queued" | "identifying" | "exact_market" | "ready" | "error";
  fastResult: ScanPayload | null;
  exactResult: ScanPayload | null;
  error: string | null;
  identityMs: number | null;
  totalMs: number | null;
  frontAutoRotation: Rotation;
  backAutoRotation: Rotation;
};

const MAX_SCAN_EDGE = 2400;
const IDENTITY_CONCURRENCY = 2;

function readElapsedClockMs() {
  return performance.now();
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

function seconds(ms: number | null) {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function confidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number <= 1 ? number * 100 : number)}%`;
}

function validRotation(value: unknown): Rotation {
  const number = Number(value);
  return number === 90 || number === 180 || number === 270 ? number : 0;
}

function orientationFrom(result: ScanPayload | null) {
  return result?.imageOrientation || result?.ocrDiagnostics?.imageOrientation || null;
}

function pairKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/(?:^|[-_ .])(front|obverse|obv|back|reverse|rev)(?:$|[-_ .])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sideFromName(name: string): "front" | "back" | null {
  const lower = name.toLowerCase();
  if (/(?:^|[-_ .])(front|obverse|obv)(?:$|[-_ .])/.test(lower)) return "front";
  if (/(?:^|[-_ .])(back|reverse|rev)(?:$|[-_ .])/.test(lower)) return "back";
  return null;
}

function pairFiles(files: File[]) {
  const named = new Map<string, { front?: File; back?: File }>();
  const loose: File[] = [];

  for (const file of files) {
    const side = sideFromName(file.name);
    if (!side) {
      loose.push(file);
      continue;
    }
    const key = pairKey(file.name) || file.name;
    const row = named.get(key) || {};
    row[side] = file;
    named.set(key, row);
  }

  const pairs: Array<{ front: File; back: File | null }> = [];
  for (const row of named.values()) {
    if (row.front) pairs.push({ front: row.front, back: row.back || null });
    else if (row.back) loose.push(row.back);
  }
  for (let index = 0; index < loose.length; index += 2) {
    pairs.push({ front: loose[index], back: loose[index + 1] || null });
  }
  return pairs;
}

async function bitmap(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function renderImage(
  file: File,
  label: string,
  rotation: Rotation = 0,
  resize = true,
) {
  const source = await bitmap(file);
  const scale = resize
    ? Math.min(1, MAX_SCAN_EDGE / Math.max(source.width, source.height))
    : 1;
  const sourceWidth = Math.max(1, Math.round(source.width * scale));
  const sourceHeight = Math.max(1, Math.round(source.height * scale));
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? sourceHeight : sourceWidth;
  canvas.height = swap ? sourceWidth : sourceHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    source.close();
    throw new Error("Browser image preparation failed.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(
    source,
    -sourceWidth / 2,
    -sourceHeight / 2,
    sourceWidth,
    sourceHeight,
  );
  source.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Image conversion failed."))),
      "image/jpeg",
      0.9,
    );
  });
  return new File([blob], `${label}.jpg`, { type: "image/jpeg" });
}

async function applySemanticOrientation(card: QueueCard, result: ScanPayload) {
  const orientation = orientationFrom(result);
  const frontRotation = validRotation(orientation?.frontRotation);
  const backRotation = validRotation(orientation?.backRotation);
  const [front, back] = await Promise.all([
    frontRotation
      ? renderImage(card.front, `instacomp-${card.id}-front-upright`, frontRotation, false)
      : Promise.resolve(card.front),
    card.back && backRotation
      ? renderImage(card.back, `instacomp-${card.id}-back-upright`, backRotation, false)
      : Promise.resolve(card.back),
  ]);

  return {
    ...card,
    front,
    back,
    frontPreview:
      front === card.front ? card.frontPreview : URL.createObjectURL(front),
    backPreview:
      back === card.back
        ? card.backPreview
        : back
          ? URL.createObjectURL(back)
          : null,
    frontAutoRotation: frontRotation,
    backAutoRotation: backRotation,
  };
}

function title(result: ScanPayload | null) {
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

export default function InstaCompFastDropScannerV2() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const totals = useMemo(
    () => ({
      cards: cards.length,
      ready: cards.filter((card) => card.status === "ready").length,
      under10: cards.filter(
        (card) => card.identityMs !== null && card.identityMs <= 10_000,
      ).length,
      errors: cards.filter((card) => card.status === "error").length,
    }),
    [cards],
  );

  function patch(id: string, values: Partial<QueueCard>) {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, ...values } : card)),
    );
  }

  async function exactMarket(card: QueueCard, startedAt: number) {
    if (!card.back) {
      patch(card.id, { status: "ready", totalMs: readElapsedClockMs() - startedAt });
      return;
    }
    patch(card.id, { status: "exact_market" });
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
        throw new Error(data.error || "Exact comps failed.");
      }
      patch(card.id, {
        exactResult: data,
        status: "ready",
        totalMs: readElapsedClockMs() - startedAt,
      });
    } catch (error) {
      patch(card.id, {
        status: "ready",
        totalMs: readElapsedClockMs() - startedAt,
        error:
          error instanceof Error
            ? `Identity succeeded; exact comps failed: ${error.message}`
            : "Identity succeeded; exact comps failed.",
      });
    }
  }

  async function identify(card: QueueCard) {
    const startedAt = readElapsedClockMs();
    patch(card.id, { status: "identifying", error: null });
    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      if (card.back) form.append("backImage", card.back, card.back.name);
      // Fast first answer: authenticated local/deterministic + Registry lane.
      // The background exact-market pass below remains adaptive.
      form.append("aiCouncilTier", "basic");
      const response = await fetch("/api/instacomp/scan-fast", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ScanPayload;
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "InstaComp could not identify this card.");
      }
      const oriented = await applySemanticOrientation(card, data);
      const identityMs = readElapsedClockMs() - startedAt;
      const next: QueueCard = {
        ...oriented,
        fastResult: data,
        status: oriented.back ? "exact_market" : "ready",
        identityMs,
        totalMs: oriented.back ? null : identityMs,
      };
      setCards((current) =>
        current.map((row) => (row.id === card.id ? next : row)),
      );
      if (next.back) void exactMarket(next, startedAt);
    } catch (error) {
      patch(card.id, {
        status: "error",
        identityMs: readElapsedClockMs() - startedAt,
        totalMs: readElapsedClockMs() - startedAt,
        error: error instanceof Error ? error.message : "Card identification failed.",
      });
    }
  }

  async function runQueue(queue: QueueCard[]) {
    for (let index = 0; index < queue.length; index += IDENTITY_CONCURRENCY) {
      await Promise.all(queue.slice(index, index + IDENTITY_CONCURRENCY).map(identify));
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
        const stamp = `${readElapsedClockMs()}-${index + 1}`;
        const [front, back] = await Promise.all([
          renderImage(pair.front, `instacomp-${stamp}-front`),
          pair.back
            ? renderImage(pair.back, `instacomp-${stamp}-back`)
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
          error: back ? null : "Back image missing; exact-card comp trust will be limited.",
          identityMs: null,
          totalMs: null,
          frontAutoRotation: 0,
          backAutoRotation: 0,
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

  async function manualRotate(card: QueueCard, side: "front" | "back") {
    const source = side === "front" ? card.front : card.back;
    if (!source) return;
    const rotated = await renderImage(source, `instacomp-${card.id}-${side}-manual`, 90, false);
    patch(card.id, {
      ...(side === "front"
        ? { front: rotated, frontPreview: URL.createObjectURL(rotated) }
        : { back: rotated, backPreview: URL.createObjectURL(rotated) }),
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
            <h2 className="mt-1 text-2xl font-black">Drop fronts + backs. Scanning starts itself.</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-neutral-300">
              Camera/EXIF orientation is normalized before upload. After InstaComp reads the card,
              its own text-orientation decision rotates sideways scanner images upright too.
              Identity uses the basic local/Registry lane first; exact comps and teacher learning
              continue in the background.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Summary label="Cards" value={totals.cards} />
            <Summary label="Ready" value={totals.ready} />
            <Summary label="≤10 sec" value={totals.under10} />
            <Summary label="Errors" value={totals.errors} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragging(false); }}
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
            {preparing ? "ROTATING + PREPARING…" : "DROP CARD IMAGES HERE"}
          </span>
          <span className="mt-2 text-sm font-semibold text-neutral-300">
            Front, back, front, back… or filenames containing FRONT/BACK
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void acceptFiles(event.target.files);
          }}
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {cards.map((card) => (
          <CardPanel
            key={card.id}
            card={card}
            onRotate={(side) => void manualRotate(card, side)}
            onRescan={() => rescan(card)}
            onRemove={() => setCards((current) => current.filter((row) => row.id !== card.id))}
          />
        ))}
      </div>
    </div>
  );
}

function CardPanel({
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
  const trustedPrice =
    exact?.trustedSuggestedPrice ??
    card.exactResult?.stats?.suggestedPrice ??
    card.fastResult?.stats?.suggestedPrice ??
    null;
  const under10 = card.identityMs !== null && card.identityMs <= 10_000;

  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge>{card.status === "exact_market" ? "EXACT COMPS RUNNING" : card.status.toUpperCase()}</Badge>
            {card.identityMs !== null ? (
              <Badge tone={under10 ? "green" : "amber"}>ID {seconds(card.identityMs)}</Badge>
            ) : null}
            {card.frontAutoRotation || card.backAutoRotation ? (
              <Badge tone="cyan">
                AUTO ROTATED F{card.frontAutoRotation}° / B{card.backAutoRotation}°
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-2 break-words text-lg font-black">{title(result)}</h3>
        </div>
        <button type="button" onClick={onRemove} className="text-xs font-black text-neutral-500">
          Remove
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 bg-neutral-100 p-3">
        <ImagePanel label="FRONT" src={card.frontPreview} onRotate={() => onRotate("front")} />
        <ImagePanel label="BACK" src={card.backPreview} onRotate={() => onRotate("back")} />
      </div>

      {ai ? (
        <div className="grid grid-cols-2 gap-px bg-neutral-200 sm:grid-cols-4">
          <Metric label="Confidence" value={confidence(ai.confidence)} />
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
          <p className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm font-bold text-cyan-900">
            Identity is already available. Exact sold comps + teacher learning are still running.
          </p>
        ) : null}
        {card.exactResult ? (
          <div className="grid gap-2 sm:grid-cols-4">
            <MetricCard label="Trusted price" value={money(trustedPrice)} />
            <MetricCard label="Sold comps" value={String(exact?.soldCount ?? sold.length)} />
            <MetricCard label="Active" value={String(exact?.activeCount ?? active.length)} />
            <MetricCard
              label="Student lesson"
              value={exact?.teacherLearning?.studentTrainingEligible ? "ELIGIBLE" : exact?.teacherLearning?.status || "—"}
            />
          </div>
        ) : null}
        {sold.length ? <CompList title="Exact sold evidence" rows={sold.slice(0, 5)} /> : null}
        {active.length ? <CompList title="Active evidence" rows={active.slice(0, 5)} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRescan}
            disabled={card.status === "identifying" || card.status === "exact_market"}
            className="rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            Rescan
          </button>
          {card.totalMs !== null ? (
            <span className="text-xs font-bold text-neutral-500">Full pipeline {seconds(card.totalMs)}</span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ImagePanel({ label, src, onRotate }: { label: string; src: string | null; onRotate: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <span className="text-[11px] font-black tracking-widest text-neutral-500">{label}</span>
        {src ? (
          <button type="button" onClick={onRotate} className="rounded border px-2 py-1 text-[11px] font-black">
            ↻ 90°
          </button>
        ) : null}
      </div>
      {src ? (
        <img src={src} alt={`${label.toLowerCase()} card`} className="h-64 w-full object-contain" />
      ) : (
        <div className="flex h-64 items-center justify-center text-sm font-bold text-neutral-400">No back</div>
      )}
    </div>
  );
}

function CompList({ title: heading, rows }: { title: string; rows: CompRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200">
      <div className="border-b bg-neutral-50 px-3 py-2 text-xs font-black uppercase tracking-wider text-neutral-600">
        {heading}
      </div>
      <div className="divide-y">
        {rows.map((row, index) => {
          const seller = row.sellerName || row.seller || null;
          const delivered =
            Number(row.itemPrice) > 0
              ? Number(row.itemPrice) + Math.max(0, Number(row.shippingPrice) || 0)
              : Number(row.price) || null;
          return (
            <div key={`${row.url || row.title || index}-${index}`} className="flex items-start justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-black">{row.title || "Comp"}</p>
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
                  <a href={row.url} target="_blank" rel="noreferrer" className="text-xs font-black text-blue-700 underline">
                    Open
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Badge({ children, tone = "dark" }: { children: React.ReactNode; tone?: "dark" | "green" | "amber" | "cyan" }) {
  const classes = {
    dark: "bg-neutral-950 text-white",
    green: "bg-emerald-100 text-emerald-800",
    amber: "bg-amber-100 text-amber-800",
    cyan: "bg-cyan-100 text-cyan-800",
  }[tone];
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${classes}`}>{children}</span>;
}

function Summary({ label, value }: { label: string; value: number }) {
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
      <p className="mt-1 break-words text-sm font-black">{value}</p>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 break-words text-base font-black">{value}</p>
    </div>
  );
}
