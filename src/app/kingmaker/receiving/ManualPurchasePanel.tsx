"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { pairManualPurchaseCardPhotos } from "../../../lib/manual-purchase-photo-pairing";
import { getFreshAccountSession } from "../../account/account-session";

type Mode = "single" | "lot";
type AllocationMethod = "equal_split" | "manual";

type ManualCard = {
  id: string;
  title: string;
  player: string;
  year: string;
  brand: string;
  setName: string;
  cardNumber: string;
  parallel: string;
  serialNumber: string;
  isAuto: boolean;
  isRelic: boolean;
  scanId: string;
  cardUuid: string;
  inventoryItemId: string;
  allocatedCost: string;
  individualCostExact: boolean;
  files: File[];
  identificationStatus: "idle" | "identifying" | "identified" | "review";
  identificationNote: string;
};

type Props = {
  onSaved: () => void | Promise<void>;
};

function cardId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyCard(seed?: Partial<ManualCard>): ManualCard {
  return {
    id: seed?.id || cardId(),
    title: seed?.title || "",
    player: seed?.player || "",
    year: seed?.year || "",
    brand: seed?.brand || "",
    setName: seed?.setName || "",
    cardNumber: seed?.cardNumber || "",
    parallel: seed?.parallel || "Base",
    serialNumber: seed?.serialNumber || "",
    isAuto: seed?.isAuto || false,
    isRelic: seed?.isRelic || false,
    scanId: seed?.scanId || "",
    cardUuid: seed?.cardUuid || "",
    inventoryItemId: seed?.inventoryItemId || "",
    allocatedCost: seed?.allocatedCost || "",
    individualCostExact: seed?.individualCostExact || false,
    files: seed?.files || [],
    identificationStatus: seed?.identificationStatus || "idle",
    identificationNote: seed?.identificationNote || "",
  };
}

function number(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function apiJson(path: string, accessToken: string, body: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(String(data?.error || data?.detail || `Request failed (${response.status})`));
  }
  return data as Record<string, any>;
}

async function uploadEvidence(
  accessToken: string,
  lotId: string,
  file: File,
  kind: string,
  draftCardId?: string,
) {
  const form = new FormData();
  form.set("lotId", lotId);
  form.set("evidenceKind", kind);
  if (draftCardId) form.set("draftCardId", draftCardId);
  form.set("file", file, file.name);
  const response = await fetch("/api/account/seller/instacomp-manual-purchase/evidence", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(String(data?.error || data?.detail || "Evidence upload failed."));
  }
  return data;
}

export default function ManualPurchasePanel({ onSaved }: Props) {
  const searchParams = useSearchParams();
  const requestedFromInventory = searchParams.get("addPurchase") === "1";
  const inventorySeed = useMemo(
    () =>
      emptyCard({
        title: searchParams.get("title") || "",
        player: searchParams.get("player") || "",
        year: searchParams.get("year") || "",
        brand: searchParams.get("brand") || "",
        setName: searchParams.get("setName") || "",
        cardNumber: searchParams.get("cardNumber") || "",
        parallel: searchParams.get("parallel") || "Base",
        serialNumber: searchParams.get("serialNumber") || "",
        scanId: searchParams.get("scanId") || "",
        cardUuid: searchParams.get("cardUuid") || "",
        inventoryItemId: searchParams.get("inventoryItemId") || "",
      }),
    [searchParams],
  );

  const [open, setOpen] = useState(requestedFromInventory);
  const [mode, setMode] = useState<Mode>("single");
  const [source, setSource] = useState("Misc");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [seller, setSeller] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [totalCost, setTotalCost] = useState("");
  const [notes, setNotes] = useState("");
  const [cards, setCards] = useState<ManualCard[]>([inventorySeed]);
  const [lotFiles, setLotFiles] = useState<File[]>([]);
  const [allocationMethod, setAllocationMethod] = useState<AllocationMethod>("equal_split");
  const [disposition, setDisposition] = useState<"resale" | "investment_stash">("resale");
  const [saving, setSaving] = useState(false);
  const [resolvingUrl, setResolvingUrl] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateCard(id: string, patch: Partial<ManualCard>) {
    setCards((current) => current.map((card) => (card.id === id ? { ...card, ...patch } : card)));
  }

  function switchMode(next: Mode) {
    setMode(next);
    setAllocationMethod(next === "lot" ? "equal_split" : "manual");
    if (next === "single") setCards((current) => [current[0] || emptyCard()]);
  }

  function addCard() {
    setCards((current) => [...current, emptyCard()]);
  }

  async function identifyCardsFromPhotos(targets: ManualCard[]) {
    if (!targets.length) return;
    let accessToken = "";
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      accessToken = session?.access_token || "";
      if (!accessToken) throw new Error("Seller login is required.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start automatic identification.";
      targets.forEach((card) => updateCard(card.id, { identificationStatus: "review", identificationNote: message }));
      return;
    }

    for (const card of targets) {
      const front = card.files[0];
      const back = card.files[1] || null;
      if (!front) continue;
      updateCard(card.id, {
        identificationStatus: "identifying",
        identificationNote: back ? "Identifying from front + back…" : "Identifying from the available card photo…",
      });
      try {
        const form = new FormData();
        form.set("front", front, front.name);
        if (back) form.set("back", back, back.name);
        const response = await fetch("/api/account/seller/instacomp-manual-purchase/identify", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.error) {
          throw new Error(String(data?.error || data?.detail || "Automatic card identification failed."));
        }
        const identity = (data?.identity || {}) as Record<string, any>;
        updateCard(card.id, {
          title: String(data?.title || card.title || "").trim(),
          player: String(identity.player || card.player || "").trim(),
          year: String(identity.year || card.year || "").trim(),
          brand: String(identity.brand || card.brand || "").trim(),
          setName: String(identity.setName || card.setName || "").trim(),
          cardNumber: String(identity.cardNumber || card.cardNumber || "").trim(),
          parallel: String(identity.parallel || card.parallel || "Base").trim(),
          serialNumber: String(identity.serialNumber || card.serialNumber || "").trim(),
          isAuto: identity.isAuto === true || card.isAuto,
          isRelic: identity.isRelic === true || card.isRelic,
          identificationStatus: data?.usable ? "identified" : "review",
          identificationNote: data?.usable
            ? `Auto-identified by InstaComp${back ? " from front + back" : ""}.`
            : "InstaComp filled what it could; review the missing identity fields.",
        });
      } catch (err) {
        updateCard(card.id, {
          identificationStatus: "review",
          identificationNote: err instanceof Error ? err.message : "Automatic card identification failed.",
        });
      }
    }
  }

  function addCardsFromPhotos(files: File[]) {
    if (!files.length) return;
    const pairs = pairManualPurchaseCardPhotos(files);
    const added = pairs.map((pair) =>
      emptyCard({
        files: pair.files,
        identificationStatus: "identifying",
        identificationNote: pair.back
          ? `Front/back pair detected (${pair.pairing}). Identifying…`
          : "Only one image was found for this card. Identifying what is visible…",
      }),
    );
    setMode("lot");
    setCards((current) => {
      const keep = current.length === 1 && !current[0].title && !current[0].player && !current[0].cardNumber
        ? []
        : current;
      return [...keep, ...added];
    });
    void identifyCardsFromPhotos(added);
  }

  function attachCardPhotos(card: ManualCard, files: File[]) {
    if (!files.length) {
      updateCard(card.id, { files: [], identificationStatus: "idle", identificationNote: "" });
      return;
    }
    const pair = pairManualPurchaseCardPhotos(files)[0];
    const selected = pair?.files || files.slice(0, 2);
    const next = { ...card, files: selected };
    updateCard(card.id, {
      files: selected,
      identificationStatus: "identifying",
      identificationNote: selected.length >= 2 ? "Front + back attached. Identifying…" : "Photo attached. Identifying…",
    });
    void identifyCardsFromPhotos([next]);
  }

  async function resolvePurchaseUrl() {
    const url = referenceText.trim();
    if (!url) return;
    setResolvingUrl(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const data = await apiJson(
        "/api/account/seller/instacomp-manual-purchase/resolve-url",
        session.access_token,
        { url },
      );
      const identity = (data?.identity || {}) as Record<string, any>;
      setSource(String(data?.source || source || "Misc"));
      if (data?.seller) setSeller(String(data.seller));
      if (data?.orderNumber) setOrderNumber(String(data.orderNumber));
      if (mode === "single" && Number(data?.totalCost) > 0) {
        setTotalCost(Number(data.totalCost).toFixed(2));
      }
      if (mode === "single" && data?.purchaseDate) {
        const date = new Date(String(data.purchaseDate));
        if (!Number.isNaN(date.getTime())) setPurchaseDate(date.toISOString().slice(0, 10));
      }
      setCards((current) => {
        const target = current[0] || emptyCard();
        const filled: ManualCard = {
          ...target,
          title: String(data?.title || target.title || "").trim(),
          player: String(identity.player || target.player || "").trim(),
          year: String(identity.year || target.year || "").trim(),
          brand: String(identity.brand || target.brand || "").trim(),
          setName: String(identity.setName || target.setName || "").trim(),
          cardNumber: String(identity.cardNumber || target.cardNumber || "").trim(),
          parallel: String(identity.parallel || target.parallel || "Base").trim(),
          serialNumber: String(identity.serialNumber || target.serialNumber || "").trim(),
          isAuto: identity.isAuto === true || target.isAuto,
          isRelic: identity.isRelic === true || target.isRelic,
          identificationStatus: data?.usable ? "identified" : "review",
          identificationNote: data?.usable
            ? "Identity filled from the eBay item URL."
            : "The URL filled the listing details; review any identity fields eBay did not provide.",
        };
        return current.length ? [filled, ...current.slice(1)] : [filled];
      });
      setNotice(data?.usable
        ? "Purchase URL matched and Card 1 was filled automatically."
        : "Purchase URL loaded. Review the fields eBay did not provide.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the purchase URL.");
    } finally {
      setResolvingUrl(false);
    }
  }

  function removeCard(id: string) {
    setCards((current) => {
      const next = current.filter((card) => card.id !== id);
      return next.length ? next : [emptyCard()];
    });
  }

  function resetForm() {
    setMode("single");
    setSource("Misc");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setSeller("");
    setOrderNumber("");
    setReferenceText("");
    setTotalCost("");
    setNotes("");
    setCards([emptyCard()]);
    setLotFiles([]);
    setAllocationMethod("equal_split");
    setDisposition("resale");
  }

  async function saveAndConfirm() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (number(totalCost) <= 0) throw new Error("Enter the real total amount you paid.");
      if (!cards.length) throw new Error("Add at least one card.");
      if (mode === "single" && cards.length !== 1) throw new Error("Single-card mode can only contain one card.");
      if (cards.some((card) => card.identificationStatus === "identifying")) {
        throw new Error("Automatic identification is still running. Wait for the card rows to finish before confirming.");
      }
      const incomplete = cards.find(
        (card) => !card.scanId && (!card.player.trim() || !card.cardNumber.trim()),
      );
      if (incomplete) {
        throw new Error("One or more cards could not be fully identified. Review the highlighted row and fill only the missing player/card number.");
      }
      if (mode === "lot" && allocationMethod === "manual") {
        const sum = cards.reduce((value, card) => value + number(card.allocatedCost), 0);
        if (cards.some((card) => number(card.allocatedCost) <= 0)) {
          throw new Error("Every card needs a positive allocation when using manual lot allocation.");
        }
        if (Math.abs(sum - number(totalCost)) > 0.009) {
          throw new Error(`Per-card allocations total $${sum.toFixed(2)}, but the lot total is $${number(totalCost).toFixed(2)}.`);
        }
      }

      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");

      const draft = await apiJson(
        "/api/account/seller/instacomp-manual-purchase",
        session.access_token,
        {
          action: "draft",
          mode,
          source,
          purchaseDate,
          seller,
          orderNumber,
          referenceText,
          totalCost: number(totalCost),
          notes,
          cards: cards.map((card) => ({
            id: card.id,
            title: card.title,
            scanId: card.scanId,
            cardUuid: card.cardUuid,
            inventoryItemId: card.inventoryItemId,
            allocatedCost:
              mode === "lot" && allocationMethod === "manual" ? number(card.allocatedCost) : null,
            individualCostExact:
              mode === "single" ||
              (mode === "lot" && allocationMethod === "manual" && card.individualCostExact),
            identity: {
              player: card.player,
              year: card.year,
              brand: card.brand,
              setName: card.setName,
              cardNumber: card.cardNumber,
              parallel: card.parallel || "Base",
              serialNumber: card.serialNumber,
              isAuto: card.isAuto,
              isRelic: card.isRelic,
            },
          })),
        },
      );
      const lotId = String(draft?.lot?.id || "");
      if (!lotId) throw new Error("The Mac did not return a purchase-lot ID.");

      for (const file of lotFiles) {
        await uploadEvidence(session.access_token, lotId, file, "receipt");
      }
      for (const card of cards) {
        for (const file of card.files) {
          await uploadEvidence(session.access_token, lotId, file, "card_photo", card.id);
        }
      }

      const confirmed = await apiJson(
        "/api/account/seller/instacomp-manual-purchase",
        session.access_token,
        {
          action: "confirm",
          lotId,
          allocationMethod: mode === "lot" ? allocationMethod : "manual",
          disposition,
        },
      );
      const acquisitions = Array.isArray(confirmed.acquisitions) ? confirmed.acquisitions : [];
      const evidenceCount = Number(confirmed?.lot?.evidenceCount || 0);
      const links = Array.isArray(confirmed.existingInventoryLinks)
        ? confirmed.existingInventoryLinks.filter((row: any) => row?.success === true).length
        : 0;
      const learningCopy =
        mode === "lot" && allocationMethod === "equal_split"
          ? " Equal per-card amounts are bookkeeping allocations only; InstaComp will not learn them as exact individual card prices."
          : "";
      setNotice(
        `Confirmed ${mode === "lot" ? "lot" : "purchase"}: $${number(totalCost).toFixed(2)} across ${acquisitions.length} card${acquisitions.length === 1 ? "" : "s"} with ${evidenceCount} evidence file${evidenceCount === 1 ? "" : "s"}.${links ? ` ${links} existing inventory card${links === 1 ? "" : "s"} linked.` : ""}${learningCopy}`,
      );
      await onSaved();
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this purchase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 rounded-2xl border-2 border-neutral-900 bg-white p-5 shadow-[5px_5px_0_#111]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-700">Manual acquisition evidence</p>
          <h2 className="text-2xl font-black">Add Card Manually / Add Purchase Lot</h2>
          <p className="mt-1 max-w-4xl text-sm font-semibold text-neutral-700">
            Record what you actually paid before or after listing. Receipts, screenshots, and card photos are hashed and kept with the Mac-local purchase audit trail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-xl border-2 border-neutral-900 bg-violet-200 px-4 py-3 font-black shadow-[3px_3px_0_#111]"
        >
          {open ? "Close manual entry" : "Add Card Manually"}
        </button>
      </div>

      {notice ? <p className="mt-4 rounded-xl border-2 border-emerald-800 bg-emerald-100 p-3 text-sm font-bold text-emerald-950">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl border-2 border-red-900 bg-red-100 p-3 text-sm font-bold text-red-950">{error}</p> : null}

      {open ? (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => switchMode("single")} className={`rounded-lg border-2 border-neutral-900 px-4 py-2 font-black ${mode === "single" ? "bg-black text-white" : "bg-white"}`}>Single card</button>
            <button type="button" onClick={() => switchMode("lot")} className={`rounded-lg border-2 border-neutral-900 px-4 py-2 font-black ${mode === "lot" ? "bg-black text-white" : "bg-white"}`}>Purchase lot</button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="font-bold">Total paid *
              <input value={totalCost} onChange={(e) => setTotalCost(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2" />
            </label>
            <label className="font-bold">Purchase date
              <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2" />
            </label>
            <label className="font-bold">Source
              <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2">
                {["eBay", "Mercari", "Card Show", "Card Shop", "Private Deal", "Trade", "Misc"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="font-bold">Seller / source name
              <input value={seller} onChange={(e) => setSeller(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2" />
            </label>
            <label className="font-bold">Order / reference number
              <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2" />
            </label>
            <label className="font-bold">Purchase / item URL
              <input
                value={referenceText}
                onChange={(e) => setReferenceText(e.target.value)}
                onBlur={() => {
                  if (/^https?:\/\//i.test(referenceText.trim()) && !resolvingUrl) void resolvePurchaseUrl();
                }}
                placeholder="Paste the eBay item URL and it will fill Card 1"
                className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2"
              />
              <button
                type="button"
                disabled={resolvingUrl || !referenceText.trim()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void resolvePurchaseUrl()}
                className="mt-2 rounded-lg border-2 border-neutral-900 bg-sky-100 px-3 py-2 text-sm font-black disabled:opacity-50"
              >
                {resolvingUrl ? "Reading item…" : "Fill card from URL"}
              </button>
            </label>
          </div>

          <div className="rounded-xl border-2 border-neutral-900 bg-neutral-50 p-4">
            <p className="font-black">Lot-level proof</p>
            <p className="text-sm font-semibold text-neutral-600">Attach the receipt, order screenshot, invoice, or listing screenshot once. It backs the entire purchase.</p>
            <input type="file" multiple accept="image/*,.pdf" onChange={(e) => setLotFiles(Array.from(e.target.files || []))} className="mt-2 block w-full text-sm font-bold" />
            {lotFiles.length ? <p className="mt-1 text-xs font-bold">{lotFiles.length} file(s) ready to upload.</p> : null}
          </div>

          {mode === "lot" ? (
            <div className="rounded-xl border-2 border-violet-700 bg-violet-50 p-4">
              <p className="font-black">Add all cards in the lot</p>
              <p className="text-sm font-semibold text-violet-950">Upload front + back for every card. Named Front/Back files pair automatically; ordinary camera files pair in order. Twelve images become six card rows, not twelve. InstaComp then identifies each pair automatically.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={addCard} className="rounded-lg border-2 border-neutral-900 bg-white px-3 py-2 font-black">+ Add another card</button>
                <label className="cursor-pointer rounded-lg border-2 border-neutral-900 bg-white px-3 py-2 font-black">
                  Upload multiple card photos
                  <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => addCardsFromPhotos(Array.from(e.target.files || []))} />
                </label>
              </div>
              <div className="mt-4">
                <p className="font-black">Cost allocation</p>
                <label className="mt-2 flex items-start gap-2 text-sm font-bold">
                  <input type="radio" checked={allocationMethod === "equal_split"} onChange={() => setAllocationMethod("equal_split")} />
                  Equal bookkeeping split — keeps the lot balanced, but is NOT learned as the exact price of each card.
                </label>
                <label className="mt-2 flex items-start gap-2 text-sm font-bold">
                  <input type="radio" checked={allocationMethod === "manual"} onChange={() => setAllocationMethod("manual")} />
                  Enter per-card allocations manually.
                </label>
              </div>
            </div>
          ) : null}

          <div className="space-y-4">
            {cards.map((card, index) => (
              <article key={card.id} className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-black">Card {index + 1}</p>
                  {mode === "lot" && cards.length > 1 ? <button type="button" onClick={() => removeCard(card.id)} className="rounded border-2 border-red-800 px-2 py-1 text-xs font-black text-red-900">Remove</button> : null}
                </div>
                {card.scanId ? <p className="mt-1 rounded bg-emerald-100 px-2 py-1 text-xs font-black text-emerald-900">Linked to existing InstaComp scan {card.scanId}</p> : null}
                {card.identificationNote ? (
                  <p className={`mt-2 rounded px-3 py-2 text-xs font-black ${
                    card.identificationStatus === "identified"
                      ? "bg-emerald-100 text-emerald-900"
                      : card.identificationStatus === "identifying"
                        ? "bg-sky-100 text-sky-900"
                        : "bg-amber-100 text-amber-950"
                  }`}>
                    {card.identificationNote}
                  </p>
                ) : null}
                {card.identificationStatus === "identified" ? (
                  <div className="mt-3 rounded-lg border-2 border-emerald-700 bg-emerald-50 p-3">
                    <p className="font-black">{card.title || [card.year, card.brand, card.player, card.cardNumber ? `#${card.cardNumber}` : ""].filter(Boolean).join(" ")}</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-950">
                      {[card.player, card.year, card.brand, card.setName, card.cardNumber ? `#${card.cardNumber}` : null, card.parallel, card.serialNumber].filter(Boolean).join(" · ")}
                    </p>
                    <button type="button" onClick={() => updateCard(card.id, { identificationStatus: "review", identificationNote: "Manual identity editing enabled." })} className="mt-2 rounded border-2 border-neutral-900 bg-white px-2 py-1 text-xs font-black">
                      Edit identity
                    </button>
                  </div>
                ) : card.identificationStatus === "identifying" ? (
                  <p className="mt-3 text-sm font-bold text-sky-900">Reading the card now — no identity typing needed.</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs font-semibold text-neutral-600">Only fill these fields when automatic identification needs review.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <label className="font-bold md:col-span-2">Card title
                        <input value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Player *
                        <input value={card.player} onChange={(e) => updateCard(card.id, { player: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Card # *
                        <input value={card.cardNumber} onChange={(e) => updateCard(card.id, { cardNumber: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Year
                        <input value={card.year} onChange={(e) => updateCard(card.id, { year: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Brand / maker
                        <input value={card.brand} onChange={(e) => updateCard(card.id, { brand: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Set / product
                        <input value={card.setName} onChange={(e) => updateCard(card.id, { setName: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Parallel
                        <input value={card.parallel} onChange={(e) => updateCard(card.id, { parallel: e.target.value })} className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                      <label className="font-bold">Serial / print run
                        <input value={card.serialNumber} onChange={(e) => updateCard(card.id, { serialNumber: e.target.value })} placeholder="12/99 or /99" className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={card.isAuto} onChange={(e) => updateCard(card.id, { isAuto: e.target.checked })} /> Autograph</label>
                      <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={card.isRelic} onChange={(e) => updateCard(card.id, { isRelic: e.target.checked })} /> Relic / memorabilia</label>
                    </div>
                  </>
                )}
                {mode === "lot" && allocationMethod === "manual" ? (
                  <div className="mt-3 flex flex-wrap items-end gap-4">
                    <label className="font-bold">Allocated cost
                      <input value={card.allocatedCost} onChange={(e) => updateCard(card.id, { allocatedCost: e.target.value })} inputMode="decimal" className="mt-1 w-full rounded-lg border-2 border-neutral-300 px-3 py-2" />
                    </label>
                    <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={card.individualCostExact} onChange={(e) => updateCard(card.id, { individualCostExact: e.target.checked })} /> This allocation is the exact known price for this card</label>
                  </div>
                ) : null}
                <div className="mt-3 rounded-lg bg-neutral-100 p-3">
                  <p className="text-sm font-black">Front + back card photos</p>
                  <p className="text-xs font-semibold text-neutral-600">These two photos stay together as one card and trigger automatic InstaComp identification.</p>
                  <input type="file" multiple accept="image/*" onChange={(e) => attachCardPhotos(card, Array.from(e.target.files || []))} className="mt-1 block w-full text-sm font-bold" />
                  {card.files.length ? (
                    <p className="mt-1 text-xs font-bold">
                      Front: {card.files[0]?.name || "—"}{card.files[1] ? ` · Back: ${card.files[1].name}` : " · Back missing"}
                    </p>
                  ) : null}
                  {card.files.length ? (
                    <button
                      type="button"
                      disabled={card.identificationStatus === "identifying"}
                      onClick={() => void identifyCardsFromPhotos([card])}
                      className="mt-2 rounded border-2 border-neutral-900 bg-white px-2 py-1 text-xs font-black disabled:opacity-50"
                    >
                      {card.identificationStatus === "identifying" ? "Identifying…" : "Re-run InstaComp ID"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <label className="block font-bold">Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border-2 border-neutral-400 px-3 py-2" />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="font-bold">Receive/link as
              <select value={disposition} onChange={(e) => setDisposition(e.target.value === "investment_stash" ? "investment_stash" : "resale")} className="ml-2 rounded-lg border-2 border-neutral-400 px-3 py-2">
                <option value="resale">Resale</option>
                <option value="investment_stash">Investment Stash</option>
              </select>
            </label>
            <button type="button" disabled={saving || cards.some((card) => card.identificationStatus === "identifying")} onClick={() => void saveAndConfirm()} className="rounded-xl border-2 border-neutral-900 bg-emerald-300 px-5 py-3 font-black shadow-[3px_3px_0_#111] disabled:opacity-50">
              {saving
                ? "Saving evidence…"
                : cards.some((card) => card.identificationStatus === "identifying")
                  ? "Identifying cards…"
                  : mode === "lot"
                    ? "Confirm Purchase Lot"
                    : "Confirm Manual Purchase"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
