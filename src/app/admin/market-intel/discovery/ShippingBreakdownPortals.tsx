"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type CandidatePrice = {
  id: string;
  askingPrice: number;
  shippingPrice: number;
};

type PortalTarget = CandidatePrice & {
  element: HTMLDListElement;
};

function money(value: number) {
  return `$${Number(value).toFixed(2)}`;
}

function PriceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white p-2">
      <dt className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 font-black">{value}</dd>
    </div>
  );
}

export default function ShippingBreakdownPortals({
  candidates,
}: {
  candidates: CandidatePrice[];
}) {
  const [targets, setTargets] = useState<PortalTarget[]>([]);
  const candidateKey = useMemo(
    () => candidates.map((candidate) => candidate.id).join("|"),
    [candidates],
  );

  useEffect(() => {
    const nextTargets: PortalTarget[] = [];

    for (const candidate of candidates) {
      const article = document.getElementById(`candidate-${candidate.id}`);
      const facts = article?.querySelector("dl");
      if (!(facts instanceof HTMLDListElement)) continue;

      const labels = Array.from(facts.querySelectorAll("dt"));
      const lotTotalLabel = labels.find(
        (label) => label.textContent?.trim().toLowerCase() === "lot total",
      );
      if (lotTotalLabel) lotTotalLabel.textContent = "Delivered total";

      nextTargets.push({ ...candidate, element: facts });
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setTargets(nextTargets);
    });

    return () => {
      cancelled = true;
    };
  }, [candidateKey, candidates]);

  return (
    <>
      {targets.map((target) =>
        createPortal(
          <>
            <PriceFact label="Item price" value={money(target.askingPrice)} />
            <PriceFact label="Shipping" value={money(target.shippingPrice)} />
          </>,
          target.element,
          `shipping-${target.id}`,
        ),
      )}
    </>
  );
}
