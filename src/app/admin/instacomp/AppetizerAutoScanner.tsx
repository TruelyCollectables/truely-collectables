"use client";

import { useMemo, useRef, useState } from "react";

type ScanResult = {
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
  } | null;
  exactMarket?: {
    status?: string | null;
    trustedSuggestedPrice?: number | null;
    soldCount?: number | null;
    activeCount?: number | null;
  } | null;
  stats?: { suggestedPrice?: number | null } | null;
  soldStats?: { suggestedPrice?: number | null } | null;
  knowledge?: {
    mode?: string | null;
    confirmationStatus?: string | null;
    knowledgeEntryId?: string | null;
    cacheHit?: boolean | null;
  } | null;
};

type CardRow = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: "queued" | "running" | "done" | "error";
  result: ScanResult | null;
  error: string | null;
};

const MAX_CARDS = 30;
const CONCURRENCY = 2;

function sideFromName(name: string): "front" | "back" | null {
  const lower = name.toLowerCase();
  if (/(?:^|[-_ .])(front|obverse|obv)(?:$|[-_ .])/.test(lower)) return "front";
  if (/(?:^|[-_ .])(back|reverse|rev)(?:$|[-_ .])/.test(lower)) return "back";
  return null;
}

function pairKey(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/(?:^|[-_ .])(front|obverse|obv|back|reverse|rev)(?:$|[-_ .])/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  return pairs.slice(0, MAX_CARDS);
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

function confidence(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number <= 1 ? number * 100 : number)}%`;
}

function title(result: ScanResult | null) {
  const ai = result?.ai;
  if (!ai) return "Waiting for InstaComp…";
  return [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.parallel,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    ai.serialNumber,
  ]
    .filter(Boolean)
    .join(" ");
}

function suggestedPrice(result: ScanResult | null) {
  return (
    result?.exactMarket?.trustedSuggestedPrice ??
    result?.soldStats?.suggestedPrice ??
    result?.stats?.suggestedPrice ??
    null
  );
}

export default function AppetizerAutoScanner() {
  const [cards, setCards] = useState<CardRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const totals = useMemo(
    () => ({
      cards: cards.length,
      running: cards.filter((card) => card.status === "running").length,
      done: cards.filter((card) => card.status === "done").length,
      errors: cards.filter((card) => card.status === "error").length,
    }),
    [cards],
  );

  function patch(id: string, values: Partial<CardRow>) {
    setCards((current) =>
      current.map((card) => (card.id === id ? { ...card, ...values } : card)),
    );
  }

  async function runCard(card: CardRow) {
    patch(card.id, { status: "running", error: null });

    try {
      const form = new FormData();
      form.append("frontImage", card.front, card.front.name);
      if (card.back) form.append("backImage", card.back, card.back.name);
      form.append("aiCouncilTier", "adaptive");

      const response = await fetch("/api/instacomp/scan-fast", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ScanResult;

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `InstaComp failed (${response.status}).`);
      }

      patch(card.id, { status: "done", result: data, error: null });
    } catch (error) {
      patch(card.id, {
        status: "error",
        error: error instanceof Error ? error.message : "InstaComp failed.",
      });
    }
  }

  async function runQueue(queue: CardRow[]) {
    for (let index = 0; index < queue.length; index += CONCURRENCY) {
      await Promise.all(queue.slice(index, index + CONCURRENCY).map(runCard));
    }
  }

  async function acceptFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;

    setPreparing(true);
    setMessage(null);

    try {
      const pairs = pairFiles(files);
      const next = pairs.map<CardRow>((pair) => ({
        id: crypto.randomUUID(),
        front: pair.front,
        back: pair.back,
        frontPreview: URL.createObjectURL(pair.front),
        backPreview: pair.back ? URL.createObjectURL(pair.back) : null,
        status: "queued",
        result: null,
        error: pair.back ? null : "Back image missing; exact-card confidence may be limited.",
      }));

      setCards(next);
      setMessage(
        `Loaded ${next.length} card${next.length === 1 ? "" : "s"}. InstaComp started automatically. Images are being used exactly as uploaded — no auto-rotation.`,
      );

      void runQueue(next);
    } finally {
      setPreparing(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function clear() {
    cards.forEach((card) => {
      URL.revokeObjectURL(card.frontPreview);
      if (card.backPreview) URL.revokeObjectURL(card.backPreview);
    });
    setCards([]);
    setMessage(null);
  }

  function swap(card: CardRow) {
    if (!card.back) return;
    setCards((current) =>
      current.map((row) =>
        row.id === card.id
          ? {
              ...row,
              front: card.back!,
              back: card.front,
              frontPreview: card.backPreview!,
              backPreview: card.frontPreview,
              status: "queued",
              result: null,
              error: null,
            }
          : row,
      ),
    );

    const swapped: CardRow = {
      ...card,
      front: card.back,
      back: card.front,
      frontPreview: card.backPreview || card.frontPreview,
      backPreview: card.frontPreview,
      status: "queued",
      result: null,
      error: null,
    };
    void runCard(swapped);
  }

  return (
    <section className="mb-7 overflow-hidden rounded-3xl border-2 border-emerald-300 bg-emerald-50 shadow-sm">
      <div className="border-b border-emerald-200 bg-emerald-100 px-5 py-4">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">
          25–30 card appetizer
        </p>
        <h2 className="mt-1 text-2xl font-black text-emerald-950">
          Drop them in. InstaComp starts by itself.
        </h2>
        <p className="mt-2 max-w-4xl text-sm font-semibold text-emerald-950">
          Your scans are already upright, so this lane does not rotate or re-orient them.
          Named front/back files pair by filename; otherwise images pair in upload order.
          Maximum {MAX_CARDS} cards for this appetizer run.
        </p>
      </div>

      <div className="p-5">
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
            event.dataTransfer.dropEffect = "copy";
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
          className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
            dragging ? "border-blue-500 bg-blue-50" : "border-emerald-400 bg-white"
          }`}
        >
          <div className="text-xl font-black">Drop 50–60 front/back images here</div>
          <div className="mt-2 text-sm font-semibold text-neutral-600">
            No Scan Batch button. Processing begins immediately after pairing.
          </div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={preparing}
            className="mt-4 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            {preparing ? "Loading images…" : "Choose images"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void acceptFiles(event.target.files);
            }}
          />
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {message}
          </div>
        ) : null}

        {cards.length ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2 text-sm font-black">
              <span className="rounded-full bg-neutral-900 px-3 py-2 text-white">{totals.cards} cards</span>
              <span className="rounded-full bg-blue-100 px-3 py-2 text-blue-900">{totals.running} running</span>
              <span className="rounded-full bg-emerald-100 px-3 py-2 text-emerald-900">{totals.done} done</span>
              <span className="rounded-full bg-red-100 px-3 py-2 text-red-900">{totals.errors} errors</span>
              <button
                type="button"
                onClick={clear}
                className="rounded-full border border-neutral-300 bg-white px-3 py-2 text-neutral-800"
              >
                Clear appetizer
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {cards.map((card, index) => (
                <article key={card.id} className="rounded-2xl border border-neutral-200 bg-white p-4">
                  <div className="grid gap-4 md:grid-cols-[90px_90px_1fr] md:items-center">
                    <img
                      src={card.frontPreview}
                      alt={`Card ${index + 1} front`}
                      className="h-28 w-full rounded-lg bg-neutral-100 object-contain"
                    />
                    {card.backPreview ? (
                      <img
                        src={card.backPreview}
                        alt={`Card ${index + 1} back`}
                        className="h-28 w-full rounded-lg bg-neutral-100 object-contain"
                      />
                    ) : (
                      <div className="grid h-28 place-items-center rounded-lg border border-dashed border-amber-400 bg-amber-50 text-xs font-black text-amber-900">
                        No back
                      </div>
                    )}

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>Card {index + 1}</strong>
                        <span className="rounded-full border border-neutral-300 px-2 py-1 text-xs font-black uppercase">
                          {card.status}
                        </span>
                        {card.back ? (
                          <button
                            type="button"
                            onClick={() => swap(card)}
                            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-black"
                          >
                            Swap + rescan
                          </button>
                        ) : null}
                      </div>

                      <div className="mt-2 text-lg font-black">{title(card.result)}</div>

                      {card.result?.ai ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-neutral-700">
                          <span>Confidence {confidence(card.result.ai.confidence)}</span>
                          <span>Price {money(suggestedPrice(card.result))}</span>
                          <span>Sold {card.result.exactMarket?.soldCount ?? "—"}</span>
                          <span>Active {card.result.exactMarket?.activeCount ?? "—"}</span>
                          <span>
                            Learning {card.result.knowledge?.confirmationStatus || card.result.knowledge?.mode || "saved"}
                          </span>
                        </div>
                      ) : null}

                      {card.error ? (
                        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
                          {card.error}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
