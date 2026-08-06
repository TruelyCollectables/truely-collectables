"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type Candidate = {
  identityId: string | null;
  year: string | null;
  manufacturer: string | null;
  setName: string | null;
  cardNumber: string | null;
  player: string | null;
  parallel: string | null;
  variation: string | null;
  serialRun: number | null;
};

type AuditItem = {
  inventoryItemId: string;
  title: string;
  sku: string | null;
  imageAudit: {
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
  freshRegistryAudit: {
    lookupAttempted: boolean;
    registryReachable: boolean;
    broadStatus: string;
    selectedStatus: string;
    broadCandidateCount: number;
    selectedCandidateCount: number;
    broadCandidates: Candidate[];
    parallelCandidates: string[];
    broadReasons: string[];
    selectedReasons: string[];
  };
};

type AuditPayload = {
  success: boolean;
  error?: string;
  coverage: {
    authenticated: boolean;
    activeLiveVersions: number;
    activeLiveCards: number;
    lookupScope: string;
  };
  auditedCards: number;
  items: AuditItem[];
};

type LockStatus = {
  inventoryItemId: string;
  title: string | null;
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

type StatusPayload = {
  success: boolean;
  error?: string;
  items: Record<string, LockStatus>;
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

type ImageAuditPayload = {
  success: boolean;
  error?: string | null;
  scan?: {
    httpStatus?: number;
    ok?: boolean;
    scanId?: string | null;
    code?: string | null;
    error?: string | null;
    ai?: Record<string, unknown>;
    checklist?: unknown;
  };
  imageAudit?: {
    frontSha256?: string | null;
    backSha256?: string | null;
  };
  draftMutated?: boolean;
};

type ActionState = {
  busy: string | null;
  notice: string;
  error: string;
  audit: ImageAuditPayload | null;
};

const MANUAL_URL =
  "/api/account/seller/inventory/instacomp-manual-identity";
const AUDIT_URL =
  "/api/account/seller/inventory/instacomp-checklist-audit";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function correctedBaseTitle(value: string) {
  return value
    .replace(/\bBase\s+Silver\s+Prizm\b/gi, "Base")
    .replace(/\bBase\s+(?:Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White)\s+Prizm\b/gi, "Base")
    .replace(/\bBase\s+(?:Cracked\s+Ice|Velocity|Wave)\s+Prizm\b/gi, "Base")
    .replace(/\bBase\s+Base\b/gi, "Base")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasImpossibleBaseParallelTitle(value: string) {
  return /\bBase\s+(?:Silver|Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White|Cracked\s+Ice|Velocity|Wave)\s+Prizm\b/i.test(
    value,
  );
}

function inferPlayer(title: string, cardNumber: string) {
  const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    ? new RegExp(
        `#${escaped}\\s+(.+?)(?=\\s+(?:Base|Silver|Blue|Red|Green|Gold|Orange|Purple|Pink|Black|White|Cracked|Velocity|Wave|Auto|Autograph|Rookie|RC)\\b|$)`,
        "i",
      )
    : null;
  return pattern?.exec(title)?.[1]?.trim() || "";
}

function inferSetName(title: string, manufacturer: string) {
  const raw = /^\d{4}\s+(.+?)\s+#/i.exec(title)?.[1]?.trim() || "";
  if (!raw) return "";
  if (!manufacturer) return raw;
  return raw.replace(new RegExp(`^${manufacturer}\\s+`, "i"), "").trim();
}

function inferSport(title: string) {
  if (/\bWNBA\b|\bNBA\b/i.test(title)) return "Basketball";
  if (/\bNFL\b|Football/i.test(title)) return "Football";
  if (/\bNHL\b|Hockey/i.test(title)) return "Hockey";
  if (/\bMLB\b|Bowman|Baseball/i.test(title)) return "Baseball";
  return "";
}

function formFromItem(item: AuditItem, status?: LockStatus): EditForm {
  const cardNumber =
    status?.cardNumber || item.extractedInput.cardNumber || "";
  const manufacturer =
    status?.manufacturer || item.extractedInput.manufacturer || "";
  const contradiction = hasImpossibleBaseParallelTitle(item.title);
  const title = contradiction ? correctedBaseTitle(item.title) : item.title;

  return {
    title: status?.title || title,
    player:
      status?.player ||
      item.extractedInput.player ||
      inferPlayer(item.title, cardNumber),
    year: status?.year || item.extractedInput.year || "",
    manufacturer,
    setName:
      status?.setName || inferSetName(item.title, manufacturer),
    cardNumber,
    parallel:
      status?.parallel ||
      (contradiction ? "Base" : item.extractedInput.parallel || "Base"),
    variation: status?.variation || item.extractedInput.variation || "",
    serialNumber:
      status?.serialNumber || item.extractedInput.serialNumber || "",
    sport: status?.sport || inferSport(item.title),
    team: status?.team || "",
    isAuto: status?.isAuto ?? item.extractedInput.isAuto ?? false,
    isRelic: status?.isRelic ?? item.extractedInput.isRelic ?? false,
  };
}

function fieldClass() {
  return "min-h-11 w-full rounded-lg border-2 border-neutral-400 bg-white px-3 py-2 font-semibold focus:border-blue-700 focus:outline-none";
}

function valueFromAi(ai: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = ai?.[key];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value);
    }
  }
  return "—";
}

export default function InstaCompAuditPage() {
  const [payload, setPayload] = useState<AuditPayload | null>(null);
  const [statuses, setStatuses] = useState<Record<string, LockStatus>>({});
  const [forms, setForms] = useState<Record<string, EditForm>>({});
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [auditResponse, statusResponse] = await Promise.all([
        fetch(AUDIT_URL, { headers, cache: "no-store" }),
        fetch(MANUAL_URL, { headers, cache: "no-store" }),
      ]);
      const audit = (await auditResponse.json()) as AuditPayload;
      const status = (await statusResponse.json()) as StatusPayload;
      if (!auditResponse.ok || audit.success !== true) {
        throw new Error(audit.error || "Card workbench failed to load.");
      }
      if (!statusResponse.ok || status.success !== true) {
        throw new Error(status.error || "Identity lock status failed to load.");
      }
      setPayload(audit);
      setStatuses(status.items || {});
      setForms((current) => {
        const next = { ...current };
        for (const item of audit.items) {
          if (!next[item.inventoryItemId]) {
            next[item.inventoryItemId] = formFromItem(
              item,
              status.items?.[item.inventoryItemId],
            );
          }
        }
        return next;
      });
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Card workbench failed to load.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateForm(
    inventoryItemId: string,
    updater: (current: EditForm) => EditForm,
  ) {
    setForms((current) => {
      const existing = current[inventoryItemId];
      if (!existing) return current;
      return { ...current, [inventoryItemId]: updater(existing) };
    });
  }

  function setAction(
    inventoryItemId: string,
    next: Partial<ActionState>,
  ) {
    setActions((current) => ({
      ...current,
      [inventoryItemId]: {
        busy: null,
        notice: "",
        error: "",
        audit: current[inventoryItemId]?.audit || null,
        ...current[inventoryItemId],
        ...next,
      },
    }));
  }

  async function authorizedJson(
    url: string,
    body: Record<string, unknown>,
  ) {
    const session = await getFreshAccountSession(5 * 60, false);
    if (!session?.access_token) throw new Error("Seller login is required.");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || data.success !== true) {
      throw new Error(text(data.error) || `Request failed with HTTP ${response.status}.`);
    }
    return data;
  }

  async function saveAndLock(item: AuditItem) {
    const form = forms[item.inventoryItemId];
    if (!form) return;
    setAction(item.inventoryItemId, {
      busy: "save",
      notice: "",
      error: "",
    });
    try {
      const data = await authorizedJson(MANUAL_URL, {
        action: "save",
        inventoryItemId: item.inventoryItemId,
        title: form.title,
        identity: form,
      });
      const returnedTitle = text(data.title) || form.title;
      const returnedIdentity = data.identity as LockStatus | undefined;
      setStatuses((current) => ({
        ...current,
        [item.inventoryItemId]: {
          inventoryItemId: item.inventoryItemId,
          title: returnedTitle,
          locked: true,
          humanVerified: true,
          trustedForIdentity: true,
          savedAt: returnedIdentity?.savedAt || new Date().toISOString(),
          source: "seller_manual_locked",
          player: form.player,
          year: form.year,
          manufacturer: form.manufacturer,
          setName: form.setName,
          cardNumber: form.cardNumber,
          parallel: /^base$/i.test(form.parallel) ? null : form.parallel,
          variation: form.variation,
          serialNumber: form.serialNumber,
          sport: form.sport,
          team: form.team,
          isAuto: form.isAuto,
          isRelic: form.isRelic,
        },
      }));
      updateForm(item.inventoryItemId, (current) => ({
        ...current,
        title: returnedTitle,
      }));
      setAction(item.inventoryItemId, {
        busy: null,
        notice: text(data.message) || "Identity saved and locked.",
        error: "",
      });
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error: error instanceof Error ? error.message : "Identity save failed.",
      });
    }
  }

  async function unlock(item: AuditItem) {
    setAction(item.inventoryItemId, {
      busy: "unlock",
      notice: "",
      error: "",
    });
    try {
      const data = await authorizedJson(MANUAL_URL, {
        action: "unlock",
        inventoryItemId: item.inventoryItemId,
      });
      setStatuses((current) => ({
        ...current,
        [item.inventoryItemId]: {
          ...(current[item.inventoryItemId] || {
            inventoryItemId: item.inventoryItemId,
            title: item.title,
          }),
          locked: false,
          humanVerified: true,
          trustedForIdentity: false,
        } as LockStatus,
      }));
      setAction(item.inventoryItemId, {
        busy: null,
        notice: text(data.message) || "Identity unlocked.",
        error: "",
      });
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error: error instanceof Error ? error.message : "Unlock failed.",
      });
    }
  }

  async function editImage(
    item: AuditItem,
    action: "rotate" | "swap",
    side?: "front" | "back",
    degrees?: -90 | 90,
  ) {
    const locked = statuses[item.inventoryItemId]?.locked === true;
    if (locked) {
      setAction(item.inventoryItemId, {
        error: "Unlock the identity before changing its image evidence.",
        notice: "",
      });
      return;
    }
    setAction(item.inventoryItemId, {
      busy: `image-${action}`,
      notice: "",
      error: "",
    });
    try {
      const response = await fetch("/api/admin/card-listing-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          inventoryItemId: item.inventoryItemId,
          action,
          side,
          degrees,
        }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.success !== true) {
        throw new Error(text(data.error) || "Image edit failed.");
      }
      setAction(item.inventoryItemId, {
        busy: null,
        notice: text(data.message) || "Image edit saved.",
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
        error: error instanceof Error ? error.message : "Image edit failed.",
      });
    }
  }

  async function runDiagnostic(item: AuditItem) {
    setAction(item.inventoryItemId, {
      busy: "audit",
      notice: "",
      error: "",
      audit: null,
    });
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch(AUDIT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inventoryItemId: item.inventoryItemId }),
        cache: "no-store",
      });
      const data = (await response.json()) as ImageAuditPayload;
      setAction(item.inventoryItemId, {
        busy: null,
        notice: data.success
          ? "AI/checklist diagnostic completed. The draft was not changed."
          : "",
        error: data.success ? "" : data.error || data.scan?.error || "Diagnostic failed.",
        audit: data,
      });
    } catch (error) {
      setAction(item.inventoryItemId, {
        busy: null,
        notice: "",
        error: error instanceof Error ? error.message : "Diagnostic failed.",
        audit: null,
      });
    }
  }

  const summary = useMemo(() => {
    const items = payload?.items || [];
    return {
      total: items.length,
      locked: items.filter((item) => statuses[item.inventoryItemId]?.locked).length,
      imageReady: items.filter((item) => item.imageAudit.readyForFreshImageAudit).length,
    };
  }, [payload, statuses]);

  return (
    <main className="min-h-screen bg-neutral-100 px-3 py-5 text-neutral-950 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <header className="rounded-2xl border-2 border-neutral-950 bg-neutral-950 p-5 text-white shadow-[7px_7px_0_#facc15]">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-yellow-300">
            KINGMAKER · Concrete card record
          </p>
          <h1 className="mt-2 text-3xl font-black sm:text-5xl">
            Rotate, Correct, Save & Lock
          </h1>
          <p className="mt-3 max-w-4xl font-semibold text-neutral-200">
            AI failure no longer blocks your card. Correct the images and identity,
            then save it as the trusted record. InstaComp cannot overwrite a locked
            identity until you explicitly unlock it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 text-sm font-black">
              {summary.total} drafts
            </span>
            <span className="rounded-full bg-emerald-400 px-3 py-1 text-sm font-black text-emerald-950">
              {summary.imageReady} front + back ready
            </span>
            <span className="rounded-full bg-yellow-300 px-3 py-1 text-sm font-black text-neutral-950">
              {summary.locked} locked
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

        {pageError ? (
          <p className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
            {pageError}
          </p>
        ) : null}

        <section className="mt-6 space-y-7">
          {(payload?.items || []).map((item) => {
            const form = forms[item.inventoryItemId];
            const status = statuses[item.inventoryItemId];
            const action = actions[item.inventoryItemId];
            const locked = status?.locked === true;
            const contradiction = hasImpossibleBaseParallelTitle(item.title);
            const liveAi = action?.audit?.scan?.ai;

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
                          : "bg-white/15 text-white"
                      }`}
                    >
                      {locked ? "🔒 SAVED & LOCKED" : "UNLOCKED DRAFT"}
                    </span>
                  </div>
                </div>

                {contradiction ? (
                  <div className="border-b-2 border-red-700 bg-red-50 p-4 font-black text-red-900">
                    Automatic correction applied: “Base Silver Prizm” is contradictory.
                    This editor prefills the card as Base. The set name may still be
                    Panini Prizm WNBA; the parallel is Base.
                  </div>
                ) : null}

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
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-2xl font-black">Card images</h3>
                      <p className="font-semibold text-neutral-600">
                        Rotate and swap save immediately. Lock the identity after the
                        images are correct.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void editImage(item, "swap")}
                      disabled={locked || Boolean(action?.busy)}
                      className="rounded-xl border-2 border-neutral-950 bg-yellow-300 px-4 py-2 font-black disabled:opacity-40"
                    >
                      Swap front / back
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
                        key={side}
                        className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3"
                      >
                        <figcaption className="mb-2 text-center text-sm font-black uppercase">
                          {side}
                        </figcaption>
                        <div className="flex min-h-72 items-center justify-center">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={url}
                              alt={`${form.title} ${side}`}
                              className="max-h-[34rem] max-w-full object-contain"
                            />
                          ) : (
                            <p className="font-black text-red-800">IMAGE MISSING</p>
                          )}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void editImage(item, "rotate", side, -90)
                            }
                            disabled={locked || Boolean(action?.busy) || !url}
                            className="rounded-lg border-2 border-neutral-950 bg-white px-3 py-2 font-black disabled:opacity-40"
                          >
                            ↶ Rotate left
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void editImage(item, "rotate", side, 90)
                            }
                            disabled={locked || Boolean(action?.busy) || !url}
                            className="rounded-lg border-2 border-neutral-950 bg-white px-3 py-2 font-black disabled:opacity-40"
                          >
                            Rotate right ↷
                          </button>
                        </div>
                      </figure>
                    ))}
                  </div>
                </section>

                <section className="border-b-2 border-neutral-900 p-5">
                  <h3 className="text-2xl font-black">Concrete identity</h3>
                  <p className="mt-1 font-semibold text-neutral-600">
                    Edit these fields, then save and lock. Base means no separate
                    parallel designation is being claimed.
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
                          placeholder={key === "parallel" ? "Base" : ""}
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
                        ? "Saving…"
                        : "Save & Lock Identity"}
                    </button>
                    {locked ? (
                      <button
                        type="button"
                        onClick={() => void unlock(item)}
                        disabled={Boolean(action?.busy)}
                        className="min-h-12 rounded-xl border-2 border-red-800 bg-white px-5 py-3 font-black text-red-900 disabled:opacity-40"
                      >
                        Unlock for AI or image changes
                      </button>
                    ) : null}
                  </div>
                </section>

                <details className="p-5">
                  <summary className="cursor-pointer text-lg font-black">
                    AI + checklist diagnostic — optional
                  </summary>
                  <p className="mt-2 font-semibold text-neutral-600">
                    This does not change the saved draft. A failed diagnostic does
                    not block editing or saving.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void runDiagnostic(item)}
                      disabled={Boolean(action?.busy)}
                      className="rounded-xl bg-sky-700 px-5 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      {action?.busy === "audit"
                        ? "Running diagnostic…"
                        : "Run AI + Checklist Diagnostic"}
                    </button>
                    <span className="rounded-full bg-neutral-200 px-3 py-2 text-sm font-black">
                      Registry called: {item.freshRegistryAudit.lookupAttempted ? "YES" : "NO"}
                    </span>
                    <span className="rounded-full bg-neutral-200 px-3 py-2 text-sm font-black">
                      Candidates: {item.freshRegistryAudit.broadCandidateCount}
                    </span>
                  </div>

                  {action?.audit ? (
                    <div className="mt-4 rounded-xl border-2 border-neutral-800 bg-neutral-50 p-4">
                      <p className="font-black">
                        HTTP {action.audit.scan?.httpStatus ?? "—"} ·{" "}
                        {action.audit.success ? "COMPLETED" : "FAILED"}
                      </p>
                      {action.audit.scan?.error ? (
                        <p className="mt-2 font-bold text-red-900">
                          {action.audit.scan.error}
                        </p>
                      ) : null}
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                        <p><strong>Player:</strong> {valueFromAi(liveAi, "player", "playerName")}</p>
                        <p><strong>Year:</strong> {valueFromAi(liveAi, "year")}</p>
                        <p><strong>Card:</strong> {valueFromAi(liveAi, "cardNumber", "card_number")}</p>
                        <p><strong>Set:</strong> {valueFromAi(liveAi, "setName", "set")}</p>
                        <p><strong>Parallel:</strong> {valueFromAi(liveAi, "parallel", "parallelName")}</p>
                        <p><strong>Serial:</strong> {valueFromAi(liveAi, "serialNumber", "printRun")}</p>
                      </div>
                      <p className="mt-3 break-all font-mono text-xs">
                        Front SHA: {action.audit.imageAudit?.frontSha256 || "—"}
                      </p>
                      <p className="break-all font-mono text-xs">
                        Back SHA: {action.audit.imageAudit?.backSha256 || "—"}
                      </p>
                    </div>
                  ) : null}

                  {item.freshRegistryAudit.broadCandidates.length ? (
                    <details className="mt-4 rounded-xl border border-neutral-400 p-4">
                      <summary className="cursor-pointer font-black">
                        Show checklist candidates
                      </summary>
                      <div className="mt-3 space-y-2">
                        {item.freshRegistryAudit.broadCandidates.map(
                          (candidate, index) => (
                            <div
                              key={candidate.identityId || index}
                              className="rounded-lg border bg-white p-3 text-sm"
                            >
                              <strong>{candidate.player || "Unknown player"}</strong>{" "}
                              · #{candidate.cardNumber || "—"} ·{" "}
                              {candidate.parallel || "Base"}
                              {candidate.serialRun
                                ? ` · /${candidate.serialRun}`
                                : ""}
                            </div>
                          ),
                        )}
                      </div>
                    </details>
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
