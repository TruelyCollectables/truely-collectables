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
    serialNumber?: string | null;
  };
};

type Stage = "waiting" | "images" | "identity" | "registry" | "pricing" | "saving" | "done" | "failed";
type EditState = { title: string; parallel: string; printRun: string };

const STAGE_LABEL: Record<Stage, string> = {
  waiting: "Waiting",
  images: "Reading front + back",
  identity: "Resolving card identity",
  registry: "Checking Checklist Registry",
  pricing: "Finding exact comps",
  saving: "Saving private draft",
  done: "Complete",
  failed: "Failed",
};

const STAGE_PERCENT: Record<Stage, number> = {
  waiting: 0,
  images: 15,
  identity: 35,
  registry: 60,
  pricing: 78,
  saving: 92,
  done: 100,
  failed: 100,
};

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
}

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0 });
  const [stageById, setStageById] = useState<Record<string, Stage>>({});
  const [rotationById, setRotationById] = useState<Record<string, { front: number; back: number }>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editById, setEditById] = useState<Record<string, EditState>>({});
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

  const setStage = useCallback((id: string, stage: Stage) => {
    setStageById((current) => ({ ...current, [id]: stage }));
  }, []);

  const instaCompCard = useCallback(async (card: PendingCard) => {
    if (!hasValidPair(card)) {
      throw new Error(`${card.title}: a distinct stored front and back are required.`);
    }

    const session = await getFreshAccountSession(5 * 60, false);
    if (!session?.access_token) throw new Error("Seller login is required.");

    const timers = [
      window.setTimeout(() => setStage(card.inventoryItemId, "identity"), 800),
      window.setTimeout(() => setStage(card.inventoryItemId, "registry"), 2200),
      window.setTimeout(() => setStage(card.inventoryItemId, "pricing"), 4200),
      window.setTimeout(() => setStage(card.inventoryItemId, "saving"), 6500),
    ];
    setStage(card.inventoryItemId, "images");

    try {
      const response = await fetch("/api/account/seller/inventory/instacomp-front-back", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inventoryItemId: card.inventoryItemId, aiCouncilTier: "adaptive" }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true || data.frontBackContract?.enforced !== true) {
        throw new Error(data.error || "The front-and-back card scan failed.");
      }
      setStage(card.inventoryItemId, "done");
      return data;
    } catch (scanError) {
      setStage(card.inventoryItemId, "failed");
      throw scanError;
    } finally {
      timers.forEach((timer) => window.clearTimeout(timer));
    }
  }, [setStage]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (loading || automaticBatchRunning.current) return;
    const candidates = cards.filter(
      (card) => hasValidPair(card) && card.instaComp?.pricingStatus === "not_run" && !attemptedIds.current.has(card.inventoryItemId),
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
          setAutoProgress((current) => ({ current: current.current + 1, total: current.total }));
        }

        setBusyId(null);
        setAutoRunning(false);
        automaticBatchRunning.current = false;
        if (failures.length) setError(failures.join(" | "));
        if (completed) setNotice(`Automatically InstaComped ${completed} card${completed === 1 ? "" : "s"} using front + back together.`);
        await load();
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [cards, instaCompCard, load, loading]);

  function rotate(cardId: string, side: "front" | "back", delta: number) {
    setRotationById((current) => {
      const existing = current[cardId] || { front: 0, back: 0 };
      return { ...current, [cardId]: { ...existing, [side]: (existing[side] + delta + 360) % 360 } };
    });
  }

  function beginEdit(card: PendingCard) {
    setEditingId(card.inventoryItemId);
    setEditById((current) => ({
      ...current,
      [card.inventoryItemId]: {
        title: card.title,
        parallel: "",
        printRun: card.instaComp?.serialNumber || "",
      },
    }));
  }

  async function saveEdit(card: PendingCard) {
    const edit = editById[card.inventoryItemId];
    if (!edit?.title.trim()) return;
    setBusyId(card.inventoryItemId);
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp-card-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          title: edit.title,
          parallel: edit.parallel,
          printRun: edit.printRun,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not save the card edit.");
      attemptedIds.current.delete(card.inventoryItemId);
      setEditingId(null);
      setNotice(`${edit.title}: edit saved privately. A fresh front + back InstaComp scan is queued.`);
      await load();
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusyId(null);
    }
  }

  async function runCardManually(card: PendingCard) {
    setBusyId(card.inventoryItemId);
    setError("");
    setNotice("");
    attemptedIds.current.add(card.inventoryItemId);
    try {
      await instaCompCard(card);
      setNotice(`${card.title}: InstaComp completed using the card's front and back together.`);
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
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-800">Kingmaker / Automatic card identification</p>
            <h1 className="mt-1 text-3xl font-black">Pending InstaComp Cards</h1>
            <p className="mt-2 max-w-3xl font-semibold text-neutral-700">Each card is scanned once using front + back together. Panini WNBA and Select WNBA only count as Prizm when PRIZM is visible in back-side evidence. Nothing publishes automatically.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || autoRunning || Boolean(busyId)} className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50">{loading ? "Loading…" : "Reload Cards"}</button>
        </div>

        {autoRunning ? (
          <div className="mt-5 rounded-xl border-2 border-sky-700 bg-sky-50 p-4 font-bold text-sky-950">
            Auto InstaComp: {autoProgress.current}/{autoProgress.total}
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-sky-200"><div className="h-full bg-sky-700 transition-all" style={{ width: `${autoProgress.total ? Math.round((autoProgress.current / autoProgress.total) * 100) : 0}%` }} /></div>
          </div>
        ) : null}
        {error ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const pairReady = hasValidPair(card);
            const isBusy = busyId === card.inventoryItemId;
            const stage = stageById[card.inventoryItemId] || "waiting";
            const rotation = rotationById[card.inventoryItemId] || { front: 0, back: 0 };
            const edit = editById[card.inventoryItemId];
            return (
              <article key={card.inventoryItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div><h2 className="font-black">{card.title}</h2><p className="text-xs font-bold text-neutral-300">{card.sku || card.inventoryItemId}</p></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>{pairReady ? "CARD READY — FRONT + BACK" : "CARD BLOCKED — SIDE MISSING"}</span>
                </div>

                <div className="border-b-2 border-neutral-900 p-4">
                  <div className="flex items-center justify-between gap-3 text-sm font-black"><span>{STAGE_LABEL[stage]}</span><span>{STAGE_PERCENT[stage]}%</span></div>
                  <div className="mt-2 h-4 overflow-hidden rounded-full bg-neutral-200"><div className={`h-full transition-all ${stage === "failed" ? "bg-red-700" : "bg-emerald-600"}`} style={{ width: `${STAGE_PERCENT[stage]}%` }} /></div>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {(["front", "back"] as const).map((side) => {
                    const url = side === "front" ? card.frontImageUrl : card.backImageUrl;
                    return (
                      <figure key={side} className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                        <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">Card {side}</figcaption>
                        <div className="flex h-80 items-center justify-center overflow-hidden">
                          {url ? <img src={url} alt={`${card.title} ${side}`} className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `rotate(${rotation[side]}deg)` }} /> : <div className="font-black text-red-800">{side.toUpperCase()} MISSING</div>}
                        </div>
                        <div className="mt-3 flex justify-center gap-2"><button type="button" onClick={() => rotate(card.inventoryItemId, side, -90)} className="rounded-lg bg-neutral-900 px-3 py-2 font-black text-white">↶ Rotate</button><button type="button" onClick={() => rotate(card.inventoryItemId, side, 90)} className="rounded-lg bg-neutral-900 px-3 py-2 font-black text-white">Rotate ↷</button></div>
                      </figure>
                    );
                  })}
                </div>

                {editingId === card.inventoryItemId ? (
                  <div className="grid gap-3 border-t-2 border-neutral-900 bg-amber-50 p-4 md:grid-cols-3">
                    <label className="font-bold">Card title<input value={edit?.title || ""} onChange={(event) => setEditById((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), title: event.target.value } }))} className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <label className="font-bold">Parallel<input value={edit?.parallel || ""} onChange={(event) => setEditById((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), parallel: event.target.value } }))} placeholder="Leave blank for base" className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <label className="font-bold">Print run only<input value={edit?.printRun || ""} onChange={(event) => setEditById((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), printRun: event.target.value } }))} placeholder="/99" className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <div className="flex gap-2 md:col-span-3"><button type="button" onClick={() => void saveEdit(card)} disabled={isBusy} className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white">Save Edit + Rescan</button><button type="button" onClick={() => setEditingId(null)} className="rounded-xl bg-neutral-700 px-4 py-3 font-black text-white">Cancel</button></div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">One card run · both sides together · stored rows: {card.storedImageCount || 0}</p>
                  <div className="flex gap-2"><button type="button" onClick={() => beginEdit(card)} disabled={autoRunning || Boolean(busyId)} className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400">Edit Card</button><button type="button" onClick={() => void runCardManually(card)} disabled={!pairReady || autoRunning || Boolean(busyId)} className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400">{isBusy ? "InstaComping card…" : "InstaComp This Card"}</button></div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
