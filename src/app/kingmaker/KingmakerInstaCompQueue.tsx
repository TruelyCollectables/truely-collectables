"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { getFreshAccountSession } from "../account/account-session";

type IntakeResult = {
  success?: boolean;
  code?: string;
  error?: string;
  cardUuid?: string | null;
  inventoryItemId?: string | null;
  title?: string | null;
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
};

type QueueStatus = "queued" | "working" | "pending" | "review" | "error";

type QueueCard = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: QueueStatus;
  result: IntakeResult | null;
  error: string | null;
  durationMs: number | null;
  savingPrice: boolean;
};

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
  return pairs;
}

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

function identityRows(result: IntakeResult | null) {
  const identity = result?.scan?.trusted_identity || {};
  return [
    ["Year", identity.year],
    ["Product", identity.manufacturer || identity.brand],
    ["Set / Insert", identity.set_name],
    ["Player", identity.player],
    ["Card #", identity.card_number],
    ["Parallel", identity.parallel || "Base"],
    ["Serial", identity.serial_number],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function statusText(card: QueueCard) {
  if (card.status === "queued") return "Queued";
  if (card.status === "working") return "InstaComp AI identifying + exact comping";
  if (card.status === "pending") return "Pending Listing created";
  if (card.status === "review") return "Saved to Pending — review required";
  return "Stopped safely";
}

export default function KingmakerInstaCompQueue() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pageError, setPageError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  async function processCard(card: QueueCard) {
    if (!card.back) {
      patch(card.id, {
        status: "error",
        error: "Back image missing. Front and back are required before a Pending Listing is created.",
      });
      return;
    }

    const startedAt = Date.now();
    patch(card.id, { status: "working", error: null });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required before scanning cards.");
      const body = new FormData();
      body.append("front", card.front, card.front.name);
      body.append("back", card.back, card.back.name);
      const response = await fetch("/api/account/seller/instacomp-scan/intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const result = (await response.json().catch(() => ({}))) as IntakeResult;
      const hasDraft = Boolean(result.inventoryItemId);
      if (!response.ok && response.status !== 202 && response.status !== 207 && !hasDraft) {
        if (result.duplicate?.inventoryItemId) {
          patch(card.id, {
            status: "review",
            result,
            durationMs: Date.now() - startedAt,
            error: `Duplicate image pair already exists: ${result.duplicate.title || result.duplicate.inventoryItemId}`,
          });
          return;
        }
        throw new Error(result.error || "InstaComp intake failed.");
      }

      patch(card.id, {
        status: result.success === true && result.pricingSucceeded !== false ? "pending" : "review",
        result,
        durationMs: Date.now() - startedAt,
        frontPreview: result.normalizedImages?.frontImageUrl || card.frontPreview,
        backPreview: result.normalizedImages?.backImageUrl || card.backPreview,
        error: result.error || null,
      });
    } catch (error) {
      patch(card.id, {
        status: "error",
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : "InstaComp intake failed.",
      });
    }
  }

  async function runQueue(queue: QueueCard[]) {
    for (let index = 0; index < queue.length; index += CONCURRENCY) {
      await Promise.all(queue.slice(index, index + CONCURRENCY).map(processCard));
    }
  }

  async function acceptFiles(value: FileList | File[]) {
    const files = Array.from(value).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    setPreparing(true);
    setPageError("");
    try {
      const pairs = pairFiles(files);
      const prepared = pairs.map((pair) => ({
        id: crypto.randomUUID(),
        front: pair.front,
        back: pair.back,
        frontPreview: URL.createObjectURL(pair.front),
        backPreview: pair.back ? URL.createObjectURL(pair.back) : null,
        status: "queued" as const,
        result: null,
        error: pair.back ? null : "Back image missing.",
        durationMs: null,
        savingPrice: false,
      }));
      setCards((current) => [...prepared, ...current]);
      void runQueue(prepared);
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
            One intake does the whole job: permanent card UUID, text-based image orientation,
            InstaComp AI identification, Registry lock, exact comps, pricing, then a Pending Listing.
            Nothing publishes automatically.
          </p>
        </div>
        <Link
          href="/kingmaker/pending"
          className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:border-emerald-400"
        >
          Open Pending Listings
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
          const choices = basePrice
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
                  <p className="font-black">{card.result?.title || card.front.name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-400">{statusText(card)}</p>
                </div>
                <div className="text-right text-xs font-bold text-slate-400">
                  {card.durationMs !== null ? `${(card.durationMs / 1000).toFixed(1)}s` : ""}
                </div>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
                <div className="grid grid-cols-2 gap-2">
                  {[card.frontPreview, card.backPreview].map((url, index) => (
                    <div key={index} className="flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-slate-950 p-2">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={index === 0 ? "Card front" : "Card back"} className="max-h-52 max-w-full object-contain" />
                      ) : (
                        <span className="text-xs font-black text-red-300">BACK MISSING</span>
                      )}
                    </div>
                  ))}
                </div>
                <div className="min-w-0">
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
                  {card.error ? (
                    <div className="mt-3 rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm font-bold text-red-200">
                      {card.error}
                    </div>
                  ) : null}
                  {card.result?.inventoryItemId ? (
                    <Link
                      href="/kingmaker/pending"
                      className="mt-3 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950"
                    >
                      Review in Pending →
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
