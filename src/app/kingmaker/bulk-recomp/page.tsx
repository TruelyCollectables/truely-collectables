"use client";

import Link from "next/link";
import { useState } from "react";

type Listing = {
  itemId: string;
  title: string;
  askingPrice: number;
  status: string;
  token: string | null;
};
type Result = {
  status?: string;
  error?: string;
  suggestedPrice?: number | null;
  medianComp?: number | null;
  evidence?: { title: string; url: string; price: number; soldAt: string }[];
  researchIncomplete?: boolean;
  researchedAt?: string;
};
const endpoint = "/api/kingmaker/bulk-recomp";
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const control = "rounded border border-slate-500 bg-slate-900 px-3 py-2 text-white";
const button = "rounded bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50";
const presets: Record<string, Record<string, string>> = {
  low: { max: "10" },
  under: { max: "1000", exclusiveMax: "1" },
  high: { min: "1000" },
};

export default function BulkRecompPage() {
  const [scope, setScope] = useState("low");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [batchSize, setBatchSize] = useState(10);
  const [listings, setListings] = useState<Listing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const eligible = listings.filter(row => row.token);
  const nextBatch = eligible.filter(row => !results[row.itemId] || results[row.itemId].error).slice(0, batchSize);

  async function preview() {
    setBusy(true);
    setError("");
    setCheckedAt(null);
    setListings([]);
    setResults({});
    setSelected(new Set());
    try {
      const params = new URLSearchParams(scope === "custom" ? { min, max } : presets[scope]);
      const response = await fetch(endpoint + "?" + params);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setCheckedAt(body.checkedAt);
      setListings(body.listings);
      setSelected(new Set((body.listings as Listing[]).filter(row => row.token).slice(0, batchSize).map(row => row.itemId)));
    } catch (error) {
      setError(error instanceof Error ? error.message : "The listing preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function research() {
    const rows = eligible.filter(row => selected.has(row.itemId));
    if (!rows.length || rows.length > batchSize) return;
    setBusy(true);
    setError("");
    try {
      for (let index = 0; index < rows.length; index += 2) {
        await Promise.all(rows.slice(index, index + 2).map(async row => {
          let result: Result;
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: row.token }),
            });
            result = await response.json();
          } catch {
            result = { error: "Research request interrupted. Try this card again." };
          }
          setResults(previous => ({ ...previous, [row.itemId]: result }));
          if (!result.error) {
            setSelected(previous => {
              const next = new Set(previous);
              next.delete(row.itemId);
              return next;
            });
          }
        }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-5 text-white">
      <Link href="/kingmaker/listings" className="text-emerald-300 underline">Master Listings</Link>
      <h1 className="text-3xl font-black">Bulk Re-Comp</h1>
      <p className="text-slate-300">Research sold comps for active USD fixed-price cards using their current eBay asking price. Results are for seller review.</p>
      <form className="flex flex-wrap items-end gap-4" onSubmit={event => { event.preventDefault(); void preview(); }}>
        <label className="grid gap-1">eBay asking price
          <select className={control} value={scope} onChange={event => { setScope(event.target.value); setCheckedAt(null); }} disabled={busy}>
            <option value="low">$10 or less</option>
            <option value="under">Under $1,000</option>
            <option value="high">$1,000 or more</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {scope === "custom" && <>
          <label className="grid gap-1">Minimum USD
            <input className={control} type="number" min="0" max="99999999" step="0.01" value={min} disabled={busy}
              onChange={event => { setMin(event.target.value); setCheckedAt(null); }} />
          </label>
          <label className="grid gap-1">Maximum USD
            <input className={control} type="number" min="0" max="99999999" step="0.01" value={max} disabled={busy}
              onChange={event => { setMax(event.target.value); setCheckedAt(null); }} />
          </label>
        </>}
        <label className="grid gap-1">Cards per batch
          <select className={control} value={batchSize} onChange={event => setBatchSize(Number(event.target.value))} disabled={busy}>
            {[10, 25, 50, 100].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button className={button} disabled={busy}>Preview eBay listings</button>
      </form>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {busy && <p role="status">{checkedAt ? "Researching selected cards. Keep this page open." : "Reading active eBay listings…"}</p>}
      {checkedAt !== null && <>
        <div className="flex flex-wrap items-center gap-3">
          <p>{listings.length} matched · {selected.size} selected · eBay checked {new Date(checkedAt).toLocaleString()}</p>
          <button className={control} disabled={busy || !nextBatch.length}
            onClick={() => setSelected(new Set(nextBatch.map(row => row.itemId)))}>Select next batch</button>
          <button className={button} disabled={busy || !selected.size || selected.size > batchSize}
            onClick={() => void research()}>Research selected</button>
        </div>
        {listings.length > 0 && <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead><tr><th scope="col">Select</th><th scope="col">Card</th><th scope="col">eBay ask</th><th scope="col">Sold median</th><th scope="col">Suggested</th><th scope="col">Change</th><th scope="col">Research</th></tr></thead>
            <tbody>
              {listings.map(row => {
                const result = results[row.itemId];
                return (
                  <tr key={row.itemId} className="border-t border-slate-600 align-top [&>td]:p-2">
                    <td><input type="checkbox" aria-label={"Select " + row.title} checked={selected.has(row.itemId)}
                      disabled={busy || !row.token || Boolean(result && !result.error) ||
                        (!selected.has(row.itemId) && selected.size >= batchSize)}
                      onChange={event => {
                        const checked = event.target.checked;
                        setSelected(previous => {
                          const next = new Set(previous);
                          if (checked) next.add(row.itemId);
                          else next.delete(row.itemId);
                          return next;
                        });
                      }} /></td>
                    <td><a className="underline" href={`https://www.ebay.com/itm/${row.itemId}`} target="_blank" rel="noreferrer">{row.title}</a></td>
                    <td>{money.format(row.askingPrice)}</td>
                    <td>{result?.medianComp == null ? "—" : money.format(result.medianComp)}</td>
                    <td>{result?.suggestedPrice == null ? "—" : money.format(result.suggestedPrice)}</td>
                    <td>{result?.suggestedPrice == null ? "—" : money.format(result.suggestedPrice - row.askingPrice)}</td>
                    <td>
                      {result?.error || result?.status || row.status}
                      {result?.researchIncomplete && <p>Some sources were unavailable.</p>}
                      {result?.researchedAt && <p className="text-slate-300">{new Date(result.researchedAt).toLocaleString()}</p>}
                      {Boolean(result?.evidence?.length) && <details>
                        <summary>{result!.evidence!.length} verified sales</summary>
                        <ul className="list-disc pl-4">
                          {result!.evidence!.map(sale => <li key={sale.url}>
                            <a className="underline" href={sale.url} target="_blank" rel="noreferrer">{sale.title}</a>
                            {" · "}{money.format(sale.price)}{" · "}{sale.soldAt.slice(0, 10)}
                          </li>)}
                        </ul>
                      </details>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>}
      </>}
    </main>
  );
}
