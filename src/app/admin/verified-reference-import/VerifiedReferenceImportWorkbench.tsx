"use client";

import { useMemo, useState } from "react";

type ImportResult = {
  recordId?: string;
  status?: string;
  assetId?: string;
  inventoryItemId?: string;
  legacyProductId?: number;
  sku?: string;
  title?: string;
  graderVerificationStatus?: string;
  graderVerificationUrl?: string | null;
  editUrl?: string | null;
  error?: string;
  code?: string | null;
};

type ImportResponse = {
  success?: boolean;
  error?: string;
  code?: string;
  batch?: string;
  summary?: {
    received: number;
    created: number;
    skipped: number;
    failed: number;
  };
  pendingListingsUrl?: string;
  collectibleAssetsUrl?: string;
  results?: ImportResult[];
};

function statusTone(status: string | undefined) {
  if (status === "created") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "skipped_existing")
    return "border-sky-300 bg-sky-50 text-sky-900";
  return "border-rose-300 bg-rose-50 text-rose-900";
}

function verificationTone(status: string | undefined) {
  if (status === "verified")
    return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "not_applicable")
    return "border-neutral-300 bg-neutral-100 text-neutral-800";
  return "border-amber-300 bg-amber-50 text-amber-900";
}

export default function VerifiedReferenceImportWorkbench() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<ImportResponse | null>(null);
  const [error, setError] = useState("");

  const canImport = Boolean(file && !busy);
  const results = response?.results || [];
  const createdResults = useMemo(
    () => results.filter((result) => result.status === "created"),
    [results],
  );

  async function importFile() {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResponse(null);

    const form = new FormData();
    form.append("verifiedReferenceFile", file);

    try {
      const result = await fetch("/api/admin/verified-reference-import", {
        method: "POST",
        body: form,
      });
      const data = (await result.json().catch(() => ({}))) as ImportResponse;
      if (!result.ok) {
        throw new Error(data.error || "Verified-reference import failed.");
      }
      setResponse(data);
    } catch (caught: any) {
      setError(caught?.message || "Verified-reference import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-neutral-900 bg-white p-6 shadow-xl shadow-neutral-950/5">
        <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-700">
              Cold concrete import
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">
              Put human-verified cards into Pending Listings.
            </h2>
            <p className="mt-3 max-w-3xl font-semibold leading-7 text-neutral-700">
              Upload the JSON exported from the InstaComp grading site. The file
              already contains each approved front/back scan and final identity.
              Importing creates private draft inventory rows with price set to
              pending. Nothing is published automatically.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "Exact copy stamp stays private and permanent",
                "Grading company, grade and cert number survive the sale",
                "PSA certs are checked against PSA's official cert page",
                "Sold cards remain as post-sale market-tracking assets",
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm font-bold"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border-2 border-dashed border-neutral-400 bg-neutral-50 p-5">
            <label className="block text-sm font-black">
              Verified-reference JSON
              <input
                type="file"
                accept="application/json,.json"
                className="mt-3 block w-full rounded-xl border border-neutral-300 bg-white p-3 text-sm"
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  setResponse(null);
                  setError("");
                }}
              />
            </label>
            <p className="mt-3 break-all text-xs font-semibold text-neutral-600">
              {file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : "No file selected"}
            </p>
            <button
              type="button"
              disabled={!canImport}
              onClick={() => void importFile()}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-neutral-950 bg-emerald-400 px-5 py-3 font-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Creating pending listings..." : "Import to Pending Listings"}
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border-2 border-rose-400 bg-rose-50 p-5 font-bold text-rose-900">
          {error}
        </section>
      ) : null}

      {response?.summary ? (
        <section className="rounded-3xl border border-neutral-900 bg-neutral-950 p-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">
                Import finished
              </p>
              <h2 className="mt-2 text-3xl font-black">
                {response.summary.created} new pending listing
                {response.summary.created === 1 ? "" : "s"} created
              </h2>
              <p className="mt-2 font-semibold text-neutral-300">
                {response.summary.skipped} already existed · {response.summary.failed} failed
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <a
                href={response.pendingListingsUrl || "/seller/inventory?status=draft"}
                className="rounded-full bg-emerald-300 px-5 py-3 text-sm font-black text-neutral-950"
              >
                Open Pending Listings
              </a>
              <a
                href={response.collectibleAssetsUrl || "/seller/collectible-assets"}
                className="rounded-full border border-white/20 bg-white/10 px-5 py-3 text-sm font-black"
              >
                Open Collectible Lifecycle
              </a>
            </div>
          </div>
        </section>
      ) : null}

      {results.length > 0 ? (
        <section className="space-y-3">
          {results.map((result, index) => (
            <article
              key={`${result.recordId || index}-${index}`}
              className={`rounded-2xl border-2 p-5 ${statusTone(result.status)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em]">
                    {result.status?.replaceAll("_", " ") || "unknown"}
                  </p>
                  <h3 className="mt-1 text-xl font-black">
                    {result.title || result.recordId || `Card ${index + 1}`}
                  </h3>
                  {result.sku ? (
                    <p className="mt-1 text-sm font-bold">SKU: {result.sku}</p>
                  ) : null}
                  {result.error ? (
                    <p className="mt-2 text-sm font-bold">{result.error}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {result.graderVerificationStatus ? (
                    <span
                      className={`rounded-full border px-3 py-2 text-xs font-black uppercase ${verificationTone(
                        result.graderVerificationStatus,
                      )}`}
                    >
                      Grader: {result.graderVerificationStatus.replaceAll("_", " ")}
                    </span>
                  ) : null}
                  {result.graderVerificationUrl ? (
                    <a
                      href={result.graderVerificationUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-current px-3 py-2 text-xs font-black"
                    >
                      Official cert page
                    </a>
                  ) : null}
                  {result.editUrl ? (
                    <a
                      href={result.editUrl}
                      className="rounded-full border border-current px-3 py-2 text-xs font-black"
                    >
                      Open draft
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {createdResults.some(
        (result) =>
          result.graderVerificationStatus &&
          !["verified", "not_applicable"].includes(
            result.graderVerificationStatus,
          ),
      ) ? (
        <section className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-sm font-bold leading-6 text-amber-950">
          A graded card whose official lookup failed or conflicted remains a
          private draft and is blocked from activation until the grader
          evidence is resolved.
        </section>
      ) : null}
    </div>
  );
}
