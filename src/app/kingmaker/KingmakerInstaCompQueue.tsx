"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getAccountSession, getFreshAccountSession, ACCOUNT_SESSION_CHANGE_EVENT } from "../account/account-session";
import {
  instaCompDropFileSignature,
  pairInstaCompDropFiles,
  runInstaCompBatchQueue,
} from "../../lib/instacomp-batch-drop";

import { createSerialIntakeQueue, readIntakeDrafts, writeIntakeDrafts, recoverIntakeStatus } from "../../lib/instacomp-intake-recovery";

type IntakeResult = {
  success?: boolean;
  code?: string;
  error?: string;
  stage?: string;
  identityComplete?: boolean;
  cardUuid?: string | null;
  inventoryItemId?: string | null;
  title?: string | null;
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
    inventoryItemHref?: string | null;
    title?: string | null;
    status?: string | null;
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
  result: IntakeResult | null;
  error: string | null;
  durationMs: number | null;
  savingPrice: boolean;
};

// The Mac scanner admits one physical scan at a time. Keeping the browser
// queue at the same concurrency prevents a second request from spending its
// Cloudflare lifetime waiting behind Apple Vision and timing out around 90s.
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
  const setName = identity.setName || identity.set_name;
  const displaySetName = isBase(setName) && parallel && !isBase(parallel)
    ? null
    : setName;
  return [
    ["Year", identity.year],
    ["Product", identity.manufacturer || identity.brand],
    ["Set / Insert", displaySetName],
    ["Player", identity.player || identity.playerName],
    ["Card #", identity.cardNumber || identity.card_number],
    ["Parallel", parallel],
    ["Serial", identity.serialNumber || identity.serial_number || identity.printRun],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");
}

function statusText(card: QueueCard) {
  if (card.status === "queued") return "Queued";
  if (card.status === "working") return "Scanning images, identifying card, and checking prices…";
  if (card.status === "pending") return "Registry match saved — verify before publishing";
  if (card.status === "review") return card.result?.duplicate?.inventoryItemId ? "Already saved — open existing listing" : card.result?.inventoryItemId ? "Saved — review required" : "Scan needs review";
  return "Stopped safely";
}

export default function KingmakerInstaCompQueue() {
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [pageError, setPageError] = useState("");
  const [pageNotice, setPageNotice] = useState("");
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState("Loading saved intake…");
  const ownerRef = useRef<string | null>(null);
  const accountChangedRef = useRef(false);
  const scanQueueRef = useRef(createSerialIntakeQueue());
  const storageQueueRef = useRef(createSerialIntakeQueue());
  const scheduledRef = useRef(new Set<string>());
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

  useEffect(() => {
    let cancelled = false;
    const owner = getAccountSession()?.user?.id || null;
    ownerRef.current = owner;
    const accountChanged = () => {
      if ((getAccountSession()?.user?.id || null) !== ownerRef.current) {
        accountChangedRef.current = true;
        setCards([]);
        setRecoveryReady(false);
        setStorageNotice("Account changed. Refresh this page to load this seller’s intake.");
      }
    };
    window.addEventListener(ACCOUNT_SESSION_CHANGE_EVENT, accountChanged);
    window.addEventListener("storage", accountChanged);
    void (async () => {
      try {
        const saved = owner ? await readIntakeDrafts<QueueCard>(owner) : [];
        if (cancelled || accountChangedRef.current) return;
        const restored = saved.map((card) => ({
          ...card,
          frontPreview: "",
          backPreview: null,
          status: recoverIntakeStatus(card.status) as QueueStatus,
          savingPrice: false,
          error: card.status === "working" ? "Scan was interrupted. Check your listings, then retry if needed." : card.error,
        }));
        for (const card of restored) {
          for (const file of [card.front, card.back]) {
            if (file) acceptedSignatures.current.add(instaCompDropFileSignature(file));
          }
        }
        setCards(restored);
        setStorageNotice(owner ? "Photos recover after refresh on this browser. Restored scans resume only when you choose." : "Sign in, then refresh to enable saved photo recovery.");
      } catch {
        if (!cancelled) setStorageNotice("Photo recovery unavailable. Keep this tab open until scans finish.");
      } finally {
        if (!cancelled && !accountChangedRef.current) setRecoveryReady(true);
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener(ACCOUNT_SESSION_CHANGE_EVENT, accountChanged);
      window.removeEventListener("storage", accountChanged);
    };
  }, []);

  async function persist(nextCards: QueueCard[]) {
    const owner = ownerRef.current;
    if (!owner || accountChangedRef.current) return;
    try {
      await storageQueueRef.current(() => writeIntakeDrafts(owner, nextCards.map((card) => ({ ...card, frontPreview: "", backPreview: null }))));
    } catch {
      setStorageNotice("Photos could not be saved locally. Keep this tab open until scans finish.");
    }
  }

  useEffect(() => {
    if (recoveryReady) void Promise.resolve().then(() => persist(cards));
  }, [cards, recoveryReady]);

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
    if (accountChangedRef.current) return;
    if (!card.front || !card.back) {
      patch(card.id, {
        status: "error",
        error: `${card.front ? "Back" : "Front"} image missing. Front and back are required before a Pending Listing is created.`,
      });
      return;
    }

    const startedAt = Date.now();
    patch(card.id, { status: "working", error: null });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required before scanning cards.");
      if (session.user?.id !== ownerRef.current) throw new Error("Seller account changed. Refresh before scanning.");
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
          result.success === true &&
          result.identityComplete === true &&
          result.pricingSucceeded === true
            ? "pending"
            : "review",
        result,
        durationMs: Date.now() - startedAt,
        frontPreview: nextFrontPreview,
        backPreview: nextBackPreview,
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
    const unscheduled = queue.filter((card) => !scheduledRef.current.has(card.id));
    unscheduled.forEach((card) => scheduledRef.current.add(card.id));
    await scanQueueRef.current(async () => {
      try {
        await runInstaCompBatchQueue({ items: unscheduled, concurrency: CONCURRENCY, worker: processCard });
      } finally {
        unscheduled.forEach((card) => scheduledRef.current.delete(card.id));
      }
    });
  }

  async function acceptFiles(value: FileList | File[]) {
    if (!recoveryReady || preparing || accountChangedRef.current) return;
    const files = Array.from(value).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    if (!files.length) { setPageError("Choose JPEG, PNG, or WebP images."); return; }
    setPreparing(true);
    setPageError(files.length !== value.length ? "Unsupported files were skipped. Choose JPEG, PNG, or WebP images." : "");
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
      await persist([...prepared, ...cards]);
      void runQueue(prepared);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not prepare dropped images.");
    } finally {
      setPreparing(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function supplyMissingSide(card: QueueCard, file: File) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setPageError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    const next = { ...card, [card.front ? "back" : "front"]: file, status: "queued" as const, error: null };
    acceptedSignatures.current.add(instaCompDropFileSignature(file));
    patch(card.id, next);
    await persist(cards.map((existing) => existing.id === card.id ? next : existing));
    void runQueue([next]);
  }

  async function choosePrice(card: QueueCard, price: number, source: string) {
    const inventoryItemId = card.result?.inventoryItemId;
    if (!inventoryItemId) return;
    patch(card.id, { savingPrice: true, error: null });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required before saving price.");
      if (accountChangedRef.current || session.user?.id !== ownerRef.current) throw new Error("Seller account changed. Refresh before saving a price.");
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
            Upload both sides. Kingmaker identifies the card, checks prices, and saves a listing for your review.
            Nothing publishes automatically.
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
            disabled={preparing || !recoveryReady}
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

      <p className="mt-3 text-sm text-slate-400" role="status">{storageNotice}</p>
      {cards.some((card) => card.status === "queued") ? (
        <button type="button" className="mt-3 rounded-xl border border-emerald-500 px-4 py-2 font-bold" onClick={() => void runQueue(cards.filter((card) => card.status === "queued"))} disabled={!recoveryReady}>
          Resume queued scans
        </button>
      ) : null}
      {cards.some((card) => card.status === "pending" || card.status === "review") ? (
        <button type="button" className="mt-3 ml-3 rounded-xl border border-slate-600 px-4 py-2 font-bold" onClick={() => setCards((current) => current.filter((card) => card.status !== "pending" && card.status !== "review"))}>Clear finished cards from this intake</button>
      ) : null}
      {cards.length ? <p className="mt-3 text-sm text-slate-300" role="status">{totals.pending + totals.review + totals.errors} of {totals.total} scans finished · {cards.filter((card) => card.status === "queued").length} queued · one card scans at a time</p> : null}
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
            : [null, null];
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
                  {card.result?.cardUuid ? (
                    <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3">
                      <p className="text-xs font-black uppercase tracking-wider text-emerald-300">Permanent card UUID</p>
                      <p className="mt-1 break-all font-mono text-sm text-emerald-100">{card.result.cardUuid}</p>
                    </div>
                  ) : null}
                  {card.result?.inventoryItemId ? (
                    <div className="mt-3 rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
                      <p className="font-black">Check the match before publishing</p>
                      <p className="mt-1">Compare the player, card number, year, set, and parallel above with both card photos. The Registry match is automated and has not been confirmed by you.</p>
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
                  {!card.front || !card.back ? (
                    <label className="mt-3 block text-sm font-bold text-amber-200">
                      Add missing {card.front ? "back" : "front"} image
                      <input type="file" accept="image/jpeg,image/png,image/webp" disabled={!recoveryReady} className="mt-2 block w-full text-sm" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void supplyMissingSide(card, file);
                        event.target.value = "";
                      }} />
                    </label>
                  ) : null}
                  {card.status === "error" && card.front && card.back && !card.result?.inventoryItemId ? (
                    <button type="button" disabled={!recoveryReady} onClick={() => { patch(card.id, { status: "queued", error: null }); void runQueue([card]); }} className="mt-3 mr-3 rounded-xl border border-amber-500 px-4 py-2 font-bold">Retry scan</button>
                  ) : null}
                  {card.result?.inventoryItemId || card.result?.duplicate?.inventoryItemId ? (
                    <Link
                      href={
                        card.result.duplicate?.inventoryItemHref ||
                        `/seller/admin/inventory/${encodeURIComponent(card.result.duplicate?.inventoryItemId || card.result.inventoryItemId || "")}?inventoryItemId=${encodeURIComponent(card.result.duplicate?.inventoryItemId || card.result.inventoryItemId || "")}`
                      }
                      className="mt-3 inline-flex rounded-xl bg-white px-4 py-2 text-sm font-black text-slate-950"
                    >
                      Open exact master listing →
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
