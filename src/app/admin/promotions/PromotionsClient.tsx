"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Promotion = {
  id: string;
  code: string;
  percent_off: number;
  first_order_only: boolean;
  active: boolean;
  expires_at: string | null;
  max_redemptions: number | null;
  times_redeemed: number;
  stripe_livemode: boolean;
  stripe_promotion_code_id: string | null;
  free_shipping: boolean;
  category_scope: string | null;
};

export default function PromotionsClient() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [deleteOnDeactivate, setDeleteOnDeactivate] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/promotions", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Promotions could not be loaded.");
    setPromotions(data.promotions || []);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load().catch((error) => setMessage(error.message));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  async function createPromotion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true);
    setMessage("");
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"), percentOff: form.get("percentOff"),
          firstOrderOnly: form.get("firstOrderOnly") === "on",
          freeShipping: form.get("freeShipping") === "on",
          category: form.get("category"),
          maxRedemptions: form.get("maxRedemptions"),
          expiresAt: form.get("expiresAt")
            ? new Date(String(form.get("expiresAt"))).toISOString()
            : null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Coupon could not be created.");
      setMessage("Coupon created and ready for TC checkout.");
      formElement.reset();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function action(id: string, body: Record<string, unknown>) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Coupon could not be updated.");
      setMessage("Promotion updated."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }


  async function removePromotion(promotion: Promotion) {
    const confirmed = window.confirm(
      `Deactivate and remove ${promotion.code} from Kingmaker? This cannot be undone. If the coupon has been redeemed, its transaction history will be preserved.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: promotion.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Coupon could not be removed.");
      setMessage(
        data.archived
          ? `${promotion.code} deactivated and removed from Kingmaker. Previous redemptions remain in the accounting history.`
          : `${promotion.code} deactivated and deleted.`,
      );
      setDeleteOnDeactivate((current) => ({ ...current, [promotion.id]: false }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-neutral-950 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Store checkout</p>
      <h1 className="mt-2 text-4xl font-black">Coupons</h1>
      <p className="mt-3 max-w-3xl text-neutral-600">Create checkout discount codes, with optional free shipping and first-order restrictions. Payments are securely processed by Stripe.</p>

      {message ? <div className="mt-5 rounded border border-amber-300 bg-amber-50 p-4 font-bold text-amber-950">{message}</div> : null}

      <form onSubmit={createPromotion} className="mt-7 grid gap-4 rounded-2xl border border-neutral-200 bg-white p-6 text-neutral-950 shadow-sm sm:grid-cols-2">
        <label className="font-bold">Coupon code<input name="code" placeholder="SAVE15" required className="mt-2 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-neutral-950 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-600" /></label>
        <label className="font-bold">Percent off<input name="percentOff" type="number" min="0.01" max="100" step="0.01" defaultValue="10" required className="mt-2 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-neutral-950 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-600" /></label>
        <label className="font-bold">Category (optional)<input name="category" placeholder="Leave blank for entire store" className="mt-2 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-neutral-950 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-600" /></label>
        <label className="flex items-center gap-3 font-bold"><input name="freeShipping" type="checkbox" className="h-5 w-5 accent-emerald-600" />Free shipping for eligible orders</label>
        <label className="font-bold">Maximum redemptions (optional)<input name="maxRedemptions" type="number" min="1" step="1" className="mt-2 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-neutral-950 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-600" /></label>
        <label className="font-bold">Expiration (optional)<input name="expiresAt" type="datetime-local" className="mt-2 min-h-12 w-full rounded border border-neutral-300 bg-white px-3 text-neutral-950 placeholder:text-neutral-500 focus:border-emerald-600 focus:outline-2 focus:outline-offset-1 focus:outline-emerald-600" /></label>
        <label className="flex items-center gap-3 font-bold"><input name="firstOrderOnly" type="checkbox" className="h-5 w-5 accent-emerald-600" />First successful order only</label>
        <button type="submit" disabled={busy} className="min-h-12 rounded bg-neutral-950 px-5 font-black text-white disabled:opacity-50">{busy ? "Working..." : "Create coupon"}</button>
      </form>

      <section className="mt-8 space-y-4">
        {promotions.some((promotion) => !promotion.active) ? (
          <button type="button" className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-100"
            onClick={() => setShowInactive((current) => !current)}>
            {showInactive ? "Hide inactive coupons" : "Show inactive coupons"}
          </button>
        ) : null}
        {promotions.filter((promotion) => showInactive || promotion.active).length === 0 ? (
          <p className="rounded-xl border border-neutral-200 bg-white p-5 text-neutral-700">No active coupon codes.</p>
        ) : null}
        {promotions.filter((promotion) => showInactive || promotion.active).map((promotion) => (
          <article key={promotion.id} className="rounded-2xl border border-neutral-200 bg-white p-5 text-neutral-950 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="text-2xl font-black">{promotion.code}</h2><p className="mt-1 font-semibold text-neutral-600">{promotion.percent_off}% off{promotion.free_shipping ? " + free shipping" : ""}{promotion.category_scope ? ` - ${promotion.category_scope}` : ""}{promotion.first_order_only ? " - first order only" : ""} - {promotion.stripe_promotion_code_id ? (promotion.stripe_livemode ? "LIVE Stripe" : "TEST Stripe") : "TC checkout"}</p></div>
              <span className={`rounded-full px-3 py-1 text-sm font-black ${promotion.active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200"}`}>{promotion.active ? "ACTIVE" : "INACTIVE"}</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {promotion.active ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deleteOnDeactivate[promotion.id]
                    ? void removePromotion(promotion)
                    : void action(promotion.id, { action: "set-active", active: false })}
                  className={`min-h-11 rounded border px-4 font-bold disabled:opacity-50 ${deleteOnDeactivate[promotion.id] ? "border-red-300 text-red-800 hover:bg-red-50" : "border-neutral-300 text-neutral-950 hover:bg-neutral-100"}`}
                >
                  {deleteOnDeactivate[promotion.id] ? "Deactivate & delete" : "Deactivate"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void action(promotion.id, { action: "set-active", active: true })}
                  className="min-h-11 rounded border border-neutral-300 px-4 font-bold text-neutral-950 hover:bg-neutral-100 disabled:opacity-50"
                >
                  Reactivate
                </button>
              )}
              {!promotion.active && deleteOnDeactivate[promotion.id] ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removePromotion(promotion)}
                  className="min-h-11 rounded border border-red-300 px-4 font-bold text-red-800 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete coupon
                </button>
              ) : null}
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-800">
                <input
                  type="checkbox"
                  checked={Boolean(deleteOnDeactivate[promotion.id])}
                  disabled={busy}
                  onChange={(event) =>
                    setDeleteOnDeactivate((current) => ({ ...current, [promotion.id]: event.target.checked }))
                  }
                  className="h-5 w-5 accent-red-700"
                />
                Delete instead of keeping inactive
              </label>
            </div>
            {deleteOnDeactivate[promotion.id] ? (
              <p className="mt-2 text-xs text-neutral-600">
                Confirmation is required. Inactive, unused codes are deleted. Active or redeemed codes are removed from the list but retained as inactive records to protect checkout and order history.
              </p>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
