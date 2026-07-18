"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";

type PurchaseCandidate = {
  id: string;
  title: string;
  defaultCost: number;
  defaultPurchaseDate: string;
};

type PortalTarget = PurchaseCandidate & {
  element: HTMLDivElement;
  approvalForm: HTMLFormElement;
};

function money(value: number) {
  return Number(value).toFixed(2);
}

export default function PurchaseCandidateControls({
  candidates,
}: {
  candidates: PurchaseCandidate[];
}) {
  const searchParams = useSearchParams();
  const [targets, setTargets] = useState<PortalTarget[]>([]);
  const candidateKey = useMemo(
    () => candidates.map((candidate) => candidate.id).join("|"),
    [candidates],
  );

  useEffect(() => {
    const next: PortalTarget[] = [];
    for (const candidate of candidates) {
      const article = document.getElementById(`candidate-${candidate.id}`);
      if (!(article instanceof HTMLElement)) continue;
      const approvalForm = article.querySelector<HTMLFormElement>(
        'form[action*="/approve"]',
      );
      if (!approvalForm) continue;

      let target = article.querySelector<HTMLDivElement>(
        `[data-purchase-target="${candidate.id}"]`,
      );
      if (!target) {
        target = document.createElement("div");
        target.dataset.purchaseTarget = candidate.id;
        const rejectForm = article.querySelector<HTMLFormElement>(
          'form[action*="/reject"]',
        );
        if (rejectForm) rejectForm.before(target);
        else approvalForm.after(target);
      }
      next.push({ ...candidate, element: target, approvalForm });
    }
    queueMicrotask(() => {
      setTargets(next);
    });
  }, [candidateKey, candidates]);

  const handoff = searchParams.get("admin_handoff");

  function mirrorApprovalFields(
    purchaseForm: HTMLFormElement,
    approvalForm: HTMLFormElement,
  ) {
    purchaseForm
      .querySelectorAll<HTMLInputElement>("input[data-approval-mirror='1']")
      .forEach((input) => input.remove());

    const approvalData = new FormData(approvalForm);
    for (const [name, value] of approvalData.entries()) {
      if (typeof value !== "string") continue;
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = name;
      hidden.value = value;
      hidden.dataset.approvalMirror = "1";
      purchaseForm.appendChild(hidden);
    }
  }

  return (
    <>
      {targets.map((target) => {
        const action = handoff
          ? `/api/admin/market-intel/discovery/${target.id}/purchase?admin_handoff=${encodeURIComponent(handoff)}`
          : `/api/admin/market-intel/discovery/${target.id}/purchase`;
        return createPortal(
          <form
            method="post"
            action={action}
            onSubmit={(event) =>
              mirrorApprovalFields(event.currentTarget, target.approvalForm)
            }
            className="mx-5 mt-4 rounded-xl border border-lime-300 bg-lime-50 p-4 text-lime-950"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em]">
                  Already bought it?
                </p>
                <h3 className="mt-1 text-xl font-black">
                  Approve Identity + Record Purchase
                </h3>
                <p className="mt-1 text-sm font-semibold">
                  Uses the identity fields currently shown above and creates the real
                  purchase position in one step.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:min-w-[620px]">
                <label className="text-sm font-black">
                  Out-the-door cost
                  <input
                    name="totalAcquisitionCost"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    defaultValue={money(target.defaultCost)}
                    className="mt-1 w-full rounded-md border border-lime-400 bg-white px-3 py-2.5"
                  />
                </label>
                <label className="text-sm font-black">
                  Purchase date
                  <input
                    name="purchaseDate"
                    type="date"
                    required
                    defaultValue={target.defaultPurchaseDate}
                    className="mt-1 w-full rounded-md border border-lime-400 bg-white px-3 py-2.5"
                  />
                </label>
                <label className="flex items-center gap-2 self-end rounded-md border border-lime-300 bg-white px-3 py-3 text-sm font-black">
                  <input name="alreadyReceived" type="checkbox" />
                  Already received
                </label>
              </div>
            </div>
            <button
              type="submit"
              className="mt-4 w-full rounded-md bg-lime-700 px-4 py-3 font-black text-white"
            >
              RECORD AS PURCHASED
            </button>
          </form>,
          target.element,
          `purchase-${target.id}`,
        );
      })}
    </>
  );
}
