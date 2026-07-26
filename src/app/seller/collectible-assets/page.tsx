"use client";

import { useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../account/account-session";

type Asset = {
  assetId: string;
  inventoryItemId: string | null;
  legacyProductId: number | null;
  lifecycleStatus: string;
  title: string;
  player: string | null;
  year: number | null;
  manufacturer: string | null;
  productSet: string | null;
  insertSubset: string | null;
  cardNumber: string | null;
  parallel: string | null;
  team: string | null;
  exactSerialNumber: string | null;
  gradingCompany: string | null;
  gradingGrade: string | null;
  gradingCertNumber: string | null;
  graderVerificationStatus: string;
  graderVerificationUrl: string | null;
  listingPrice: number | null;
  soldPrice: number | null;
  soldAt: string | null;
  currentMarketValue: number | null;
  lastMarketCheckedAt: string | null;
  imageUrl: string | null;
  marketSnapshotCount: number;
  saleTiming: {
    code: string;
    label: string;
    differencePercent: number | null;
    currentMarketValue: number | null;
    preSalePeak: number | null;
  };
};

type ResponseData = {
  assets?: Asset[];
  summary?: Record<string, number>;
  error?: string;
};

function money(value: number | null | undefined) {
  return value === null || value === undefined
    ? "Not recorded"
    : value.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
}

function statusTone(status: string) {
  if (status === "sold") return "border-violet-300 bg-violet-50 text-violet-950";
  if (status === "active") return "border-emerald-300 bg-emerald-50 text-emerald-950";
  if (status === "pending_listing")
    return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-neutral-300 bg-neutral-100 text-neutral-900";
}

function timingTone(code: string) {
  if (code === "sold_early") return "border-rose-300 bg-rose-50 text-rose-900";
  if (code === "sold_late") return "border-amber-300 bg-amber-50 text-amber-900";
  if (code === "right_on_time")
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (code === "sold_ahead_of_decline")
    return "border-sky-300 bg-sky-50 text-sky-900";
  return "border-neutral-300 bg-neutral-100 text-neutral-800";
}

export default function CollectibleAssetsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<ResponseData>({});
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  async function load(accessToken?: string | null) {
    const resolvedToken = accessToken ?? token;
    if (!resolvedToken) return;
    setLoading(true);
    const response = await fetch("/api/account/seller/collectible-assets", {
      headers: { Authorization: `Bearer ${resolvedToken}` },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as ResponseData;
    setData(body);
    setLoading(false);
  }

  useEffect(() => {
    void (async () => {
      const session = await getFreshAccountSession(5 * 60, true);
      const accessToken = session?.access_token || null;
      setToken(accessToken);
      if (accessToken) await load(accessToken);
      else setLoading(false);
    })();
  }, []);

  const assets = useMemo(
    () =>
      (data.assets || []).filter(
        (asset) => filter === "all" || asset.lifecycleStatus === filter,
      ),
    [data.assets, filter],
  );

  async function refreshMarket(asset: Asset) {
    if (!token || !asset.inventoryItemId) return;
    setRefreshingId(asset.assetId);
    try {
      const response = await fetch(
        `/api/account/seller/inventory/${asset.inventoryItemId}/instacomp-tracking`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ deepScan: true }),
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "Market refresh failed.");
      await load(token);
    } catch (error: any) {
      setData((current) => ({
        ...current,
        error: error?.message || "Market refresh failed.",
      }));
    } finally {
      setRefreshingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border-2 border-neutral-950 bg-neutral-950 p-6 text-white">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-300">
            Permanent physical-card record
          </p>
          <h1 className="mt-2 text-4xl font-black">Collectible Lifecycle</h1>
          <p className="mt-3 max-w-4xl font-semibold leading-7 text-neutral-300">
            Pending, listed and sold cards remain tied to the exact physical copy,
            copy stamp, grading cert and market history. Sold cards are never
            erased from this view.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {["all", "pending_listing", "active", "sold", "archived"].map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  className={`rounded-full border px-4 py-2 text-xs font-black uppercase ${
                    filter === value
                      ? "border-white bg-white text-neutral-950"
                      : "border-white/20 bg-white/10"
                  }`}
                >
                  {value.replaceAll("_", " ")}
                </button>
              ),
            )}
            <a
              href="/seller/inventory?status=draft&source=instacomp"
              className="rounded-full bg-emerald-300 px-4 py-2 text-xs font-black uppercase text-neutral-950"
            >
              Pending Listings
            </a>
          </div>
        </header>

        {data.error ? (
          <section className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-5 font-bold text-rose-900">
            {data.error}
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-2xl border bg-white p-8 text-center font-black">
            Loading collectible records...
          </section>
        ) : null}

        <section className="grid gap-4">
          {assets.map((asset) => (
            <article
              key={asset.assetId}
              className="grid gap-5 rounded-3xl border-2 border-neutral-950 bg-white p-5 lg:grid-cols-[150px_minmax(0,1fr)_280px]"
            >
              <div className="rounded-xl border bg-neutral-50 p-2">
                {asset.imageUrl ? (
                  <img
                    src={asset.imageUrl}
                    alt={asset.title}
                    className="aspect-[4/5] h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex aspect-[4/5] items-center justify-center text-xs font-bold">
                    Scan stored privately
                  </div>
                )}
              </div>

              <div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusTone(
                      asset.lifecycleStatus,
                    )}`}
                  >
                    {asset.lifecycleStatus.replaceAll("_", " ")}
                  </span>
                  {asset.gradingCompany ? (
                    <span className="rounded-full border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-black text-sky-900">
                      {asset.gradingCompany} {asset.gradingGrade}
                    </span>
                  ) : null}
                  {asset.exactSerialNumber ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-900">
                      Exact copy {asset.exactSerialNumber}
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-3 text-2xl font-black">{asset.title}</h2>
                <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <p><b>Player:</b> {asset.player || "Not set"}</p>
                  <p><b>Year:</b> {asset.year || "Not set"}</p>
                  <p><b>Set:</b> {asset.productSet || "Not set"}</p>
                  <p><b>Card:</b> {asset.cardNumber || "Not set"}</p>
                  <p><b>Parallel:</b> {asset.parallel || "Not set"}</p>
                  <p><b>Cert:</b> {asset.gradingCertNumber || "Not graded"}</p>
                </div>

                {asset.graderVerificationUrl ? (
                  <a
                    href={asset.graderVerificationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-full border-2 border-neutral-950 px-4 py-2 text-sm font-black"
                  >
                    Open official {asset.gradingCompany} cert record
                  </a>
                ) : null}
              </div>

              <div className="space-y-3">
                <div
                  className={`rounded-2xl border-2 p-4 ${timingTone(
                    asset.saleTiming.code,
                  )}`}
                >
                  <p className="text-xs font-black uppercase tracking-[0.14em]">
                    Sale timing
                  </p>
                  <p className="mt-1 text-xl font-black">
                    {asset.lifecycleStatus === "sold"
                      ? asset.saleTiming.label
                      : "Not sold yet"}
                  </p>
                  {asset.saleTiming.differencePercent !== null ? (
                    <p className="mt-1 text-sm font-bold">
                      Market change after sale:{" "}
                      {asset.saleTiming.differencePercent > 0 ? "+" : ""}
                      {asset.saleTiming.differencePercent}%
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border bg-neutral-50 p-4 text-sm">
                  <p><b>Listing price:</b> {money(asset.listingPrice)}</p>
                  <p className="mt-1"><b>Sold price:</b> {money(asset.soldPrice)}</p>
                  <p className="mt-1">
                    <b>Current market:</b> {money(asset.currentMarketValue)}
                  </p>
                  <p className="mt-1">
                    <b>Market checks:</b> {asset.marketSnapshotCount}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={!asset.inventoryItemId || refreshingId === asset.assetId}
                  onClick={() => void refreshMarket(asset)}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-neutral-950 bg-violet-200 px-4 py-3 font-black disabled:opacity-40"
                >
                  {refreshingId === asset.assetId
                    ? "Refreshing market..."
                    : asset.lifecycleStatus === "sold"
                      ? "Run Post-Sale Market Check"
                      : "Refresh InstaComp Market"}
                </button>
              </div>
            </article>
          ))}
        </section>

        {!loading && assets.length === 0 ? (
          <section className="rounded-2xl border-2 border-dashed border-neutral-400 bg-white p-10 text-center font-black">
            No collectible assets match this filter.
          </section>
        ) : null}
      </div>
    </main>
  );
}
