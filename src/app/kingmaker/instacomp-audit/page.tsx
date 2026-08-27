"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchWithAccountSession } from "../../account/account-session";

type JsonRecord = Record<string, unknown>;

type WorkbenchItem = {
  inventoryItemId: string;
  title: string;
  sku: string | null;
  updatedAt: string | null;
  imageAudit: {
    frontImageUrl: string | null;
    backImageUrl: string | null;
    frontFound: boolean;
    backFound: boolean;
    distinctUrls: boolean;
    storedImageCount: number;
    readyForAutomaticScan: boolean;
  };
  identity: {
    identityComplete: boolean;
    locked: boolean;
    humanVerified: boolean;
    trustedForIdentity: boolean;
    savedAt: string | null;
    source: string | null;
    player: string | null;
    year: string | null;
    manufacturer: string | null;
    setName: string | null;
    cardNumber: string | null;
    parallel: string | null;
    variation: string | null;
    serialNumber: string | null;
    sport: string | null;
    team: string | null;
    isAuto: boolean;
    isRelic: boolean;
  };
  orientation: {
    persisted: boolean;
    status: string | null;
    model: string | null;
    frontRotation: number;
    backRotation: number;
    frontConfidence: number;
    backConfidence: number;
    frontEvidenceText: string[];
    backEvidenceText: string[];
    reason: string | null;
  };
  checklist: {
    status: string | null;
    candidateCount: number;
    reasons: string[];
    candidateIdentityIds: string[];
    parallelStatus: string | null;
    selectedParallel: string | null;
    parallelConfidence: number;
    parallelEvidence: string | null;
    candidateParallels: string[];
  };
  scan: {
    scanId: string | null;
    lastStatus: string | null;
    lastStage: string | null;
    lastError: string | null;
    lastErrorCode: string | null;
    pricingStatus: string | null;
    pricingReason: string | null;
    learningPromotion: JsonRecord;
  };
};

type WorkbenchPayload = {
  success: boolean;
  error?: string;
  generatedAt: string;
  durationMs: number;
  limit: number;
  coverage: {
    available: boolean;
    activeLiveVersions: number;
    activeLiveCards: number;
    error: string | null;
  };
  items: WorkbenchItem[];
};

type EditForm = {
  title: string;
  player: string;
  year: string;
  manufacturer: string;
  setName: string;
  cardNumber: string;
  parallel: string;
  variation: string;
  serialNumber: string;
  sport: string;
  team: string;
  isAuto: boolean;
  isRelic: boolean;
};

type DiagnosticReceipt = {
  success?: boolean;
  error?: string | null;
  imageAudit?: {
    frontSha256?: string | null;
    backSha256?: string | null;
  };
  scan?: {
    httpStatus?: number;
    ok?: boolean;
    scanId?: string | null;
    code?: string | null;
    error?: string | null;
    ai?: JsonRecord;
  };
};

type ActionState = {
  busy: "auto" | "save" | "unlock" | "diagnostic" | null;
  notice: string;
  error: string;
  diagnostic: DiagnosticReceipt | null;
};

const WORKBENCH_URL =
  "/api/account/seller/inventory/instacomp-kingmaker";
const MANUAL_URL =
  "/api/account/seller/inventory/instacomp-manual-identity";
const AUTO_SCAN_URL =
  "/api/account/seller/inventory/instacomp-front-back";
const DIAGNOSTIC_URL =
  "/api/account/seller/inventory/instacomp-checklist-audit";

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function inferPlayer(title: string, cardNumber: string) {
  const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return "";
  return (
    new RegExp(
      `#${escaped}\\s+(.+?)(?=\\s+(?:Base|Silver|Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White|Cracked|Velocity|Wave|Auto|Autograph|Rookie|RC)\\b|$)`,
      "i",
    ).exec(title)?.[1]?.trim() || ""
  );
}

function inferSetName(title: string, manufacturer: string) {
  const raw = /^\d{4}\s+(.+?)\s+#/i.exec(title)?.[1]?.trim() || "";
  if (!raw || !manufacturer) return raw;
  return raw.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").trim();
}

function inferSport(title: string) {
  if (/\bWNBA\b|\bNBA\b/i.test(title)) return "Basketball";
  if (/\bNFL\b|Football/i.test(title)) return "Football";
  if (/\bNHL\b|Hockey/i.test(title)) return "Hockey";
  if (/\bMLB\b|Bowman|Baseball/i.test(title)) return "Baseball";
  return "";
}

function formFromItem(item: WorkbenchItem): EditForm {
  const cardNumber = item.identity.cardNumber || "";
  const manufacturer = item.identity.manufacturer || "";
  return {
    title: item.title,
    player:
      item.identity.player || inferPlayer(item.title, cardNumber),
    year: item.identity.year || "",
    manufacturer,
    setName:
      item.identity.setName || inferSetName(item.title, manufacturer),
    cardNumber,
    parallel: item.identity.parallel || "",
    variation: item.identity.variation || "",
    serialNumber: item.identity.serialNumber || "",
    sport: item.identity.sport || inferSport(item.title),
    team: item.identity.team || "",
    isAuto: item.identity.isAuto,
    isRelic: item.identity.isRelic,
  };
}

function fieldClass() {
  return "min-h-11 w-full rounded-lg border-2 border-neutral-400 bg-white px-3 py-2 font-semibold focus:border-blue-700 focus:outline-none";
}

function percent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function valueFromAi(ai: JsonRecord | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = ai?.[key];
    if (value !== null && value !== undefined && text(value)) {
      return text(value);
    }
  }
  return "—";
}

async function requestJson<T extends JsonRecord>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchWithAccountSession(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let data: JsonRecord = {};
    try {
      data = raw ? (JSON.parse(raw) as JsonRecord) : {};
    } catch {
      throw new Error(
        `Server returned a non-JSON response with HTTP ${response.status}.`,
      );
    }
    if (!response.ok || data.success !== true) {
      throw new Error(
        text(data.error) || `Request failed with HTTP ${response.status}.`,
      );
    }
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request timed out before the server responded.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function InstaCompAuditPage() {
  const [payload, setPayload] = useState<WorkbenchPayload | null>(null);
  const [forms, setForms] = useState<Record<string, EditForm>>({});
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const data = await requestJson<WorkbenchPayload & JsonRecord>(
        WORKBENCH_URL,
        {},
        20_000,
      );
      setPayload(data);
      setForms((current) => {
        const next: Record<string, EditForm> = {};
        for (const item of data.items || []) {
          next[item.inventoryItemId] =
            current[item.inventoryItemId] || formFromItem(item);
        }
        return next;
      });
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "KINGMAKER failed to load.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function setAction(
    inventoryItemId: string,
    next: Partial<ActionState>,
  ) {
    setActions((current) => ({
      ...current,
      [inventoryItemId]: {
        ...(current[inventoryItemId] || {
          busy: null,
          notice: "",
          error: "",
          diagnostic: null,
        }),
        ...next,
      },
    }));
  }

  function updateForm(
    inventoryItemId: string,
    updater: (form: EditForm) => EditForm,
  ) {
    setForms((current) => {
      const form = current[inventoryItemId];
      if (!form) return current;
      return { ...current, [inventoryItemId]: updater(form) };
    });
  }

  async function runAutomaticScan(item: WorkbenchItem) {
    setAction(item.inventoryItemId, {
      busy: "auto",
      notice: "",
      error: "",
      diagnostic: null,
    });
    try {
      const data = await requestJson<JsonRecord>(
        AUTO_SCAN_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inventoryItemId: item.inventoryItemId }),
        },
        290_000,
      );
      const identityComplete = data.identityComplete === true;
      setAction(item.inventoryItemId, {
        busy: null,
        notice: identityComplete
          ? "Images were automatically oriented and one checklist identity was resolved."
          : "Images were automatically oriented. The checklist kept the parallel in review instead of assuming Base.",
        error: "",
      });
      setForms((current) => {
        const next = { ...current };
        delete next[item.inventoryItemId];
        return next;
      });
      await load();
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error:
          error instanceof Error
            ? error.message
            : "Automatic scan failed.",
      });
    }
  }

  async function saveAndLock(item: WorkbenchItem) {
    const form = forms[item.inventoryItemId];
    if (!form) return;
    if (!text(form.parallel)) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error:
          "Enter Base or the exact parallel before saving. Blank is never treated as Base.",
      });
      return;
    }
    setAction(item.inventoryItemId, {
      busy: "save",
      notice: "",
      error: "",
    });
    try {
      const data = await requestJson<JsonRecord>(MANUAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          inventoryItemId: item.inventoryItemId,
          title: form.title,
          identity: form,
        }),
      });
      const learning = data.learning as JsonRecord | undefined;
      setAction(item.inventoryItemId, {
        busy: null,
        notice:
          text(data.message) +
          (learning?.promoted === true
            ? " This correction was promoted to InstaComp learning."
            : learning?.attempted === true
              ? ` Learning warning: ${text(learning.error) || "promotion was not confirmed"}.`
              : ""),
        error: "",
      });
      setForms((current) => {
        const next = { ...current };
        delete next[item.inventoryItemId];
        return next;
      });
      await load();
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error:
          error instanceof Error ? error.message : "Identity save failed.",
      });
    }
  }

  async function unlock(item: WorkbenchItem) {
    setAction(item.inventoryItemId, {
      busy: "unlock",
      notice: "",
      error: "",
    });
    try {
      const data = await requestJson<JsonRecord>(MANUAL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "unlock",
          inventoryItemId: item.inventoryItemId,
        }),
      });
      setAction(item.inventoryItemId, {
        busy: null,
        notice: text(data.message) || "Identity unlocked.",
        error: "",
      });
      await load();
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error: error instanceof Error ? error.message : "Unlock failed.",
      });
    }
  }

  async function runDiagnostic(item: WorkbenchItem) {
    setAction(item.inventoryItemId, {
      busy: "diagnostic",
      notice: "",
      error: "",
      diagnostic: null,
    });
    try {
      const data = await requestJson<DiagnosticReceipt & JsonRecord>(
        DIAGNOSTIC_URL,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inventoryItemId: item.inventoryItemId }),
        },
        290_000,
      );
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "Read-only AI/checklist diagnostic completed.",
        error: "",
        diagnostic: data,
      });
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error:
          error instanceof Error ? error.message : "Diagnostic failed.",
        diagnostic: null,
      });
    }
  }

  const summary = useMemo(() => {
    const items = payload?.items || [];
    return {
      total: items.length,
      oriented: items.filter((item) => item.orientation.persisted).length,
      locked: items.filter((item) => item.identity.locked).length,
      review: items.filter(
        (item) =>
          item.identity.identityComplete !== true ||
          item.checklist.parallelStatus === "ambiguous",
      ).length,
    };
  }, [payload]);

  return (
    <main className="min-h-screen bg-neutral-100 px-3 py-5 text-neutral-950 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border-2 border-neutral-950 bg-neutral-950 p-5 text-white shadow-[7px_7px_0_#facc15]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-yellow-300">
            KINGMAKER · Automatic image and checklist review
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">
            Orient, Identify, Review & Lock
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-200">
            Front and back are oriented automatically from printed card text.
            Parallel identity is restricted to the card&apos;s live checklist
            identities. Uncertainty stays in review and never silently becomes Base.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-black">
              {summary.total} drafts
            </span>
            <span className="rounded-full bg-emerald-400 px-3 py-1 text-sm font-black text-emerald-950">
              {summary.oriented} auto-oriented
            </span>
            <span className="rounded-full bg-yellow-300 px-3 py-1 text-sm font-black text-neutral-950">
              {summary.locked} locked
            </span>
            <span className="rounded-full bg-orange-300 px-3 py-1 text-sm font-black text-neutral-950">
              {summary.review} need review
            </span>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-full border border-white px-4 py-1 text-sm font-black disabled:opacity-50"
            >
              {loading ? "Loading…" : "Reload cards"}
            </button>
          </div>
        </header>

        {payload?.coverage ? (
          <div className="mt-5 rounded-xl border-2 border-neutral-800 bg-white p-4 font-semibold">
            Checklist registry: {payload.coverage.available ? "READY" : "UNAVAILABLE"}
            {payload.coverage.available
              ? ` · ${payload.coverage.activeLiveVersions} active versions · ${payload.coverage.activeLiveCards} card rows`
              : payload.coverage.error
                ? ` · ${payload.coverage.error}`
                : ""}
            {payload.durationMs >= 0 ? ` · page data ${payload.durationMs}ms` : ""}
          </div>
        ) : null}

        {loading && !payload ? (
          <p className="mt-5 rounded-xl border-2 border-sky-700 bg-sky-50 p-4 font-black text-sky-950">
            Loading the fast KINGMAKER workbench…
          </p>
        ) : null}

        {pageError ? (
          <p className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
            {pageError}
          </p>
        ) : null}

        {!loading && !pageError && payload?.items.length === 0 ? (
          <p className="mt-5 rounded-xl border-2 border-neutral-700 bg-white p-4 font-black">
            No draft cards are waiting in KINGMAKER.
          </p>
        ) : null}

        <section className="mt-6 space-y-7">
          {(payload?.items || []).map((item) => {
            const form = forms[item.inventoryItemId];
            const action = actions[item.inventoryItemId];
            const locked = item.identity.locked;
            const diagnosticAi = action?.diagnostic?.scan?.ai;
            if (!form) return null;

            return (
              <article
                key={item.inventoryItemId}
                className="overflow-hidden rounded-2xl border-2 border-neutral-950 bg-white shadow-[6px_6px_0_#111]"
              >
                <div className="bg-neutral-950 px-5 py-4 text-white">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black">{form.title}</h2>
                      <p className="mt-1 text-xs font-bold text-neutral-300">
                        {item.sku || item.inventoryItemId}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-4 py-2 text-sm font-black ${
                        locked
                          ? "bg-yellow-300 text-neutral-950"
                          : item.identity.identityComplete
                            ? "bg-emerald-400 text-emerald-950"
                            : "bg-orange-300 text-orange-950"
                      }`}
                    >
                      {locked
                        ? "🔒 SAVED & LOCKED"
                        : item.identity.identityComplete
                          ? "IDENTITY RESOLVED"
                          : "IDENTITY REVIEW"}
                    </span>
                  </div>
                </div>

                {action?.notice ? (
                  <p className="border-b border-emerald-300 bg-emerald-50 p-4 font-black text-emerald-900">
                    {action.notice}
                  </p>
                ) : null}
                {action?.error ? (
                  <p className="border-b border-red-300 bg-red-50 p-4 font-black text-red-900">
                    {action.error}
                  </p>
                ) : null}

                <section className="border-b-2 border-neutral-900 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-2xl font-black">Card images</h3>
                      <p className="font-semibold text-neutral-600">
                        No manual rotation controls. Automatic scan reads the printed
                        writing on each side, normalizes the pixels, saves the pair,
                        and verifies the stored URLs.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runAutomaticScan(item)}
                      disabled={
                        Boolean(action?.busy) ||
                        locked ||
                        !item.imageAudit.readyForAutomaticScan
                      }
                      className="rounded-xl bg-blue-800 px-5 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      {action?.busy === "auto"
                        ? "Orienting + matching…"
                        : locked
                          ? "Unlock before automatic rescan"
                          : "Re-run Automatic Orientation + Checklist"}
                    </button>
                  </div>

                  <div className="mt-5 grid gap-5 md:grid-cols-2">
                    {(
                      [
                        ["front", item.imageAudit.frontImageUrl],
                        ["back", item.imageAudit.backImageUrl],
                      ] as const
                    ).map(([side, url]) => (
                      <figure
                        key={`${side}-${url || "missing"}`}
                        className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3"
                      >
                        <figcaption className="mb-2 text-center text-sm font-black uppercase">
                          {side}
                        </figcaption>
                        <div className="flex min-h-72 items-center justify-center">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={url}
                              src={url}
                              alt={`${form.title} ${side}`}
                              className="max-h-[34rem] max-w-full object-contain"
                            />
                          ) : (
                            <p className="font-black text-red-800">IMAGE MISSING</p>
                          )}
                        </div>
                      </figure>
                    ))}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border bg-neutral-50 p-4">
                      <p className="font-black">
                        Orientation: {item.orientation.persisted ? "SAVED" : "NOT RUN"}
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        Front {item.orientation.frontRotation}° · {percent(item.orientation.frontConfidence)} confidence
                      </p>
                      <p className="text-sm font-semibold">
                        Back {item.orientation.backRotation}° · {percent(item.orientation.backConfidence)} confidence
                      </p>
                      {item.orientation.reason ? (
                        <p className="mt-2 text-sm text-neutral-700">
                          {item.orientation.reason}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-xl border bg-neutral-50 p-4">
                      <p className="font-black">
                        Checklist: {item.checklist.status || "NOT RUN"}
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        Candidates: {item.checklist.candidateCount} · Parallel decision: {item.checklist.parallelStatus || "not run"}
                      </p>
                      {item.checklist.selectedParallel ? (
                        <p className="text-sm font-semibold">
                          Selected: {item.checklist.selectedParallel} · {percent(item.checklist.parallelConfidence)}
                        </p>
                      ) : null}
                      {item.checklist.parallelEvidence ? (
                        <p className="mt-2 text-sm text-neutral-700">
                          {item.checklist.parallelEvidence}
                        </p>
                      ) : null}
                      {item.checklist.candidateParallels.length ? (
                        <p className="mt-2 text-xs font-bold text-neutral-600">
                          Valid choices: {item.checklist.candidateParallels.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="border-b-2 border-neutral-900 p-5">
                  <h3 className="text-2xl font-black">Concrete identity</h3>
                  <p className="mt-1 font-semibold text-neutral-600">
                    Automatic identity must come from the checklist. Manual save is
                    explicit: enter Base or the exact parallel. Blank never means Base.
                  </p>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <label className="md:col-span-2 lg:col-span-3">
                      <span className="text-sm font-black">Listing title</span>
                      <input
                        value={form.title}
                        onChange={(event) =>
                          updateForm(item.inventoryItemId, (current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                        className={fieldClass()}
                      />
                    </label>
                    {(
                      [
                        ["Player", "player"],
                        ["Year", "year"],
                        ["Manufacturer", "manufacturer"],
                        ["Set", "setName"],
                        ["Card number", "cardNumber"],
                        ["Parallel", "parallel"],
                        ["Variation", "variation"],
                        ["Serial / print run", "serialNumber"],
                        ["Sport", "sport"],
                        ["Team", "team"],
                      ] as const
                    ).map(([label, key]) => (
                      <label key={key}>
                        <span className="text-sm font-black">{label}</span>
                        <input
                          value={form[key]}
                          onChange={(event) =>
                            updateForm(item.inventoryItemId, (current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          placeholder={
                            key === "parallel"
                              ? "Base or exact checklist parallel"
                              : ""
                          }
                          className={fieldClass()}
                        />
                      </label>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-5">
                    <label className="flex items-center gap-2 font-black">
                      <input
                        type="checkbox"
                        checked={form.isAuto}
                        onChange={(event) =>
                          updateForm(item.inventoryItemId, (current) => ({
                            ...current,
                            isAuto: event.target.checked,
                          }))
                        }
                        className="h-5 w-5"
                      />
                      Autograph
                    </label>
                    <label className="flex items-center gap-2 font-black">
                      <input
                        type="checkbox"
                        checked={form.isRelic}
                        onChange={(event) =>
                          updateForm(item.inventoryItemId, (current) => ({
                            ...current,
                            isRelic: event.target.checked,
                          }))
                        }
                        className="h-5 w-5"
                      />
                      Memorabilia / relic
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void saveAndLock(item)}
                      disabled={Boolean(action?.busy)}
                      className="min-h-12 rounded-xl bg-emerald-700 px-6 py-3 text-lg font-black text-white disabled:bg-neutral-400"
                    >
                      {action?.busy === "save"
                        ? "Saving + teaching…"
                        : "Save, Lock & Teach InstaComp"}
                    </button>
                    {locked ? (
                      <button
                        type="button"
                        onClick={() => void unlock(item)}
                        disabled={Boolean(action?.busy)}
                        className="min-h-12 rounded-xl border-2 border-red-800 bg-white px-5 py-3 font-black text-red-900 disabled:opacity-40"
                      >
                        Unlock for automatic rescan
                      </button>
                    ) : null}
                  </div>
                </section>

                <details className="p-5">
                  <summary className="cursor-pointer text-lg font-black">
                    Read-only diagnostic
                  </summary>
                  <p className="mt-2 font-semibold text-neutral-600">
                    This checks the stored pair without changing the draft.
                  </p>
                  <button
                    type="button"
                    onClick={() => void runDiagnostic(item)}
                    disabled={Boolean(action?.busy)}
                    className="mt-4 rounded-xl bg-sky-700 px-5 py-3 font-black text-white disabled:bg-neutral-400"
                  >
                    {action?.busy === "diagnostic"
                      ? "Running diagnostic…"
                      : "Run AI + Checklist Diagnostic"}
                  </button>

                  {action?.diagnostic ? (
                    <div className="mt-4 rounded-xl border-2 border-neutral-800 bg-neutral-50 p-4">
                      <p className="font-black">
                        HTTP {action.diagnostic.scan?.httpStatus ?? "—"} · {action.diagnostic.scan?.ok ? "COMPLETED" : "REVIEW / FAILED"}
                      </p>
                      {action.diagnostic.scan?.error ? (
                        <p className="mt-2 font-bold text-red-900">
                          {action.diagnostic.scan.error}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <p><strong>Player:</strong> {valueFromAi(diagnosticAi, "player", "playerName")}</p>
                        <p><strong>Year:</strong> {valueFromAi(diagnosticAi, "year")}</p>
                        <p><strong>Card:</strong> {valueFromAi(diagnosticAi, "cardNumber", "card_number")}</p>
                        <p><strong>Set:</strong> {valueFromAi(diagnosticAi, "setName", "set")}</p>
                        <p><strong>Parallel:</strong> {valueFromAi(diagnosticAi, "parallel", "parallelName", "checklistParallel")}</p>
                        <p><strong>Serial:</strong> {valueFromAi(diagnosticAi, "serialNumber", "printRun")}</p>
                      </div>
                      <p className="mt-3 break-all font-mono text-xs">
                        Front SHA: {action.diagnostic.imageAudit?.frontSha256 || "—"}
                      </p>
                      <p className="break-all font-mono text-xs">
                        Back SHA: {action.diagnostic.imageAudit?.backSha256 || "—"}
                      </p>
                    </div>
                  ) : null}
                </details>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
