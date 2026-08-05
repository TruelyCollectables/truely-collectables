"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type PendingCard = {
  inventoryItemId: string;
  title: string;
  sku: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  storedImageCount: number;
  instaComp: {
    hasBackImage: boolean;
    pricingStatus: string;
    scanId: string | null;
  };
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(
    card.frontImageUrl &&
      card.backImageUrl &&
      card.frontImageUrl !== card.backImageUrl,
  );
}

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const attemptedIds = useRef(new Set<string>());
  const automaticBatchRunning = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-pending", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load pending cards.");
      setCards(Array.isArray(data.items) ? data.items : []);
    } catch (nextError) {
      setCards([]);
      setError(message(nextError));
    } finally {
      setLoading(false);
    }
  }, []);

  const instaCompCard = useCallback(async (card: PendingCard) => {
    if (!hasValidPair(card)) {
      throw new Error(
        `${card.title}: the card needs one distinct stored front and one distinct stored back before InstaComp can run.`,
      );
    }

    const session = await getFreshAccountSession(5 * 60, false);
    if (!session?.access_token) throw new Error("Seller login is required.");

    const response = await fetch(
      "/api/account/seller/inventory/instacomp-front-back",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          aiCouncilTier: "adaptive",
        }),
      },
    );
    const data = await response.json();
    if (
      !response.ok ||
      data.success !== true ||
      data.frontBackContract?.enforced !== true
    ) {
      throw new Error(
        data.error ||
          "The card was not InstaComped because the front-and-back contract failed.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (loading || automaticBatchRunning.current) return;

    const candidates = cards.filter(
      (card) =>
        hasValidPair(card) &&
        card.instaComp?.pricingStatus === "not_run" &&
        !attemptedIds.current.has(card.inventoryItemId),
    );
    if (!candidates.length) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        automaticBatchRunning.current = true;
        setAutoRunning(true);
        setAutoProgress({ current: 0, total: candidates.length });
        setError("");
        setNotice("");
        let completed = 0;
        const failures: string[] = [];

        for (const card of candidates) {
          attemptedIds.current.add(card.inventoryItemId);
          setBusyId(card.inventoryItemId);
          try {
            await instaCompCard(card);
            completed += 1;
          } catch (nextError) {
            failures.push(`${card.title}: ${message(nextError)}`);
          }
          setAutoProgress((current) => ({
            current: current.current + 1,
            total: current.total,
          }));
        }

        setBusyId(null);
        setAutoRunning(false);
        automaticBatchRunning.current = false;
        if (failures.length) {
          setError(
            `${failures.length} card${failures.length === 1 ? "" : "s"} failed: ${failures.join(" | ")}`,
          );
        }
        if (completed > 0) {
          setNotice(
            `Automatically InstaComped ${completed} card${completed === 1 ? "" : "s"} using each card's front and back together.`,
          );
        }
        await load();
      })();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [cards, instaCompCard, load, loading]);

  async function runCardManually(card: PendingCard) {
    setBusyId(card.inventoryItemId);
    setError("");
    setNotice("");
    attemptedIds.current.add(card.inventoryItemId);
    try {
      await instaCompCard(card);
      setNotice(
        `${card.title}: InstaComp completed for the card using its front and back together.`,
      );
      await load();
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-800">
              Kingmaker / Automatic card identification
            </p>
            <h1 className="mt-1 text-3xl font-black">Pending InstaComp Cards</h1>
            <p className="mt-2 max-w-3xl font-semibold text-neutral-700">
              Temporary automatic mode is enabled. Each pending card is InstaComped once as one card using its stored front and back together. Nothing is published automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || autoRunning || Boolean(busyId)}
            className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload Cards"}
          </button>
        </div>

        {autoRunning ? (
          <div className="mt-5 rounded-xl border-2 border-sky-700 bg-sky-50 p-4 font-bold text-sky-950">
            Automatically InstaComping cards with front + back together: {autoProgress.current}/{autoProgress.total}
          </div>
        ) : null}
        {error ? (
          <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">
            {notice}
          </div>
        ) : null}

        {!loading && cards.length === 0 ? (
          <div className="mt-6 rounded-xl border-2 border-neutral-900 bg-white p-6 font-black">
            No pending InstaComp cards found.
          </div>
        ) : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const pairReady = hasValidPair(card);
            const isBusy = busyId === card.inventoryItemId;
            return (
              <article
                key={card.inventoryItemId}
                className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div>
                    <h2 className="font-black">{card.title}</h2>
                    <p className="text-xs font-bold text-neutral-300">
                      {card.sku || card.inventoryItemId}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      pairReady
                        ? "bg-emerald-300 text-emerald-950"
                        : "bg-red-300 text-red-950"
                    }`}
                  >
                    {pairReady
                      ? "CARD READY — FRONT + BACK"
                      : "CARD BLOCKED — SIDE MISSING"}
                  </span>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <figure className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                    <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">
                      Card front
                    </figcaption>
                    {card.frontImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.frontImageUrl}
                        alt={`${card.title} front`}
                        className="mx-auto h-80 w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-80 items-center justify-center font-black text-red-800">
                        FRONT MISSING
                      </div>
                    )}
                  </figure>
                  <figure className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                    <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">
                      Card back
                    </figcaption>
                    {card.backImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.backImageUrl}
                        alt={`${card.title} back`}
                        className="mx-auto h-80 w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-80 items-center justify-center font-black text-red-800">
                        BACK MISSING
                      </div>
                    )}
                  </figure>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">
                    One InstaComp card run · both sides together · stored rows: {card.storedImageCount || 0}
                  </p>
                  <button
                    type="button"
                    onClick={() => void runCardManually(card)}
                    disabled={!pairReady || autoRunning || Boolean(busyId)}
                    className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                  >
                    {isBusy ? "InstaComping card…" : "InstaComp This Card"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
