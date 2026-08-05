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
    pricingStatus: string;
    serialNumber?: string | null;
  };
};

type JobStatus = {
  status: string;
  stage: string | null;
  error: string | null;
  errorCode: string | null;
  identityComplete: boolean;
  manualIdentityLocked: boolean;
  identitySource: string | null;
  pricingStatus: string | null;
  printRun: string | null;
  backEvidenceText: string | null;
  updatedAt: string | null;
};

type LocalStage = "waiting" | "preparing" | "scanning" | "complete" | "failed";
type EditState = { title: string; parallel: string; printRun: string };
type Rotation = { front: number; back: number };

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
}

function normalizedRotation(value: number) {
  return ((value % 360) + 360) % 360;
}

async function rotatedImageFile(url: string, degrees: number, name: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${name} image returned HTTP ${response.status}.`);
  const source = await response.blob();
  const rotation = normalizedRotation(degrees);
  if (rotation === 0) {
    return new File([source], `${name}.${source.type === "image/png" ? "png" : "jpg"}`, {
      type: source.type || "image/jpeg",
    });
  }

  const bitmap = await createImageBitmap(source);
  const swap = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swap ? bitmap.height : bitmap.width;
  canvas.height = swap ? bitmap.width : bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`Could not rotate the ${name} image.`);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((rotation * Math.PI) / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();

  const output = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Could not encode the rotated ${name} image.`))),
      "image/jpeg",
      0.95,
    );
  });
  return new File([output], `${name}.jpg`, { type: "image/jpeg" });
}

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [localStage, setLocalStage] = useState<Record<string, LocalStage>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [rotations, setRotations] = useState<Record<string, Rotation>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0 });
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");
  const attemptedIds = useRef(new Set<string>());
  const batchRunning = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [cardsResponse, statusResponse] = await Promise.all([
        fetch("/api/account/seller/instacomp-pending", { headers, cache: "no-store" }),
        fetch("/api/account/seller/inventory/instacomp-job-status", { headers, cache: "no-store" }),
      ]);
      const [cardsData, statusData] = await Promise.all([
        cardsResponse.json(),
        statusResponse.json(),
      ]);
      if (!cardsResponse.ok) throw new Error(cardsData.error || "Could not load pending cards.");
      if (!statusResponse.ok) throw new Error(statusData.error || "Could not load card job status.");
      setCards(Array.isArray(cardsData.items) ? cardsData.items : []);
      setJobs(statusData.statuses && typeof statusData.statuses === "object" ? statusData.statuses : {});
    } catch (error) {
      setCards([]);
      setJobs({});
      setPageError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const runCard = useCallback(async (card: PendingCard, replaceManualIdentity: boolean) => {
    if (!hasValidPair(card) || !card.frontImageUrl || !card.backImageUrl) {
      throw new Error("A distinct stored front and back are required.");
    }

    setLocalError((current) => ({ ...current, [card.inventoryItemId]: "" }));
    setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "preparing" }));
    const rotation = rotations[card.inventoryItemId] || { front: 0, back: 0 };
    const [frontImage, backImage] = await Promise.all([
      rotatedImageFile(card.frontImageUrl, rotation.front, "front"),
      rotatedImageFile(card.backImageUrl, rotation.back, "back"),
    ]);

    const session = await getFreshAccountSession(5 * 60, false);
    if (!session?.access_token) throw new Error("Seller login is required.");
    const formData = new FormData();
    formData.set("inventoryItemId", card.inventoryItemId);
    formData.set("frontImage", frontImage);
    formData.set("backImage", backImage);
    formData.set("frontRotation", String(rotation.front));
    formData.set("backRotation", String(rotation.back));
    formData.set("replaceManualIdentity", String(replaceManualIdentity));
    formData.set("aiCouncilTier", "adaptive");

    setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "scanning" }));
    const response = await fetch("/api/account/seller/inventory/instacomp-front-back", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true || data.identityComplete !== true) {
      const detail = [data.error || "Front-and-back InstaComp failed.", data.code, data.stage]
        .filter(Boolean)
        .join(" · ");
      setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "failed" }));
      setLocalError((current) => ({ ...current, [card.inventoryItemId]: detail }));
      throw new Error(detail);
    }
    setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "complete" }));
    return data;
  }, [rotations]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (loading || batchRunning.current) return;
    const candidates = cards.filter((card) => {
      const job = jobs[card.inventoryItemId];
      return (
        hasValidPair(card) &&
        card.instaComp?.pricingStatus === "not_run" &&
        job?.manualIdentityLocked !== true &&
        !attemptedIds.current.has(card.inventoryItemId)
      );
    });
    if (!candidates.length) return;

    batchRunning.current = true;
    setAutoRunning(true);
    setAutoProgress({ current: 0, total: candidates.length });
    void (async () => {
      let completed = 0;
      for (const card of candidates) {
        attemptedIds.current.add(card.inventoryItemId);
        setBusyId(card.inventoryItemId);
        try {
          await runCard(card, false);
          completed += 1;
        } catch {
          // The exact per-card failure remains visible on that card.
        }
        setAutoProgress((current) => ({ current: current.current + 1, total: current.total }));
      }
      setBusyId(null);
      setAutoRunning(false);
      batchRunning.current = false;
      if (completed) setNotice(`${completed} card${completed === 1 ? "" : "s"} identified from front + back. Pricing remains separate.`);
      await load();
    })();
  }, [cards, jobs, load, loading, runCard]);

  function rotate(cardId: string, side: "front" | "back", amount: number) {
    setRotations((current) => {
      const existing = current[cardId] || { front: 0, back: 0 };
      return {
        ...current,
        [cardId]: { ...existing, [side]: normalizedRotation(existing[side] + amount) },
      };
    });
  }

  function beginEdit(card: PendingCard) {
    setEditingId(card.inventoryItemId);
    setEdits((current) => ({
      ...current,
      [card.inventoryItemId]: {
        title: card.title,
        parallel: "",
        printRun: card.instaComp?.serialNumber || jobs[card.inventoryItemId]?.printRun || "",
      },
    }));
  }

  async function saveEdit(card: PendingCard) {
    const edit = edits[card.inventoryItemId];
    if (!edit?.title.trim()) return;
    setBusyId(card.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp-card-edit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          title: edit.title,
          parallel: edit.parallel,
          printRun: edit.printRun,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not save the card edit.");
      attemptedIds.current.add(card.inventoryItemId);
      setEditingId(null);
      setNotice(`${edit.title}: seller correction saved and locked. Automatic AI will not overwrite it.`);
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function runManually(card: PendingCard) {
    const locked = jobs[card.inventoryItemId]?.manualIdentityLocked === true;
    setBusyId(card.inventoryItemId);
    setNotice("");
    attemptedIds.current.add(card.inventoryItemId);
    try {
      await runCard(card, locked);
      setNotice(`${card.title}: identity completed using the rotated front + back files.`);
      await load();
    } catch {
      // The card displays the exact durable error.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-800">Kingmaker / Front + Back Identity</p>
            <h1 className="mt-1 text-3xl font-black">Pending InstaComp Cards</h1>
            <p className="mt-2 max-w-3xl font-semibold text-neutral-700">
              Each card uses one distinct front and back. Rotation changes the files sent to AI. Identity is saved before pricing, seller edits remain locked, and nothing publishes automatically.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || autoRunning || Boolean(busyId)} className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50">
            {loading ? "Loading…" : "Reload Cards"}
          </button>
        </div>

        {autoRunning ? (
          <div className="mt-5 rounded-xl border-2 border-sky-700 bg-sky-50 p-4 font-bold text-sky-950">
            Auto InstaComp: {autoProgress.current}/{autoProgress.total} cards finished
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-sky-200">
              <div className="h-full bg-sky-700 transition-all" style={{ width: `${autoProgress.total ? (autoProgress.current / autoProgress.total) * 100 : 0}%` }} />
            </div>
          </div>
        ) : null}
        {pageError ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{pageError}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const job = jobs[card.inventoryItemId];
            const stage = localStage[card.inventoryItemId] || (job?.status === "failed" ? "failed" : job?.identityComplete ? "complete" : "waiting");
            const error = localError[card.inventoryItemId] || job?.error || "";
            const rotation = rotations[card.inventoryItemId] || { front: 0, back: 0 };
            const pairReady = hasValidPair(card);
            const locked = job?.manualIdentityLocked === true;
            const isBusy = busyId === card.inventoryItemId;
            const edit = edits[card.inventoryItemId];
            return (
              <article key={card.inventoryItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div>
                    <h2 className="font-black">{card.title}</h2>
                    <p className="text-xs font-bold text-neutral-300">{card.sku || card.inventoryItemId}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>
                    {pairReady ? "CARD READY — FRONT + BACK" : "CARD BLOCKED — SIDE MISSING"}
                  </span>
                </div>

                <div className="border-b-2 border-neutral-900 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                    <span>{stage === "preparing" ? "Preparing rotated files" : stage === "scanning" ? "InstaComp processing front + back" : stage === "complete" ? "Identity complete" : stage === "failed" ? `Failed at ${job?.stage || "scan"}` : locked ? "Seller identity locked" : "Waiting"}</span>
                    {stage === "complete" ? <span>100%</span> : null}
                  </div>
                  <div className="mt-2 h-4 overflow-hidden rounded-full bg-neutral-200">
                    {stage === "preparing" ? <div className="h-full w-1/4 bg-sky-600" /> : null}
                    {stage === "scanning" ? <div className="h-full w-1/2 animate-pulse bg-sky-700" /> : null}
                    {stage === "complete" ? <div className="h-full w-full bg-emerald-600" /> : null}
                    {stage === "failed" ? <div className="h-full w-1/4 bg-red-700" /> : null}
                  </div>
                  {error ? (
                    <div className="mt-3 rounded-lg border-2 border-red-700 bg-red-50 p-3 font-bold text-red-900">
                      {error}{job?.errorCode ? ` · ${job.errorCode}` : ""}
                    </div>
                  ) : null}
                  {job?.backEvidenceText ? (
                    <details className="mt-3 rounded-lg border border-neutral-400 bg-neutral-50 p-3 text-sm">
                      <summary className="cursor-pointer font-black">Back evidence used by InstaComp</summary>
                      <p className="mt-2 break-words font-semibold">{job.backEvidenceText}</p>
                    </details>
                  ) : null}
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {(["front", "back"] as const).map((side) => {
                    const url = side === "front" ? card.frontImageUrl : card.backImageUrl;
                    return (
                      <figure key={side} className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                        <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">Card {side} · sent at {rotation[side]}°</figcaption>
                        <div className="flex h-80 items-center justify-center overflow-hidden">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt={`${card.title} ${side}`} className="max-h-full max-w-full object-contain transition-transform" style={{ transform: `rotate(${rotation[side]}deg)` }} />
                          ) : <div className="font-black text-red-800">{side.toUpperCase()} MISSING</div>}
                        </div>
                        <div className="mt-3 flex justify-center gap-2">
                          <button type="button" onClick={() => rotate(card.inventoryItemId, side, -90)} className="rounded-lg bg-neutral-900 px-3 py-2 font-black text-white">↶ Rotate</button>
                          <button type="button" onClick={() => rotate(card.inventoryItemId, side, 90)} className="rounded-lg bg-neutral-900 px-3 py-2 font-black text-white">Rotate ↷</button>
                        </div>
                      </figure>
                    );
                  })}
                </div>

                {editingId === card.inventoryItemId ? (
                  <div className="grid gap-3 border-t-2 border-neutral-900 bg-amber-50 p-4 md:grid-cols-3">
                    <label className="font-bold">Card title<input value={edit?.title || ""} onChange={(event) => setEdits((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), title: event.target.value } }))} className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <label className="font-bold">Parallel<input value={edit?.parallel || ""} onChange={(event) => setEdits((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), parallel: event.target.value } }))} placeholder="Blank means base" className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <label className="font-bold">Print run only<input value={edit?.printRun || ""} onChange={(event) => setEdits((current) => ({ ...current, [card.inventoryItemId]: { ...(current[card.inventoryItemId] || { title: "", parallel: "", printRun: "" }), printRun: event.target.value } }))} placeholder="/99" className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2" /></label>
                    <div className="flex gap-2 md:col-span-3">
                      <button type="button" onClick={() => void saveEdit(card)} disabled={isBusy} className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white">Save Manual Identity</button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-xl bg-neutral-700 px-4 py-3 font-black text-white">Cancel</button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">One card job · rotated front + back bytes · stored rows: {card.storedImageCount || 0} · never auto-published</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => beginEdit(card)} disabled={autoRunning || Boolean(busyId)} className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400">Edit Card</button>
                    <button type="button" onClick={() => void runManually(card)} disabled={!pairReady || autoRunning || Boolean(busyId)} className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400">
                      {isBusy ? "InstaComping card…" : locked ? "Replace Manual Identity with AI" : stage === "failed" ? "Retry This Card" : "InstaComp This Card"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
