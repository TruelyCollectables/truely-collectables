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
};

export default function PromotionsClient() {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/promotions", { cache: "no-store" });
    const data = await response.json();
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
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"), percentOff: form.get("percentOff"),
          firstOrderOnly: form.get("firstOrderOnly") === "on",
          maxRedemptions: form.get("maxRedemptions"), expiresAt: form.get("expiresAt"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Coupon could not be created.");
      setMessage("Coupon created and ready for Stripe Checkout.");
      event.currentTarget.reset();
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Coupon could not be updated.");
      setMessage("Promotion updated."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-700">Store checkout</p>
      <h1 className="mt-2 text-4xl font-black">Coupons</h1>
      <p className="mt-3 max-w-3xl text-neutral-600">Create Stripe-backed coupon codes and restrict them to first-time buyers when needed.</p>

      {message ? <div className="mt-5 rounded border border-amber-300 bg-amber-50 p-4 font-bold">{message}</div> : null}

      <form onSubmit={createPromotion} className="mt-7 grid gap-4 rounded-2xl border bg-white p-6 shadow-sm sm:grid-cols-2">
        <label className="font-bold">Coupon code<input name="code" defaultValue="1st10" required className="mt-2 min-h-12 w-full rounded border px-3" /></label>
        <label className="font-bold">Percent off<input name="percentOff" type="number" min="0.01" max="100" step="0.01" defaultValue="10" required className="mt-2 min-h-12 w-full rounded border px-3" /></label>
        <label className="font-bold">Maximum redemptions (optional)<input name="maxRedemptions" type="number" min="1" step="1" className="mt-2 min-h-12 w-full rounded border px-3" /></label>
        <label className="font-bold">Expiration (optional)<input name="expiresAt" type="datetime-local" className="mt-2 min-h-12 w-full rounded border px-3" /></label>
        <label className="flex items-center gap-3 font-bold"><input name="firstOrderOnly" type="checkbox" defaultChecked className="h-5 w-5" />First successful order only</label>
        <button disabled={busy} className="min-h-12 rounded bg-neutral-950 px-5 font-black text-white disabled:opacity-50">{busy ? "Working..." : "Create coupon"}</button>
      </form>

      <section className="mt-8 space-y-4">
        {promotions.map((promotion) => (
          <article key={promotion.id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><h2 className="text-2xl font-black">{promotion.code}</h2><p className="mt-1 font-semibold text-neutral-600">{promotion.percent_off}% off{promotion.first_order_only ? " - first order only" : ""} - {promotion.stripe_livemode ? "LIVE Stripe" : "TEST Stripe"}</p></div>
              <span className={`rounded-full px-3 py-1 text-sm font-black ${promotion.active ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200"}`}>{promotion.active ? "ACTIVE" : "INACTIVE"}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button disabled={busy} onClick={() => action(promotion.id, { action: "set-active", active: !promotion.active })} className="min-h-11 rounded border px-4 font-bold">{promotion.active ? "Deactivate" : "Activate"}</button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
