"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { getKingmakerLocalSession } from "./kingmaker-session";
import { getFreshAccountSession } from "../account/account-session";
import {
  buildDirectDescription, formatDirectTitle, isSoldPricingExclusion, marketVariantMismatch, normalizeDirectIdentity,
} from "../../lib/obbfb-intake-rules";

type Identity = Record<string, unknown>;
type Props = {
  inventoryItemId: string;
  originalTitle: string;
  originalDescription: string;
  identity: Identity;
  suggestedPrice: number | null;
  pricingStatus: string | null;
  marketEvidence?: MarketEvidence;
};
export type MarketEvidence = {
  rejectedSoldComps?: Array<{ sale: Record<string, unknown>; reason: unknown }>;
  soldCompEvidence?: Array<Record<string, unknown>>;
  activeCompetition?: Array<Record<string, unknown>>;
};

function MarketRows({ label, rows, identity }: {
  label: string;
  rows?: Array<Record<string, unknown>>;
  identity: Identity;
}) {
  const exact = normalizeDirectIdentity(identity);
  const matches = (Array.isArray(rows) ? rows : []).filter(row =>
    typeof row?.title === "string" && Number(row.price) > 0 && !marketVariantMismatch(row.title, exact));
  return (
    <details className="rounded-lg border border-slate-700 p-3 text-sm">
      <summary className="cursor-pointer font-semibold">{label} ({matches.length})</summary>
      {matches.length ? (
        <ul className="mt-2 space-y-2">
          {matches.map((row, index) => {
            const url = typeof row.url === "string" && /^https:\/\/(?:www\.)?ebay\.com\/itm\//i.test(row.url)
              ? row.url : null;
            return <li key={index}>
              <strong>${Number(row.price).toFixed(2)}</strong>{" · "}
              {url ? <a href={url} target="_blank" rel="noreferrer" className="underline">{String(row.title)}</a> : String(row.title)}
            </li>;
          })}
        </ul>
      ) : <p className="mt-2 text-slate-400">No matching evidence available.</p>}
    </details>
  );
}

const fields = [
  ["year", "Year"],
  ["brandSet", "Brand / Set"],
  ["player", "Player"],
  ["cardNumber", "Card #"],
  ["parallel", "Parallel (e.g. Silver Prizm)"],
  ["subset", "Insert / Subset"],
  ["serialNumber", "Full serial (09/99)"],
  ["inscription", "Visible handwritten inscription"],
] as const;
const truth = (value: unknown) => String(value ?? "");

export type OBBFBOperatorHandle = {
  canSave: boolean;
  save: () => Promise<boolean>;
};

export default forwardRef<OBBFBOperatorHandle, Props>(function OBBFBOperatorForm(props, ref) {
  const [values, setValues] = useState<Identity>({
    ...props.identity,
    brandSet: props.identity.brandSet || props.identity.setName || "",
  });
  const [title, setTitle] = useState(props.originalTitle);
  const [description, setDescription] = useState(props.originalDescription);
  const [price, setPrice] = useState(props.suggestedPrice ? props.suggestedPrice.toFixed(2) : "");
  const [marketEvidence, setMarketEvidence] = useState(props.marketEvidence);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [retryNotice, setRetryNotice] = useState("");
  const [visionComplete, setVisionComplete] = useState(Boolean(props.identity.year && props.identity.player && props.identity.cardNumber));

  function setField(key: string, value: unknown) {
    setValues(current => {
      const next = { ...current, [key]: value };
      if (key === "year" && typeof current.year === "string" &&
          typeof current.brandSet === "string" && current.brandSet.startsWith(current.year + " ")) {
        next.brandSet = current.brandSet.slice(current.year.length).trim();
      }
      return next;
    });
    setConfirmed(false);
  }
  function regenerate() {
    const updated = normalizeDirectIdentity(values);
    setTitle(formatDirectTitle(updated));
    setDescription(buildDirectDescription(updated));
    setConfirmed(false);
  }
  async function retryArchivedVision() {
    if (retrying || busy || locked) return;
    setRetrying(true);
    setError("");
    setRetryNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false)
        || await getKingmakerLocalSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Kingmaker login required.");
      const response = await fetch("/api/kingmaker/obbfb-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify({ inventoryItemId: props.inventoryItemId }),
      });
      const payload = await response.json().catch(() => ({}));
      const previewOnly = response.status === 422 && payload.previewOnly === true;
      if (!previewOnly && (!response.ok || payload.success !== true)) {
        throw new Error(payload.error || "Archived-photo vision retry failed.");
      }
      const identity = payload.ai || {};
      setValues(identity);
      setTitle(String(payload.title || ""));
      setDescription(String(payload.description || ""));
      const suggested = Number(payload.pricing?.suggestedPrice);
      setMarketEvidence(payload.pricing || {});
      if (previewOnly) {
        setPrice("");
        setVisionComplete(false);
        setConfirmed(false);
        setError(String(payload.error));
        setRetryNotice(identity.notes ? String(identity.notes) : "Review the card details read from the saved photos.");
        return;
      }
      setPrice(Number.isFinite(suggested) && suggested > 0 ? suggested.toFixed(2) : "");
      setVisionComplete(payload.identityComplete === true);
      setConfirmed(false);
      setRetryNotice(
        (payload.identityComplete === true ? "Vision identified this card. " : "Vision returned partial details. ") +
        "Read the front/back, verify the exact identity and price, then lock. Model: " +
        String(payload.model || "card vision") +
        (payload.pricing?.status === "0 Comps — Seller Price Required" ? ". No valid sold comps — enter your price." : ".")
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Retry from archived photos failed.");
    } finally { setRetrying(false); }
  }

  const canSave = confirmed && !locked && !busy && !retrying;
  useImperativeHandle(ref, () => ({ canSave, save }));

  async function save() {
    if (!canSave || saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      // Same form supports both Kingmaker's HttpOnly admin cookie and a real
      // authenticated seller account on /seller/instacomp-scan.
      const session = await getFreshAccountSession(5 * 60, false)
        || await getKingmakerLocalSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Kingmaker seller login required.");
      const response = await fetch("/api/kingmaker/obbfb-lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + session.access_token,
        },
        body: JSON.stringify({
          confirmed: true, inventoryItemId: props.inventoryItemId,
          identity: values, title, description, price: Number(price),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success !== true) throw new Error(payload.error || "Owner lock not saved.");
      setLocked(true);
      setPrice(Number(payload.price).toFixed(2));
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Owner lock failed.");
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-emerald-700/60 bg-slate-950 p-4">
      <h3 className="text-lg font-black text-emerald-300">OBBFB — Verify & lock this physical card</h3>
      <p className="text-xs leading-5 text-slate-300">
        {visionComplete ? "Direct front/back vision supplied an editable draft. " : "The front/back photos are safely archived; vision has not yet completed. "}
        Sold comps are raw transaction evidence only.
        Saving locks your title, identity and price against automatic repricing. It does not publish.
      </p>
      {!locked ? (
        <button type="button" onClick={() => void retryArchivedVision()} disabled={retrying || busy}
          className="w-full rounded-lg border border-sky-500 bg-sky-950/60 px-4 py-3 text-sm font-black text-sky-100 disabled:opacity-50">
          {retrying ? "Reading saved front/back with card vision…" : "RETRY VISION USING SAVED PHOTOS — NO REUPLOAD"}
        </button>
      ) : null}
      {retryNotice ? <p className="rounded-lg border border-sky-500/50 bg-sky-950/40 p-3 text-sm text-sky-100">{retryNotice}</p> : null}
      {props.pricingStatus === "0 Comps — Seller Price Required" ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-950/40 p-3 text-sm font-bold text-amber-200">
          0 Comps — Seller Price Required. No fabricated sales or pricing.
        </p>
      ) : null}
      {locked ? (
        <p className="rounded-lg border border-emerald-500 bg-emerald-950/70 p-3 text-sm font-bold text-emerald-200">
          Operator verified. Identity and price locked, still private in Resale Pending.
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className="text-xs font-bold text-slate-300">
            {label}
            <input
              value={truth(values[key])}
              onChange={event => setField(key, event.target.value)}
              disabled={locked || busy}
              style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white disabled:opacity-60"
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-4">
        {(["isRookie", "isAutograph", "isRelic"] as const).map(key => (
          <label key={key} className="text-sm font-bold text-slate-300">
            <input type="checkbox" checked={values[key] === true}
              onChange={event => setField(key, event.target.checked)}
              disabled={locked || busy}
              className="mr-2 accent-emerald-500" />{key}
          </label>
        ))}
      </div>
      <label className="block text-xs font-bold text-slate-300">Autograph proof (must be physically visible or designated)
        <input value={truth(values.autographEvidence)}
          onChange={event => setField("autographEvidence", event.target.value)}
          disabled={locked || busy}
          style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      </label>
      <label className="block text-xs font-bold text-slate-300">Relic proof (visible swatch/patch/jersey)
        <input value={truth(values.relicEvidence)}
          onChange={event => setField("relicEvidence", event.target.value)}
          disabled={locked || busy}
          style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      </label>
      <button type="button" onClick={regenerate} disabled={locked || busy}
        className="rounded-lg border border-slate-600 px-3 py-2 text-sm font-bold text-slate-200 hover:border-emerald-400">
        Rebuild title and description from corrected details
      </button>
      <label className="block text-xs font-bold text-slate-300">Listing title (under 80 chars; denominator only, e.g. /99)
        <input value={title} maxLength={79} onChange={event => { setTitle(event.target.value); setConfirmed(false); }}
          disabled={locked || busy}
          style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
        <span className="text-slate-500">{title.length}/79 characters</span>
      </label>
      <label className="block text-xs font-bold text-slate-300">Description (full XX/YY serial, autograph, inscription and memorabilia)
        <textarea value={description} rows={5} onChange={event => { setDescription(event.target.value); setConfirmed(false); }}
          disabled={locked || busy}
          style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      </label>
      {marketEvidence ? (
        <>
          <MarketRows label="Exact sold comps" rows={marketEvidence.soldCompEvidence} identity={values} />
          <MarketRows label="Other exact sales excluded by pricing rules"
            rows={marketEvidence.rejectedSoldComps?.filter(row => isSoldPricingExclusion(row.reason)).map(row => row.sale)} identity={values} />
          <MarketRows label="Current eBay asking prices" rows={marketEvidence.activeCompetition} identity={values} />
        </>
      ) : null}
      <label className="block text-xs font-bold text-slate-300">Operator listing price (USD)
        <input value={price} type="number" min="0.01" step="0.01"
          onChange={event => { setPrice(event.target.value); setConfirmed(false); }}
          disabled={locked || busy}
          style={{ backgroundColor: "#0f172a", color: "#f8fafc" }}
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white" />
      </label>
      <label className="flex gap-3 text-sm font-semibold text-slate-300">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}
          disabled={locked || busy}
          className="accent-emerald-500" />
        I verified the actual front/back, exact card and serial, listing description and final price. Lock my edits.
      </label>
      {error ? <p className="rounded-lg border border-red-600 bg-red-950 p-3 text-red-200">{error}</p> : null}
      <button type="button" disabled={!canSave} onClick={() => void save()}
        className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-black text-slate-950 disabled:opacity-40">
        {locked ? "Verified & Locked" : busy ? "Saving verified edits…" : "SAVE & LOCK — NO PUBLISH"}
      </button>
    </section>
  );
});
