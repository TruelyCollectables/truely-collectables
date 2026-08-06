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
  scanId: string | null;
  imageAudit: {
    images: Array<{
      url: string;
      altText: string | null;
      sortOrder: number;
      isPrimary: boolean;
    }>;
    frontImageUrl: string | null;
    backImageUrl: string | null;
    frontFound: boolean;
    backFound: boolean;
    distinctUrls: boolean;
    storedImageCount: number;
    readyForFreshImageAudit: boolean;
  };
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
    modelEvidenceProvider: string | null;
    surfaceEvidence: string[];
    backEvidence: string | null;
    ocrPersistenceNote: string;
  };
  freshRegistryAudit: {
    lookupAttempted: boolean;
    broadStatus: string;
    selectedStatus: string;
    registryReachable: boolean;
    broadCandidateCount: number;
    selectedCandidateCount: number;
    broadCandidates: Candidate[];
    selectedCandidates: Candidate[];
    parallelCandidates: string[];
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
  error?: string;
  generatedAt?: string;
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
};

type ImageAuditPayload = {
  success: boolean;
  error?: string | null;
  generatedAt?: string;
  inventoryItemId?: string;
  title?: string | null;
  imageAudit?: {
    frontImageUrl?: string | null;
    backImageUrl?: string | null;
    frontSha256?: string | null;
    backSha256?: string | null;
    readyForFreshImageAudit?: boolean;
    fetchedSuccessfully?: boolean;
  };
  scan?: {
    httpStatus?: number;
    ok?: boolean;
    scanId?: string | null;
    code?: string | null;
    error?: string | null;
    ai?: Record<string, unknown>;
    review?: unknown;
    checklist?: unknown;
    providerFailures?: unknown;
  };
  draftMutated?: boolean;
  nothingPublished?: boolean;
  macScanArchiveCreated?: boolean;
};

type ImageAuditState = {
  loading: boolean;
  error: string;
  payload: ImageAuditPayload | null;
};

function yesNo(value: boolean) {
  return value ? "YES" : "NO";
}

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  return String(value);
}

function badgeClass(value: boolean) {
  return value
    ? "bg-emerald-300 text-emerald-950"
    : "bg-red-200 text-red-950";
}

function identityValue(ai: Record<string, unknown> | undefined, ...keys: string[]) {
  if (!ai) return null;
  for (const key of keys) {
    const value = ai[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return value;
    }
  }
  return null;
}

function CandidateTable({ candidates }: { candidates: Candidate[] }) {
  if (!candidates.length) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-400 bg-neutral-50 p-4 font-bold">
        No active/live checklist candidates were returned.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="bg-neutral-900 text-white">
            <th className="border border-neutral-700 p-2">Year / set</th>
            <th className="border border-neutral-700 p-2">Player / card</th>
            <th className="border border-neutral-700 p-2">
              Parallel / variation
            </th>
            <th className="border border-neutral-700 p-2">Serial</th>
            <th className="border border-neutral-700 p-2">Attributes</th>
            <th className="border border-neutral-700 p-2">Identity ID</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate, index) => (
            <tr key={candidate.identityId || `${candidate.cardNumber}-${index}`}>
              <td className="border border-neutral-300 p-2">
                {show(candidate.year)} · {show(candidate.setName)}
              </td>
              <td className="border border-neutral-300 p-2">
                {show(candidate.player)} · #{show(candidate.cardNumber)}
              </td>
              <td className="border border-neutral-300 p-2">
                {show(candidate.parallel)}
                {candidate.variation ? ` · ${candidate.variation}` : ""}
              </td>
              <td className="border border-neutral-300 p-2">
                {candidate.serialRun ? `/${candidate.serialRun}` : "—"}
              </td>
              <td className="border border-neutral-300 p-2">
                {candidate.isAuto ? "AUTO" : "no auto"} ·{" "}
                {candidate.isRelic ? "RELIC" : "no relic"}
              </td>
              <td className="max-w-56 break-all border border-neutral-300 p-2 font-mono">
                {show(candidate.identityId)}
              </td>
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
  const [imageAudits, setImageAudits] = useState<
    Record<string, ImageAuditState>
  >({});

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
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Checklist audit failed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const runImageAudit = useCallback(async (item: AuditItem) => {
    setImageAudits((current) => ({
      ...current,
      [item.inventoryItemId]: {
        loading: true,
        error: "",
        payload: null,
      },
    }));

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch(
        "/api/account/seller/inventory/instacomp-checklist-audit",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ inventoryItemId: item.inventoryItemId }),
          cache: "no-store",
        },
      );
      const data = (await response.json()) as ImageAuditPayload;
      const failure =
        data.error ||
        data.scan?.error ||
        (!data.success ? `Image audit returned HTTP ${response.status}.` : "");
      setImageAudits((current) => ({
        ...current,
        [item.inventoryItemId]: {
          loading: false,
          error: failure || "",
          payload: data,
        },
      }));
    } catch (nextError) {
      setImageAudits((current) => ({
        ...current,
        [item.inventoryItemId]: {
          loading: false,
          error:
            nextError instanceof Error
              ? nextError.message
              : "Fresh image audit failed.",
          payload: null,
        },
      }));
    }
  }, []);

  useEffect(() => {
    void runAudit();
  }, [runAudit]);

  return (
    <main className="min-h-screen bg-neutral-100 px-3 py-5 text-neutral-950 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border-2 border-neutral-950 bg-white p-5 shadow-[6px_6px_0_#111]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-violet-800">
                Kingmaker / Real image diagnostics
              </p>
              <h1 className="mt-1 text-3xl font-black">
                InstaComp Front + Back Audit
              </h1>
              <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
                This page now loads the actual stored front and back pictures. A
                fresh image audit sends that exact pair through InstaComp without
                writing the result back to the draft, changing the price, or
                publishing anything.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void runAudit()}
              disabled={loading}
              className="rounded-xl bg-violet-800 px-5 py-3 font-black text-white disabled:opacity-50"
            >
              {loading ? "Loading images…" : "Reload Cards"}
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
            <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">
                  Registry authenticated
                </p>
                <p className="mt-2 text-3xl font-black">
                  {yesNo(payload.coverage.authenticated)}
                </p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">
                  Active/live versions
                </p>
                <p className="mt-2 text-3xl font-black">
                  {payload.coverage.activeLiveVersions.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">
                  Active/live card rows
                </p>
                <p className="mt-2 text-3xl font-black">
                  {payload.coverage.activeLiveCards.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border-2 border-neutral-900 bg-white p-4">
                <p className="text-xs font-black uppercase">
                  Pending cards loaded
                </p>
                <p className="mt-2 text-3xl font-black">
                  {payload.auditedCards}
                </p>
              </div>
            </section>

            <section className="mt-6 space-y-7">
              {payload.items.map((item) => {
                const registry = item.freshRegistryAudit;
                const input = item.extractedInput;
                const evidence = item.originalScanEvidence;
                const pair = item.imageAudit;
                const live = imageAudits[item.inventoryItemId];
                const liveAi = live?.payload?.scan?.ai;

                return (
                  <article
                    key={item.inventoryItemId}
                    className="overflow-hidden rounded-2xl border-2 border-neutral-950 bg-white shadow-[6px_6px_0_#111]"
                  >
                    <div className="bg-neutral-950 px-5 py-4 text-white">
                      <h2 className="text-xl font-black">{item.title}</h2>
                      <p className="mt-1 text-xs font-bold text-neutral-300">
                        {item.sku || item.inventoryItemId} · Historical scan{" "}
                        {item.scanId || "missing"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(
                            pair.readyForFreshImageAudit,
                          )}`}
                        >
                          FRONT + BACK READY:{" "}
                          {yesNo(pair.readyForFreshImageAudit)}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(
                            registry.lookupAttempted,
                          )}`}
                        >
                          REGISTRY CALLED: {yesNo(registry.lookupAttempted)}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(
                            registry.registryReachable,
                          )}`}
                        >
                          REACHABLE: {yesNo(registry.registryReachable)}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black ${badgeClass(
                            registry.selectedStatus === "exact_match",
                          )}`}
                        >
                          SAVED ID EXACT:{" "}
                          {yesNo(registry.selectedStatus === "exact_match")}
                        </span>
                      </div>
                    </div>

                    <section className="border-b-2 border-neutral-900 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-black">
                            Actual stored card images
                          </h3>
                          <p className="mt-1 text-sm font-semibold text-neutral-700">
                            Stored rows: {pair.storedImageCount}. Front found:{" "}
                            {yesNo(pair.frontFound)}. Back found:{" "}
                            {yesNo(pair.backFound)}. Distinct URLs:{" "}
                            {yesNo(pair.distinctUrls)}.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runImageAudit(item)}
                          disabled={
                            !pair.readyForFreshImageAudit ||
                            live?.loading === true
                          }
                          className="rounded-xl bg-sky-700 px-5 py-3 font-black text-white disabled:bg-neutral-400"
                        >
                          {live?.loading
                            ? "Scanning real images…"
                            : "Run Fresh Front + Back Audit"}
                        </button>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {(
                          [
                            ["FRONT", pair.frontImageUrl],
                            ["BACK", pair.backImageUrl],
                          ] as const
                        ).map(([label, url]) => (
                          <figure
                            key={label}
                            className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3"
                          >
                            <figcaption className="mb-2 text-center text-sm font-black">
                              {label}
                            </figcaption>
                            <div className="flex min-h-72 items-center justify-center">
                              {url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={url}
                                  alt={`${item.title} ${label.toLowerCase()}`}
                                  className="max-h-[34rem] max-w-full object-contain"
                                />
                              ) : (
                                <p className="font-black text-red-800">
                                  {label} IMAGE MISSING
                                </p>
                              )}
                            </div>
                          </figure>
                        ))}
                      </div>

                      {!pair.readyForFreshImageAudit ? (
                        <div className="mt-4 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
                          This card cannot run a real image audit until one
                          distinct stored front and one distinct stored back are
                          available.
                        </div>
                      ) : null}
                    </section>

                    {live ? (
                      <section className="border-b-2 border-neutral-900 bg-sky-50 p-5">
                        <h3 className="text-xl font-black">
                          Fresh image-scan receipt
                        </h3>
                        {live.error ? (
                          <div className="mt-3 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
                            {live.error}
                          </div>
                        ) : null}

                        {live.payload ? (
                          <>
                            <div className="mt-4 grid gap-3 md:grid-cols-3">
                              <div className="rounded-xl border border-neutral-400 bg-white p-3">
                                <p className="text-xs font-black uppercase">
                                  Draft changed
                                </p>
                                <p className="mt-1 text-2xl font-black">
                                  {yesNo(live.payload.draftMutated === true)}
                                </p>
                              </div>
                              <div className="rounded-xl border border-neutral-400 bg-white p-3">
                                <p className="text-xs font-black uppercase">
                                  Scan ID
                                </p>
                                <p className="mt-1 break-all font-mono text-sm font-black">
                                  {show(live.payload.scan?.scanId)}
                                </p>
                              </div>
                              <div className="rounded-xl border border-neutral-400 bg-white p-3">
                                <p className="text-xs font-black uppercase">
                                  Scan completed
                                </p>
                                <p className="mt-1 text-2xl font-black">
                                  {yesNo(live.payload.success)}
                                </p>
                              </div>
                            </div>

                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <section className="rounded-xl border-2 border-neutral-800 bg-white p-4">
                                <h4 className="font-black">
                                  Identity read from the real images
                                </h4>
                                <dl className="mt-3 space-y-1 text-sm">
                                  <div>
                                    <dt className="inline font-bold">
                                      Player:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "player",
                                          "playerName",
                                        ),
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">Year: </dt>
                                    <dd className="inline">
                                      {show(identityValue(liveAi, "year"))}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Brand / set:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "brand",
                                          "manufacturer",
                                        ),
                                      )}{" "}
                                      ·{" "}
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "setName",
                                          "set",
                                        ),
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Card number:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "cardNumber",
                                          "card_number",
                                        ),
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Parallel:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "parallel",
                                          "parallelName",
                                        ),
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Serial / print run:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(
                                        identityValue(
                                          liveAi,
                                          "serialNumber",
                                          "printRun",
                                        ),
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                              </section>

                              <section className="rounded-xl border-2 border-neutral-800 bg-white p-4">
                                <h4 className="font-black">Image proof</h4>
                                <dl className="mt-3 space-y-1 text-sm">
                                  <div>
                                    <dt className="inline font-bold">
                                      Front SHA-256:{" "}
                                    </dt>
                                    <dd className="inline break-all font-mono">
                                      {show(
                                        live.payload.imageAudit?.frontSha256,
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Back SHA-256:{" "}
                                    </dt>
                                    <dd className="inline break-all font-mono">
                                      {show(
                                        live.payload.imageAudit?.backSha256,
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      HTTP status:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(live.payload.scan?.httpStatus)}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="inline font-bold">
                                      Error code:{" "}
                                    </dt>
                                    <dd className="inline">
                                      {show(live.payload.scan?.code)}
                                    </dd>
                                  </div>
                                </dl>
                              </section>
                            </div>

                            <details className="mt-4 rounded-xl border border-neutral-500 bg-white p-4">
                              <summary className="cursor-pointer font-black">
                                Raw fresh image-audit receipt
                              </summary>
                              <pre className="mt-3 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-950 p-4 text-xs text-white">
                                {JSON.stringify(live.payload, null, 2)}
                              </pre>
                            </details>
                          </>
                        ) : null}
                      </section>
                    ) : null}

                    <section className="grid gap-4 border-b-2 border-neutral-900 p-5 lg:grid-cols-3">
                      <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">
                          Previously saved identity
                        </h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div>
                            <dt className="inline font-bold">Year: </dt>
                            <dd className="inline">{show(input.year)}</dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Manufacturer:{" "}
                            </dt>
                            <dd className="inline">
                              {show(input.manufacturer)}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">Player: </dt>
                            <dd className="inline">{show(input.player)}</dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Card number:{" "}
                            </dt>
                            <dd className="inline font-black">
                              {show(input.cardNumber)}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Saved parallel:{" "}
                            </dt>
                            <dd className="inline">
                              {show(input.parallel)}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">
                          Historical Mac receipt
                        </h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div>
                            <dt className="inline font-bold">
                              Archive read:{" "}
                            </dt>
                            <dd className="inline">
                              {yesNo(evidence.macArchiveRead)}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">Status: </dt>
                            <dd className="inline">
                              {show(evidence.archiveStatus)}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Checklist outcome:{" "}
                            </dt>
                            <dd className="inline">
                              {show(evidence.archiveChecklistOutcome)}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Saved candidates:{" "}
                            </dt>
                            <dd className="inline">
                              {evidence.archiveChecklistCandidateCount}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-3 text-xs font-semibold text-neutral-600">
                          {evidence.ocrPersistenceNote}
                        </p>
                      </div>

                      <div className="rounded-xl border border-neutral-300 bg-neutral-50 p-4">
                        <h3 className="font-black">
                          Current Registry query
                        </h3>
                        <dl className="mt-3 space-y-1 text-sm">
                          <div>
                            <dt className="inline font-bold">
                              Broad status:{" "}
                            </dt>
                            <dd className="inline">
                              {registry.broadStatus}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Saved identity status:{" "}
                            </dt>
                            <dd className="inline">
                              {registry.selectedStatus}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              All variants:{" "}
                            </dt>
                            <dd className="inline">
                              {registry.broadCandidateCount}
                            </dd>
                          </div>
                          <div>
                            <dt className="inline font-bold">
                              Exact identity ID:{" "}
                            </dt>
                            <dd className="inline break-all font-mono">
                              {show(registry.exactIdentityId)}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    </section>

                    <section className="border-b-2 border-neutral-900 p-5">
                      <h3 className="font-black">
                        Parallel candidates in active/live checklists
                      </h3>
                      <p className="mt-2 font-bold text-violet-900">
                        {registry.parallelCandidates.join(" · ") ||
                          "No parallel candidates returned."}
                      </p>
                      <h3 className="mt-4 font-black">Diagnosis</h3>
                      <p className="mt-2 font-bold text-red-800">
                        {item.diagnoses.join(" · ") ||
                          "No audit blocker detected."}
                      </p>
                    </section>

                    <details className="p-5">
                      <summary className="cursor-pointer font-black">
                        Show every active/live candidate
                      </summary>
                      <div className="mt-4">
                        <CandidateTable candidates={registry.broadCandidates} />
                      </div>
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
