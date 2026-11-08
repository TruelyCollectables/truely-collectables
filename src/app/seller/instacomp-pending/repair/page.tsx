"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getFreshAccountSession } from "../../../account/account-session";

type PendingItem = {
  inventoryItemId: string;
  legacyProductId: number | null;
  title: string;
  imageUrl: string | null;
  instaComp: {
    hasBackImage: boolean;
    scanId: string | null;
  };
};

type RepairResult = {
  inventoryItemId: string;
  title: string;
  success: boolean;
  frontUrl?: string;
  backUrl?: string;
  identityRescanSucceeded?: boolean;
  pricingSucceeded?: boolean;
  warning?: string | null;
  error?: string;
};

type RepairResponse = {
  attempted?: number;
  repaired?: number;
  failed?: number;
  results?: RepairResult[];
  error?: string;
};

function needsImageRepair(item: PendingItem) {
  return Boolean(
    item.instaComp.scanId &&
      (!item.legacyProductId || !item.imageUrl || !item.instaComp.hasBackImage),
  );
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export default function InstaCompPendingRepairPage() {
  const [running, setRunning] = useState(true);
  const [status, setStatus] = useState("Finding your original front and back photos…");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [results, setResults] = useState<RepairResult[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);

  async function loadTargets(accessToken: string) {
    const response = await fetch("/api/account/seller/instacomp-pending", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Could not load Pending Listings.");
    }
    const items = Array.isArray(payload.items)
      ? (payload.items as PendingItem[])
      : [];
    return items.filter(needsImageRepair);
  }

  async function runRepair() {
    setRunning(true);
    setError("");
    setResults([]);
    setRemaining(null);
    setStatus("Authenticating your seller account…");

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) {
        throw new Error("Log in before repairing Pending Listings.");
      }

      const targets = await loadTargets(session.access_token);
      setProgress({ current: 0, total: targets.length });
      if (!targets.length) {
        setStatus("Every recoverable pending listing already has its front and back photos attached.");
        setRemaining(0);
        return;
      }

      const batches = chunks(targets, 25);
      const allResults: RepairResult[] = [];
      let completed = 0;
      for (const batch of batches) {
        setStatus(
          `Recovering original image pairs and re-running InstaComp (${completed}/${targets.length})…`,
        );
        const response = await fetch(
          "/api/account/seller/instacomp-pending/repair-images",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              itemIds: batch.map((item) => item.inventoryItemId),
            }),
          },
        );
        const payload = (await response.json()) as RepairResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Pending image recovery failed.");
        }
        const batchResults = Array.isArray(payload.results) ? payload.results : [];
        allResults.push(...batchResults);
        completed += batch.length;
        setResults([...allResults]);
        setProgress({ current: completed, total: targets.length });
      }

      const stillMissing = await loadTargets(session.access_token);
      setRemaining(stillMissing.length);
      const repaired = allResults.filter((result) => result.success).length;
      const failed = allResults.length - repaired;
      setStatus(
        failed
          ? `Recovered ${repaired} listing${repaired === 1 ? "" : "s"}; ${failed} need attention.`
          : `Recovered all ${repaired} original front/back image pair${repaired === 1 ? "" : "s"} and re-ran InstaComp.`,
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Pending image recovery failed.",
      );
      setStatus("Recovery stopped safely.");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runRepair();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-300">
            InstaComp Recovery
          </p>
          <h1 className="text-3xl font-black">Attach the originals you already uploaded</h1>
          <p className="mt-2 max-w-3xl text-slate-300">
            This reads the original front and back photos from the authenticated Mac scan archive, attaches both to each private pending listing, and re-runs identity and pricing. Nothing publishes automatically.
          </p>
        </div>
        <Link
          href="/kingmaker/pending"
          className="rounded-xl border border-slate-600 px-4 py-2 font-bold hover:bg-slate-800"
        >
          Open Pending Listings
        </Link>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-700 bg-slate-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-black">{status}</p>
            {progress.total > 0 ? (
              <p className="mt-1 text-sm text-slate-400">
                {progress.current} of {progress.total} processed
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => void runRepair()}
            className="rounded-xl bg-emerald-400 px-5 py-3 font-black text-black disabled:opacity-40"
          >
            {running ? "Repairing…" : "Run repair again"}
          </button>
        </div>
        {progress.total > 0 ? (
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-400 transition-all"
              style={{
                width: `${Math.round((progress.current / progress.total) * 100)}%`,
              }}
            />
          </div>
        ) : null}
        {remaining !== null ? (
          <p className="mt-3 text-sm text-slate-300">
            Remaining recoverable listings: <strong>{remaining}</strong>
          </p>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-700 bg-red-950/60 p-4 text-red-200">
            {error}
          </div>
        ) : null}
      </section>

      {results.length ? (
        <section className="mt-6 grid gap-4">
          {results.map((result) => (
            <article
              key={result.inventoryItemId}
              className={`rounded-2xl border p-4 ${
                result.success
                  ? "border-emerald-800 bg-emerald-950/20"
                  : "border-red-800 bg-red-950/20"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-black">{result.title}</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    {result.success
                      ? "Original front and back attached"
                      : result.error || "Recovery failed"}
                  </p>
                  {result.warning ? (
                    <p className="mt-2 text-sm text-amber-200">{result.warning}</p>
                  ) : null}
                </div>
                {result.success ? (
                  <div className="text-right text-xs text-slate-400">
                    <p>
                      Identity re-scan: {result.identityRescanSucceeded ? "complete" : "needs retry"}
                    </p>
                    <p>
                      Pricing: {result.pricingSucceeded ? "complete" : "needs retry"}
                    </p>
                  </div>
                ) : null}
              </div>

              {result.frontUrl && result.backUrl ? (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <figure className="rounded-xl bg-white p-2 text-black">
                    <Image
                      src={result.frontUrl}
                      alt={`${result.title} front`}
                      width={700}
                      height={980}
                      className="h-auto w-full object-contain"
                    />
                    <figcaption className="mt-2 text-center text-xs font-black uppercase">
                      Front
                    </figcaption>
                  </figure>
                  <figure className="rounded-xl bg-white p-2 text-black">
                    <Image
                      src={result.backUrl}
                      alt={`${result.title} back`}
                      width={700}
                      height={980}
                      className="h-auto w-full object-contain"
                    />
                    <figcaption className="mt-2 text-center text-xs font-black uppercase">
                      Back
                    </figcaption>
                  </figure>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
    </main>
  );
}
