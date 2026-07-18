"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { markCandidateResolving } from "./ResolvedCandidateCleanup";

type PurchaseCandidate = {
  id: string;
  title: string;
  defaultItemPrice: number;
  defaultShipping: number;
  defaultTax: number;
  defaultPurchaseDate: string;
};

type PortalTarget = PurchaseCandidate & {
  element: HTMLDivElement;
  approvalForm: HTMLFormElement;
};

function money(value: number) {
  return Number(value).toFixed(2);
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function nonNegative(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function PurchaseSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="mt-4 w-full rounded-md bg-lime-700 px-4 py-3 font-black text-white disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? "Recording purchase and moving card..." : "RECORD AS PURCHASED"}
    </button>
  );
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

  return (
    <>
      {targets.map((target) => {
        const action = handoff
          ? `/api/admin/market-intel/discovery/${target.id}/purchase?admin_handoff=${encodeURIComponent(handoff)}`
          : `/api/admin/market-intel/discovery/${target.id}/purchase`;
        return createPortal(
          <PurchaseCardForm key={target.id} target={target} action={action} />,
          target.element,
          `purchase-${target.id}`,
        );
      })}
    </>
  );
}

function PurchaseCardForm({
  target,
  action,
}: {
  target: PortalTarget;
  action: string;
}) {
  const [itemSubtotal, setItemSubtotal] = useState(target.defaultItemPrice);
  const [shipping, setShipping] = useState(target.defaultShipping);
  const [salesTax, setSalesTax] = useState(target.defaultTax);
  const total = roundMoney(itemSubtotal + shipping + salesTax);

  function mirrorApprovalFields(purchaseForm: HTMLFormElement) {
    purchaseForm
      .querySelectorAll<HTMLInputElement>("input[data-approval-mirror='1']")
      .forEach((input) => input.remove());

    const approvalData = new FormData(target.approvalForm);
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
    <form
      method="post"
      action={action}
      onSubmit={(event) => {
        mirrorApprovalFields(event.currentTarget);
        markCandidateResolving(event.currentTarget);
      }}
      className="mx-5 mt-4 rounded-xl border border-lime-300 bg-lime-50 p-4 text-lime-950"
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em]">
            Already bought it?
          </p>
          <h3 className="mt-1 text-xl font-black">
            Approve Identity + Record Purchase
          </h3>
          <p className="mt-1 text-sm font-semibold">
            Enter the actual receipt breakdown. Colorado tax defaults to an 8.00%
            Parker estimate, but replace it with the exact marketplace tax charged.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MoneyField
            name="itemSubtotal"
            label="Item price"
            value={itemSubtotal}
            onChange={setItemSubtotal}
          />
          <MoneyField
            name="inboundShipping"
            label="Shipping"
            value={shipping}
            onChange={setShipping}
          />
          <MoneyField
            name="salesTax"
            label="Colorado tax"
            value={salesTax}
            onChange={setSalesTax}
          />
          <div className="rounded-md border border-lime-400 bg-white px-3 py-2.5">
            <p className="text-xs font-black uppercase tracking-wide text-lime-800">
              Total paid
            </p>
            <p className="mt-1 text-xl font-black">${money(total)}</p>
          </div>
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
        </div>

        <label className="flex items-center gap-2 rounded-md border border-lime-300 bg-white px-3 py-3 text-sm font-black">
          <input name="alreadyReceived" type="checkbox" />
          Already received
        </label>
      </div>

      <input type="hidden" name="totalAcquisitionCost" value={money(total)} />
      <PurchaseSubmitButton />
    </form>
  );
}

function MoneyField({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <input
        name={name}
        type="number"
        min="0"
        step="0.01"
        required
        value={money(value)}
        onChange={(event) => onChange(nonNegative(event.target.value))}
        className="mt-1 w-full rounded-md border border-lime-400 bg-white px-3 py-2.5"
      />
    </label>
  );
}
