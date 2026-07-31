"use client";

import { useState } from "react";

type ImportResult = {
  ok?: boolean;
  error?: string;
  validatedOnly?: boolean;
  adapter?: { id?: string; version?: string };
  plan?: {
    release?: {
      manufacturer?: string;
      brand?: string | null;
      product?: string;
      releaseYear?: string | null;
      season?: string | null;
      sport?: string;
      league?: string | null;
    };
    validation?: {
      status?: string;
      counts?: {
        sets?: number;
        cards?: number;
        parallels?: number;
        identities?: number;
      };
      issues?: Array<{
        code?: string;
        severity?: string;
        message?: string;
        rowReference?: string | null;
      }>;
    };
    source?: {
      storage?: {
        sha256?: string;
        sizeBytes?: number;
        objectPath?: string;
      };
    };
  };
  persistence?: {
    releaseId?: string;
    sourceFileId?: string;
    versionId?: string;
    importRunId?: string;
    status?: string;
    idempotent?: boolean;
    counts?: Record<string, number>;
  } | null;
};

export default function ChecklistRegistryImporter() {
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [authority, setAuthority] = useState("manual_official_file");
  const [validateOnly, setValidateOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!sourceFile) {
      setError("Choose a checklist source file first.");
      return;
    }
    if (!sourceUrl.trim()) {
      setError("Record the official source URL or manual source reference.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.append("sourceFile", sourceFile);
      form.append("sourceUrl", sourceUrl.trim());
      form.append("authority", authority);
      form.append("validateOnly", String(validateOnly));
      form.append("redistributionAllowed", "false");

      const response = await fetch("/api/admin/instacomp/checklists/import", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as ImportResult;

      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Checklist Registry import failed.");
      }

      setResult(data);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Checklist Registry import failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  const counts = result?.plan?.validation?.counts;
  const issues = result?.plan?.validation?.issues || [];
  const release = result?.plan?.release;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">
          Official source intake
        </p>
        <h2 className="mt-1 text-2xl font-black">Validate, then import</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-neutral-600">
          The Registry accepts private Panini structured JSON and Pokémon TCG
          Data set bundles. New source adapters plug into the same neutral
          Registry without changing InstaComp.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block text-sm font-black">
            Checklist source file
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => setSourceFile(event.target.files?.[0] || null)}
              className="mt-2 block w-full rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-base"
            />
            <span className="mt-1 block break-all text-xs font-semibold text-neutral-500">
              {sourceFile?.name || "No file selected"}
            </span>
          </label>

          <label className="block text-sm font-black">
            Official URL or manual source reference
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder="https://manufacturer.example/checklist or manual://source-name"
              className="mt-1 min-h-12 w-full rounded-xl border border-neutral-300 px-3 text-base font-semibold"
            />
          </label>

          <label className="block text-sm font-black">
            Source authority
            <select
              value={authority}
              onChange={(event) => setAuthority(event.target.value)}
              className="mt-1 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base font-semibold"
            >
              <option value="manual_official_file">Official file uploaded manually</option>
              <option value="official_manufacturer">Official manufacturer URL</option>
              <option value="approved_distributor">Approved distributor</option>
            </select>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">
            <input
              type="checkbox"
              checked={validateOnly}
              onChange={(event) => setValidateOnly(event.target.checked)}
              className="mt-1 h-5 w-5"
            />
            <span>
              Validate only. Keep this checked for the first pass. Uncheck it only
              after the release, counts, and warnings look correct.
            </span>
          </label>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="mt-5 min-h-12 w-full rounded-xl bg-neutral-950 px-4 py-3 text-base font-black text-white disabled:opacity-60"
        >
          {loading
            ? "Processing checklist…"
            : validateOnly
              ? "Validate Checklist"
              : "Import into InstaComp Registry"}
        </button>

        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-black text-rose-800">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500">
          Registry receipt
        </p>
        <h2 className="mt-1 text-2xl font-black">
          {result ? "Checklist processed" : "Waiting for a checklist"}
        </h2>

        {!result ? (
          <p className="mt-3 rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5 text-sm font-semibold leading-6 text-neutral-600">
            Validation results, exact identity totals, source SHA-256, and the
            transactional database receipt will appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4">
              <p className="text-sm font-black text-cyan-950">
                {[release?.releaseYear || release?.season, release?.brand, release?.product]
                  .filter(Boolean)
                  .join(" ") || "Checklist release"}
              </p>
              <p className="mt-1 text-xs font-bold text-cyan-800">
                {[release?.sport, release?.league, release?.manufacturer]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ReceiptMetric label="Sets" value={counts?.sets} />
              <ReceiptMetric label="Cards" value={counts?.cards} />
              <ReceiptMetric label="Parallels" value={counts?.parallels} />
              <ReceiptMetric label="Exact identities" value={counts?.identities} />
            </div>

            <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
              <p className="font-black">
                {result.validatedOnly ? "Validation only" : "Database transaction complete"}
              </p>
              <p className="mt-1 break-all font-semibold text-neutral-600">
                SHA-256: {result.plan?.source?.storage?.sha256 || "—"}
              </p>
              {result.persistence ? (
                <p className="mt-1 break-all font-semibold text-neutral-600">
                  Version: {result.persistence.versionId || "—"} · Status:{" "}
                  {result.persistence.status || (result.persistence.idempotent ? "already imported" : "—")}
                </p>
              ) : null}
            </div>

            <div>
              <h3 className="font-black">Validation notices ({issues.length})</h3>
              <div className="mt-2 space-y-2">
                {issues.length ? (
                  issues.map((issue, index) => (
                    <div
                      key={`${issue.code}-${index}`}
                      className={`rounded-xl border p-3 text-sm font-semibold ${
                        issue.severity === "error"
                          ? "border-rose-200 bg-rose-50 text-rose-900"
                          : "border-amber-200 bg-amber-50 text-amber-950"
                      }`}
                    >
                      <strong>{issue.code || "notice"}</strong>: {issue.message}
                      {issue.rowReference ? (
                        <span className="mt-1 block text-xs opacity-75">
                          {issue.rowReference}
                        </span>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900">
                    No validation issues were returned.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ReceiptMetric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">{value ?? "—"}</p>
    </div>
  );
}
