"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type PendingItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  description: string | null;
  sku: string | null;
  status: string;
  quantity: number;
  price: number;
  imageUrl: string | null;
  createdAt: string | null;
  instaComp?: {
    isInstaCompDraft: boolean;
    source: string | null;
    scanId: string | null;
    serialNumber: string | null;
    marketPrice: number | null;
    listingPrice: number | null;
    listingPriceSource: string | null;
    hasBackImage: boolean;
  };
  activationReadiness: {
    ready: boolean;
    blockers: string[];
  };
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0));
}

function label(value: string | null | undefined) {
  if (!value) return "Not recorded";
  return value.replaceAll("_", " ");
}

export default function InstaCompPendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState("");

  const loadPending = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    setError("");
    setLoggedOut(false);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) {
        setItems([]);
        setLoggedOut(true);
        return;
      }

      const response = await fetch("/api/account/seller/inventory", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load InstaComp pending listings.");
      }

      const allItems = Array.isArray(data.items) ? (data.items as PendingItem[]) : [];
      const pending = allItems.filter(
        (item) => item.status === "draft" && item.instaComp?.isInstaCompDraft === true,
      );

      setItems(pending);
    } catch (nextError: unknown) {
      setItems([]);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load InstaComp pending listings.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPending(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPending]);

  const sortedItems = useMemo(
    () =>
      [...items].sort((left, right) =>
        String(left.sku || left.title).localeCompare(String(right.sku || right.title)),
      ),
    [items],
  );

  return (
    <main className="min-h-screen bg-[#f4f1ea] text-neutral-950">
      <section className="border-b-4 border-sky-300 bg-gradient-to-r from-sky-950 via-slate-950 to-emerald-950 px-5 py-8 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-200">
            InstaComp™ / Private Draft Queue
          </p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                Pending Listings
              </h1>
              <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-slate-200">
                This page loads only private draft inventory created by InstaComp. Active
                eBay inventory is deliberately excluded, so the 540-card active catalog
                cannot appear here.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadPending(true)}
                disabled={refreshing || loading}
                className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
              >
                {refreshing ? "Reloading..." : "Reload Six Drafts"}
              </button>
              <Link
                href="/seller/inventory"
                className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black"
              >
                Active Inventory Command Center
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-7">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Expected Batch
            </p>
            <p className="mt-2 text-3xl font-black">6</p>
          </div>
          <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Drafts Found
            </p>
            <p className="mt-2 text-3xl font-black">{loading ? "…" : sortedItems.length}</p>
          </div>
          <div className="rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500">
              Queue State
            </p>
            <p className="mt-2 text-xl font-black">
              {loading
                ? "Loading"
                : sortedItems.length === 6
                  ? "Batch 001 complete"
                  : "Count needs review"}
            </p>
          </div>
        </section>

        {loggedOut ? (
          <section className="rounded-2xl border-2 border-amber-700 bg-amber-50 p-5 font-semibold text-amber-950">
            Your local seller session is not available.{" ""}
            <Link href="/account/login" className="font-black underline">
              Log in to TCOS
            </Link>
            , then return to this page.
          </section>
        ) : null}

        {error ? (
          <section className="rounded-2xl border-2 border-rose-700 bg-rose-50 p-5 font-semibold text-rose-950">
            {error}
          </section>
        ) : null}

        {!loading && !loggedOut && !error && sortedItems.length === 0 ? (
          <section className="rounded-2xl border-2 border-neutral-900 bg-white p-6 shadow-[6px_6px_0_#111]">
            <h2 className="text-2xl font-black">No InstaComp drafts were returned</h2>
            <p className="mt-2 text-sm font-semibold text-neutral-700">
              The page successfully rejected the active catalog, but the seller inventory
              API did not return any draft rows marked as InstaComp. This is a database or
              account-visibility problem—not a filter or navigation problem.
            </p>
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2">
          {sortedItems.map((item) => (
            <article
              key={item.inventoryItemId}
              className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[7px_7px_0_#111]"
            >
              <div className="grid gap-0 sm:grid-cols-[190px_minmax(0,1fr)]">
                <div className="relative min-h-64 border-b-2 border-neutral-900 bg-neutral-100 sm:border-b-0 sm:border-r-2">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={`${item.title} front scan`}
                      fill
                      sizes="(max-width: 640px) 100vw, 190px"
                      className="object-contain p-3"
                    />
                  ) : (
                    <div className="flex h-full min-h-64 items-center justify-center p-5 text-center text-sm font-bold text-neutral-500">
                      Front scan unavailable
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-black">
                      PRIVATE DRAFT
                    </span>
                    <span className="rounded-full bg-sky-200 px-3 py-1 text-xs font-black">
                      INSTACOMP
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${
                        item.activationReadiness.ready
                          ? "bg-emerald-200"
                          : "bg-rose-200"
                      }`}
                    >
                      {item.activationReadiness.ready ? "READY" : "NEEDS WORK"}
                    </span>
                  </div>

                  <h2 className="mt-4 text-xl font-black leading-tight">{item.title}</h2>
                  <p className="mt-2 text-xs font-bold text-neutral-500">
                    SKU {item.sku || "Not recorded"}
                  </p>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Price</dt>
                      <dd className="mt-1 font-bold">{money(item.price)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Quantity</dt>
                      <dd className="mt-1 font-bold">{item.quantity}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Serial</dt>
                      <dd className="mt-1 font-bold">{item.instaComp?.serialNumber || "Not numbered"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Back scan</dt>
                      <dd className="mt-1 font-bold">{item.instaComp?.hasBackImage ? "Stored" : "Missing"}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Market value</dt>
                      <dd className="mt-1 font-bold">
                        {item.instaComp?.marketPrice
                          ? money(item.instaComp.marketPrice)
                          : "Not priced"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-black uppercase text-neutral-500">Source</dt>
                      <dd className="mt-1 font-bold">{label(item.instaComp?.source)}</dd>
                    </div>
                  </dl>

                  {item.activationReadiness.blockers.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3">
                      <p className="text-xs font-black uppercase text-rose-800">
                        Listing blockers
                      </p>
                      <p className="mt-1 text-sm font-semibold text-rose-950">
                        {item.activationReadiness.blockers.map(label).join(" · ")}
                      </p>
                    </div>
                  ) : null}

                  <details className="mt-4 rounded-xl border border-neutral-300 bg-neutral-50 p-3">
                    <summary className="cursor-pointer text-sm font-black">
                      Listing description and record IDs
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
                      {item.description || "No description stored."}
                    </p>
                    <p className="mt-3 break-all text-xs text-neutral-500">
                      Inventory: {item.inventoryItemId}
                      <br />
                      Scan: {item.instaComp?.scanId || "Not recorded"}
                    </p>
                  </details>
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
