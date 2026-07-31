"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type CompRow = {
  title?: string;
  price?: number;
  currency?: string;
  url?: string;
  sourceLabel?: string;
  soldAt?: string | null;
  listedAt?: string | null;
};

type ScanResult = {
  ok?: boolean;
  error?: string;
  ai?: Record<string, any>;
  searchQuery?: string;
  soldComps?: CompRow[];
  activeComps?: CompRow[];
  remainingCards?: CompRow[];
  stats?: Record<string, number | null>;
  soldStats?: Record<string, number | null>;
  links?: Record<string, string>;
  sourceCoverage?: Array<{
    label?: string;
    status?: string;
    resultCount?: number;
    message?: string | null;
  }>;
};

function money(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function uniqueComps(rows: CompRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.url || ""}|${row.title || ""}|${row.price || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function MobileInstaCompScanner() {
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [shippingEstimate, setShippingEstimate] = useState("5.99");
  const [fields, setFields] = useState<Record<string, string>>({});

  const soldComps = useMemo(
    () => uniqueComps(result?.soldComps || []),
    [result],
  );
  const activeListings = useMemo(
    () => uniqueComps([...(result?.activeComps || []), ...(result?.remainingCards || [])]),
    [result],
  );

  function updateField(name: string, value: string) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  async function runScan() {
    if (!frontImage) {
      setError("Take or choose a front photo first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("frontImage", frontImage);
      form.append("aiCouncilTier", "adaptive");
      if (backImage) form.append("backImage", backImage);

      const response = await fetch("/api/instacomp/scan", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as ScanResult;

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "InstaComp could not finish this scan.");
      }

      const ai = data.ai || {};
      setFields({
        player: String(ai.player || ""),
        year: String(ai.year || ""),
        brand: String(ai.brand || ""),
        setName: String(ai.setName || ""),
        cardNumber: String(ai.cardNumber || ""),
        parallel: String(ai.parallel || ""),
        serialNumber: String(ai.serialNumber || ""),
        team: String(ai.team || ""),
        sport: String(ai.sport || ""),
        condition: String(ai.conditionGuess || ""),
        price: String(data.soldStats?.suggestedPrice || data.stats?.suggestedPrice || ""),
      });
      setResult(data);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "The scan failed.");
    } finally {
      setLoading(false);
    }
  }

  const cardStudioParams = new URLSearchParams({
    source: "instacomp-mobile",
    player: fields.player || "",
    year: fields.year || "",
    brand: fields.brand || "",
    setName: fields.setName || "",
    cardNumber: fields.cardNumber || "",
    parallel: fields.parallel || "",
    serialNumber: fields.serialNumber || "",
    team: fields.team || "",
    sport: fields.sport || "",
    condition: fields.condition || "",
    price: fields.price || "",
    q: result?.searchQuery || "",
  });

  return (
    <div className="min-w-0 space-y-4">
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h2 className="text-xl font-black">Scan one card</h2>
        <p className="mt-1 text-sm font-semibold text-neutral-600">
          Take the front first. Add the back for card number, parallel, serial, autograph, relic, and grading details.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <label className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm font-black">
            Front photo
            <input className="mt-2 block w-full text-base" type="file" accept="image/*" capture="environment" onChange={(event) => setFrontImage(event.target.files?.[0] || null)} />
            <span className="mt-2 block break-all text-xs font-semibold text-neutral-600">{frontImage?.name || "No front selected"}</span>
          </label>
          <label className="rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4 text-sm font-black">
            Back photo
            <input className="mt-2 block w-full text-base" type="file" accept="image/*" capture="environment" onChange={(event) => setBackImage(event.target.files?.[0] || null)} />
            <span className="mt-2 block break-all text-xs font-semibold text-neutral-600">{backImage?.name || "Optional, but recommended"}</span>
          </label>
        </div>
        <button type="button" onClick={runScan} disabled={loading} className="mt-4 min-h-12 w-full rounded-xl bg-neutral-950 px-4 py-3 text-base font-black text-white disabled:opacity-60">
          {loading ? "Running InstaComp…" : "Run InstaComp"}
        </button>
        {error ? <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-black text-rose-800">{error}</p> : null}
      </section>

      {result ? (
        <>
          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-xl font-black">Editable card and listing details</h2>
            <div className="mt-4 grid grid-cols-1 gap-3">
              {[
                ["player", "Player"], ["year", "Year"], ["brand", "Brand"], ["setName", "Set"],
                ["cardNumber", "Card number"], ["parallel", "Parallel / variation"], ["serialNumber", "Serial number"],
                ["team", "Team"], ["sport", "Sport / category"], ["condition", "Condition"], ["price", "Website price"],
              ].map(([name, label]) => (
                <label key={name} className="text-sm font-black">
                  {label}
                  <input value={fields[name] || ""} onChange={(event) => updateField(name, event.target.value)} className="mt-1 min-h-11 w-full min-w-0 rounded-xl border border-neutral-300 px-3 text-base font-semibold" />
                </label>
              ))}
            </div>
            <Link href={`/admin/products/new?${cardStudioParams.toString()}`} className="mt-4 block min-h-12 rounded-xl bg-amber-300 px-4 py-3 text-center text-base font-black text-neutral-950">
              Continue to Card Studio
            </Link>
          </section>

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-emerald-800">Sold market</p>
            <h2 className="mt-1 text-xl font-black">Sold comps ({soldComps.length})</h2>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-black text-neutral-500">Sold median</p><p className="text-xl font-black">{money(result.soldStats?.median)}</p></div>
              <div className="rounded-xl bg-white p-3"><p className="text-xs font-black text-neutral-500">Suggested</p><p className="text-xl font-black">{money(result.soldStats?.suggestedPrice)}</p></div>
            </div>
            <div className="mt-3 space-y-3">
              {soldComps.length ? soldComps.map((comp, index) => <CompCard key={`${comp.url}-${index}`} comp={comp} />) : <NoMatches label="No verified sold matches were returned. Use the sold-search button below to review broader results." />}
            </div>
            {result.links?.ebaySoldUrl ? <a href={result.links.ebaySoldUrl} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-emerald-300 bg-white px-4 py-3 text-center font-black text-emerald-900">Open broader eBay sold search</a> : null}
          </section>

          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
            <p className="text-xs font-black uppercase tracking-widest text-blue-800">For sale now</p>
            <h2 className="mt-1 text-xl font-black">Current listings ({activeListings.length})</h2>
            <label className="mt-3 block text-sm font-black">Estimated shipping when a source does not provide it
              <input inputMode="decimal" value={shippingEstimate} onChange={(event) => setShippingEstimate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-blue-300 bg-white px-3 text-base" />
            </label>
            <div className="mt-3 space-y-3">
              {activeListings.length ? activeListings.map((comp, index) => <CompCard key={`${comp.url}-${index}`} comp={comp} shippingEstimate={Number(shippingEstimate) || 0} />) : <NoMatches label="No exact active matches were returned. Open the broader active search below to see nearby listings." />}
            </div>
            {result.links?.ebayActiveUrl ? <a href={result.links.ebayActiveUrl} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl border border-blue-300 bg-white px-4 py-3 text-center font-black text-blue-900">Open broader eBay active search</a> : null}
          </section>

          <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-black">Source status</h2>
            <div className="mt-3 space-y-2">
              {(result.sourceCoverage || []).map((source, index) => (
                <div key={`${source.label}-${index}`} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><strong>{source.label || "Source"}</strong><span className="font-black">{source.resultCount || 0}</span></div>
                  <p className="mt-1 font-semibold text-neutral-600">{source.status || "unknown"}{source.message ? ` — ${source.message}` : ""}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function NoMatches({ label }: { label: string }) {
  return <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-sm font-bold text-neutral-700">{label}</p>;
}

function CompCard({ comp, shippingEstimate }: { comp: CompRow; shippingEstimate?: number }) {
  const price = Number(comp.price) || 0;
  const total = shippingEstimate === undefined ? null : price + shippingEstimate;
  const content = (
    <div className="min-w-0 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className="break-words text-sm font-black leading-5">{comp.title || "Untitled listing"}</p>
      <p className="mt-1 text-xs font-bold text-neutral-500">{comp.sourceLabel || "Marketplace"}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-neutral-100 p-2"><p className="text-[10px] font-black uppercase text-neutral-500">Item</p><p className="font-black">{money(price)}</p></div>
        <div className="rounded-lg bg-neutral-100 p-2"><p className="text-[10px] font-black uppercase text-neutral-500">Shipping</p><p className="font-black">{shippingEstimate === undefined ? "See listing" : money(shippingEstimate)}</p></div>
        <div className="rounded-lg bg-neutral-100 p-2"><p className="text-[10px] font-black uppercase text-neutral-500">Approx total</p><p className="font-black">{total === null ? "See listing" : money(total)}</p></div>
      </div>
    </div>
  );

  return comp.url ? <a href={comp.url} target="_blank" rel="noreferrer" className="block">{content}</a> : content;
}
