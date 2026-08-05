"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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

  useEffect(() => {
    void load();
  }, [load]);

  async function rescan(card: PendingCard) {
    if (!card.frontImageUrl || !card.backImageUrl) {
      setError(`${card.title}: a distinct stored front and back are required before InstaComp can run.`);
      return;
    }
    if (card.frontImageUrl === card.backImageUrl) {
      setError(`${card.title}: front and back resolve to the same file. Scan blocked.`);
      return;
    }

    setBusyId(card.inventoryItemId);
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch("/api/account/seller/inventory/instacomp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          inventoryItemId: card.inventoryItemId,
          aiCouncilTier: "adaptive",
          forceIdentityRescan: true,
          requireFrontBackPair: true,
          expectedFrontImageUrl: card.frontImageUrl,
          expectedBackImageUrl: card.backImageUrl,
        }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Front/back InstaComp scan failed.");
      }
      setNotice(`${card.title}: fresh InstaComp identity completed from the stored front and back pair.`);
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
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-800">Kingmaker / Verified image pairs</p>
            <h1 className="mt-1 text-3xl font-black">Pending Front + Back Scans</h1>
            <p className="mt-2 max-w-3xl font-semibold text-neutral-700">
              InstaComp is blocked unless two distinct stored images are present. Every scan from this page forces a new identity run using both sides.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading || Boolean(busyId)} className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50">
            {loading ? "Loading…" : "Reload Cards"}
          </button>
        </div>

        {error ? <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">{error}</div> : null}
        {notice ? <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">{notice}</div> : null}

        {!loading && cards.length === 0 ? <div className="mt-6 rounded-xl border-2 border-neutral-900 bg-white p-6 font-black">No pending InstaComp cards found.</div> : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const pairReady = Boolean(card.frontImageUrl && card.backImageUrl && card.frontImageUrl !== card.backImageUrl);
            return (
              <article key={card.inventoryItemId} className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div>
                    <h2 className="font-black">{card.title}</h2>
                    <p className="text-xs font-bold text-neutral-300">{card.sku || card.inventoryItemId}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${pairReady ? "bg-emerald-300 text-emerald-950" : "bg-red-300 text-red-950"}`}>
                    {pairReady ? "FRONT + BACK READY" : "PAIR MISSING — SCAN BLOCKED"}
                  </span>
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  <figure className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                    <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">Front sent to InstaComp</figcaption>
                    {card.frontImageUrl ? <img src={card.frontImageUrl} alt={`${card.title} front scan`} className="mx-auto h-80 w-full object-contain" /> : <div className="flex h-80 items-center justify-center font-black text-red-800">FRONT MISSING</div>}
                  </figure>
                  <figure className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3">
                    <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">Back sent to InstaComp</figcaption>
                    {card.backImageUrl ? <img src={card.backImageUrl} alt={`${card.title} back scan`} className="mx-auto h-80 w-full object-contain" /> : <div className="flex h-80 items-center justify-center font-black text-red-800">BACK MISSING</div>}
                  </figure>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">Stored rows: {card.storedImageCount || 0} · Back flag: {card.instaComp?.hasBackImage ? "yes" : "no"}</p>
                  <button type="button" onClick={() => void rescan(card)} disabled={!pairReady || Boolean(busyId)} className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400">
                    {busyId === card.inventoryItemId ? "Scanning front + back…" : "Run Fresh Front + Back InstaComp"}
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
