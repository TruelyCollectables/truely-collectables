"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";
import ManualPurchasePanel from "./ManualPurchasePanel";

type Purchase = {
  acquisitionItemId: number;
  purchaseId: string;
  source: string;
  purchaseDate?: string | null;
  title?: string | null;
  seller?: string | null;
  orderNumber?: string | null;
  listingUrl?: string | null;
  imageUrls?: string[];
  allocatedCost: number;
  status: string;
  identityStatus?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  receiptStatus?: string | null;
  inventoryItemId?: string | null;
  scanId?: string | null;
  disposition?: string | null;
  inventoryState?: string | null;
};

type Payload = {
  ok?: boolean;
  items?: Purchase[];
  summary?: {
    totalTracked?: number;
    awaitingOwnScan?: number;
    matchedPendingReceipt?: number;
    received?: number;
  };
  error?: string;
};

type PendingItem = {
  inventoryItemId?: string | null;
  instaComp?: {
    scanId?: string | null;
    cardUuid?: string | null;
    identity?: Record<string, unknown> | null;
  } | null;
};

function money(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "—";
}

function dateLabel(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function lifecycle(purchase: Purchase) {
  if (purchase.inventoryState === "investment_stash") return "RECEIVED — INVESTMENT STASH";
  if (purchase.status === "received") return "RECEIVED — RESALE";
  if (purchase.status === "linked_existing") return "LINKED TO EXISTING INVENTORY";
  if (purchase.receiptStatus === "pending_purchase") return "MATCHED — READY TO RECEIVE";
  return "AWAITING YOUR SCAN";
}

async function jsonFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.error) {
    throw new Error(String(data?.error || data?.detail || `Request failed (${response.status}).`));
  }
  return data as Record<string, any>;
}

export default function ReceivingClient() {
  const [payload, setPayload] = useState<Payload>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");

      // First paint owns the critical path: load the purchase ledger immediately.
      // Pending scan matching is additive and must never hold Receiving hostage.
      const data = await jsonFetch(
        "/api/account/seller/instacomp-purchases",
        session.access_token,
      );
      setPayload(data as Payload);

      void (async () => {
        try {
          const pending = await jsonFetch(
            "/api/account/seller/instacomp-pending?queue=listings",
            session.access_token,
          );
          const eligible = (Array.isArray(pending.items) ? pending.items : [])
            .map((item: PendingItem) => ({
              cardUuid: String(item?.instaComp?.cardUuid || ""),
              inventoryItemId: String(item?.inventoryItemId || ""),
              scanId: String(item?.instaComp?.scanId || ""),
              identity: item?.instaComp?.identity || {},
            }))
            .filter((item: any) =>
              Boolean(
                item.inventoryItemId &&
                item.scanId &&
                item.identity?.player &&
                item.identity?.cardNumber,
              ),
            );
          if (!eligible.length) return;
          await jsonFetch(
            "/api/account/seller/instacomp-purchase-match",
            session.access_token,
            { method: "POST", body: JSON.stringify({ items: eligible }) },
          );
          const refreshed = await jsonFetch(
            "/api/account/seller/instacomp-purchases",
            session.access_token,
          );
          setPayload(refreshed as Payload);
        } catch {
          // Matching is background enrichment; the ledger remains usable.
        }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Receiving.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const result = await jsonFetch(
        "/api/account/seller/instacomp-purchases",
        session.access_token,
        { method: "POST", body: JSON.stringify({ action: "sync" }) },
      );
      const sources = Array.isArray(result.sources) ? result.sources : [];
      const created = sources.reduce((sum: number, row: any) => sum + Number(row?.created || 0), 0);
      const updated = sources.reduce((sum: number, row: any) => sum + Number(row?.updated || 0), 0);
      setNotice(`Purchase sync finished: ${created} new, ${updated} refreshed.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function receivePurchase(
    purchase: Purchase,
    disposition: "resale" | "investment_stash",
  ) {
    if (!purchase.inventoryItemId || !purchase.scanId) {
      setError("Receive blocked: this purchase does not have an exact verified scan match yet.");
      return;
    }
    setBusyId(purchase.acquisitionItemId);
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const data = await jsonFetch(
        "/api/account/seller/instacomp-purchase-receive",
        session.access_token,
        {
          method: "POST",
          body: JSON.stringify({
            inventoryItemId: purchase.inventoryItemId,
            scanId: purchase.scanId,
            acquisitionItemId: purchase.acquisitionItemId,
            disposition,
          }),
        },
      );
      setNotice(
        `${purchase.title || "Purchase"}: received to ${disposition === "investment_stash" ? "Investment Stash" : "Resale"} at ${money(data?.match?.allocatedCost || purchase.allocatedCost)} acquisition cost.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not receive this purchase.");
    } finally {
      setBusyId(null);
    }
  }

  const items = payload.items ?? [];
  const sorted = [...items].sort(
    (a, b) => Date.parse(b.purchaseDate || "") - Date.parse(a.purchaseDate || ""),
  );

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border-2 border-neutral-900 bg-white p-5 shadow-[6px_6px_0_#111]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-700">KINGMAKER Receiving</p>
              <h1 className="mt-1 text-3xl font-black">Purchases waiting for your physical scan</h1>
              <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
                Every eBay and Mercari card purchase from September 16, 2026 forward stays unreceived until your own front/back InstaComp scan proves the exact card. Purchase cost and history stay attached permanently after receipt.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="rounded-xl border-2 border-neutral-900 bg-emerald-300 px-4 py-3 font-black shadow-[3px_3px_0_#111] disabled:opacity-50"
            >
              {syncing ? "Syncing eBay + Mercari…" : "Sync purchases now"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              ["Tracked", payload.summary?.totalTracked || items.length],
              ["Awaiting scan", payload.summary?.awaitingOwnScan || 0],
              ["Matched", payload.summary?.matchedPendingReceipt || 0],
              ["Received", payload.summary?.received || 0],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border-2 border-neutral-900 bg-neutral-50 p-3">
                <p className="text-xs font-black uppercase tracking-wide text-neutral-500">{label}</p>
                <p className="text-2xl font-black">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/kingmaker/scan" className="rounded-lg border-2 border-neutral-900 bg-black px-4 py-2 text-sm font-black text-white">Scan arriving cards</Link>
            <Link href="/kingmaker/pending" className="rounded-lg border-2 border-neutral-900 px-4 py-2 text-sm font-black">Open Pending Listings</Link>
          </div>
        </section>

        <ManualPurchasePanel onSaved={load} />

        {notice ? <p className="mt-5 rounded-xl border-2 border-emerald-800 bg-emerald-100 p-3 font-bold text-emerald-950">{notice}</p> : null}
        {error ? <p className="mt-5 rounded-xl border-2 border-red-900 bg-red-100 p-3 font-bold text-red-950">{error}</p> : null}
        {loading ? <p className="mt-6 font-black">Loading Receiving…</p> : null}
        {!loading && sorted.length === 0 ? (
          <div className="mt-6 rounded-2xl border-2 border-neutral-900 bg-white p-6 font-black shadow-[6px_6px_0_#111]">
            No September 16+ purchases are in the receiving ledger yet. Run “Sync purchases now.”
          </div>
        ) : null}

        <section className="mt-6 grid gap-4">
          {sorted.map((purchase) => {
            const matched = purchase.receiptStatus === "pending_purchase";
            const received = purchase.status === "received" || purchase.status === "linked_existing";
            const busy = busyId === purchase.acquisitionItemId;
            return (
              <article key={purchase.acquisitionItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[5px_5px_0_#111]">
                <div className={`border-b-2 border-neutral-900 p-3 ${matched ? "bg-orange-100" : received ? "bg-emerald-100" : "bg-amber-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-black">{lifecycle(purchase)}</p>
                    <p className="text-sm font-black">{purchase.source} · {dateLabel(purchase.purchaseDate)} · {money(purchase.allocatedCost)}</p>
                  </div>
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-[112px_minmax(0,1fr)]">
                  <div>
                    {purchase.imageUrls?.[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={purchase.imageUrls[0]} alt="Purchase listing" className="h-36 w-28 rounded-lg border border-neutral-300 object-contain" />
                    ) : (
                      <div className="flex h-36 w-28 items-center justify-center rounded-lg border border-neutral-300 text-xs font-bold text-neutral-500">No source image</div>
                    )}
                  </div>
                  <div>
                    <h2 className="text-lg font-black">{purchase.title || "Untitled purchase"}</h2>
                    <p className="mt-1 text-sm font-semibold text-neutral-600">
                      {purchase.seller ? `Seller: ${purchase.seller} · ` : ""}Order: {purchase.orderNumber || purchase.purchaseId}
                    </p>
                    <p className="mt-2 text-sm font-bold text-neutral-700">
                      Source identity: {purchase.identityStatus || "needs scan verification"}
                      {purchase.cardNumber ? ` · #${purchase.cardNumber}` : ""}
                      {purchase.parallel ? ` · ${purchase.parallel}` : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {purchase.listingUrl ? <a href={purchase.listingUrl} target="_blank" rel="noreferrer" className="rounded-lg border-2 border-neutral-900 px-3 py-2 text-sm font-black">Open source purchase</a> : null}
                      {!received && !matched ? <Link href="/kingmaker/scan" className="rounded-lg border-2 border-neutral-900 bg-black px-3 py-2 text-sm font-black text-white">Scan this card when it arrives</Link> : null}
                      {matched ? (
                        <>
                          <button type="button" disabled={busy} onClick={() => void receivePurchase(purchase, "resale")} className="rounded-lg border-2 border-emerald-900 bg-emerald-200 px-3 py-2 text-sm font-black disabled:opacity-50">
                            {busy ? "Receiving…" : "Receive → Resale"}
                          </button>
                          <button type="button" disabled={busy} onClick={() => void receivePurchase(purchase, "investment_stash")} className="rounded-lg border-2 border-indigo-900 bg-indigo-100 px-3 py-2 text-sm font-black disabled:opacity-50">
                            Receive → Investment Stash
                          </button>
                        </>
                      ) : null}
                    </div>
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
