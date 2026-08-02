"use client";

import { FormEvent, useState } from "react";

type SweepListing = {
  itemId: string;
  title: string;
  itemWebUrl: string;
  imageUrl: string | null;
  imageUrls: string[];
  imageCount: number;
  price: number | null;
  shipping: number | null;
  currency: string;
  endDate: string | null;
  status: "photos_ready" | "photo_error";
  targetPlayers: string[];
  error: string | null;
};

type SweepResponse = {
  sweepId: string;
  seller: string;
  query: string;
  total: number;
  photosReady: number;
  failed: number;
  progress: number;
  status: string;
  listings: SweepListing[];
  persistenceWarning: string | null;
  nextStep: string;
};

function money(value: number | null, currency = "USD") {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export default function SellerSweepClient() {
  const [sellerUrl, setSellerUrl] = useState("https://www.ebay.com/str/missmelscards");
  const [query, setQuery] = useState("WNBA lot");
  const [status, setStatus] = useState("Ready");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function startSweep(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress(10);
    setStatus("Collecting active eBay listings…");

    try {
      const responsePromise = fetch("/api/admin/instacomp/seller-sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sellerUrl, query }),
      });
      setProgress(25);
      setStatus("Collecting listings and retrieving full photo sets…");
      const response = await responsePromise;
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Seller Sweep failed");
      setResult(data);
      setProgress(data.progress || 55);
      setStatus(
        `Saved sweep ${data.sweepId.slice(0, 8)}. ${data.photosReady}/${data.total} listings have full photo sets.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Seller Sweep failed");
      setStatus("Stopped");
      setProgress(0);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <form onSubmit={startSweep} className="grid gap-4 lg:grid-cols-[1.4fr_0.7fr_auto] lg:items-end">
          <label className="grid gap-2 text-sm font-black">
            eBay seller or store URL
            <input value={sellerUrl} onChange={(e) => setSellerUrl(e.target.value)} className="rounded-2xl border border-neutral-300 px-4 py-3 font-semibold" required />
          </label>
          <label className="grid gap-2 text-sm font-black">
            Search focus
            <input value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-2xl border border-neutral-300 px-4 py-3 font-semibold" />
          </label>
          <button disabled={loading} className="rounded-2xl bg-neutral-950 px-6 py-3 font-black text-white disabled:opacity-50">
            {loading ? "Sweeping…" : "Start Seller Sweep"}
          </button>
        </form>

        <div className="mt-5">
          <div className="mb-2 flex justify-between text-sm font-black"><span>{status}</span><span>{progress}%</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-neutral-200"><div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${progress}%` }} /></div>
          <div className="mt-3 grid gap-2 text-xs font-bold text-neutral-600 sm:grid-cols-4">
            <span className={progress >= 20 ? "text-emerald-700" : ""}>1. Collect listings</span>
            <span className={progress >= 55 ? "text-emerald-700" : ""}>2. Download photos</span>
            <span className={progress >= 80 ? "text-emerald-700" : ""}>3. Identify + comp cards</span>
            <span className={progress >= 100 ? "text-emerald-700" : ""}>4. Rank ROI</span>
          </div>
        </div>
        {error ? <p className="mt-4 rounded-2xl bg-red-50 p-4 font-bold text-red-800">{error}</p> : null}
        {result?.persistenceWarning ? <p className="mt-4 rounded-2xl bg-amber-50 p-4 font-bold text-amber-900">{result.persistenceWarning}</p> : null}
      </section>

      {result ? (
        <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 p-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Seller @{result.seller}</p>
            <h2 className="mt-1 text-2xl font-black">{result.total} listings collected · {result.photosReady} photo-ready · {result.failed} errors</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-600">Sweep ID: {result.sweepId}</p>
            <p className="mt-2 text-sm font-semibold text-neutral-600">{result.nextStep}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="p-4">Listing</th><th className="p-4">Price</th><th className="p-4">Shipping</th><th className="p-4">Photos</th><th className="p-4">Title flags</th><th className="p-4">Ends</th><th className="p-4">Status</th></tr></thead>
              <tbody>
                {result.listings.map((listing) => (
                  <tr key={listing.itemId} className="border-t border-neutral-100 align-top">
                    <td className="p-4"><a href={listing.itemWebUrl} target="_blank" rel="noreferrer" className="font-black text-blue-700 underline">{listing.title}</a><div className="mt-1 text-xs text-neutral-500">{listing.itemId}</div></td>
                    <td className="p-4 font-black">{money(listing.price, listing.currency)}</td>
                    <td className="p-4 font-bold">{money(listing.shipping, listing.currency)}</td>
                    <td className="p-4 font-black">{listing.imageCount}</td>
                    <td className="p-4">{listing.targetPlayers.length ? <div className="flex flex-wrap gap-1">{listing.targetPlayers.map((player) => <span key={player} className="rounded-full bg-fuchsia-100 px-2 py-1 text-xs font-black text-fuchsia-900">{player}</span>)}</div> : <span className="text-xs font-bold text-neutral-500">Photo AI pending</span>}</td>
                    <td className="p-4 font-semibold">{listing.endDate ? new Date(listing.endDate).toLocaleString() : "—"}</td>
                    <td className="p-4">{listing.status === "photos_ready" ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-900">Photos ready</span> : <div><span className="rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-900">Photo error</span><p className="mt-2 max-w-xs text-xs font-semibold text-red-700">{listing.error}</p></div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
