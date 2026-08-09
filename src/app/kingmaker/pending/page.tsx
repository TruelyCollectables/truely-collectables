"use client";

import { useCallback, useEffect, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type CardIdentity = {
  sport?: string | null;
  league?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  setName?: string | null;
  subset?: string | null;
  player?: string | null;
  team?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  variation?: string | null;
  serialNumber?: string | null;
  isRookie?: boolean;
  isAuto?: boolean;
  isRelic?: boolean;
  inscription?: boolean;
  inscriptionText?: string | null;
  memorabiliaType?: string | null;
};

type CompEvidence = {
  title?: string | null;
  price?: number | null;
  url?: string | null;
  sourceLabel?: string | null;
  soldAt?: string | null;
  listedAt?: string | null;
};

type PendingCard = {
  inventoryItemId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  condition?: string | null;
  sku: string | null;
  price?: number | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  storedImageCount: number;
  activationReadiness?: { ready?: boolean; blockers?: string[] } | null;
  instaComp: {
    cardUuid?: string | null;
    pricingStatus: string;
    serialNumber?: string | null;
    suggestedPrice?: number | null;
    listingPrice?: number | null;
    reliableSoldCompCount?: number;
    soldCompEvidence?: CompEvidence[];
    activeCompetition?: CompEvidence[];
    identity?: CardIdentity | null;
  };
};

type JobStatus = {
  status: string;
  stage: string | null;
  error: string | null;
  errorCode: string | null;
  identityComplete: boolean;
  manualIdentityLocked: boolean;
  selectedParallel: string | null;
  candidateParallels: string[];
  visualColor: string | null;
  visualPattern: string | null;
  visualSerial: string | null;
  visualConfidence: number;
  parallelEvidence: string | null;
};

type EditState = {
  title: string;
  description: string;
  category: string;
  condition: string;
  sport: string;
  league: string;
  year: string;
  manufacturer: string;
  brand: string;
  setName: string;
  subset: string;
  player: string;
  team: string;
  cardNumber: string;
  parallel: string;
  variation: string;
  printRun: string;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  inscription: boolean;
  inscriptionText: string;
  memorabiliaType: string;
};

type LocalStage = "waiting" | "scanning" | "complete" | "review" | "failed" | "locked";

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
}

function displayPattern(value: string | null) {
  return value ? value.replace(/_/g, " ") : "—";
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

function serialRunLabel(value: string) {
  const match = String(value || "").match(/\/(\d{1,6})$/);
  return match ? `/${Number(match[1])}` : "";
}

function standardizedTitle(edit: EditState) {
  const setName = /^base$/i.test(edit.setName.trim()) ? "" : edit.setName.trim();
  const parallel = /^base$/i.test(edit.parallel.trim()) ? "" : edit.parallel.trim();
  const product = edit.brand.trim() || edit.manufacturer.trim();
  return [
    edit.year.trim(),
    product,
    setName,
    edit.cardNumber.trim() ? `#${edit.cardNumber.trim().replace(/^#/, "")}` : "",
    edit.player.trim(),
    parallel,
    serialRunLabel(edit.printRun),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\bBase\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function initialEdit(card: PendingCard): EditState {
  const identity = card.instaComp.identity || {};
  return {
    title: card.title,
    description: card.description || "",
    category: card.category || "Trading Card Singles",
    condition: card.condition || "Ungraded",
    sport: identity.sport || "",
    league: identity.league || "",
    year: identity.year || "",
    manufacturer: identity.manufacturer || "",
    brand: identity.brand || identity.manufacturer || "",
    setName: identity.setName || "",
    subset: identity.subset || "",
    player: identity.player || "",
    team: identity.team || "",
    cardNumber: identity.cardNumber || "",
    parallel: identity.parallel || "Base",
    variation: identity.variation || "",
    printRun: identity.serialNumber || card.instaComp.serialNumber || "",
    isRookie: identity.isRookie === true,
    isAuto: identity.isAuto === true,
    isRelic: identity.isRelic === true,
    inscription: identity.inscription === true,
    inscriptionText: identity.inscriptionText || "",
    memorabiliaType: identity.memorabiliaType || "",
  };
}

async function fileFromUrl(url: string, name: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read stored ${name} image for rotation.`);
  const blob = await response.blob();
  return new File([blob], `${name}.${blob.type.includes("png") ? "png" : "jpg"}`, {
    type: blob.type || "image/jpeg",
  });
}

async function rotatedImageFile(file: File, name: string) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    bitmap.close();
    throw new Error("Browser image rotation is unavailable.");
  }
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) => (value ? resolve(value) : reject(new Error("Image rotation failed."))),
      "image/jpeg",
      0.94,
    );
  });
  return new File([blob], `${name}-rotated.jpg`, { type: "image/jpeg" });
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border-2 border-neutral-300 bg-white p-2 text-neutral-950 focus:border-neutral-950 focus:outline-none"
      />
    </label>
  );
}

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [localStage, setLocalStage] = useState<Record<string, LocalStage>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

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
      const [cardsData, statusData] = await Promise.all([cardsResponse.json(), statusResponse.json()]);
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

  useEffect(() => {
    void load();
  }, [load]);

  function setEditValue<K extends keyof EditState>(id: string, key: K, value: EditState[K]) {
    setEdits((current) => ({
      ...current,
      [id]: { ...(current[id] || initialEdit(cards.find((card) => card.inventoryItemId === id)!)), [key]: value },
    }));
  }

  function beginEdit(card: PendingCard) {
    setEditingId(card.inventoryItemId);
    setEdits((current) => ({ ...current, [card.inventoryItemId]: initialEdit(card) }));
  }

  async function saveEdit(card: PendingCard) {
    const edit = edits[card.inventoryItemId];
    if (!edit) return;
    if (!edit.parallel.trim()) {
      setPageError("Blank no longer means Base. Enter Base or the exact checklist parallel.");
      return;
    }
    const finalTitle = standardizedTitle(edit) || edit.title.trim();
    if (!finalTitle) {
      setPageError("The corrected card needs enough identity fields to build a listing title.");
      return;
    }
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice("");
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
          ...edit,
          title: finalTitle,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not save the card correction.");
      setEditingId(null);
      setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "locked" }));
      setNotice(
        data.learningStatus === "stored"
          ? `${finalTitle}: correction locked and trusted InstaComp lesson stored.`
          : `${finalTitle}: correction locked. Learning receipt: ${data.learningStatus || "pending"}.`,
      );
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function savePrice(card: PendingCard, price: number, source: string) {
    setBusyId(card.inventoryItemId);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/instacomp-scan/price", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ inventoryItemId: card.inventoryItemId, price, source }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not save listing price.");
      setNotice(`${money(price)} saved as the Pending Listing price.`);
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function rotateImage(card: PendingCard, side: "front" | "back") {
    if (!card.frontImageUrl || !card.backImageUrl) return;
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice("");
    try {
      const [frontOriginal, backOriginal] = await Promise.all([
        fileFromUrl(card.frontImageUrl, "front"),
        fileFromUrl(card.backImageUrl, "back"),
      ]);
      const [frontImage, backImage] = await Promise.all([
        side === "front"
          ? rotatedImageFile(frontOriginal, "front")
          : Promise.resolve(frontOriginal),
        side === "back"
          ? rotatedImageFile(backOriginal, "back")
          : Promise.resolve(backOriginal),
      ]);
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const formData = new FormData();
      formData.set("inventoryItemId", card.inventoryItemId);
      formData.set("rotatedSide", side);
      formData.set("frontImage", frontImage);
      formData.set("backImage", backImage);
      const response = await fetch("/api/account/seller/inventory/instacomp-image-rotate", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) throw new Error(data.error || "Could not rotate stored card image.");
      setNotice(`${side === "front" ? "Front" : "Back"} rotated 90° clockwise and saved to the Pending draft.`);
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function runExactIdentity(card: PendingCard) {
    const job = jobs[card.inventoryItemId];
    if (!hasValidPair(card)) {
      setLocalError((current) => ({ ...current, [card.inventoryItemId]: "A distinct stored front and back are required." }));
      return;
    }
    setBusyId(card.inventoryItemId);
    setNotice("");
    setPageError("");
    setLocalError((current) => ({ ...current, [card.inventoryItemId]: "" }));
    setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "scanning" }));
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp-front-back", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          replaceManualIdentity: job?.manualIdentityLocked === true,
          aiCouncilTier: "adaptive",
        }),
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        throw new Error([data.error || "Exact front-and-back scan failed.", data.code, data.stage].filter(Boolean).join(" · "));
      }
      if (data.identityComplete === true) {
        setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "complete" }));
        setNotice(`${data.title || card.title}: exact checklist identity resolved.`);
      } else {
        setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "review" }));
        setLocalError((current) => ({
          ...current,
          [card.inventoryItemId]: data.parallelDecision?.evidence || "The exact parallel remains unresolved. No Base or look-alike parallel was substituted.",
        }));
      }
      await load();
    } catch (error) {
      setLocalStage((current) => ({ ...current, [card.inventoryItemId]: "failed" }));
      setLocalError((current) => ({ ...current, [card.inventoryItemId]: message(error) }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-800">KINGMAKER / Pending</p>
            <h1 className="mt-1 text-3xl font-black">Review the finished InstaComp work</h1>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
              Automatic text orientation should keep both sides upright. If it misses, rotate the stored draft here.
              Every identity and listing field remains editable before approval. Nothing publishes automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || Boolean(busyId)}
            className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload"}
          </button>
        </div>

        {pageError ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{pageError}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        {!loading && !cards.length ? (
          <div className="mt-6 rounded-2xl border border-neutral-300 bg-white p-8 text-center">
            <p className="text-xl font-black">No Pending InstaComp cards</p>
            <p className="mt-2 text-neutral-600">Drop the next front/back pair on the KINGMAKER home page.</p>
          </div>
        ) : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const job = jobs[card.inventoryItemId];
            const pairReady = hasValidPair(card);
            const isBusy = busyId === card.inventoryItemId;
            const edit = edits[card.inventoryItemId];
            const storedStage: LocalStage = job?.manualIdentityLocked
              ? "locked"
              : job?.identityComplete
                ? "complete"
                : job?.status === "failed"
                  ? "failed"
                  : job?.status === "review_required"
                    ? "review"
                    : "waiting";
            const stage = localStage[card.inventoryItemId] || storedStage;
            const error = localError[card.inventoryItemId] || (stage === "failed" ? job?.error || "" : "");
            const soldCompEvidence = card.instaComp.soldCompEvidence || [];
            const activeCompetition = card.instaComp.activeCompetition || [];
            const suggested = Number(card.instaComp.suggestedPrice || 0);
            const priceChoices = suggested > 0
              ? [
                  ["InstaComp", suggested, "instacomp"],
                  ["+5%", Math.round(suggested * 1.05 * 100) / 100, "instacomp_plus_5"],
                  ["+10%", Math.round(suggested * 1.1 * 100) / 100, "instacomp_plus_10"],
                ] as const
              : [];

            return (
              <article key={card.inventoryItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div className="min-w-0">
                    <h2 className="font-black">{card.title}</h2>
                    <p className="mt-1 break-all text-xs font-mono text-emerald-300">
                      {card.instaComp.cardUuid ? `UUID ${card.instaComp.cardUuid}` : "Permanent UUID missing — review required"}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>
                    {pairReady ? "FRONT + BACK READY" : "SIDE MISSING"}
                  </span>
                </div>

                <div className="border-b-2 border-neutral-900 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                    <span>
                      {stage === "scanning"
                        ? "Reading exact identity"
                        : stage === "complete"
                          ? "Exact identity complete"
                          : stage === "locked"
                            ? "Operator-confirmed identity locked"
                            : stage === "review"
                              ? "Review required"
                              : stage === "failed"
                                ? "InstaComp stopped safely"
                                : "Pending review"}
                    </span>
                    <span>{stage === "complete" || stage === "locked" ? "100%" : ""}</span>
                  </div>
                  <div className="mt-2 h-3 overflow-hidden rounded-full bg-neutral-200">
                    <div
                      className={`h-full ${stage === "complete" || stage === "locked" ? "w-full bg-emerald-600" : stage === "review" ? "w-2/3 bg-amber-500" : stage === "failed" ? "w-1/3 bg-red-700" : stage === "scanning" ? "w-2/3 animate-pulse bg-sky-700" : "w-1/2 bg-neutral-400"}`}
                    />
                  </div>
                  {error ? <div className="mt-3 rounded-lg border-2 border-red-700 bg-red-50 p-3 font-bold text-red-900">{error}{job?.errorCode ? ` · ${job.errorCode}` : ""}</div> : null}

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Parallel</span><p>{job?.selectedParallel || card.instaComp.identity?.parallel || "Base"}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Visible pattern</span><p>{displayPattern(job?.visualPattern || null)}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Serial</span><p>{job?.visualSerial || card.instaComp.serialNumber || "None seen"}</p></div>
                    <div className="rounded-lg bg-neutral-100 p-3"><span className="font-black">Exact sold comps</span><p>{card.instaComp.reliableSoldCompCount || 0}</p></div>
                  </div>
                </div>

                {(soldCompEvidence.length || activeCompetition.length) ? (
                  <div className="grid gap-4 border-b-2 border-neutral-900 bg-neutral-50 p-4 lg:grid-cols-2">
                    <MarketEvidencePanel
                      title="Exact sold evidence"
                      subtitle="Sold transactions used to establish market value"
                      rows={soldCompEvidence}
                      dateKey="soldAt"
                    />
                    <MarketEvidencePanel
                      title="Active competition"
                      subtitle="Current asking prices shown separately from sold value"
                      rows={activeCompetition}
                      dateKey="listedAt"
                    />
                  </div>
                ) : null}

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {([ ["front", card.frontImageUrl], ["back", card.backImageUrl] ] as const).map(([side, url]) => (
                    <figure key={side} className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                      <figcaption className="mb-2 flex items-center justify-between gap-2 text-xs font-black uppercase tracking-wider">
                        <span>Card {side} · auto-oriented</span>
                        {url ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void rotateImage(card, side)}
                            className="rounded-lg bg-neutral-800 px-3 py-2 normal-case tracking-normal text-white disabled:opacity-40"
                          >
                            Rotate 90° ↻
                          </button>
                        ) : null}
                      </figcaption>
                      <div className="flex h-80 items-center justify-center overflow-hidden rounded-lg bg-white">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={`${card.title} ${side}`} className="max-h-full max-w-full object-contain" />
                        ) : (
                          <div className="font-black text-red-800">{side.toUpperCase()} MISSING</div>
                        )}
                      </div>
                    </figure>
                  ))}
                </div>

                {priceChoices.length ? (
                  <div className="border-t-2 border-neutral-900 bg-emerald-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-black">Exact-comp pricing</p>
                        <p className="text-sm font-semibold text-neutral-600">Current draft price: {money(card.price || card.instaComp.listingPrice)}</p>
                      </div>
                      <div className="grid min-w-[300px] flex-1 gap-2 sm:grid-cols-3 lg:max-w-2xl">
                        {priceChoices.map(([label, value, source]) => (
                          <button
                            key={source}
                            type="button"
                            disabled={isBusy}
                            onClick={() => void savePrice(card, value, source)}
                            className="rounded-xl border-2 border-emerald-700 bg-white p-3 text-left disabled:opacity-40"
                          >
                            <span className="block text-xs font-bold text-neutral-500">{label}</span>
                            <span className="text-lg font-black">{money(value)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {editingId === card.inventoryItemId && edit ? (
                  <div className="border-t-2 border-neutral-900 bg-amber-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-black">Correct any field</h3>
                        <p className="mt-1 text-sm font-semibold text-neutral-600">Saving locks this identity as operator-confirmed truth. Structural Base is always removed from the displayed title.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setEditValue(card.inventoryItemId, "title", standardizedTitle(edit))}
                        className="rounded-xl border-2 border-neutral-900 bg-white px-4 py-2 text-sm font-black"
                      >
                        Rebuild Standard Title
                      </button>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                      <div className="md:col-span-2 lg:col-span-4">
                        <Field label="Listing title" value={edit.title} onChange={(value) => setEditValue(card.inventoryItemId, "title", value)} />
                      </div>
                      <Field label="Year" value={edit.year} onChange={(value) => setEditValue(card.inventoryItemId, "year", value)} />
                      <Field label="Manufacturer" value={edit.manufacturer} onChange={(value) => setEditValue(card.inventoryItemId, "manufacturer", value)} />
                      <Field label="Product / Brand" value={edit.brand} onChange={(value) => setEditValue(card.inventoryItemId, "brand", value)} />
                      <Field label="Set / Insert / Level" value={edit.setName} onChange={(value) => setEditValue(card.inventoryItemId, "setName", value)} />
                      <Field label="Subset" value={edit.subset} onChange={(value) => setEditValue(card.inventoryItemId, "subset", value)} />
                      <Field label="Player" value={edit.player} onChange={(value) => setEditValue(card.inventoryItemId, "player", value)} />
                      <Field label="Team" value={edit.team} onChange={(value) => setEditValue(card.inventoryItemId, "team", value)} />
                      <Field label="Sport" value={edit.sport} onChange={(value) => setEditValue(card.inventoryItemId, "sport", value)} />
                      <Field label="League" value={edit.league} onChange={(value) => setEditValue(card.inventoryItemId, "league", value)} />
                      <Field label="Card number" value={edit.cardNumber} onChange={(value) => setEditValue(card.inventoryItemId, "cardNumber", value)} />
                      <Field label="Exact parallel" value={edit.parallel} placeholder="Base or White Seismic Prizm" onChange={(value) => setEditValue(card.inventoryItemId, "parallel", value)} />
                      <Field label="Variation" value={edit.variation} onChange={(value) => setEditValue(card.inventoryItemId, "variation", value)} />
                      <Field label="Physical serial / print run" value={edit.printRun} placeholder="06/75 or /75" onChange={(value) => setEditValue(card.inventoryItemId, "printRun", value)} />
                      <Field label="Memorabilia type" value={edit.memorabiliaType} placeholder="Patch, jersey, relic…" onChange={(value) => setEditValue(card.inventoryItemId, "memorabiliaType", value)} />
                      <Field label="Inscription text" value={edit.inscriptionText} onChange={(value) => setEditValue(card.inventoryItemId, "inscriptionText", value)} />
                      <Field label="Category" value={edit.category} onChange={(value) => setEditValue(card.inventoryItemId, "category", value)} />
                      <Field label="Condition" value={edit.condition} onChange={(value) => setEditValue(card.inventoryItemId, "condition", value)} />
                    </div>

                    <label className="mt-3 block text-sm font-bold">
                      Description
                      <textarea
                        value={edit.description}
                        onChange={(event) => setEditValue(card.inventoryItemId, "description", event.target.value)}
                        rows={5}
                        className="mt-1 w-full rounded-lg border-2 border-neutral-300 bg-white p-3 text-neutral-950 focus:border-neutral-950 focus:outline-none"
                      />
                    </label>

                    <div className="mt-4 flex flex-wrap gap-4 rounded-xl border border-neutral-300 bg-white p-3">
                      {([
                        ["isRookie", "Rookie"],
                        ["isAuto", "Autograph"],
                        ["isRelic", "Memorabilia / Relic"],
                        ["inscription", "Inscription"],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 font-bold">
                          <input
                            type="checkbox"
                            checked={edit[key]}
                            onChange={(event) => setEditValue(card.inventoryItemId, key, event.target.checked)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void saveEdit(card)}
                        disabled={isBusy}
                        className="rounded-xl bg-amber-600 px-5 py-3 font-black text-white disabled:opacity-50"
                      >
                        Save, Lock & Teach InstaComp
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className="rounded-xl bg-neutral-700 px-5 py-3 font-black text-white">Cancel</button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">Stored image rows: {card.storedImageCount || 0} · quantity 1 physical card · never auto-published</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(card)}
                      disabled={Boolean(busyId)}
                      className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      Edit All Fields
                    </button>
                    {stage === "failed" ? (
                      <button
                        type="button"
                        onClick={() => void runExactIdentity(card)}
                        disabled={!pairReady || Boolean(busyId)}
                        className="rounded-xl bg-red-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                      >
                        Retry This Card
                      </button>
                    ) : null}
                    <button
                      type="button"
                      title={job?.manualIdentityLocked ? "Re-scan and Replace Locked Identity" : "Run Exact Identity"}
                      onClick={() => void runExactIdentity(card)}
                      disabled={!pairReady || Boolean(busyId)}
                      className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      {isBusy
                        ? "Working…"
                        : job?.manualIdentityLocked
                          ? "Replace Manual Identity with AI"
                          : "Run Exact Identity"}
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

function MarketEvidencePanel({
  title,
  subtitle,
  rows,
  dateKey,
}: {
  title: string;
  subtitle: string;
  rows: CompEvidence[];
  dateKey: "soldAt" | "listedAt";
}) {
  return (
    <div className="rounded-xl border border-neutral-300 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-black">{title}</h3>
          <p className="mt-1 text-xs font-semibold text-neutral-500">{subtitle}</p>
        </div>
        <span className="rounded-full bg-neutral-950 px-2.5 py-1 text-xs font-black text-white">
          {rows.length}
        </span>
      </div>
      {rows.length ? (
        <div className="mt-3 space-y-2">
          {rows.slice(0, 5).map((row, index) => (
            <div key={`${row.url || row.title || title}-${index}`} className="rounded-lg bg-neutral-100 p-3 text-sm">
              {row.url ? (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold underline decoration-neutral-400 underline-offset-2"
                >
                  {row.title || "Market listing"}
                </a>
              ) : (
                <p className="font-bold">{row.title || "Market listing"}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-neutral-600">
                <span>{money(row.price)}</span>
                {row.sourceLabel ? <span>{row.sourceLabel}</span> : null}
                {row[dateKey] ? <span>{row[dateKey]}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm font-semibold text-neutral-500">None accepted yet.</p>
      )}
    </div>
  );
}
