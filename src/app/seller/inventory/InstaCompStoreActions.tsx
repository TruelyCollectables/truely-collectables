"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type InventoryItem = {
  inventoryItemId: string;
  sku: string | null;
  title: string;
  status: string;
  imageUrl: string | null;
};

type ScanResult = {
  inventoryItemId: string;
  sku: string | null;
  title: string;
  success: boolean;
  exactCompCount: number;
  suggestedPrice: number | null;
  message: string;
};

function selectedSkuValues() {
  const values = new Set<string>();
  const boxes = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'article input[type="checkbox"]:checked',
    ),
  );

  for (const box of boxes) {
    const text = box.closest("article")?.textContent || "";
    const match = /\bSKU\s+([^\s/]+)/i.exec(text);
    const sku = match?.[1]?.trim();
    if (sku && sku.toLowerCase() !== "not") values.add(sku);
  }

  return values;
}

function money(value: number | null) {
  if (!value) return "no price";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export default function InstaCompStoreActions() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(true);
  const [running, setRunning] = useState<"selected" | "all" | null>(null);
  const [completed, setCompleted] = useState(0);
  const [targetCount, setTargetCount] = useState(0);
  const [results, setResults] = useState<ScanResult[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const stopRequested = useRef(false);

  const loadInventory = useCallback(async (showLoading = true) => {
    if (showLoading) setLoadingInventory(true);
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) {
        setInventory([]);
        return;
      }
      const response = await fetch("/api/account/seller/inventory", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load inventory.");
      setInventory(Array.isArray(data.items) ? data.items : []);
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load inventory for InstaComp.",
      );
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInventory(false);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadInventory]);

  async function runItems(scope: "selected" | "all") {
    setError("");
    setMessage("");
    setResults([]);

    const session = await getFreshAccountSession(5 * 60, false);
    if (!session?.access_token) {
      setError("Log in to the TCOS seller account before running InstaComp.");
      return;
    }

    let items = inventory.filter(
      (item) => item.imageUrl && !["sold", "archived"].includes(item.status),
    );

    if (scope === "selected") {
      const selectedSkus = selectedSkuValues();
      items = items.filter((item) => item.sku && selectedSkus.has(item.sku));
      if (!items.length) {
        setError(
          "Check one or more inventory cards first, then press InstaComp Selected.",
        );
        return;
      }
    } else if (
      !window.confirm(
        `Run InstaComp on all ${items.length} inventory cards with images? This performs real AI scans and can take a long time.`,
      )
    ) {
      return;
    }

    stopRequested.current = false;
    setRunning(scope);
    setTargetCount(items.length);
    setCompleted(0);
    const nextResults: ScanResult[] = [];

    for (const item of items) {
      if (stopRequested.current) break;
      try {
        const response = await fetch(
          "/api/account/seller/inventory/instacomp",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              inventoryItemId: item.inventoryItemId,
              aiCouncilTier: "adaptive",
            }),
          },
        );
        const data = await response.json();
        if (!response.ok || data.success !== true) {
          throw new Error(data.error || "InstaComp scan failed.");
        }

        const exactCompCount = Number(data.exactCompCount || 0);
        const providerProblems = Array.isArray(data.providerProblems)
          ? data.providerProblems
          : [];
        const providerMessage = providerProblems
          .slice(0, 2)
          .map(
            (problem: { message?: string; label?: string }) =>
              problem.message || `${problem.label || "Provider"} unavailable`,
          )
          .join("; ");
        nextResults.push({
          inventoryItemId: item.inventoryItemId,
          sku: item.sku,
          title: item.title,
          success: true,
          exactCompCount,
          suggestedPrice: Number(data.suggestedPrice || 0) || null,
          message:
            exactCompCount > 0
              ? `${exactCompCount} exact comp${exactCompCount === 1 ? "" : "s"}; ${money(Number(data.suggestedPrice || 0) || null)}`
              : providerMessage
                ? `No exact comp. ${providerMessage}`
                : "No exact comp passed the identity filter.",
        });
      } catch (nextError: unknown) {
        nextResults.push({
          inventoryItemId: item.inventoryItemId,
          sku: item.sku,
          title: item.title,
          success: false,
          exactCompCount: 0,
          suggestedPrice: null,
          message:
            nextError instanceof Error
              ? nextError.message
              : "InstaComp scan failed.",
        });
      }
      setResults([...nextResults]);
      setCompleted(nextResults.length);
    }

    const successes = nextResults.filter((result) => result.success).length;
    const matches = nextResults.filter(
      (result) => result.success && result.exactCompCount > 0,
    ).length;
    const failures = nextResults.length - successes;
    setMessage(
      stopRequested.current
        ? `Stopped after ${nextResults.length} card${nextResults.length === 1 ? "" : "s"}. ${matches} found exact comps; ${failures} failed.`
        : `Finished ${nextResults.length} card${nextResults.length === 1 ? "" : "s"}. ${matches} found exact comps; ${successes - matches} scanned but found no exact comp; ${failures} failed.`,
    );
    setRunning(null);
    stopRequested.current = false;
    await loadInventory();
  }

  const eligibleCount = inventory.filter(
    (item) => item.imageUrl && !["sold", "archived"].includes(item.status),
  ).length;

  return (
    <div className="w-full rounded-2xl border border-sky-300/40 bg-black/25 p-3 lg:max-w-2xl">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void runItems("selected")}
          disabled={running !== null || loadingInventory}
          className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running === "selected" ? "Scanning Selected..." : "InstaComp Selected"}
        </button>
        <button
          type="button"
          onClick={() => void runItems("all")}
          disabled={running !== null || loadingInventory || eligibleCount === 0}
          className="rounded-full border border-emerald-300/60 bg-emerald-300/10 px-4 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running === "all"
            ? `Scanning ${completed}/${targetCount}`
            : `InstaComp All (${eligibleCount})`}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => {
              stopRequested.current = true;
              setMessage("Stopping after the current card finishes...");
            }}
            className="rounded-full border border-rose-300/60 bg-rose-300/10 px-4 py-2 text-sm font-black text-rose-100 hover:bg-rose-300/20"
          >
            Stop
          </button>
        ) : null}
        <Link
          href="/seller/instacomp-pending"
          className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black text-white hover:bg-white/15"
        >
          Show InstaComp Pending
        </Link>
      </div>

      {running ? (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full bg-sky-300 transition-all"
            style={{
              width: `${targetCount ? Math.round((completed / targetCount) * 100) : 0}%`,
            }}
          />
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-xs font-bold text-emerald-100">{message}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-xs font-bold text-rose-200">{error}</p>
      ) : null}

      {results.length ? (
        <div className="mt-3 max-h-44 space-y-1 overflow-auto rounded-xl border border-white/15 bg-black/20 p-2 text-xs">
          {results.slice(-20).map((result) => (
            <div
              key={result.inventoryItemId}
              className={result.success ? "text-slate-100" : "text-rose-200"}
            >
              <strong>{result.success ? "DONE" : "FAILED"}</strong> —{" "}
              {result.sku || result.title}: {result.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
