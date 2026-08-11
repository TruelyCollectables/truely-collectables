"use client";

import { useMemo, useState } from "react";

type CollxRow = {
  collxId: string;
  name: string;
  year: string;
  brand: string;
  set: string;
  number: string;
  flags: string;
  frontImage: string;
  backImage: string;
};

type MatchResult =
  | {
      status: "matched";
      method: "existing_reference" | "unique_identity" | "visual";
      target: {
        inventoryItemId: string;
        legacyProductId: number;
        title: string;
        productImageUrl: string;
      };
      row: CollxRow;
      identityScore: number;
      visualDistance: number | null;
      visualRunnerUpDistance: number | null;
    }
  | {
      status: "ambiguous" | "unmatched";
      target: {
        inventoryItemId: string;
        legacyProductId: number;
        title: string;
        productImageUrl: string;
      };
      candidateCount: number;
      reason: string;
    };

type PreviewResponse = {
  csvRows: number;
  csvFrontImages: number;
  csvBackImages: number;
  totalTargets: number;
  offset: number;
  nextOffset: number | null;
  results: MatchResult[];
  error?: string;
};

type ApplyFailure = {
  inventoryItemId: string;
  legacyProductId: number;
  collxId: string;
  error: string;
};

function chunk<T>(values: T[], size: number) {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function statusTone(status: MatchResult["status"]) {
  if (status === "matched") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "ambiguous") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-neutral-200 bg-neutral-50 text-neutral-800";
}

export default function CollxImageImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [csvStats, setCsvStats] = useState<{
    rows: number;
    front: number;
    back: number;
  } | null>(null);
  const [totalTargets, setTotalTargets] = useState(0);
  const [scannedTargets, setScannedTargets] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [failures, setFailures] = useState<ApplyFailure[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"scan" | "apply" | null>(null);

  const matched = useMemo(
    () => results.filter((result) => result.status === "matched") as Extract<MatchResult, { status: "matched" }>[],
    [results],
  );
  const ambiguous = useMemo(
    () => results.filter((result) => result.status === "ambiguous"),
    [results],
  );
  const unmatched = useMemo(
    () => results.filter((result) => result.status === "unmatched"),
    [results],
  );
  const matchedWithBack = matched.filter((result) => Boolean(result.row.backImage)).length;

  async function scan() {
    if (!file || busy) return;
    setBusy("scan");
    setResults([]);
    setFailures([]);
    setImportedCount(0);
    setMessage("Reading the CollX export and matching existing eBay-backed cards...");
    setScannedTargets(0);

    const collected: MatchResult[] = [];
    let offset: number | null = 0;
    let guard = 0;

    try {
      while (offset !== null) {
        guard += 1;
        if (guard > 5_000) throw new Error("Preview pagination safety limit reached.");

        const formData = new FormData();
        formData.set("file", file);
        formData.set("offset", String(offset));
        formData.set("limit", "12");
        const response = await fetch("/api/admin/collx-image-import?mode=preview", {
          method: "POST",
          body: formData,
          cache: "no-store",
        });
        const body = (await response.json().catch(() => null)) as PreviewResponse | null;
        if (!response.ok || !body) {
          throw new Error(body?.error || `Preview failed with HTTP ${response.status}.`);
        }

        if (!csvStats) {
          setCsvStats({
            rows: body.csvRows,
            front: body.csvFrontImages,
            back: body.csvBackImages,
          });
        }
        setTotalTargets(body.totalTargets);
        collected.push(...body.results);
        setResults([...collected]);
        setScannedTargets(Math.min(body.totalTargets, body.offset + body.results.length));
        offset = body.nextOffset;
      }

      const safeCount = collected.filter((result) => result.status === "matched").length;
      const ambiguousCount = collected.filter((result) => result.status === "ambiguous").length;
      setMessage(
        `Scan complete: ${safeCount} safe match${safeCount === 1 ? "" : "es"}; ${ambiguousCount} ambiguous card${ambiguousCount === 1 ? "" : "s"} left untouched.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CollX image scan failed.");
    } finally {
      setBusy(null);
    }
  }

  async function applyMatches() {
    if (!matched.length || busy) return;
    setBusy("apply");
    setImportedCount(0);
    setFailures([]);
    setMessage("Copying safe front/back matches into Truely Collectables storage...");

    let completed = 0;
    const collectedFailures: ApplyFailure[] = [];

    try {
      const batches = chunk(
        matched.map((match) => ({
          method: match.method,
          inventoryItemId: match.target.inventoryItemId,
          legacyProductId: match.target.legacyProductId,
          row: match.row,
        })),
        6,
      );

      for (const batch of batches) {
        const response = await fetch("/api/admin/collx-image-import?mode=apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ matches: batch }),
          cache: "no-store",
        });
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`Import batch failed with HTTP ${response.status}.`);
        completed += Array.isArray(body.applied) ? body.applied.length : 0;
        if (Array.isArray(body.failed)) collectedFailures.push(...body.failed);
        setImportedCount(completed);
        setFailures([...collectedFailures]);
        if (!response.ok && response.status !== 207) {
          throw new Error(body.error || `Import batch failed with HTTP ${response.status}.`);
        }
      }

      setMessage(
        collectedFailures.length
          ? `Imported ${completed} matched card${completed === 1 ? "" : "s"}; ${collectedFailures.length} need retry/review.`
          : `Imported ${completed} matched card${completed === 1 ? "" : "s"}. CollX sale status, prices, quantities, and eBay listings were not changed.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CollX image import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-700">
              Image-only migration
            </p>
            <h2 className="mt-2 text-2xl font-black">Upload the CollX collection CSV</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
              This tool matches only existing eBay-backed Truely Collectables inventory. It never creates CollX-only products and never changes price, quantity, sold status, or marketplace availability.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-950">
            Front/back files are copied into our own storage before the site record is updated.
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="block">
            <span className="text-sm font-black">CollX CSV export</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={Boolean(busy)}
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setResults([]);
                setCsvStats(null);
                setMessage("");
                setImportedCount(0);
                setFailures([]);
              }}
              className="mt-2 block w-full rounded-2xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm font-bold file:mr-4 file:rounded-full file:border-0 file:bg-neutral-950 file:px-4 file:py-2 file:font-black file:text-white"
            />
          </label>
          <button
            type="button"
            onClick={scan}
            disabled={!file || Boolean(busy)}
            className="rounded-full bg-neutral-950 px-6 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "scan" ? "Scanning matches..." : "Scan Safe Matches"}
          </button>
        </div>

        {message ? (
          <p aria-live="polite" className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-sky-950">
            {message}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="CSV rows" value={csvStats ? csvStats.rows.toLocaleString() : "—"} />
        <Metric label="Front images" value={csvStats ? csvStats.front.toLocaleString() : "—"} />
        <Metric label="Back images" value={csvStats ? csvStats.back.toLocaleString() : "—"} />
        <Metric label="Site targets" value={totalTargets ? totalTargets.toLocaleString() : "—"} />
        <Metric label="Safe matches" value={matched.length.toLocaleString()} tone="emerald" />
        <Metric label="Ambiguous" value={ambiguous.length.toLocaleString()} tone="amber" />
      </section>

      {busy === "scan" && totalTargets > 0 ? (
        <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5">
          <p className="font-black text-sky-950">
            Scanned {scannedTargets.toLocaleString()} / {totalTargets.toLocaleString()} existing eBay-backed cards
          </p>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
            <div
              className="h-full bg-sky-600 transition-all"
              style={{ width: `${Math.min(100, (scannedTargets / totalTargets) * 100)}%` }}
            />
          </div>
        </section>
      ) : null}

      {results.length ? (
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">Preview complete</p>
              <h2 className="mt-2 text-2xl font-black">Apply only the proven matches</h2>
              <p className="mt-2 text-sm font-semibold text-neutral-600">
                {matched.length.toLocaleString()} safe matches · {matchedWithBack.toLocaleString()} include a back image · {ambiguous.length.toLocaleString()} ambiguous · {unmatched.length.toLocaleString()} unmatched.
              </p>
            </div>
            <button
              type="button"
              onClick={applyMatches}
              disabled={!matched.length || Boolean(busy)}
              className="rounded-full bg-emerald-700 px-6 py-3 text-sm font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "apply"
                ? `Imported ${importedCount.toLocaleString()} / ${matched.length.toLocaleString()}`
                : `Import ${matched.length.toLocaleString()} Safe Matches`}
            </button>
          </div>
        </section>
      ) : null}

      {failures.length ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-5 text-red-950">
          <h3 className="text-lg font-black">Import retries needed: {failures.length}</h3>
          <div className="mt-3 space-y-2 text-sm font-semibold">
            {failures.slice(0, 25).map((failure) => (
              <p key={`${failure.inventoryItemId}-${failure.collxId}`}>
                Product #{failure.legacyProductId} / CollX {failure.collxId}: {failure.error}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {(ambiguous.length || unmatched.length) ? (
        <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-black">Cards intentionally left untouched</h2>
          <p className="mt-2 text-sm font-semibold text-neutral-600">
            These are not guessed. Ambiguous duplicate physical copies stay here until there is enough evidence to prove which CollX photo belongs to which listing.
          </p>
          <div className="mt-5 space-y-3">
            {[...ambiguous, ...unmatched].slice(0, 50).map((result) => (
              <article key={result.target.inventoryItemId} className={`rounded-2xl border p-4 ${statusTone(result.status)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black">#{result.target.legacyProductId} · {result.target.title}</p>
                  <span className="rounded-full border border-current/20 px-3 py-1 text-xs font-black uppercase">
                    {result.status}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold">{result.reason}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "emerald" | "amber";
}) {
  const classes =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-neutral-200 bg-white text-neutral-950";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${classes}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-60">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}
