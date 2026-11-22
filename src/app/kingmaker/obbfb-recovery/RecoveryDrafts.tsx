"use client";

import { useRef, useState } from "react";
import OBBFBOperatorForm, { type MarketEvidence, type OBBFBOperatorHandle } from "../OBBFBOperatorForm";

type Draft = {
  id: string;
  title: string;
  description: string;
  identity: Record<string, unknown>;
  suggestedPrice: number | null;
  pricingStatus: string;
  front: string;
  back: string;
  visualFailure: string;
  priceNeedsRecomp: boolean;
  marketEvidence: MarketEvidence;
};

export default function RecoveryDrafts({ drafts }: { drafts: Draft[] }) {
  const forms = useRef(new Map<string, OBBFBOperatorHandle>());
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function lockReviewed() {
    if (running.current) return;
    const reviewed = drafts.filter(({ id }) => forms.current.get(id)?.canSave);
    if (!reviewed.length) {
      setMessage("Check the verification box on each card you want to lock.");
      return;
    }

    running.current = true;
    setBusy(true);
    let saved = 0;
    try {
      for (const [index, draft] of reviewed.entries()) {
        setMessage(`Locking card ${index + 1} of ${reviewed.length}…`);
        if (await forms.current.get(draft.id)?.save()) saved++;
      }
      const failed = reviewed.length - saved;
      setMessage(`${saved} of ${reviewed.length} cards locked. No listings published.` +
        (failed ? ` Check the errors on the ${failed === 1 ? "card that failed" : `${failed} cards that failed`}.` : ""));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  if (!drafts.length) return null;
  return (
    <>
      <div className="sticky top-0 z-10 mt-6 rounded-xl border border-emerald-800 bg-slate-950 p-4">
        <button type="button" onClick={() => void lockReviewed()} disabled={busy}
          className="rounded-lg bg-emerald-400 px-4 py-2 font-bold text-slate-950 disabled:opacity-50">
          Lock Reviewed Cards
        </button>
        <p className="mt-2 text-sm text-slate-300" role="status">
          {message || "Check each card you’ve verified, then lock them together."}
        </p>
      </div>
      <fieldset disabled={busy} aria-label="Saved scans" className="mt-6 min-w-0 space-y-6">
        {drafts.map(draft => (
          <article key={draft.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <h2 className="text-xl font-black">{draft.title}</h2>
            <p className="mt-1 text-xs text-slate-400">Private draft ID: {draft.id}</p>
            <div className="mt-4 flex flex-wrap gap-4">
              {[["front", draft.front], ["back", draft.back]].map(([side, src]) => src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={side} src={src} alt={`Archived ${side}`}
                  className="h-52 w-36 rounded-lg border border-slate-600 bg-slate-950 object-contain" />
              ) : null)}
            </div>
            {draft.priceNeedsRecomp ? (
              <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-200">
                The saved suggestion used a different variant or a multi-card sale. Retry identification and comps for a fresh price.
              </p>
            ) : null}
            {draft.visualFailure ? (
              <p className="mt-4 rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-sm text-amber-200">
                Previous vision error: {draft.visualFailure}
              </p>
            ) : null}
            <OBBFBOperatorForm
              ref={handle => {
                if (handle) forms.current.set(draft.id, handle);
                else forms.current.delete(draft.id);
              }}
              inventoryItemId={draft.id}
              identity={draft.identity}
              originalTitle={draft.title}
              originalDescription={draft.description}
              suggestedPrice={draft.suggestedPrice}
              pricingStatus={draft.pricingStatus}
              marketEvidence={draft.marketEvidence}
            />
          </article>
        ))}
      </fieldset>
    </>
  );
}
