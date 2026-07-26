"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DUCK_AI_FREE_MODELS,
  DUCK_AI_URL,
  buildDuckAiCardPrompt,
  compareDuckAiIdentity,
  parseDuckAiResponse,
  parseInstaCompBaseline,
  type DuckAiFieldComparison,
  type DuckAiIdentity,
  type DuckAiModel,
} from "@/src/lib/instacomp-duckai";

const STORAGE_KEY = "tcos-instacomp-duck-ai-witness-v1";

type SavedWitness = {
  id: string;
  createdAt: string;
  model: string;
  frontFile: FileProof | null;
  backFile: FileProof | null;
  baseline: DuckAiIdentity;
  witness: DuckAiIdentity;
  comparison: DuckAiFieldComparison[];
  summary: {
    agree: number;
    disagree: number;
    instaCompOnly: number;
    duckOnly: number;
    missingBoth: number;
  };
  rawResponse: string;
};

type FileProof = {
  name: string;
  type: string;
  size: number;
  sha256: string;
};

function comparisonTone(status: DuckAiFieldComparison["status"]) {
  if (status === "agree") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (status === "disagree") return "border-rose-200 bg-rose-50 text-rose-900";
  if (status === "duck_only") return "border-sky-200 bg-sky-50 text-sky-900";
  if (status === "instacomp_only") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-neutral-200 bg-neutral-100 text-neutral-600";
}

function fieldLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function summaryFor(comparison: DuckAiFieldComparison[]) {
  return comparison.reduce(
    (summary, row) => {
      if (row.status === "agree") summary.agree += 1;
      if (row.status === "disagree") summary.disagree += 1;
      if (row.status === "instacomp_only") summary.instaCompOnly += 1;
      if (row.status === "duck_only") summary.duckOnly += 1;
      if (row.status === "missing_both") summary.missingBoth += 1;
      return summary;
    },
    { agree: 0, disagree: 0, instaCompOnly: 0, duckOnly: 0, missingBoth: 0 },
  );
}

async function hashFile(file: File | null): Promise<FileProof | null> {
  if (!file) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    sha256,
  };
}

function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadSavedWitnesses() {
  if (typeof window === "undefined") return [] as SavedWitness[];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as SavedWitness[]) : [];
  } catch {
    return [] as SavedWitness[];
  }
}

export default function DuckAiWitness() {
  const [model, setModel] = useState<DuckAiModel>("gpt-oss-120b");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [baselineText, setBaselineText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [witness, setWitness] = useState<DuckAiIdentity | null>(null);
  const [comparison, setComparison] = useState<DuckAiFieldComparison[]>([]);
  const [savedWitnesses, setSavedWitnesses] = useState<SavedWitness[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSavedWitnesses(loadSavedWitnesses());
  }, []);

  const prompt = useMemo(
    () =>
      buildDuckAiCardPrompt({
        model,
        instaCompContext: baselineText,
        frontFileName: frontFile?.name,
        backFileName: backFile?.name,
      }),
    [backFile?.name, baselineText, frontFile?.name, model],
  );

  const summary = useMemo(() => summaryFor(comparison), [comparison]);

  async function copyPrompt() {
    setError("");
    try {
      await navigator.clipboard.writeText(prompt);
      setMessage("Exact card prompt copied. Open Duck.ai, upload the same front/back scans, and paste the prompt.");
    } catch {
      setError("The browser could not copy the Duck.ai prompt.");
    }
  }

  function parseAndCompare() {
    setError("");
    setMessage("");
    try {
      const nextWitness = parseDuckAiResponse(responseText);
      const baseline = parseInstaCompBaseline(baselineText);
      const nextComparison = compareDuckAiIdentity(baseline, nextWitness);
      setWitness(nextWitness);
      setComparison(nextComparison);
      const nextSummary = summaryFor(nextComparison);
      setMessage(
        nextSummary.disagree > 0
          ? `Duck.ai found ${nextSummary.disagree} disagreement${nextSummary.disagree === 1 ? "" : "s"}. Keep the card in review until the scans or checklist settle them.`
          : `Duck.ai parsed successfully with ${nextSummary.agree} agreeing field${nextSummary.agree === 1 ? "" : "s"}.`,
      );
    } catch (caught) {
      setWitness(null);
      setComparison([]);
      setError(caught instanceof Error ? caught.message : "Duck.ai response could not be parsed.");
    }
  }

  async function saveWitness() {
    if (!witness || comparison.length === 0) {
      setError("Parse and compare the Duck.ai response before saving it.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const record: SavedWitness = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        model,
        frontFile: await hashFile(frontFile),
        backFile: await hashFile(backFile),
        baseline: parseInstaCompBaseline(baselineText),
        witness,
        comparison,
        summary,
        rawResponse: responseText,
      };
      const next = [record, ...savedWitnesses].slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedWitnesses(next);
      setMessage("Duck.ai witness saved locally with scan hashes and disagreement evidence.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Duck.ai witness could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function exportLedger() {
    if (savedWitnesses.length === 0) {
      setError("No Duck.ai witness records have been saved yet.");
      return;
    }
    downloadJson(`instacomp-duck-ai-witness-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, {
      schema: "tcos.instacomp.duckAiManualWitnessLedger.v1",
      exportedAt: new Date().toISOString(),
      recordCount: savedWitnesses.length,
      records: savedWitnesses,
    });
    setMessage("Duck.ai witness ledger downloaded.");
    setError("");
  }

  function clearLedger() {
    if (!window.confirm("Delete all locally saved Duck.ai witness records from this browser?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setSavedWitnesses([]);
    setMessage("Duck.ai witness history cleared from this browser.");
    setError("");
  }

  return (
    <section className="mt-7 overflow-hidden rounded-3xl border-2 border-sky-300 bg-white shadow-sm">
      <div className="border-b border-sky-200 bg-gradient-to-r from-sky-950 via-slate-950 to-emerald-950 p-5 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">
              AI council · manual external witness
            </p>
            <h2 className="mt-1 text-3xl font-black">Duck.ai Referee Lane</h2>
            <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-slate-200">
              Duck.ai does not expose a documented production API, so this lane uses its free browser models without scraping or hidden automation. Upload the same scans there, paste the exact prompt, then bring the JSON answer back for field-by-field disagreement detection.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={DUCK_AI_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-sky-300 px-4 py-2 text-sm font-black text-slate-950 hover:bg-sky-200"
            >
              Open Duck.ai
            </a>
            <button
              type="button"
              onClick={exportLedger}
              className="rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm font-black hover:bg-white/15"
            >
              Export {savedWitnesses.length} Witness Records
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm font-semibold leading-6 text-sky-950">
            <b>Workflow:</b> select a Duck.ai model → attach the same front/back scans here and in Duck.ai → paste the current InstaComp JSON → copy the prompt → paste Duck.ai&apos;s JSON response back → compare → save the witness record. Duck.ai never silently overrides verified identity.
          </div>

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Duck.ai model used
            </span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value as DuckAiModel)}
              className="mt-2 min-h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base font-bold"
            >
              {DUCK_AI_FREE_MODELS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              <option value="Other / changed">Other / changed</option>
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4">
              <span className="block text-sm font-black">Front scan</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-3 block w-full text-sm"
                onChange={(event) => setFrontFile(event.target.files?.[0] || null)}
              />
              <span className="mt-2 block break-all text-xs font-semibold text-neutral-500">
                {frontFile ? `${frontFile.name} · ${(frontFile.size / 1024 / 1024).toFixed(2)} MB` : "Not attached"}
              </span>
            </label>
            <label className="rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-4">
              <span className="block text-sm font-black">Back scan</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="mt-3 block w-full text-sm"
                onChange={(event) => setBackFile(event.target.files?.[0] || null)}
              />
              <span className="mt-2 block break-all text-xs font-semibold text-neutral-500">
                {backFile ? `${backFile.name} · ${(backFile.size / 1024 / 1024).toFixed(2)} MB` : "Not attached"}
              </span>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Current InstaComp result or card context
            </span>
            <textarea
              value={baselineText}
              onChange={(event) => setBaselineText(event.target.value)}
              placeholder='Paste the current InstaComp scan JSON, for example: {"ai":{"player":"...","year":"..."}}'
              className="mt-2 min-h-52 w-full rounded-xl border border-neutral-300 p-3 font-mono text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="min-h-12 rounded-xl border-2 border-neutral-950 bg-yellow-300 px-5 font-black"
            >
              Copy Exact Duck.ai Prompt
            </button>
            <a
              href={DUCK_AI_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-12 items-center rounded-xl border-2 border-neutral-950 bg-neutral-950 px-5 font-black text-white"
            >
              Open Duck.ai & Upload Scans
            </a>
          </div>

          <details className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <summary className="cursor-pointer font-black">Preview exact prompt</summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-neutral-700">{prompt}</pre>
          </details>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-black uppercase tracking-[0.14em] text-neutral-500">
              Paste Duck.ai JSON response
            </span>
            <textarea
              value={responseText}
              onChange={(event) => setResponseText(event.target.value)}
              placeholder='Paste Duck.ai’s JSON object here. Markdown code fences are accepted.'
              className="mt-2 min-h-72 w-full rounded-xl border border-neutral-300 p-3 font-mono text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={parseAndCompare}
              disabled={!responseText.trim()}
              className="min-h-12 rounded-xl border-2 border-neutral-950 bg-sky-300 px-5 font-black disabled:opacity-40"
            >
              Parse & Compare
            </button>
            <button
              type="button"
              onClick={() => void saveWitness()}
              disabled={!witness || saving}
              className="min-h-12 rounded-xl border-2 border-neutral-950 bg-emerald-300 px-5 font-black disabled:opacity-40"
            >
              {saving ? "Hashing & Saving…" : "Save Witness Evidence"}
            </button>
            <button
              type="button"
              onClick={clearLedger}
              disabled={savedWitnesses.length === 0}
              className="min-h-12 rounded-xl border border-neutral-300 px-4 font-bold disabled:opacity-40"
            >
              Clear Local History
            </button>
          </div>

          {error ? (
            <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4 font-bold text-rose-900">{error}</div>
          ) : null}
          {message ? (
            <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 font-bold text-emerald-900">{message}</div>
          ) : null}

          {comparison.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-neutral-200">
              <div className="grid grid-cols-2 gap-2 border-b border-neutral-200 bg-neutral-950 p-4 text-white sm:grid-cols-5">
                <Metric label="Agree" value={summary.agree} tone="text-emerald-300" />
                <Metric label="Disagree" value={summary.disagree} tone="text-rose-300" />
                <Metric label="InstaComp only" value={summary.instaCompOnly} tone="text-amber-300" />
                <Metric label="Duck only" value={summary.duckOnly} tone="text-sky-300" />
                <Metric label="Missing both" value={summary.missingBoth} tone="text-neutral-300" />
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50">
                      <th className="px-4 py-3 text-xs font-black uppercase text-neutral-500">Field</th>
                      <th className="px-4 py-3 text-xs font-black uppercase text-neutral-500">InstaComp</th>
                      <th className="px-4 py-3 text-xs font-black uppercase text-neutral-500">Duck.ai</th>
                      <th className="px-4 py-3 text-xs font-black uppercase text-neutral-500">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((row) => (
                      <tr key={row.field} className="border-b border-neutral-100">
                        <td className="px-4 py-3 font-black">{fieldLabel(row.field)}</td>
                        <td className="px-4 py-3 font-semibold text-neutral-700">{row.instaCompValue || "—"}</td>
                        <td className="px-4 py-3 font-semibold text-neutral-700">{row.duckAiValue || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase ${comparisonTone(row.status)}`}>
                            {row.status.replaceAll("_", " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {witness ? (
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
              <p className="font-black">Duck.ai confidence: {witness.confidence === null ? "Not supplied" : `${Math.round(witness.confidence * 100)}%`}</p>
              <p className="mt-2"><b>Evidence:</b> {witness.evidence.length ? witness.evidence.join(" · ") : "None supplied"}</p>
              <p className="mt-2"><b>Unresolved:</b> {witness.unresolved.length ? witness.unresolved.join(" · ") : "None supplied"}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-sky-200 bg-sky-50 px-5 py-4 text-xs font-semibold leading-5 text-sky-950">
        Duck.ai is treated as an independent manual witness, not authoritative truth. Any disagreement stays review-required until the actual front/back scans, printed serial, slab cert, official checklist, or official grader record resolves it. Free Duck.ai usage has daily limits and model availability can change.
      </div>
    </section>
  );
}

function Metric(props: { label: string; value: number; tone: string }) {
  return (
    <div>
      <b className={`block text-2xl ${props.tone}`}>{props.value}</b>
      <span className="text-[11px] font-black uppercase tracking-wide text-neutral-300">{props.label}</span>
    </div>
  );
}
