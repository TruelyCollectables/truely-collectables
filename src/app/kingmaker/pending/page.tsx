"use client";

import { useCallback, useEffect, useState } from "react";
import { getFreshAccountSession } from "../../account/account-session";

type PendingCard = {
  inventoryItemId: string;
  title: string;
  sku: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  storedImageCount: number;
  instaComp: {
    pricingStatus: string;
    serialNumber?: string | null;
  };
};

type JobStatus = {
  status: string;
  stage: string | null;
  error: string | null;
  errorCode: string | null;
  identityComplete: boolean;
  manualIdentityLocked: boolean;
  identitySource: string | null;
  pricingStatus: string | null;
  printRun: string | null;
  selectedParallel: string | null;
  candidateParallels: string[];
  visualColor: string | null;
  visualPattern: string | null;
  visualSerial: string | null;
  visualConfidence: number;
  parallelEvidence: string | null;
  updatedAt: string | null;
};

type LocalStage =
  | "waiting"
  | "scanning"
  | "complete"
  | "review"
  | "failed"
  | "locked";
type EditState = { title: string; parallel: string; printRun: string };

function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed.";
}

function hasValidPair(card: PendingCard) {
  return Boolean(
    card.frontImageUrl &&
      card.backImageUrl &&
      card.frontImageUrl !== card.backImageUrl,
  );
}

function displayPattern(value: string | null) {
  return value ? value.replace(/_/g, " ") : "—";
}

export default function KingmakerPendingPage() {
  const [cards, setCards] = useState<PendingCard[]>([]);
  const [jobs, setJobs] = useState<Record<string, JobStatus>>({});
  const [localStage, setLocalStage] = useState<Record<string, LocalStage>>({});
  const [localError, setLocalError] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setPageError("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const [cardsResponse, statusResponse] = await Promise.all([
        fetch("/api/account/seller/instacomp-pending", {
          headers,
          cache: "no-store",
        }),
        fetch("/api/account/seller/inventory/instacomp-job-status", {
          headers,
          cache: "no-store",
        }),
      ]);
      const [cardsData, statusData] = await Promise.all([
        cardsResponse.json(),
        statusResponse.json(),
      ]);
      if (!cardsResponse.ok) {
        throw new Error(cardsData.error || "Could not load pending cards.");
      }
      if (!statusResponse.ok) {
        throw new Error(statusData.error || "Could not load card job status.");
      }
      setCards(Array.isArray(cardsData.items) ? cardsData.items : []);
      setJobs(
        statusData.statuses && typeof statusData.statuses === "object"
          ? statusData.statuses
          : {},
      );
    } catch (error) {
      setCards([]);
      setJobs({});
      setPageError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function beginEdit(card: PendingCard) {
    const job = jobs[card.inventoryItemId];
    setEditingId(card.inventoryItemId);
    setEdits((current) => ({
      ...current,
      [card.inventoryItemId]: {
        title: card.title,
        parallel: job?.selectedParallel || "",
        printRun:
          card.instaComp?.serialNumber || job?.printRun || job?.visualSerial || "",
      },
    }));
  }

  async function saveEdit(card: PendingCard) {
    const edit = edits[card.inventoryItemId];
    if (!edit?.title.trim()) return;
    if (!edit.parallel.trim()) {
      setPageError(
        "Enter Base or the exact checklist parallel. Blank no longer means Base.",
      );
      return;
    }
    setBusyId(card.inventoryItemId);
    setPageError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch(
        "/api/account/seller/inventory/instacomp-card-edit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            inventoryItemId: card.inventoryItemId,
            title: edit.title,
            parallel: edit.parallel,
            printRun: edit.printRun,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not save the card correction.");
      }
      setEditingId(null);
      setLocalStage((current) => ({
        ...current,
        [card.inventoryItemId]: "locked",
      }));
      setNotice(
        `${edit.title}: exact seller correction saved, locked, and sent to InstaComp learning.`,
      );
      await load();
    } catch (error) {
      setPageError(message(error));
    } finally {
      setBusyId(null);
    }
  }

  async function runExactIdentity(card: PendingCard) {
    const job = jobs[card.inventoryItemId];
    const replaceManualIdentity = job?.manualIdentityLocked === true;
    if (!hasValidPair(card)) {
      setLocalError((current) => ({
        ...current,
        [card.inventoryItemId]:
          "A distinct stored front and back are required.",
      }));
      return;
    }

    setBusyId(card.inventoryItemId);
    setNotice("");
    setPageError("");
    setLocalError((current) => ({ ...current, [card.inventoryItemId]: "" }));
    setLocalStage((current) => ({
      ...current,
      [card.inventoryItemId]: "scanning",
    }));

    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Seller login is required.");
      const response = await fetch(
        "/api/account/seller/inventory/instacomp-front-back",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inventoryItemId: card.inventoryItemId,
            replaceManualIdentity,
            aiCouncilTier: "adaptive",
          }),
          cache: "no-store",
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success !== true) {
        const detail = [
          data.error || "Exact front-and-back scan failed.",
          data.code,
          data.stage,
        ]
          .filter(Boolean)
          .join(" · ");
        throw new Error(detail);
      }

      if (data.identityComplete === true) {
        setLocalStage((current) => ({
          ...current,
          [card.inventoryItemId]: "complete",
        }));
        setNotice(
          `${data.title || card.title}: exact checklist identity resolved from color, pattern, and serial evidence.`,
        );
      } else {
        setLocalStage((current) => ({
          ...current,
          [card.inventoryItemId]: "review",
        }));
        setLocalError((current) => ({
          ...current,
          [card.inventoryItemId]:
            data.parallelDecision?.evidence ||
            "The exact parallel remains unresolved. No Base or look-alike parallel was substituted.",
        }));
      }
      await load();
    } catch (error) {
      setLocalStage((current) => ({
        ...current,
        [card.inventoryItemId]: "failed",
      }));
      setLocalError((current) => ({
        ...current,
        [card.inventoryItemId]: message(error),
      }));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-6 text-neutral-950">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-800">
              KINGMAKER / Exact Front + Back Identity
            </p>
            <h1 className="mt-1 text-3xl font-black">Pending InstaComp Cards</h1>
            <p className="mt-2 max-w-4xl font-semibold text-neutral-700">
              Images are oriented automatically from printed writing. Identity is
              resolved in order: year, set, player, card number, visible parallel
              color, visible pattern geometry, and serial stamp. Velocity and
              Cracked Ice are treated as different patterns. Nothing publishes
              automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || Boolean(busyId)}
            className="rounded-xl bg-neutral-950 px-4 py-3 font-black text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Reload Cards"}
          </button>
        </div>

        {pageError ? (
          <div className="mt-5 rounded-xl border-2 border-red-700 bg-red-50 p-4 font-bold text-red-900">
            {pageError}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-5 rounded-xl border-2 border-emerald-700 bg-emerald-50 p-4 font-bold text-emerald-900">
            {notice}
          </div>
        ) : null}

        <section className="mt-6 space-y-6">
          {cards.map((card) => {
            const job = jobs[card.inventoryItemId];
            const pairReady = hasValidPair(card);
            const isBusy = busyId === card.inventoryItemId;
            const edit = edits[card.inventoryItemId];
            const storedStage: LocalStage = job?.manualIdentityLocked
              ? "locked"
              : job?.identityComplete
                ? "complete"
                : job?.status === "failed"
                  ? "failed"
                  : job?.status === "review_required"
                    ? "review"
                    : "waiting";
            const stage = localStage[card.inventoryItemId] || storedStage;
            const error =
              localError[card.inventoryItemId] ||
              (stage === "failed" ? job?.error || "" : "");

            return (
              <article
                key={card.inventoryItemId}
                className="overflow-hidden rounded-2xl border-2 border-neutral-900 bg-white shadow-[6px_6px_0_#111]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-neutral-900 bg-neutral-950 px-4 py-3 text-white">
                  <div>
                    <h2 className="font-black">{card.title}</h2>
                    <p className="text-xs font-bold text-neutral-300">
                      {card.sku || card.inventoryItemId}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${
                      pairReady
                        ? "bg-emerald-300 text-emerald-950"
                        : "bg-red-300 text-red-950"
                    }`}
                  >
                    {pairReady
                      ? "CARD READY — FRONT + BACK"
                      : "CARD BLOCKED — SIDE MISSING"}
                  </span>
                </div>

                <div className="border-b-2 border-neutral-900 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 font-black">
                    <span>
                      {stage === "scanning"
                        ? "Reading color, pattern geometry, and serial stamp"
                        : stage === "complete"
                          ? "Exact identity complete"
                          : stage === "review"
                            ? "Exact parallel review required"
                            : stage === "locked"
                              ? "Seller-corrected identity locked"
                              : stage === "failed"
                                ? `Scan failed at ${job?.stage || "pipeline"}`
                                : "Waiting for exact identity scan"}
                    </span>
                    {stage === "complete" ? <span>100%</span> : null}
                  </div>
                  <div className="mt-2 h-4 overflow-hidden rounded-full bg-neutral-200">
                    {stage === "scanning" ? (
                      <div className="h-full w-2/3 animate-pulse bg-sky-700" />
                    ) : null}
                    {stage === "complete" || stage === "locked" ? (
                      <div className="h-full w-full bg-emerald-600" />
                    ) : null}
                    {stage === "review" ? (
                      <div className="h-full w-2/3 bg-amber-500" />
                    ) : null}
                    {stage === "failed" ? (
                      <div className="h-full w-1/3 bg-red-700" />
                    ) : null}
                  </div>
                  {error ? (
                    <div className="mt-3 rounded-lg border-2 border-red-700 bg-red-50 p-3 font-bold text-red-900">
                      {error}
                      {job?.errorCode ? ` · ${job.errorCode}` : ""}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-neutral-100 p-3">
                      <span className="font-black">Selected parallel</span>
                      <p>{job?.selectedParallel || "—"}</p>
                    </div>
                    <div className="rounded-lg bg-neutral-100 p-3">
                      <span className="font-black">Visible color</span>
                      <p>{job?.visualColor || "—"}</p>
                    </div>
                    <div className="rounded-lg bg-neutral-100 p-3">
                      <span className="font-black">Visible pattern</span>
                      <p>{displayPattern(job?.visualPattern || null)}</p>
                    </div>
                    <div className="rounded-lg bg-neutral-100 p-3">
                      <span className="font-black">Serial stamp</span>
                      <p>{job?.visualSerial || "None seen"}</p>
                    </div>
                  </div>
                  {job?.candidateParallels?.length ? (
                    <details className="mt-3 rounded-lg border border-neutral-400 bg-neutral-50 p-3 text-sm">
                      <summary className="cursor-pointer font-black">
                        Checklist candidates and visual receipt
                      </summary>
                      <p className="mt-2 font-semibold">
                        Candidates: {job.candidateParallels.join(" · ")}
                      </p>
                      <p className="mt-2 font-semibold">
                        Confidence: {Math.round((job.visualConfidence || 0) * 100)}%
                      </p>
                      {job.parallelEvidence ? (
                        <p className="mt-2 break-words font-semibold">
                          {job.parallelEvidence}
                        </p>
                      ) : null}
                    </details>
                  ) : null}
                </div>

                <div className="grid gap-4 p-4 md:grid-cols-2">
                  {(
                    [
                      ["front", card.frontImageUrl],
                      ["back", card.backImageUrl],
                    ] as const
                  ).map(([side, url]) => (
                    <figure
                      key={side}
                      className="rounded-xl border-2 border-neutral-800 bg-neutral-100 p-3"
                    >
                      <figcaption className="mb-2 text-center text-xs font-black uppercase tracking-wider">
                        Card {side} · automatically oriented
                      </figcaption>
                      <div className="flex h-80 items-center justify-center overflow-hidden">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt={`${card.title} ${side}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <div className="font-black text-red-800">
                            {side.toUpperCase()} MISSING
                          </div>
                        )}
                      </div>
                    </figure>
                  ))}
                </div>

                {editingId === card.inventoryItemId ? (
                  <div className="grid gap-3 border-t-2 border-neutral-900 bg-amber-50 p-4 md:grid-cols-3">
                    <label className="font-bold">
                      Card title
                      <input
                        value={edit?.title || ""}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [card.inventoryItemId]: {
                              ...(current[card.inventoryItemId] || {
                                title: "",
                                parallel: "",
                                printRun: "",
                              }),
                              title: event.target.value,
                            },
                          }))
                        }
                        className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2"
                      />
                    </label>
                    <label className="font-bold">
                      Exact parallel
                      <input
                        value={edit?.parallel || ""}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [card.inventoryItemId]: {
                              ...(current[card.inventoryItemId] || {
                                title: "",
                                parallel: "",
                                printRun: "",
                              }),
                              parallel: event.target.value,
                            },
                          }))
                        }
                        placeholder="Base or Blue Velocity Prizm"
                        className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2"
                      />
                    </label>
                    <label className="font-bold">
                      Exact serial stamp
                      <input
                        value={edit?.printRun || ""}
                        onChange={(event) =>
                          setEdits((current) => ({
                            ...current,
                            [card.inventoryItemId]: {
                              ...(current[card.inventoryItemId] || {
                                title: "",
                                parallel: "",
                                printRun: "",
                              }),
                              printRun: event.target.value,
                            },
                          }))
                        }
                        placeholder="17/99 or /99"
                        className="mt-1 w-full rounded-lg border-2 border-neutral-800 p-2"
                      />
                    </label>
                    <div className="flex gap-2 md:col-span-3">
                      <button
                        type="button"
                        onClick={() => void saveEdit(card)}
                        disabled={isBusy}
                        className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:opacity-50"
                      >
                        Save, Lock & Teach InstaComp
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-xl bg-neutral-700 px-4 py-3 font-black text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-neutral-900 p-4">
                  <p className="text-sm font-bold">
                    One exact card job · stored front/back rows: {card.storedImageCount || 0} · never auto-published
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => beginEdit(card)}
                      disabled={Boolean(busyId)}
                      className="rounded-xl bg-amber-600 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      Correct Card
                    </button>
                    <button
                      type="button"
                      onClick={() => void runExactIdentity(card)}
                      disabled={!pairReady || Boolean(busyId)}
                      className="rounded-xl bg-sky-700 px-4 py-3 font-black text-white disabled:bg-neutral-400"
                    >
                      {isBusy
                        ? "Reading exact identity…"
                        : job?.manualIdentityLocked
                          ? "Re-scan and Replace Locked Identity"
                          : "Run Exact Identity"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
