"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type ScannerResult = {
  success: boolean;
  code?: string;
  error?: string;
  inventoryItemId?: string;
  title?: string;
  pricingSucceeded?: boolean;
  scan?: any;
  pricing?: any;
  duplicate?: { inventoryItemId: string; title: string; status: string };
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function numberFrom(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : null;
}

function findSuggestedPrice(result: ScannerResult | null) {
  if (!result) return null;
  const pricing = result.pricing || {};
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

function identityRows(scan: any) {
  const identity = scan?.trusted_identity || {};
  return [
    ["Year", identity.year],
    ["Manufacturer", identity.manufacturer || identity.brand],
    ["Set", identity.set_name],
    ["Player", identity.player],
    ["Card", identity.card_number],
    ["Parallel", identity.parallel],
    ["Variation", identity.variation],
    ["Serial", identity.serial_number],
  ].filter(([, value]) => value);
}

export default function InstaCompScanPage() {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [result, setResult] = useState<ScannerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState("Ready for required front and back photos");
  const suggestedPrice = findSuggestedPrice(result);
  const pricingChoices = useMemo(() => suggestedPrice ? [
    { label: "InstaComp", value: suggestedPrice, source: "instacomp" },
    { label: "+5%", value: Math.round(suggestedPrice * 1.05 * 100) / 100, source: "instacomp_plus_5" },
    { label: "+10%", value: Math.round(suggestedPrice * 1.1 * 100) / 100, source: "instacomp_plus_10" },
  ] : [], [suggestedPrice]);

  async function scan() {
    if (!front) {
      setError("Take or select the front photo first.");
      return;
    }
    if (!back) {
      setError("Take or select the back photo before creating a listing.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setStage("Authenticating seller account");
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in before scanning cards.");
      const body = new FormData();
      body.append("front", front);
      body.append("back", back);
      setStage("Mac mini reading front and back card evidence");
      const response = await fetch("/api/account/seller/instacomp-scan/intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      setStage("Checklist Registry locking exact identity");
      const payload = await response.json() as ScannerResult;
      setResult(payload);
      if (!response.ok && response.status !== 207) throw new Error(payload.error || "Card requires review.");
      setStage(payload.pricingSucceeded ? "Registry locked and verified comps complete" : "Registry locked; pricing needs a retry");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Scanner intake failed.");
      setStage("Stopped safely");
    } finally {
      setBusy(false);
    }
  }

  async function choosePrice(choice: { value: number; source: string }) {
    if (!result?.inventoryItemId) return;
    setSavingPrice(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in before saving a price.");
      const response = await fetch("/api/account/seller/instacomp-scan/price", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ inventoryItemId: result.inventoryItemId, price: choice.value, source: choice.source }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save the price.");
      setStage(`${money(choice.value)} saved to Pending Listings`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not save the price.");
    } finally {
      setSavingPrice(false);
    }
  }

  function reset() {
    setFront(null);
    setBack(null);
    setResult(null);
    setError("");
    setStage("Ready for required front and back photos");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-white">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">InstaComp Scanner</p>
          <h1 className="text-3xl font-black">Scan Front + Back → Registry → Comps → Pending Listing</h1>
          <p className="mt-2 text-sm text-slate-300">Every listing requires a front photo and a back photo. Local AI reads both sides, the Checklist Registry owns identity, and pricing stays blocked until the Registry locks the exact card.</p>
        </div>
        <Link href="/seller/instacomp-pending" className="rounded-xl border border-slate-600 px-4 py-2 font-bold hover:bg-slate-800">Open Pending Listings</Link>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="text-xl font-bold">1. Capture both sides of the card</h2>
          <p className="mt-2 text-sm font-semibold text-amber-200">This listing workflow will not run with only one photo. A separate one-off InstaComp request may still use one image.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="rounded-xl border border-dashed border-slate-600 p-4">
              <span className="font-bold">Front photo *</span>
              <input className="mt-3 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setFront(event.target.files?.[0] || null)} />
              <span className="mt-2 block text-xs text-slate-400">{front?.name || "Required — camera or file upload"}</span>
            </label>
            <label className="rounded-xl border border-dashed border-slate-600 p-4">
              <span className="font-bold">Back photo *</span>
              <input className="mt-3 block w-full text-sm" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setBack(event.target.files?.[0] || null)} />
              <span className="mt-2 block text-xs text-slate-400">{back?.name || "Required for every listing"}</span>
            </label>
          </div>
          <div className="mt-5 rounded-xl bg-slate-900 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">Pipeline status</span>
              {busy ? <span className="animate-pulse text-amber-300">Working</span> : <span className="text-emerald-300">{stage}</span>}
            </div>
          </div>
          {error ? <div className="mt-4 rounded-xl border border-red-700 bg-red-950/60 p-4 text-red-200">{error}</div> : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={busy || !front || !back} onClick={() => void scan()} className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-40">{busy ? "Scanning…" : "Identify + price card"}</button>
            <button disabled={busy} onClick={reset} className="rounded-xl border border-slate-600 px-5 py-3 font-bold">Clear</button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="text-xl font-bold">2. Registry receipt and pricing</h2>
          {!result ? <p className="mt-4 text-slate-400">The locked identity, duplicate result, and pricing choices will appear here.</p> : null}
          {result?.duplicate ? <div className="mt-4 rounded-xl border border-amber-600 bg-amber-950/50 p-4"><p className="font-black text-amber-200">Duplicate scan blocked</p><p className="mt-1">{result.duplicate.title}</p><Link className="mt-3 inline-block font-bold underline" href="/seller/instacomp-pending">Review existing pending item</Link></div> : null}
          {result?.scan ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-slate-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-black text-emerald-300">Registry locked</span><span className="text-xs text-slate-400">Scan {result.scan.scan_id}</span></div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {identityRows(result.scan).map(([name, value]) => <div key={name} className="rounded-lg bg-slate-950 p-2"><dt className="text-slate-500">{name}</dt><dd className="font-bold">{String(value)}</dd></div>)}
                </dl>
                <p className="mt-3 break-all text-xs text-slate-500">Registry ID: {result.scan.checklist?.identity_id || "Missing"}</p>
              </div>
              {result.inventoryItemId ? <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4"><p className="font-black">Saved to Pending Listings</p><p className="text-sm text-slate-300">{result.title}</p></div> : null}
              {pricingChoices.length ? <div><p className="mb-3 font-black">Choose listing price</p><div className="grid gap-3 sm:grid-cols-3">{pricingChoices.map((choice) => <button key={choice.source} disabled={savingPrice} onClick={() => void choosePrice(choice)} className="rounded-xl border border-emerald-600 p-4 text-left hover:bg-emerald-950"><span className="block text-sm text-slate-400">{choice.label}</span><span className="text-xl font-black">{money(choice.value)}</span></button>)}</div></div> : <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">No reliable sold-comp suggestion was returned. The draft is still saved and can be priced manually in Pending Listings.</p>}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
