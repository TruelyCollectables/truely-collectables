"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type PricingStatus =
  | "not_run"
  | "suggested_from_reliable_sold_comps"
  | "seller_price_required";

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
  updatedAt: string | null;
  instaComp: {
    source: string | null;
    scanId: string | null;
    humanVerified: boolean;
    serialNumber: string | null;
    hasBackImage: boolean;
    suggestedPrice: number | null;
    pricingStatus: PricingStatus;
    pricingReason: string;
    reliableSoldCompCount: number;
    pricingCheckedAt: string | null;
    listingPrice: number | null;
    listingPriceSource: string | null;
    gradingCompany: string | null;
    gradingGrade: string | null;
    gradingCertNumber: string | null;
    graderVerificationStatus: string;
    graderVerificationUrl: string | null;
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

function blockerLabel(value: string) {
  if (value === "missing_price") return "price required";
  if (value === "grader_verification_required") {
    return "grader verification required";
  }
  if (value === "grader_verification_conflict") {
    return "grader verification conflict";
  }
  return label(value);
}

function errorMessage(value: unknown, fallback: string) {
  return value instanceof Error ? value.message : fallback;
}

function graderStatusLabel(status: string) {
  if (status === "verified") return "Official grader verified";
  if (status === "manual_verified") return "Human-verified slab scan";
  if (status === "conflict") return "Verification conflict";
  if (status === "failed") return "Official lookup unavailable";
  return label(status);
}

export default function InstaCompPendingPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pricingItemId, setPricingItemId] = useState<string | null>(null);
  const [pricingAll, setPricingAll] = useState(false);
  const [pricingProgress, setPricingProgress] = useState({ current: 0, total: 0 });
  const [savingPriceId, setSavingPriceId] = useState<string | null>(null);
  const [manualPrices, setManualPrices] = useState<Record<string, string>>({});

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

      const response = await fetch("/api/account/seller/instacomp-pending", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load InstaComp pending listings.");
      }

      setItems(Array.isArray(data.items) ? (data.items as PendingItem[]) : []);
    } catch (nextError: unknown) {
      setItems([]);
      setError(
        errorMessage(nextError, "Could not load InstaComp pending listings."),
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
        String(left.sku || left.title).localeCompare(
          String(right.sku || right.title),
        ),
      ),
    [items],
  );

  const pricingSummary = useMemo(
    () =>
      sortedItems.reduce(
        (summary, item) => {
          if (
            item.instaComp.pricingStatus ===
            "suggested_from_reliable_sold_comps"
          ) {
            summary.suggested += 1;
          } else if (
            item.instaComp.pricingStatus === "seller_price_required"
          ) {
            summary.sellerRequired += 1;
          } else {
            summary.notRun += 1;
          }
          return summary;
        },
        { suggested: 0, sellerRequired: 0, notRun: 0 },
      ),
    [sortedItems],
  );

  async function scanItem(item: PendingItem, accessToken: string) {
    const response = await fetch("/api/account/seller/inventory/instacomp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        inventoryItemId: item.inventoryItemId,
        aiCouncilTier: "adaptive",
      }),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) {
      throw new Error(data.error || "InstaComp pricing failed.");
    }
    return data as {
      suggestedPrice: number;
      pricingStatus: PricingStatus;
      pricingReason: string;
      reliableSoldCompCount: number;
    };
  }

  async function runPricing(item: PendingItem) {
    setError("");
    setNotice("");
    setPricingItemId(item.inventoryItemId);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      const result = await scanItem(item, session.access_token);
      setNotice(
        result.suggestedPrice > 0
          ? `${item.title}: InstaComp suggests ${money(result.suggestedPrice)} from ${result.reliableSoldCompCount} reliable sold comp${result.reliableSoldCompCount === 1 ? "" : "s"}.`
          : `${item.title}: $0.00 means no reliable sold comps passed. Seller pricing is required.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "InstaComp pricing failed."));
    } finally {
      setPricingItemId(null);
    }
  }

  async function runAllPricing() {
    if (
      !window.confirm(
        `Run InstaComp sold-comp pricing on all ${sortedItems.length} private drafts?`,
      )
    ) {
      return;
    }

    setError("");
    setNotice("");
    setPricingAll(true);
    setPricingProgress({ current: 0, total: sortedItems.length });

    let failures = 0;
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");

      for (const [index, item] of sortedItems.entries()) {
        setPricingItemId(item.inventoryItemId);
        try {
          await scanItem(item, session.access_token);
        } catch {
          failures += 1;
        }
        setPricingProgress({ current: index + 1, total: sortedItems.length });
      }

      await loadPending(true);
      setNotice(
        failures === 0
          ? `InstaComp produced a pricing outcome for all ${sortedItems.length} cards.`
          : `InstaComp finished ${sortedItems.length - failures} cards; ${failures} need a retry because the scan or provider failed.`,
      );
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not run batch InstaComp pricing."));
    } finally {
      setPricingItemId(null);
      setPricingAll(false);
    }
  }

  async function savePrice(item: PendingItem, mode: "suggested" | "manual") {
    setError("");
    setNotice("");
    setSavingPriceId(item.inventoryItemId);

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to set the listing price.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/price",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventoryItemId: item.inventoryItemId,
            mode,
            price:
              mode === "manual"
                ? manualPrices[item.inventoryItemId] || ""
                : undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not set the listing price.");
      }
      setNotice(
        `${item.title}: listing price set to ${money(data.price)}. The card remains a private draft.`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not set the listing price."));
    } finally {
      setSavingPriceId(null);
    }
  }

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
                Every card receives a price outcome. A suggestion above $0.00 comes only
                from reliable exact sold comps. $0.00 means no reliable sold comps passed,
                so the seller sets the price.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAllPricing()}
                disabled={pricingAll || loading || sortedItems.length === 0}
                className="rounded-full bg-emerald-300 px-4 py-2 text-sm font-black text-emerald-950 disabled:opacity-50"
              >
                {pricingAll
                  ? `Pricing ${pricingProgress.current}/${pricingProgress.total}`
                  : `Price All ${sortedItems.length} with InstaComp`}
              </button>
              <button
                type="button"
                onClick={() => void loadPending(true)}
                disabled={refreshing || loading || pricingAll}
                className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-50"
              >
                {refreshing ? "Reloading..." : "Reload Drafts"}
              </button>
              <Link
                href="/seller/inventory"
                className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black"
              >
                Active Inventory
              </Link>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-5 px-5 py-7">
        <section className="grid gap-3 sm:grid-cols-4">
          {[
            ["Drafts Found", loading ? "…" : sortedItems.length],
            ["Reliable Suggestions", pricingSummary.suggested],
            ["Seller Pricing", pricingSummary.sellerRequired],
            ["Pricing Not Run", pricingSummary.notRun],
          ].map(([title, value]) => (
            <div
              key={String(title)}
              className="rounded-2xl border-2 border-neutral-900 bg-white p-4 shadow-[5px_5px_0_#111]"
            >
              <p className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
                {title}
              </p>
              <p className="mt-2 text-3xl font-black">{value}</p>
            </div>
          ))}
        </section>

        {loggedOut ? (
          <section className="rounded-2xl border-2 border-amber-700 bg-amber-50 p-5 font-semibold text-amber-950">
            Your local seller session is not available.{" "}
            <Link href="/account/login" className="font-black underline">
              Log in to TCOS
            </Link>
            , then return to this page.
          </section>
        ) : null}

        {notice ? (
          <section className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-5 font-semibold text-emerald-950">
            {notice}
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
          </section>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-2">
          {sortedItems.map((item) => {
            const suggestion = item.instaComp.suggestedPrice;
            const reliableSuggestion =
              item.instaComp.pricingStatus ===
                "suggested_from_reliable_sold_comps" &&
              typeof suggestion === "number" &&
              suggestion > 0;
            const priceBusy = savingPriceId === item.inventoryItemId;
            const scanBusy = pricingItemId === item.inventoryItemId;

            return (
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

                    <h2 className="mt-4 text-xl font-black leading-tight">
                      {item.title}
                    </h2>
                    <p className="mt-2 text-xs font-bold text-neutral-500">
                      SKU {item.sku || "Not recorded"}
                    </p>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Listing price
                        </dt>
                        <dd className="mt-1 font-bold">{money(item.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          InstaComp suggestion
                        </dt>
                        <dd className="mt-1 font-bold">
                          {suggestion === null ? "Not run" : money(suggestion)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Reliable sold comps
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.reliableSoldCompCount}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Quantity
                        </dt>
                        <dd className="mt-1 font-bold">{item.quantity}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Serial
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.serialNumber || "Not numbered"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-black uppercase text-neutral-500">
                          Back scan
                        </dt>
                        <dd className="mt-1 font-bold">
                          {item.instaComp.hasBackImage ? "Stored" : "Missing"}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 rounded-xl border-2 border-sky-300 bg-sky-50 p-3">
                      <p className="text-xs font-black uppercase text-sky-900">
                        InstaComp pricing outcome
                      </p>
                      <p className="mt-1 text-sm font-semibold text-sky-950">
                        {item.instaComp.pricingReason}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void runPricing(item)}
                          disabled={scanBusy || pricingAll}
                          className="rounded-full bg-sky-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                        >
                          {scanBusy ? "Running InstaComp..." : "Run InstaComp Pricing"}
                        </button>
                        {reliableSuggestion ? (
                          <button
                            type="button"
                            onClick={() => void savePrice(item, "suggested")}
                            disabled={priceBusy}
                            className="rounded-full bg-emerald-700 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                          >
                            {priceBusy
                              ? "Saving..."
                              : `Use ${money(suggestion)} Suggestion`}
                          </button>
                        ) : null}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={manualPrices[item.inventoryItemId] || ""}
                          onChange={(event) =>
                            setManualPrices((current) => ({
                              ...current,
                              [item.inventoryItemId]: event.target.value,
                            }))
                          }
                          placeholder="Seller price"
                          className="min-w-0 flex-1 rounded-lg border-2 border-neutral-400 px-3 py-2 text-sm font-bold"
                        />
                        <button
                          type="button"
                          onClick={() => void savePrice(item, "manual")}
                          disabled={priceBusy}
                          className="rounded-lg bg-neutral-950 px-3 py-2 text-xs font-black text-white disabled:opacity-50"
                        >
                          Save Seller Price
                        </button>
                      </div>
                    </div>

                    {item.instaComp.gradingCompany ? (
                      <div className="mt-4 rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm">
                        <p className="text-xs font-black uppercase text-neutral-500">
                          Grader verification
                        </p>
                        <p className="mt-1 font-bold">
                          {item.instaComp.gradingCompany}{" "}
                          {item.instaComp.gradingGrade || ""} · Cert{" "}
                          {item.instaComp.gradingCertNumber || "Not recorded"}
                        </p>
                        <p className="mt-1 font-semibold text-neutral-700">
                          {graderStatusLabel(
                            item.instaComp.graderVerificationStatus,
                          )}
                        </p>
                        {item.instaComp.graderVerificationUrl ? (
                          <a
                            href={item.instaComp.graderVerificationUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block font-black text-sky-800 underline"
                          >
                            Open official grader record
                          </a>
                        ) : null}
                      </div>
                    ) : null}

                    {item.activationReadiness.blockers.length > 0 ? (
                      <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3">
                        <p className="text-xs font-black uppercase text-rose-800">
                          Listing blockers
                        </p>
                        <p className="mt-1 text-sm font-semibold text-rose-950">
                          {item.activationReadiness.blockers
                            .map(blockerLabel)
                            .join(" · ")}
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
                        Scan: {item.instaComp.scanId || "Not recorded"}
                      </p>
                    </details>
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
