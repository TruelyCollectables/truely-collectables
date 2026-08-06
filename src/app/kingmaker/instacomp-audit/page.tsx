"use client";

import { useCallback, useEffect, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type Candidate = {
  identityId: string | null;
  fingerprintSha256: string | null;
  year: string | null;
  manufacturer: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  player: string | null;
  parallel: string | null;
  variation: string | null;
  serialRun: number | null;
  isAuto: boolean | null;
  isRelic: boolean | null;
  team: string | null;
  sport: string | null;
};

type AuditItem = {
  inventoryItemId: string;
  title: string;
  sku: string | null;
  updatedAt: string | null;
  scanId: string | null;
  extractedInput: {
    year: string | null;
    manufacturer: string | null;
    player: string | null;
    cardNumber: string | null;
    parallel: string | null;
    serialNumber: string | null;
    isAuto: boolean | null;
    isRelic: boolean | null;
    variation: string | null;
  };
  originalScanEvidence: {
    macArchiveRead: boolean;
    archiveError: string | null;
    archiveStatus: string | null;
    archiveChecklistOutcome: string | null;
    archiveChecklistCandidateCount: number;
    archiveChecklistReasons: string[];
    archiveSourceReceipts: string[];
    modelEvidenceProvider: string | null;
    surfaceEvidence: string[];
    backEvidence: string | null;
    ocrProviderPersisted: boolean;
    ocrPersistenceNote: string;
  };
  freshRegistryAudit: {
    lookupAttempted: boolean;
    source: string;
    broadStatus: string;
    selectedStatus: string;
    registryReachable: boolean;
    broadCandidateCount: number;
    selectedCandidateCount: number;
    broadCandidates: Candidate[];
    selectedCandidates: Candidate[];
    parallelCandidates: string[];
    selectedMatch: Candidate | null;
    exactIdentityId: string | null;
    exactFingerprintSha256: string | null;
    broadReasons: string[];
    selectedReasons: string[];
  };
  identityPath: {
    memoryUsed: boolean;
    memorySource: string | null;
    currentSavedParallel: string | null;
    exactRegistryMatch: boolean;
  };
  diagnoses: string[];
};

type AuditPayload = {
  success: boolean;
  generatedAt: string;
  coverage: {
    authenticated: boolean;
    activeLiveVersions: number;
    activeLiveCards: number;
    lookupScope: string;
  };
  auditedCards: number;
  items: AuditItem[];
  nothingMutated: boolean;
  nothingPublished: boolean;
  error?: string;
};

function yesNo(value: boolean) {
  return value ? "YES" : "NO";
}

function show(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function badgeClass(ok: boolean) {
  return ok
    ? "bg-emerald-200 text-emerald-950"
    : "bg-red-200 text-red-950";
}

function CandidateTable({ candidates }: { candidates: Candidate[] }) {
  if (!candidates.length) {
    return <p className="font-bold text-red-800">No active/live Registry candidates were returned.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead>
          <tr className="bg-neutral-900 text-white">
            <th className="border border-neutral-700 p-2">Player</th>
            <th className="border border-neutral-700 p-2">Year / Set</th>
            <th className="border border-neutral-700 p-2">Card #</th>
            <th className="border border-neutral-700 p-2">Parallel / Variation</th>
            <th className="border border-neutral-700 p-2">Run</th>
            <th className="border border-neutral-700 p-2">Auto / Relic</th>
            <th className="border border-neutral-700 p-2">Registry ID</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => (
            <tr key={`${candidate.identityId || "candidate"}-${index}`} className="odd:bg-white even:bg-neutral-100">
              <td className="border border-neutral-300 p-2 font-bold">{show(candidate.player)}</td>
              <td className="border border-neutral-300 p-2">
                {show(candidate.year)} · {show(candidate.manufacturer || candidate.brand)} · {show(candidate.setName)}
              </td>
              <td className="border border-neutral-300 p-2 font-black">{show(candidate.cardNumber)}</td>
              <td className="border border-neutral-300 p-2">
                {show(candidate.parallel)}{candidate.variation ? ` · ${candidate.variation}` : ""}
              </td>
              <td className="border border-neutral-300 p-2">{candidate.serialRun ? `/${candidate.serialRun}` : "—"}</td>
              <td className="border border-neutral-300 p-2">
                {candidate.isAuto ? "AUTO" : "no auto"} · {candidate.isRelic ? "RELIC" : "no relic"}
              </td>
              <td className="max-w-56 break-all border border-neutral-300 p-2 font-mono">{show(candidate.identityId)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InstaCompAuditPage() {
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const runAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch(
        "/api/account/seller/inventory/instacomp-checklist-audit",
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: "no-store",
        },
      );
      const data = (await response.json()) as AuditPayload;
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Checklist audit failed.");
      }
      setPayload(data);
    } catch (nextError) {
      setPayload(null);
      setError(nextError instanceof Error ? nextError.message : "Checklist audit failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border-2 border-neutral-950 bg-white p-5 shadow-[6px_6px_0_#111]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-800">
                Kingmaker / Read-only diagnostics
              </p>
              <h1 className="mt-1 text-3xl font-black">InstaComp Checklist Audit Desk</h1>
              <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
                This page reads the Mac scan archive, performs a fresh query against every active/live Checklist Registry version, lists every matching card-number variant, and compares those candidates with the identity currently saved on the pending card. It does not reset, edit, price, publish, or delete anything.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runAudit()}
              disabled={loading}
              className="rounded-xl bg-violet-800 px-5 py-3 font-black text-white disabled:opacity-50"
            >
              {loading ? "Auditing…" : "Run Fresh Audit"}
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
            {error}
          </div>
        ) : null}

        {payload ? (
          <>
            <section className="mt-6 grid gap-4 md:grid-cols-4">
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">Registry authenticated</p>
                <p className="mt-2 text-3xl font-black">{yesNo(payload.coverage.authenticated)}</p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">Active/live versions</p>
                <p className="mt-2 text-3xl font-black">{payload.coverage.activeLiveVersions.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">Active/live card rows</p>
                <p className="mt-2 text-3xl font-black">{payload.coverage.activeLiveCards.toLocaleString()}</p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">Pending cards audited</p>
                <p className="mt-2 text-3xl font-black">{payload.auditedCards}</p>
              </div>
            </section>

            <div className="mt-4 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-950">
              Scope: {payload.coverage.lookupScope}. Nothing mutated: {yesNo(payload.nothingMutated)}. Nothing published: {yesNo(payload.nothingPublished)}.
            </div>

            <section className="mt-6 space-y-6">
              {payload.items.map((item) => {
                const registry = item.freshRegistryAudit;
                const input = item.extractedInput;
                const evidence = item.originalScanEvidence;
                const exact = registry.selectedStatus === "exact_match";
                return (
                  <article
                    key={item.inventoryItemId}
                    className="overflow-hidden rounded-2xl border-2 border-neutral-950 bg-white shadow-[6px_6px_0_#111]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-950 px-5 py-4 text-white">
                      <div>
                        <h2 className="text-xl font-black">{item.title}</h2>
                        <p className="mt-1 text-xs font-bold text-neutral-300">
                          {item.sku || item.inventoryItemId} · Scan {item.scanId || "missing"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(registry.lookupAttempted)}`}>
                          REGISTRY CALLED: {yesNo(registry.lookupAttempted)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(registry.registryReachable)}`}>
                          REACHABLE: {yesNo(registry.registryReachable)}
                        </span>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(exact)}`}>
                          EXACT MATCH: {yesNo(exact)}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-4 border-b-2 border-neutral-900 p-5 lg:grid-cols-3">
                      <section className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">Identity sent to Registry</h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div><dt className="inline font-bold">Year: </dt><dd className="inline">{show(input.year)}</dd></div>
                          <div><dt className="inline font-bold">Manufacturer: </dt><dd className="inline">{show(input.manufacturer)}</dd></div>
                          <div><dt className="inline font-bold">Player: </dt><dd className="inline">{show(input.player)}</dd></div>
                          <div><dt className="inline font-bold">Card number: </dt><dd className="inline font-black">{show(input.cardNumber)}</dd></div>
                          <div><dt className="inline font-bold">Saved parallel: </dt><dd className="inline">{show(input.parallel)}</dd></div>
                          <div><dt className="inline font-bold">Serial run: </dt><dd className="inline">{show(input.serialNumber)}</dd></div>
                          <div><dt className="inline font-bold">Auto / relic: </dt><dd className="inline">{show(input.isAuto)} / {show(input.isRelic)}</dd></div>
                        </dl>
                      </section>

                      <section className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">Original Mac receipt</h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div><dt className="inline font-bold">Archive read: </dt><dd className="inline">{yesNo(evidence.macArchiveRead)}</dd></div>
                          <div><dt className="inline font-bold">Status: </dt><dd className="inline">{show(evidence.archiveStatus)}</dd></div>
                          <div><dt className="inline font-bold">Checklist outcome: </dt><dd className="inline">{show(evidence.archiveChecklistOutcome)}</dd></div>
                          <div><dt className="inline font-bold">Saved candidate count: </dt><dd className="inline">{evidence.archiveChecklistCandidateCount}</dd></div>
                          <div><dt className="inline font-bold">Evidence reader: </dt><dd className="inline">{show(evidence.modelEvidenceProvider)}</dd></div>
                          <div><dt className="inline font-bold">Memory used: </dt><dd className="inline">{yesNo(item.identityPath.memoryUsed)} · {show(item.identityPath.memorySource)}</dd></div>
                        </dl>
                        {evidence.archiveError ? <p className="mt-2 font-bold text-red-800">{evidence.archiveError}</p> : null}
                      </section>

                      <section className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">Fresh Registry result</h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div><dt className="inline font-bold">Broad status: </dt><dd className="inline">{registry.broadStatus}</dd></div>
                          <div><dt className="inline font-bold">Selected status: </dt><dd className="inline">{registry.selectedStatus}</dd></div>
                          <div><dt className="inline font-bold">All variants: </dt><dd className="inline">{registry.broadCandidateCount}</dd></div>
                          <div><dt className="inline font-bold">Selected candidates: </dt><dd className="inline">{registry.selectedCandidateCount}</dd></div>
                          <div><dt className="inline font-bold">Exact identity ID: </dt><dd className="inline break-all font-mono">{show(registry.exactIdentityId)}</dd></div>
                        </dl>
                      </section>
                    </div>

                    <div className="border-b-2 border-neutral-900 p-5">
                      <h3 className="font-black">Parallel candidates in the active/live checklist</h3>
                      <p className="mt-2 font-bold text-violet-900">
                        {registry.parallelCandidates.join(" · ") || "No parallel candidates returned."}
                      </p>
                      <h3 className="mt-4 font-black">Surface and pattern evidence saved by the Mac</h3>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-semibold">
                        {evidence.surfaceEvidence.join(" · ") || "No surface-pattern evidence was persisted on this scan."}
                      </p>
                      <h3 className="mt-4 font-black">Diagnosis</h3>
                      <p className="mt-2 font-bold text-red-800">
                        {item.diagnoses.join(" · ") || "No audit blocker detected."}
                      </p>
                    </div>

                    <details className="border-b-2 border-neutral-900 p-5">
                      <summary className="cursor-pointer font-black">
                        Show every active/live card-number candidate
                      </summary>
                      <div className="mt-4">
                        <CandidateTable candidates={registry.broadCandidates} />
                      </div>
                    </details>

                    <details className="p-5">
                      <summary className="cursor-pointer font-black">Raw sanitized audit receipt</summary>
                      <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-neutral-950 p-4 text-xs text-neutral-100">
                        {JSON.stringify(item, null, 2)}
                      </pre>
                    </details>
                  </article>
                );
              })}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
