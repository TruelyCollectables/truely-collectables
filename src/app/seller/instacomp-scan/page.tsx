"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type ScannerResult = {
  success: boolean;
  code?: string;
  error?: string;
  stage?: string;
  identityComplete?: boolean;
  inventoryItemId?: string;
  title?: string;
  pricingSucceeded?: boolean;
  scan?: any;
  ai?: Record<string, unknown> | null;
  pricing?: any;
  checklistDecision?: any;
  parallelDecision?: any;
  duplicate?: { inventoryItemId: string; title: string; status: string };
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function numberFrom(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
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

function identityRecord(result: ScannerResult) {
  return result.ai || result.scan?.trusted_identity || {};
}

function identityRows(result: ScannerResult) {
  const identity = identityRecord(result) as Record<string, unknown>;
  return [
    ["Year", identity.year],
    ["Manufacturer", identity.manufacturer || identity.brand],
    ["Set", identity.setName || identity.set_name],
    ["Player", identity.player || identity.playerName],
    ["Card", identity.cardNumber || identity.card_number],
    [
      "Parallel",
      identity.checklistParallel || identity.parallelName || identity.parallel,
    ],
    ["Variation", identity.variation],
    ["Serial", identity.serialNumber || identity.printRun],
  ].filter(([, value]) => value);
}

export default function InstaCompScanPage() {
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [result, setResult] = useState<ScannerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState(
    "Ready for required front and back photos",
  );
  const suggestedPrice = findSuggestedPrice(result);
  const pricingChoices = useMemo(
    () =>
      suggestedPrice
        ? [
            {
              label: "InstaComp",
              value: suggestedPrice,
              source: "instacomp",
            },
            {
              label: "+5%",
              value: Math.round(suggestedPrice * 1.05 * 100) / 100,
              source: "instacomp_plus_5",
            },
            {
              label: "+10%",
              value: Math.round(suggestedPrice * 1.1 * 100) / 100,
              source: "instacomp_plus_10",
            },
          ]
        : [],
    [suggestedPrice],
  );

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
      setStage(
        "Orienting images, reading core identity, then matching color, pattern, and serial",
      );
      const response = await fetch("/api/account/seller/instacomp-scan/intake", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body,
      });
      const payload = (await response.json()) as ScannerResult;
      setResult(payload);
      if (!response.ok && response.status !== 202 && response.status !== 207) {
        throw new Error(payload.error || "Card scan failed.");
      }
      if (payload.identityComplete === true) {
        setStage(
          payload.pricingSucceeded
            ? "Exact checklist identity and verified comps complete"
            : "Exact checklist identity saved; pricing needs a retry",
        );
      } else if (payload.inventoryItemId) {
        setStage(
          "Front and back saved to Pending Listings; exact parallel review is required",
        );
      } else {
        setStage("Stopped safely for review");
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Scanner intake failed.",
      );
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
      const response = await fetch(
        "/api/account/seller/instacomp-scan/price",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventoryItemId: result.inventoryItemId,
            price: choice.value,
            source: choice.source,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Could not save the price.");
      }
      setStage(`${money(choice.value)} saved to Pending Listings`);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not save the price.",
      );
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
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-300">
            InstaComp Exact Scanner
          </p>
          <h1 className="text-3xl font-black">
            Front + Back → Core Identity → Color + Pattern + Serial → Checklist
          </h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-300">
            Images are oriented from printed writing. The scanner first reads year,
            set, player, and card number, then distinguishes exact treatments such
            as Blue Velocity, Blue Cracked Ice, Green Prizm, Base, and numbered
            parallels. An unresolved card is preserved in Pending Listings instead
            of being mislabeled or discarded.
          </p>
        </div>
        <Link
          href="/kingmaker/pending"
          className="rounded-xl border border-slate-600 px-4 py-2 font-bold hover:bg-slate-800"
        >
          Open Pending Listings
        </Link>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="text-xl font-bold">1. Capture both sides</h2>
          <p className="mt-2 text-sm font-semibold text-amber-200">
            Front and back are both required. Manual rotation is not part of this
            workflow.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="rounded-xl border border-dashed border-slate-600 p-4">
              <span className="font-bold">Front photo *</span>
              <input
                className="mt-3 block w-full text-sm"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => setFront(event.target.files?.[0] || null)}
              />
              <span className="mt-2 block text-xs text-slate-400">
                {front?.name || "Required — camera or file upload"}
              </span>
            </label>
            <label className="rounded-xl border border-dashed border-slate-600 p-4">
              <span className="font-bold">Back photo *</span>
              <input
                className="mt-3 block w-full text-sm"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                onChange={(event) => setBack(event.target.files?.[0] || null)}
              />
              <span className="mt-2 block text-xs text-slate-400">
                {back?.name || "Required for every listing"}
              </span>
            </label>
          </div>
          <div className="mt-5 rounded-xl bg-slate-900 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-bold">Pipeline status</span>
              {busy ? (
                <span className="animate-pulse text-amber-300">Working</span>
              ) : (
                <span className="text-emerald-300">{stage}</span>
              )}
            </div>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border border-red-700 bg-red-950/60 p-4 text-red-200">
              {error}
            </div>
          ) : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              disabled={busy || !front || !back}
              onClick={() => void scan()}
              className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-40"
            >
              {busy ? "Scanning…" : "Identify Exact Card"}
            </button>
            <button
              disabled={busy}
              onClick={reset}
              className="rounded-xl border border-slate-600 px-5 py-3 font-bold"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-slate-950 p-5">
          <h2 className="text-xl font-bold">2. Exact identity receipt</h2>
          {!result ? (
            <p className="mt-4 text-slate-400">
              The checklist candidates, visible color and pattern, serial evidence,
              saved draft, and pricing choices will appear here.
            </p>
          ) : null}
          {result?.duplicate ? (
            <div className="mt-4 rounded-xl border border-amber-600 bg-amber-950/50 p-4">
              <p className="font-black text-amber-200">Duplicate scan blocked</p>
              <p className="mt-1">{result.duplicate.title}</p>
              <Link
                className="mt-3 inline-block font-bold underline"
                href="/kingmaker/pending"
              >
                Review existing pending item
              </Link>
            </div>
          ) : null}

          {result?.inventoryItemId ? (
            <div className="mt-4 space-y-4">
              <div
                className={`rounded-xl border p-4 ${
                  result.identityComplete
                    ? "border-emerald-700 bg-emerald-950/30"
                    : "border-amber-700 bg-amber-950/30"
                }`}
              >
                <p className="font-black">
                  {result.identityComplete
                    ? "Exact checklist identity resolved"
                    : "Saved safely — exact parallel review required"}
                </p>
                <p className="mt-1 text-sm text-slate-300">{result.title}</p>
                {result.error ? (
                  <p className="mt-2 text-sm text-amber-200">{result.error}</p>
                ) : null}
              </div>

              {identityRows(result).length ? (
                <div className="rounded-xl bg-slate-900 p-4">
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {identityRows(result).map(([name, value]) => (
                      <div key={String(name)} className="rounded-lg bg-slate-950 p-2">
                        <dt className="text-slate-500">{String(name)}</dt>
                        <dd className="font-bold">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}

              {result.parallelDecision ? (
                <div className="rounded-xl bg-slate-900 p-4 text-sm">
                  <p className="font-black">Visual parallel receipt</p>
                  <p className="mt-2">
                    Color: {result.parallelDecision.features?.dominantColor || "—"}
                  </p>
                  <p>
                    Pattern:{" "}
                    {String(
                      result.parallelDecision.features?.pattern || "—",
                    ).replace(/_/g, " ")}
                  </p>
                  <p>
                    Serial:{" "}
                    {result.parallelDecision.features?.serialStampText || "None seen"}
                  </p>
                  <p className="mt-2 text-slate-300">
                    {result.parallelDecision.evidence}
                  </p>
                </div>
              ) : null}

              {pricingChoices.length ? (
                <div>
                  <p className="mb-3 font-black">Choose listing price</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {pricingChoices.map((choice) => (
                      <button
                        key={choice.source}
                        disabled={savingPrice}
                        onClick={() => void choosePrice(choice)}
                        className="rounded-xl border border-emerald-600 p-4 text-left hover:bg-emerald-950"
                      >
                        <span className="block text-sm text-slate-400">
                          {choice.label}
                        </span>
                        <span className="text-xl font-black">
                          {money(choice.value)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">
                  Pricing remains blocked until one exact checklist identity is
                  proven. The front and back are preserved in Pending Listings.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
