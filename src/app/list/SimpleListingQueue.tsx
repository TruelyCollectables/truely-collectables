"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chunkDualMarketplaceItems,
  type DualMarketplaceAction,
} from "@/src/lib/dual-marketplace-workflow";

type ListingRow = {
  inventoryItemId: string;
  legacyProductId: number | null;
  sku: string | null;
  websiteStatus: string;
  ebayStatus: string;
  ebayItemId: string | null;
  websiteTitle: string;
  websiteDescription: string;
  ebayTitle: string;
  ebayDescription: string;
  ebayPrice: number;
  websitePrice: number;
  quantity: number;
  imageUrls: string[];
  ebayCategoryId: string;
  ebayCondition: "LIKE_NEW" | "USED_VERY_GOOD";
  cardCondition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  aspects: Record<string, string[]>;
  bestOfferEnabled: boolean;
  readyWebsite: boolean;
  readyEbay: boolean;
  websiteProblems: string[];
  ebayProblems: string[];
  lastError: string | null;
};

type EbayReadiness = {
  ready: boolean;
  connected: boolean;
  missing: string[];
  error: string | null;
};

type PendingPublish = {
  action: "publish-both" | "publish-ebay";
  ids: string[];
};

const ASPECT_FIELDS = [
  ["Player", "Player / subject"],
  ["Team", "Team"],
  ["Sport", "Sport"],
  ["Year", "Year"],
  ["Brand", "Brand"],
  ["Set", "Set"],
  ["Card Number", "Card number"],
  ["Parallel/Variety", "Parallel / variation"],
] as const;

function payloadForRows(rows: ListingRow[]) {
  return rows.map((row) => ({
    inventoryItemId: row.inventoryItemId,
    websiteTitle: row.websiteTitle,
    websiteDescription: row.websiteDescription,
    ebayTitle: row.ebayTitle,
    ebayDescription: row.ebayDescription,
    ebayPrice: row.ebayPrice,
    websitePrice: row.websitePrice,
    quantity: row.quantity,
    ebayCategoryId: row.ebayCategoryId,
    ebayCondition: row.ebayCondition,
    cardCondition: row.cardCondition,
    grader: row.grader,
    grade: row.grade,
    certificationNumber: row.certificationNumber,
    aspects: row.aspects,
    bestOfferEnabled: row.bestOfferEnabled,
  }));
}

function aspectValue(row: ListingRow, name: string) {
  const key = Object.keys(row.aspects || {}).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  return key ? String(row.aspects[key]?.[0] || "") : "";
}

function setAspect(row: ListingRow, name: string, value: string) {
  const aspects = { ...(row.aspects || {}) };
  for (const key of Object.keys(aspects)) {
    if (key.toLowerCase() === name.toLowerCase() && key !== name) delete aspects[key];
  }
  if (value.trim()) aspects[name] = [value.trim()];
  else delete aspects[name];
  return { ...row, aspects };
}

export default function SimpleListingQueue() {
  const [rows, setRows] = useState<ListingRow[]>([]);
  const rowsRef = useRef<ListingRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [readiness, setReadiness] = useState<EbayReadiness | null>(null);
  const [pendingPublish, setPendingPublish] = useState<PendingPublish | null>(null);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const loadRows = useCallback(async (selectIds: string[] = []) => {
    setLoading(true);
    try {
      const response = await fetch(
        "/api/admin/dual-marketplace-listings?includeReadiness=1",
        { cache: "no-store", credentials: "same-origin" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not load the listing queue.");
      }
      const incoming = (Array.isArray(data.rows) ? data.rows : []) as ListingRow[];
      const drafts = incoming.filter(
        (row) => row.websiteStatus !== "active" || row.ebayStatus !== "active",
      );
      setRows(drafts);
      setReadiness((data.ebayReadiness || null) as EbayReadiness | null);
      const available = new Set(drafts.map((row) => row.inventoryItemId));
      setSelectedIds((current) =>
        Array.from(new Set([...current, ...selectIds])).filter((id) => available.has(id)),
      );
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load the listing queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRows();
    const onDraftsCreated = (event: Event) => {
      const custom = event as CustomEvent<{ inventoryItemIds?: string[] }>;
      void loadRows(custom.detail?.inventoryItemIds || []);
    };
    window.addEventListener("tcos:simple-list-drafts-created", onDraftsCreated);
    return () => window.removeEventListener("tcos:simple-list-drafts-created", onDraftsCreated);
  }, [loadRows]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selectedSet.has(row.inventoryItemId)),
    [rows, selectedSet],
  );

  function updateRow(id: string, updater: (row: ListingRow) => ListingRow) {
    setRows((current) =>
      current.map((row) => (row.inventoryItemId === id ? updater(row) : row)),
    );
  }

  function updateField<K extends keyof ListingRow>(id: string, field: K, value: ListingRow[K]) {
    updateRow(id, (row) => ({ ...row, [field]: value }));
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function validate(action: DualMarketplaceAction, targetRows: ListingRow[]) {
    const problems: string[] = [];
    for (const row of targetRows) {
      if (!row.websiteTitle.trim()) problems.push("A listing title is blank.");
      if (row.quantity < 1) problems.push(`${row.websiteTitle}: quantity must be at least 1.`);
      if ((action === "publish-website" || action === "publish-both") && row.websitePrice <= 0) {
        problems.push(`${row.websiteTitle}: website price must be positive.`);
      }
      if ((action === "publish-ebay" || action === "publish-both") && row.ebayPrice <= 0) {
        problems.push(`${row.ebayTitle}: eBay price must be positive.`);
      }
      if (
        (action === "publish-both" || action === "publish-website") &&
        row.ebayPrice > 0 &&
        row.websitePrice >= row.ebayPrice
      ) {
        problems.push(`${row.websiteTitle}: website price must be lower than eBay price.`);
      }
    }
    return Array.from(new Set(problems));
  }

  async function runAction(action: DualMarketplaceAction, ids = selectedIds) {
    if (working) return;
    const idSet = new Set(ids);
    const targets = rowsRef.current.filter((row) => idSet.has(row.inventoryItemId));
    if (!targets.length) {
      setError("Select at least one card first.");
      return;
    }
    const includesEbay = action === "publish-ebay" || action === "publish-both";
    if (includesEbay && readiness?.ready !== true) {
      setError(readiness?.error || `eBay is not ready: ${(readiness?.missing || []).join(", ") || "setup incomplete"}.`);
      return;
    }
    const problems = validate(action, targets);
    if (problems.length) {
      setError(problems.slice(0, 6).join(" | "));
      return;
    }
    if (includesEbay && !pendingPublish) {
      setPendingPublish({ action: action as "publish-both" | "publish-ebay", ids });
      setError("");
      return;
    }

    setWorking(true);
    setNotice("");
    setError("");
    setPendingPublish(null);
    const results: any[] = [];
    const errors: any[] = [];
    let completed = 0;

    try {
      for (const chunk of chunkDualMarketplaceItems(targets, action)) {
        setNotice(`${action.replaceAll("-", " ")} ${completed + 1}–${Math.min(completed + chunk.length, targets.length)} of ${targets.length}...`);
        const response = await fetch("/api/admin/dual-marketplace-listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action, items: payloadForRows(chunk) }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok && !Array.isArray(data.results) && !Array.isArray(data.errors)) {
          throw new Error(data.error || "Listing action failed.");
        }
        results.push(...(Array.isArray(data.results) ? data.results : []));
        errors.push(...(Array.isArray(data.errors) ? data.errors : []));
        completed += chunk.length;
      }

      setNotice(`${results.length} card${results.length === 1 ? "" : "s"} completed${errors.length ? `; ${errors.length} need review` : " successfully"}.`);
      if (errors.length) {
        setError(
          errors
            .slice(0, 8)
            .map((entry) => `${entry.title || entry.inventoryItemId || "Card"}: ${entry.error || "failed"}`)
            .join(" | "),
        );
      }
      const successfulIds = new Set(results.map((entry) => String(entry.inventoryItemId || "")));
      setSelectedIds((current) => current.filter((id) => !successfulIds.has(id)));
      await loadRows();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Listing action failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section id="listing-queue" className="rounded-3xl border-2 border-neutral-950 bg-white p-4 shadow-[7px_7px_0_#facc15] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Step 2 · Review and list</p>
          <h2 className="mt-2 text-3xl font-black">Listing queue</h2>
          <p className="mt-2 max-w-3xl font-semibold text-neutral-600">
            Check one card, five cards, or every card. Edit the final details, then save or publish exactly what is selected.
          </p>
        </div>
        <button type="button" onClick={() => void loadRows()} disabled={working || loading} className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black disabled:opacity-40">Refresh queue</button>
      </div>

      {readiness && !readiness.ready ? (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 font-bold text-amber-900">
          Website listing is available. eBay listing stays blocked until eBay setup is ready{readiness.missing?.length ? `: ${readiness.missing.join(", ")}` : ""}.
        </p>
      ) : null}
      {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900">{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 font-bold text-red-900">{error}</p> : null}

      {pendingPublish ? (
        <div className="mt-4 rounded-2xl border-2 border-red-700 bg-red-50 p-4">
          <h3 className="text-xl font-black text-red-900">Confirm marketplace publishing</h3>
          <p className="mt-2 font-bold text-red-900">
            This will publish {pendingPublish.ids.length} selected card{pendingPublish.ids.length === 1 ? "" : "s"} to {pendingPublish.action === "publish-both" ? "the website and eBay" : "eBay"}. Real marketplace listings and inventory changes may occur.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void runAction(pendingPublish.action, pendingPublish.ids)} className="rounded-xl bg-red-800 px-5 py-3 font-black text-white">Yes, list selected cards</button>
            <button type="button" onClick={() => setPendingPublish(null)} className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black">Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="sticky top-20 z-20 mt-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-neutral-950 bg-yellow-300 p-3 shadow-lg">
        <strong>{selectedRows.length} selected of {rows.length}</strong>
        <button type="button" onClick={() => setSelectedIds(rows.map((row) => row.inventoryItemId))} disabled={working || !rows.length} className="rounded-xl border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-40">Select all</button>
        <button type="button" onClick={() => setSelectedIds([])} disabled={working || !selectedIds.length} className="rounded-xl border-2 border-neutral-950 bg-white px-4 py-2 font-black disabled:opacity-40">Clear</button>
        <button type="button" onClick={() => void runAction("save")} disabled={working || !selectedRows.length} className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black disabled:opacity-40">Save selected</button>
        <button type="button" onClick={() => void runAction("publish-website")} disabled={working || !selectedRows.length} className="rounded-xl bg-blue-700 px-5 py-3 font-black text-white disabled:bg-neutral-500">List selected on website</button>
        <button type="button" onClick={() => void runAction("publish-both")} disabled={working || !selectedRows.length || readiness?.ready !== true} className="rounded-xl bg-neutral-950 px-5 py-3 font-black text-white disabled:bg-neutral-500">List selected on website + eBay</button>
      </div>

      {loading ? <p className="mt-6 font-black">Loading listing queue...</p> : null}
      {!loading && !rows.length ? (
        <p className="mt-6 rounded-2xl border-2 border-dashed border-neutral-400 p-8 text-center text-lg font-black">No card drafts are waiting. Upload and InstaComp cards above.</p>
      ) : null}

      <div className="mt-5 grid gap-4">
        {rows.map((row, index) => (
          <article key={row.inventoryItemId} className={`rounded-2xl border-2 p-4 ${selectedSet.has(row.inventoryItemId) ? "border-blue-700 bg-blue-50/40" : "border-neutral-300"}`}>
            <div className="grid gap-4 lg:grid-cols-[150px_1fr]">
              <div>
                <label className="flex items-center gap-3 font-black">
                  <input type="checkbox" checked={selectedSet.has(row.inventoryItemId)} disabled={working} onChange={() => toggleSelected(row.inventoryItemId)} className="h-6 w-6" />
                  Card {index + 1}
                </label>
                <div className="relative mt-3 aspect-[4/5] overflow-hidden rounded-xl border bg-neutral-100">
                  <Image src={row.imageUrls?.[0] || "/placeholder.png"} alt={row.websiteTitle || "Card"} fill unoptimized className="object-contain" />
                </div>
                <p className="mt-2 text-xs font-black uppercase text-neutral-500">Website: {row.websiteStatus} · eBay: {row.ebayStatus}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Listing title" className="sm:col-span-2 lg:col-span-4">
                  <input value={row.websiteTitle} maxLength={80} onChange={(event) => updateRow(row.inventoryItemId, (current) => ({ ...current, websiteTitle: event.target.value, ebayTitle: event.target.value }))} className="input" />
                </Field>
                <Field label="Description" className="sm:col-span-2 lg:col-span-4">
                  <textarea value={row.websiteDescription} rows={4} onChange={(event) => updateRow(row.inventoryItemId, (current) => ({ ...current, websiteDescription: event.target.value, ebayDescription: event.target.value }))} className="input" />
                </Field>
                {ASPECT_FIELDS.map(([name, label]) => (
                  <Field key={name} label={label}>
                    <input value={aspectValue(row, name)} onChange={(event) => updateRow(row.inventoryItemId, (current) => setAspect(current, name, event.target.value))} className="input" />
                  </Field>
                ))}
                <Field label="Card condition"><input value={row.cardCondition} onChange={(event) => updateField(row.inventoryItemId, "cardCondition", event.target.value)} className="input" /></Field>
                <Field label="Grader"><input value={row.grader} onChange={(event) => updateField(row.inventoryItemId, "grader", event.target.value)} className="input" /></Field>
                <Field label="Grade"><input value={row.grade} onChange={(event) => updateField(row.inventoryItemId, "grade", event.target.value)} className="input" /></Field>
                <Field label="Certification #"><input value={row.certificationNumber} onChange={(event) => updateField(row.inventoryItemId, "certificationNumber", event.target.value)} className="input" /></Field>
                <Field label="Website price"><input type="number" min="0.01" step="0.01" value={row.websitePrice} onChange={(event) => updateField(row.inventoryItemId, "websitePrice", Math.max(0, Number(event.target.value)))} className="input" /></Field>
                <Field label="eBay price"><input type="number" min="0.01" step="0.01" value={row.ebayPrice} onChange={(event) => updateField(row.inventoryItemId, "ebayPrice", Math.max(0, Number(event.target.value)))} className="input" /></Field>
                <Field label="Quantity"><input type="number" min="1" step="1" value={row.quantity} onChange={(event) => updateField(row.inventoryItemId, "quantity", Math.max(0, Math.floor(Number(event.target.value))))} className="input" /></Field>
                <Field label="eBay category"><input value={row.ebayCategoryId} onChange={(event) => updateField(row.inventoryItemId, "ebayCategoryId", event.target.value)} className="input" /></Field>
                <label className="flex items-center gap-2 font-black sm:col-span-2 lg:col-span-4">
                  <input type="checkbox" checked={row.bestOfferEnabled} onChange={(event) => updateField(row.inventoryItemId, "bestOfferEnabled", event.target.checked)} className="h-5 w-5" /> Enable Best Offer on eBay
                </label>
                {(row.websiteProblems?.length || row.ebayProblems?.length || row.lastError) ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900 sm:col-span-2 lg:col-span-4">
                    {[...(row.websiteProblems || []), ...(row.ebayProblems || []), row.lastError].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>

      <style jsx>{`
        .input { margin-top: 0.25rem; width: 100%; border: 2px solid #d4d4d4; border-radius: 0.65rem; padding: 0.7rem 0.8rem; background: white; font-weight: 650; }
        .input:focus { border-color: #111318; outline: none; box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.45); }
      `}</style>
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block text-sm font-black text-neutral-700 ${className}`}>{label}{children}</label>;
}
