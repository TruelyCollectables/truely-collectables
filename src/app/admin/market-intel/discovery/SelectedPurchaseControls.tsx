"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { markDiscoveryQueueDirty } from "./ResolvedCandidateCleanup";

type ApprovalFields = {
  seasonYear: string;
  manufacturer: string;
  brand: string;
  productLine: string;
  setName: string;
  insertName: string;
  cardNumber: string;
  parallelName: string;
  variationName: string;
  serialNumberedTo: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookieDesignation: boolean;
  conditionType: "raw" | "graded";
  gradingCompany: string;
  grade: string;
  quantity: number;
};

export type SelectablePurchaseCandidate = {
  id: string;
  player: string;
  title: string;
  ready: boolean;
  missing: string[];
  itemPrice: number;
  shippingPrice: number;
  defaultTax: number;
  purchaseDate: string;
  approval: ApprovalFields;
};

type PurchaseDraft = {
  itemSubtotal: number;
  shipping: number;
  salesTax: number;
};

type PurchaseApiResponse =
  | {
      success: true;
      purchaseId: string;
      purchaseNumber: number;
      redirectUrl: string;
    }
  | { success: false; error: string };

function money(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function nonNegative(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function removeCandidateCard(candidateId: string) {
  const article = document.getElementById(`candidate-${candidateId}`);
  if (!article) return;
  article.style.transition = "opacity 180ms ease, transform 180ms ease";
  article.style.opacity = "0";
  article.style.transform = "translateX(24px)";
  article.style.pointerEvents = "none";
  window.setTimeout(() => article.remove(), 190);
}

export default function SelectedPurchaseControls({
  candidates,
}: {
  candidates: SelectablePurchaseCandidate[];
}) {
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 0, purchased: 0, skipped: 0 });
  const [purchaseDate, setPurchaseDate] = useState(
    candidates[0]?.purchaseDate || new Date().toISOString().slice(0, 10),
  );
  const [alreadyReceived, setAlreadyReceived] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PurchaseDraft>>({});

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    let observer: MutationObserver | null = null;

    const bind = () => {
      for (const candidate of candidates) {
        const article = document.getElementById(`candidate-${candidate.id}`);
        const checkbox = article?.querySelector<HTMLInputElement>(
          'input[type="checkbox"][aria-label^="Select "]',
        );
        if (!checkbox || checkbox.dataset.purchaseSelectionBound === "1") continue;
        checkbox.dataset.purchaseSelectionBound = "1";
        const listener = () => {
          setSelected((current) => {
            const next = new Set(current);
            if (checkbox.checked) next.add(candidate.id);
            else next.delete(candidate.id);
            return next;
          });
        };
        checkbox.addEventListener("change", listener);
        listener();
        cleanups.push(() => checkbox.removeEventListener("change", listener));
      }
    };

    bind();
    observer = new MutationObserver(bind);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer?.disconnect();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [candidates]);

  const selectedCandidates = candidates.filter((candidate) => selected.has(candidate.id));
  const readySelected = selectedCandidates.filter((candidate) => candidate.ready);
  const incompleteSelected = selectedCandidates.length - readySelected.length;

  function openPurchaseModal() {
    setError(null);
    if (readySelected.length === 0) {
      setError("Select at least one approval-ready card before marking purchases.");
      return;
    }

    const nextDrafts: Record<string, PurchaseDraft> = {};
    for (const candidate of readySelected) {
      nextDrafts[candidate.id] = {
        itemSubtotal: candidate.itemPrice,
        shipping: candidate.shippingPrice,
        salesTax: candidate.defaultTax,
      };
    }
    setDrafts(nextDrafts);
    setPurchaseDate(readySelected[0]?.purchaseDate || new Date().toISOString().slice(0, 10));
    setModalOpen(true);
  }

  function updateDraft(candidateId: string, field: keyof PurchaseDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [candidateId]: {
        ...(current[candidateId] || { itemSubtotal: 0, shipping: 0, salesTax: 0 }),
        [field]: nonNegative(value),
      },
    }));
  }

  async function recordSelectedPurchases() {
    if (busy) return;
    const purchases = readySelected.filter((candidate) => drafts[candidate.id]);
    if (purchases.length === 0) {
      setError("No approval-ready selected purchases are available.");
      return;
    }

    setBusy(true);
    setError(null);
    setProgress({ completed: 0, total: purchases.length, purchased: 0, skipped: 0 });
    markDiscoveryQueueDirty();

    let purchased = 0;
    let skipped = 0;
    let firstError = "";
    const handoff = searchParams.get("admin_handoff");

    for (let index = 0; index < purchases.length; index += 1) {
      const candidate = purchases[index];
      const draft = drafts[candidate.id];
      const totalAcquisitionCost = roundMoney(
        draft.itemSubtotal + draft.shipping + draft.salesTax,
      );
      const formData = new FormData();
      const approval = candidate.approval;

      formData.set("seasonYear", approval.seasonYear);
      formData.set("manufacturer", approval.manufacturer);
      formData.set("brand", approval.brand);
      formData.set("productLine", approval.productLine);
      formData.set("setName", approval.setName);
      formData.set("insertName", approval.insertName);
      formData.set("cardNumber", approval.cardNumber);
      formData.set("parallelName", approval.parallelName);
      formData.set("variationName", approval.variationName);
      if (approval.serialNumberedTo) {
        formData.set("serialNumberedTo", String(approval.serialNumberedTo));
      }
      if (approval.autograph) formData.set("autograph", "on");
      if (approval.memorabilia) formData.set("memorabilia", "on");
      if (approval.rookieDesignation) formData.set("rookieDesignation", "on");
      formData.set("conditionType", approval.conditionType);
      formData.set("gradingCompany", approval.gradingCompany);
      formData.set("grade", approval.grade);
      formData.set("quantity", String(approval.quantity));
      formData.set("itemSubtotal", money(draft.itemSubtotal));
      formData.set("inboundShipping", money(draft.shipping));
      formData.set("salesTax", money(draft.salesTax));
      formData.set("totalAcquisitionCost", money(totalAcquisitionCost));
      formData.set("purchaseDate", purchaseDate);
      if (alreadyReceived) formData.set("alreadyReceived", "on");

      const action = handoff
        ? `/api/admin/market-intel/discovery/${candidate.id}/purchase?admin_handoff=${encodeURIComponent(handoff)}`
        : `/api/admin/market-intel/discovery/${candidate.id}/purchase`;

      try {
        const response = await fetch(action, {
          method: "POST",
          body: formData,
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => null)) as PurchaseApiResponse | null;
        if (!response.ok || !payload || payload.success !== true) {
          const message =
            payload && "error" in payload
              ? payload.error
              : `Purchase failed with HTTP ${response.status}.`;
          firstError ||= `${candidate.player}: ${message}`;
          skipped += 1;
        } else {
          purchased += 1;
          removeCandidateCard(candidate.id);
          setSelected((current) => {
            const next = new Set(current);
            next.delete(candidate.id);
            return next;
          });
        }
      } catch (purchaseError) {
        firstError ||= `${candidate.player}: ${
          purchaseError instanceof Error ? purchaseError.message : "Unknown purchase error."
        }`;
        skipped += 1;
      }

      setProgress({
        completed: index + 1,
        total: purchases.length,
        purchased,
        skipped,
      });
    }

    const params = new URLSearchParams({
      purchased: String(purchased),
      purchaseSkipped: String(skipped),
    });
    if (firstError) params.set("purchaseError", firstError.slice(0, 220));
    if (handoff) params.set("admin_handoff", handoff);
    window.location.assign(`/admin/market-intel/discovery?${params.toString()}`);
  }

  return (
    <>
      <div className="fixed bottom-28 right-4 z-[66] flex max-w-sm flex-col items-end gap-2">
        {error ? (
          <div className="rounded-lg border border-rose-400 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-950 shadow-xl">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={openPurchaseModal}
          disabled={selected.size === 0 || busy}
          className="rounded-lg bg-lime-700 px-4 py-3 text-sm font-black text-white shadow-xl disabled:cursor-not-allowed disabled:opacity-40"
        >
          Mark Selected Purchased ({readySelected.length})
        </button>
        {incompleteSelected > 0 ? (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs font-bold text-amber-950 shadow">
            {incompleteSelected} selected incomplete card{incompleteSelected === 1 ? "" : "s"} will not be purchased.
          </p>
        ) : null}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/70 p-4">
          <div className="mx-auto my-6 max-w-6xl rounded-2xl bg-[#f4f1ea] p-5 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-lime-800">
                  Selected Purchase Intake
                </p>
                <h2 className="mt-1 text-3xl font-black">Mark selected cards purchased</h2>
                <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-700">
                  Tax defaults to an 8.00% Parker, Colorado estimate on item plus shipping. Replace it with the actual marketplace tax from the receipt before recording.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !busy && setModalOpen(false)}
                disabled={busy}
                className="rounded-md border border-neutral-400 bg-white px-4 py-2 font-black disabled:opacity-40"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-black">
                Purchase date
                <input
                  type="date"
                  value={purchaseDate}
                  onChange={(event) => setPurchaseDate(event.target.value)}
                  disabled={busy}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2"
                />
              </label>
              <label className="flex items-center gap-2 self-end rounded-md border border-neutral-300 bg-white px-3 py-3 text-sm font-black">
                <input
                  type="checkbox"
                  checked={alreadyReceived}
                  onChange={(event) => setAlreadyReceived(event.target.checked)}
                  disabled={busy}
                />
                Already received
              </label>
            </div>

            <div className="mt-5 space-y-3">
              {readySelected.map((candidate) => {
                const draft = drafts[candidate.id] || {
                  itemSubtotal: candidate.itemPrice,
                  shipping: candidate.shippingPrice,
                  salesTax: candidate.defaultTax,
                };
                const total = roundMoney(draft.itemSubtotal + draft.shipping + draft.salesTax);
                return (
                  <article key={candidate.id} className="rounded-xl border border-neutral-300 bg-white p-4">
                    <p className="font-black">{candidate.player}</p>
                    <p className="mt-1 text-sm font-semibold text-neutral-700">{candidate.title}</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <MoneyInput
                        label="Item price"
                        value={draft.itemSubtotal}
                        disabled={busy}
                        onChange={(value) => updateDraft(candidate.id, "itemSubtotal", value)}
                      />
                      <MoneyInput
                        label="Shipping"
                        value={draft.shipping}
                        disabled={busy}
                        onChange={(value) => updateDraft(candidate.id, "shipping", value)}
                      />
                      <MoneyInput
                        label="Colorado tax"
                        value={draft.salesTax}
                        disabled={busy}
                        onChange={(value) => updateDraft(candidate.id, "salesTax", value)}
                      />
                      <div className="rounded-md border border-lime-300 bg-lime-50 px-3 py-2">
                        <p className="text-xs font-black uppercase tracking-wide text-lime-800">Total paid</p>
                        <p className="mt-1 text-xl font-black">${money(total)}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {busy ? (
              <div className="mt-5 rounded-lg border border-cyan-300 bg-cyan-50 p-4 font-black text-cyan-950">
                Processing {progress.completed} of {progress.total} · Purchased {progress.purchased} · Skipped {progress.skipped}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={busy}
                className="rounded-md border border-neutral-400 bg-white px-4 py-3 font-black disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void recordSelectedPurchases()}
                disabled={busy || readySelected.length === 0 || !purchaseDate}
                className="rounded-md bg-lime-700 px-5 py-3 font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Recording purchases..." : `Record ${readySelected.length} selected purchase${readySelected.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MoneyInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        type="number"
        min="0"
        step="0.01"
        value={money(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2.5"
      />
    </label>
  );
}
